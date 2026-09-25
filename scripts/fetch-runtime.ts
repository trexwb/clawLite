#!/usr/bin/env node
/**
 * Claw Lite — DSH 本地运行时拉取脚本（Electron 版）
 * ═══════════════════════════════════════════════════════════════════
 * 目标：把 @deepseek-ai/dsh 依赖树固化到 resources/dsh/，
 *       随 Electron 安装包一起分发，使用户无需安装 Node 环境。
 *
 * 为什么不再下载 Node 解释器：
 *   Electron 自带 Node 运行时（process.versions.node）。
 *   主进程 spawn 时置 ELECTRON_RUN_AS_NODE=1、并以 process.execPath
 *   作为解释器，即可直接执行 dsh 入口脚本 —— 无需外挂 node 二进制。
 *
 * 产物布局（打包后位于 ClawLite.app/Contents/Resources/dsh/）：
 *   dsh/
 *   ├─ app/            dsh 依赖树根（含 package.json 与 node_modules）
 *   └─ runtime.json    版本清单（dsh 版本 / 目标平台 / 拉取时间）
 *
 * 用法：
 *   node scripts/fetch-runtime.ts                    # 当前平台
 *   node scripts/fetch-runtime.ts --target win-x64   # 交叉准备（npm --os 模拟）
 *   node scripts/fetch-runtime.ts --from-npx         # 复用 ~/.npm/_npx 缓存（仅同平台，快）
 *   node scripts/fetch-runtime.ts --force            # 忽略已有产物重新拉取
 *
 * 说明：
 *   • 依赖树含平台相关原生模块（node-pty / sharp / node-addon-require-builtin），
 *     每个平台必须在自己的构建机上安装，不能跨平台复用。
 *   • 本脚本不依赖 PATH 中的 node/npm：npm 通过 process.execPath 反查 npm-cli.js 调用。
 *   • 源码为 .ts（node 原生类型擦除直跑），无需编译步骤。
 * ═══════════════════════════════════════════════════════════════════
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, cpSync, rmSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import os from 'node:os'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const RES_DIR = join(ROOT, 'resources', 'dsh')
const APP_DIR = join(RES_DIR, 'app')

/**
 * 固定 dsh 版本，保证可复现；升级时改这里。
 *
 * ⚠️ 版本约束：0.1.7-rc.2（next 标签）起，dsh 启动必经 dsh-app-boot 的
 * installRuntimeInterception，其原生依赖 node-addon-require-builtin@0.1.6
 * 内嵌运行时指纹白名单，仅支持 Electron 43.0.0 / 44.0.0 / 45.0.0-alpha.6。
 * 本应用使用 Electron ^44.4.5（V8 15.2.124.28），不在白名单内，会导致
 * "host preparation failed" 致命退出。故暂锁定 0.1.5-rc.3；待 dsh 支持
 * Electron 44.4.x 或本应用调整 Electron 版本后再升级。
 */
const DSH_VERSION = '0.1.5-rc.3'

// ── 参数解析 ───────────────────────────────────────────────────────
const argv = process.argv.slice(2)
const hasFlag = (f: string): boolean => argv.includes(f)
const optValue = (f: string): string | null => {
  const i = argv.indexOf(f)
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null
}

const FORCE = hasFlag('--force')
const FROM_NPX = hasFlag('--from-npx')

/** 目标平台：darwin-arm64 | darwin-x64 | win-x64 | linux-x64 */
function detectPlatform(): string {
  const explicit = optValue('--target')
  if (explicit) return explicit
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
  if (process.platform === 'darwin') return `darwin-${arch}`
  if (process.platform === 'win32') return `win-${arch}`
  return `linux-${arch}`
}
const PLATFORM = detectPlatform()
const IS_WIN = PLATFORM.startsWith('win')

const log = (msg: string): void => console.log(`[runtime] ${msg}`)
const fail = (msg: string): never => {
  console.error(`[runtime] ✗ ${msg}`)
  process.exit(1)
}
const errText = (e: unknown): string => (e instanceof Error ? e.stack || e.message : String(e))

