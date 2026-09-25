/* ═══════════════════════════════════════════════════════════════════
   Claw Lite — DSH 版本运行时拉取（主进程侧）
   ───────────────────────────────────────────────────────────────────
   职责：把 scripts/fetch-runtime.ts 的"构建时拉取"逻辑下沉为"运行时拉取"，
   使 DSH 版本与应用版本解耦：用户装一次 clawLite，即可在设置里选 latest
   （自动跟随 npm 最新版）或锁定某个具体版本，无需等应用发版。

   设计要点：
     • 版本号来自 npm registry（HTTPS），不经过渲染层 CSP 限制
       （主进程是纯 Node，无 CSP 约束）。
     • 安装到 userData/dsh-versions/<ver>/app/node_modules，与构建时
       resources/dsh/app 目录结构一致，harness 的 dshEntry 路径不变。
     • npm 由应用打包内置（electron-builder extraResources → resourcesPath/npm），
       不依赖用户系统装有 npm / Node。
     • 原生模块 ABI：下载的预编译二进制若与 Electron 44 ABI 不兼容，
       拉起会失败——此时 harness 回退内置 DSH 并记日志，需实测后补
       @electron/rebuild（见 AGENTS.md / 本文件底部 TODO）。
   ═══════════════════════════════════════════════════════════════════ */

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const REGISTRY = 'https://registry.npmjs.org'
const PKG = '@deepseek-ai/dsh'

export const errText = (e: unknown): string =>
  e instanceof Error ? e.message : String(e)

/** 查 npm registry 拿 latest 版本号 */
export async function fetchLatestVersion(): Promise<string> {
  const res = await fetch(`${REGISTRY}/${PKG}/latest`)
  if (!res.ok) throw new Error(`registry 查询失败（latest）：${res.status}`)
  const data = (await res.json()) as { version?: string }
  if (!data.version) throw new Error('registry 未返回版本号')
  return data.version
}

/** 查 npm registry 拿全部版本号（含 prerelease），降序排列（最新在前） */
export async function fetchAllVersions(): Promise<string[]> {
  const res = await fetch(`${REGISTRY}/${PKG}`)
  if (!res.ok) throw new Error(`registry 查询失败（versions）：${res.status}`)
  const data = (await res.json()) as { versions?: Record<string, unknown> }
  if (!data.versions) throw new Error('registry 未返回版本列表')
  // sensitivity 仅接受 'base' | 'accent' | 'case' | 'variant'，'version' 会被 ICU
  // 直接拒绝并在运行时抛 RangeError（此前用 as any 压掉类型错误，等于把编译期报错
  // 换成了运行期崩溃）。版本号排序只需 numeric:true，sensitivity 用默认值 'variant'。
  return Object.keys(data.versions).sort((a, b) =>
    b.localeCompare(a, undefined, { numeric: true })
  )
}

/**
 * 定位 npm-cli.js：优先级
 *   1. 应用内置（electron-builder 把 npm 打到 resourcesPath/npm）
 *   2. Electron 自带（开发态 process.execPath 旁）
 *   3. 系统 PATH（兜底，用户机器通常没有）
 */
export function resolveNpmCli(electronExecPath: string, resourcesPath: string): string | null {
  const exeDir = path.dirname(electronExecPath)
  const candidates = [
    path.join(resourcesPath, 'npm', 'bin', 'npm-cli.js'),
    path.join(exeDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(exeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ]
  for (const c of candidates) if (fs.existsSync(c)) return c
  return null
}

/** 在版本目录写入一个最小 package.json，让 npm install 把 dsh 装进 app/node_modules */
function writeAppPackageJson(appDir: string, version: string): void {
  fs.mkdirSync(appDir, { recursive: true })
  fs.writeFileSync(
    path.join(appDir, 'package.json'),
    JSON.stringify(
      {
        name: 'clawlite-dsh-runtime',
        private: true,
        version: '1.0.0',
        description: `Claw Lite DSH 运行时依赖树（${version}）`,
        dependencies: { '@deepseek-ai/dsh': version },
      },
      null,
      2
    ) + '\n'
  )
}

export interface EnsureResult {
  ok: boolean
  dshRoot: string
  reason?: string
}

/**
 * 确保某版本已安装到 userData/dsh-versions/<ver>/app/node_modules。
 * 已存在则直接返回；否则 npm install 到该目录。
 */
export function ensureVersionInstalled(
  version: string,
  userDataDir: string,
  electronExecPath: string,
  resourcesPath: string,
  platform: string
): EnsureResult {
  const verDir = path.join(userDataDir, 'dsh-versions', version)
  const appDir = path.join(verDir, 'app')
  const dshBin = path.join(appDir, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  if (fs.existsSync(dshBin)) return { ok: true, dshRoot: verDir }

  writeAppPackageJson(appDir, version)

  const npmCli = resolveNpmCli(electronExecPath, resourcesPath)
  const args = ['install', '--omit=dev', '--no-audit', '--no-fund', '--loglevel=error']
  if (platform.startsWith('win')) args.push('--os=win32', '--cpu=x64')
  else if (platform.startsWith('darwin')) args.push('--os=darwin', `--cpu=${platform.endsWith('arm64') ? 'arm64' : 'x64'}`)
  else args.push('--os=linux', '--cpu=x64')

  try {
    if (npmCli) {
      execFileSync(electronExecPath, [npmCli, ...args], { cwd: appDir, stdio: 'inherit' })
    } else {
      execFileSync('npm', args, { cwd: appDir, stdio: 'inherit', shell: platform.startsWith('win') })
    }
  } catch (e) {
    return { ok: false, dshRoot: verDir, reason: errText(e) }
  }

  if (!fs.existsSync(dshBin)) {
    return { ok: false, dshRoot: verDir, reason: '安装后未找到 dsh 入口（原生模块可能需针对 Electron 重编）' }
  }
  return { ok: true, dshRoot: verDir }
}