// ── npm 调用（不依赖 PATH）─────────────────────────────────────────
function resolveNpmCli(): string | null {
  const exeDir = dirname(process.execPath)
  const candidates = IS_WIN
    ? [join(exeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js')]
    : [
        join(exeDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
        join(exeDir, '..', '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
      ]
  for (const c of candidates) if (existsSync(c)) return c
  return null
}

function runNpm(args: string[], cwd: string): void {
  const cli = resolveNpmCli()
  const label = cli ? `node ${cli}` : 'npm'
  log(`运行 ${label} ${args.join(' ')}`)
  if (cli) {
    execFileSync(process.execPath, [cli, ...args], { cwd, stdio: 'inherit' })
  } else {
    execFileSync('npm', args, { cwd, stdio: 'inherit', shell: IS_WIN })
  }
}

// ── dsh 依赖树 ─────────────────────────────────────────────────────
function dshVersionOf(nmDir: string): string | null {
  const p = join(nmDir, '@deepseek-ai', 'dsh', 'package.json')
  if (!existsSync(p)) return null
  try {
    return (JSON.parse(readFileSync(p, 'utf8')) as { version?: string }).version ?? null
  } catch {
    return null
  }
}

/** 在本机 ~/.npm/_npx 缓存里找版本匹配的 dsh 依赖树 */
function findNpxCache(): string | null {
  const base = join(os.homedir(), '.npm', '_npx')
  if (!existsSync(base)) return null
  for (const entry of readdirSync(base)) {
    const nm = join(base, entry, 'node_modules')
    if (dshVersionOf(nm) === DSH_VERSION) return nm
  }
  return null
}

function writeAppPackageJson(): void {
  mkdirSync(APP_DIR, { recursive: true })
  writeFileSync(
    join(APP_DIR, 'package.json'),
    JSON.stringify(
      {
        name: 'clawlite-dsh-runtime',
        private: true,
        version: '1.0.0',
        description: 'Claw Lite 内置 DSH 运行时依赖树（由 scripts/fetch-runtime.ts 生成）',
        dependencies: { '@deepseek-ai/dsh': DSH_VERSION },
      },
      null,
      2
    ) + '\n'
  )
}

function copyFromNpx(nmSrc: string): void {
  const nmDst = join(APP_DIR, 'node_modules')
  log(`复用 npx 缓存：${nmSrc} → ${nmDst}（约 280MB，请稍候）`)
  mkdirSync(APP_DIR, { recursive: true })
  cpSync(nmSrc, nmDst, { recursive: true, dereference: true })
}

function installFromRegistry(): void {
  writeAppPackageJson()
  const args = ['install', '--omit=dev', '--no-audit', '--no-fund', '--loglevel=error']
  if (PLATFORM.startsWith('win')) {
    args.push('--os=win32', '--cpu=x64')
  } else if (PLATFORM.startsWith('darwin')) {
    args.push('--os=darwin', `--cpu=${PLATFORM.endsWith('arm64') ? 'arm64' : 'x64'}`)
  }
  runNpm(args, APP_DIR)
}

/** 写入运行时清单（每次执行都刷新，保证字段格式与版本同步） */
function writeManifest(manifestPath: string): void {
  writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        platform: PLATFORM,
        dshVersion: DSH_VERSION,
        entry: 'node_modules/@deepseek-ai/dsh/lib/bin.js',
        nodeRuntime: 'electron',
        fetchedAt: new Date().toISOString(),
      },
      null,
      2
    ) + '\n'
  )
}

/**
 * Electron 版不再需要外挂 node 二进制。
 * 默认只提示、不删除（避免脚本隐式执行删除动作）；
 * 显式传 --prune-node 才真正清理历史遗留文件。
 */
function pruneLegacyNode(): void {
  const legacy = join(RES_DIR, IS_WIN ? 'node.exe' : 'node')
  if (!existsSync(legacy)) return
  if (!hasFlag('--prune-node')) {
    log(`提示：检测到历史遗留的 node 解释器 ${legacy}`)
    log('      Electron 自带 Node，该文件已无用且已被打包配置排除；')
    log('      如需清理请执行：node scripts/fetch-runtime.ts --prune-node')
    return
  }
  try {
    rmSync(legacy, { force: true })
    log(`已清理历史遗留的 node 解释器：${legacy}`)
  } catch (e) {
    log(`⚠ 未能清理 ${legacy}：${e instanceof Error ? e.message : String(e)}`)
  }
}

// ── 主流程 ─────────────────────────────────────────────────────────
function main(): void {
  log(`目标平台：${PLATFORM}`)

  const dshBin = join(APP_DIR, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  const manifestPath = join(RES_DIR, 'runtime.json')

  if (!FORCE && existsSync(dshBin) && existsSync(manifestPath)) {
    const m = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      platform?: string
      dshVersion?: string
    }
    if (m.platform === PLATFORM && m.dshVersion === DSH_VERSION) {
      log(`运行时已就绪（dsh ${m.dshVersion}），跳过安装。加 --force 可强制重拉。`)
      writeManifest(manifestPath) // 仍刷新清单，保证字段格式与版本同步
      pruneLegacyNode()
      return
    }
    log('平台或 dsh 版本变化，重新拉取。')
  }

  // dsh 依赖树
  const existing = dshVersionOf(join(APP_DIR, 'node_modules'))
  if (!FORCE && existing === DSH_VERSION) {
    log(`dsh 依赖树已存在（${existing}），跳过安装。`)
  } else {
    const npxNm = FROM_NPX || !process.env.CI ? findNpxCache() : null
    if (npxNm && (!IS_WIN || process.platform === 'win32')) {
      copyFromNpx(npxNm)
    } else {
      installFromRegistry()
    }
    const got = dshVersionOf(join(APP_DIR, 'node_modules'))
    if (got !== DSH_VERSION) fail(`dsh 依赖树版本不符：期望 ${DSH_VERSION}，实际 ${got ?? '缺失'}`)
  }

  // 清单
  writeManifest(manifestPath)

  pruneLegacyNode()

  log('✓ 运行时准备完成')
  log(`  依赖树：${join(APP_DIR, 'node_modules')}`)
  log('  解释器：Electron 内置 Node（运行时无需外挂）')
}

try {
  main()
} catch (e) {
  fail(errText(e))
}
