/* ═══════════════════════════════════════════════════════════════════
   Claw Lite — DSH 版本下载（异步 + 进度上报）
   ───────────────────────────────────────────────────────────────────
   职责：把 version-fetch.ts 里"同步阻塞式"的 ensureVersionInstalled 升级为
   可观测的异步下载：设置页选定版本后立即开跑，主进程按帧上报进度，
   渲染层画出进度条，下载完成即可切换启动（无需重启应用 / 无需等下次打开）。

   与旧实现的区别：
     • 不再 execFileSync 阻塞主进程 —— 改为 spawn + 流式消费 npm 输出，
       主进程全程可响应 IPC（进度、取消）。
     • 进度来源（实测确认，见 scripts/check.ts 无关，属运行期行为）：
         - 分母：`npm install --dry-run` 打印的 `add <pkg> <ver>` 行数
           （即本次依赖树需要落地的包总数）
         - 分子 A：npm 日志里出现的 tarball URL 去重计数
             冷缓存 → `npm http fetch GET 200 <url>.tgz 123ms (cache miss)`
             热缓存 → `npm http cache <pkg>@<url>.tgz 0ms (cache hit)`
           两种形态都含 `.tgz`，统一正则提取 URL 去重。
         - 分子 B：目标 node_modules 下已落地的包目录数（递归统计）
           —— 热缓存时 tarball 计数会瞬间打满，真正耗时在解包落盘，
           故取 max(A, B) 作为已完成量，进度条才不会卡在 90% 不动。
     • 目录布局与旧实现完全一致：userData/dsh-versions/<ver>/app/node_modules，
       harness 的 dshEntry 推导路径不变。

   本文件不依赖 electron（仅 node 内置模块），可被脚本直接跑测试。
   ═══════════════════════════════════════════════════════════════════ */

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { errText } from './version-fetch.ts'

/**
 * 下载阶段枚举（单一来源）：
 * 渲染层 PHASE_LABEL 的键必须与本数组严格一致，
 * scripts/check.ts §12 双向校验，杜绝"主进程置入的状态没有文案"这类死枚举。
 */
export const DOWNLOAD_PHASES = [
  'idle',
  'resolving',
  'downloading',
  'installing',
  'verifying',
  'done',
  'error',
] as const

export type DownloadPhase = (typeof DOWNLOAD_PHASES)[number]

/** 一次版本下载任务的完整状态（随 harness:versionProgress 事件推给渲染层） */
export interface VersionJob {
  /** 用户选定的版本策略：'latest' 或具体版本号 */
  policy: string
  /** 实际下载的具体版本号（latest 已展开） */
  version: string
  phase: DownloadPhase
  /** 0–100；total 未知时为 0，渲染层据此显示不确定进度条 */
  percent: number
  /** 已获取的依赖包数（tarball 去重计数） */
  fetched: number
  /** 依赖包总数（--dry-run 预解析；未知为 0） */
  total: number
  message: string
  error: string
  startedAt: number
  finishedAt: number
  /** 是否已就绪（bin.js 落盘可启动） */
  installed: boolean
}

export interface DownloadOptions {
  /** 目标版本号（具体值，不接受 latest） */
  version: string
  /** 版本策略原文，用于回显（默认取 version） */
  policy?: string
  /** 应用数据目录（版本树落在 <userDataDir>/dsh-versions/<ver>） */
  userDataDir: string
  /** npm-cli.js 绝对路径；null 时退回 PATH 上的 npm */
  npmCli: string | null
  /** 执行 npm-cli.js 的解释器（Electron 可执行文件或 node） */
  nodeExec: string
  /** 平台标签，如 darwin-arm64 / win-x64；默认取当前平台 */
  platform?: string
  onProgress?: (job: VersionJob) => void
  /** 非高频行（npm 告警/错误/汇总）转发给运行日志 */
  onLog?: (line: string) => void
  signal?: AbortSignal
}

/** 进度上报节流：npm 输出可达数百行/秒，逐行广播会打爆 IPC 与渲染帧 */
const EMIT_INTERVAL_MS = 120
/** node_modules 落地统计间隔（递归 readdir 有成本，不必每帧都跑） */
const WALK_INTERVAL_MS = 900
/** --dry-run 预解析超时：拿不到总数就退化为不确定进度，不能拖住安装 */
const DRY_RUN_TIMEOUT_MS = 120_000
/** 进度映射区间：下载/安装阶段占 5%–95%，留出解析与校验的刻度 */
const PCT_BASE = 5
const PCT_SPAN = 90
const MAX_ERROR_CHARS = 300

export function versionDir(userDataDir: string, version: string): string {
  return path.join(userDataDir, 'dsh-versions', version)
}

/** 版本树里的 dsh 入口（与 resources/dsh/app 结构一致） */
function versionEntry(userDataDir: string, version: string): string {
  return path.join(versionDir(userDataDir, version), 'app', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
}

/** 该版本是否已就绪（bin.js 存在即可启动） */
export function isVersionReady(userDataDir: string, version: string): boolean {
  if (!version) return false
  return fs.existsSync(versionEntry(userDataDir, version))
}

/** 在版本目录写入最小 package.json，让 npm install 把 dsh 装进 app/node_modules */
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

/**
 * 平台参数：依赖树含平台相关原生模块（node-pty / sharp 等），
 * 跨平台准备时必须显式指定 --os/--cpu，否则装出来的是当前平台二进制。
 */
function platformArgs(platform: string): string[] {
  const arch = platform.endsWith('arm64') ? 'arm64' : 'x64'
  if (platform.startsWith('win')) return ['--os=win32', '--cpu=x64']
  if (platform.startsWith('darwin')) return ['--os=darwin', `--cpu=${arch}`]
  return ['--os=linux', `--cpu=${arch}`]
}

interface NpmRunner {
  exec: string
  argv: string[]
  shell: boolean
  env: NodeJS.ProcessEnv
}

/**
 * 构造 npm 执行体：
 *   有 npm-cli.js → 用 Electron 自身（ELECTRON_RUN_AS_NODE=1）当 Node 跑它，
 *   用户机器无需安装 Node/npm；否则退回 PATH 上的 npm（开发机兜底）。
 */
function npmRunner(npmCli: string | null, nodeExec: string, npmArgs: string[], platform: string): NpmRunner {
  if (npmCli) {
    return {
      exec: nodeExec,
      argv: [npmCli, ...npmArgs],
      shell: false,
      // 关键：让 Electron 可执行文件以纯 Node 模式运行 npm-cli.js
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    }
  }
  return {
    exec: platform.startsWith('win') ? 'npm.cmd' : 'npm',
    argv: npmArgs,
    shell: platform.startsWith('win'),
    env: { ...process.env },
  }
}

/** 流式跑一个 npm 子进程，逐行回调；返回退出码（启动失败 / 被杀为 -1） */
function runNpm(
  cwd: string,
  runner: NpmRunner,
  onLine: (line: string) => void,
  signal?: AbortSignal
): Promise<number> {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(runner.exec, runner.argv, {
        cwd,
        env: runner.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: runner.shell,
        windowsHide: true,
      })
    } catch (e) {
      onLine(`npm 启动失败：${errText(e)}`)
      resolve(-1)
      return
    }

    const kill = (): void => {
      try {
        child.kill('SIGKILL')
      } catch {}
    }
    signal?.addEventListener('abort', kill, { once: true })

    const consume = (stream: NodeJS.ReadableStream | null): void => {
      if (!stream) return
      let buf = ''
      stream.setEncoding('utf8')
      stream.on('data', (chunk: string) => {
        buf += chunk
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        for (const l of lines) onLine(l.replace(/\r$/, ''))
      })
      stream.on('end', () => {
        if (buf.trim()) onLine(buf.trim())
      })
    }
    consume(child.stdout)
    consume(child.stderr)

    let done = false
    const finish = (code: number): void => {
      if (done) return
      done = true
      signal?.removeEventListener('abort', kill)
      resolve(code)
    }
    child.on('error', (e) => {
      onLine(`npm 进程错误：${errText(e)}`)
      finish(-1)
    })
    child.on('exit', (code) => finish(code ?? -1))
  })
}

/**
 * 预解析依赖总数：`npm install --dry-run` 会逐行打印 `add <pkg> <ver>`。
 * 失败/超时返回 0（进度条退化为不确定态），绝不阻塞真正的安装。
 */
async function resolveTotal(
  appDir: string,
  runner: NpmRunner,
  onLine: (line: string) => void,
  signal?: AbortSignal
): Promise<number> {
  const pkgs = new Set<string>()
  const collect = (line: string): void => {
    const m = line.match(/^add (\S+)/)
    if (m) pkgs.add(m[1])
  }
  let timedOut = false
  const ac = new AbortController()
  const timer = setTimeout(() => {
    timedOut = true
    ac.abort()
  }, DRY_RUN_TIMEOUT_MS)
  const onOuterAbort = (): void => ac.abort()
  signal?.addEventListener('abort', onOuterAbort, { once: true })

  try {
    await runNpm(appDir, runner, (line) => {
      collect(line)
      if (/^npm (error|ERR!)/i.test(line)) onLine(line)
    }, ac.signal)
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onOuterAbort)
  }
  if (timedOut) onLine('[claw-lite] ⚠ 依赖数预解析超时，进度条改为不确定态')
  return pkgs.size
}

/**
 * 统计目标 node_modules 下已落地的包目录数（含 @scope 展开与嵌套依赖）。
 * 热缓存下 tarball 计数瞬间打满，真正耗时在解包落盘，用本计数让进度条持续前进。
 * 只读目录、不进入 .bin/.cache 等非包目录；异常一律吞掉（统计失败不影响安装）。
 */
function countPackages(nmDir: string): number {
  let count = 0
  const stack: { dir: string; depth: number }[] = [{ dir: nmDir, depth: 0 }]
  while (stack.length) {
    const cur = stack.pop()!
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(cur.dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      if (!e.isDirectory() && !e.isSymbolicLink()) continue
      const name = e.name
      if (name.startsWith('.') || name === 'node_modules') continue
      if (name.startsWith('@')) {
        // scope 目录本身不算包，展开后再计
        stack.push({ dir: path.join(cur.dir, name), depth: cur.depth })
        continue
      }
      count++
      if (cur.depth < 6) {
        const nested = path.join(cur.dir, name, 'node_modules')
        if (fs.existsSync(nested)) stack.push({ dir: nested, depth: cur.depth + 1 })
      }
    }
  }
  return count
}

/**
 * 下载（并安装）某个 DSH 版本，全程回调进度。永不 reject：
 * 失败以 phase='error' + error 文案返回，调用方只需看 installed。
 */
export async function downloadVersion(opts: DownloadOptions): Promise<VersionJob> {
  const platform = opts.platform || `${process.platform}-${process.arch}`
  const version = opts.version
  const appDir = path.join(versionDir(opts.userDataDir, version), 'app')
  const bin = versionEntry(opts.userDataDir, version)

  const job: VersionJob = {
    policy: opts.policy || version,
    version,
    phase: 'resolving',
    percent: 1,
    fetched: 0,
    total: 0,
    message: '正在解析依赖…',
    error: '',
    startedAt: Date.now(),
    finishedAt: 0,
    installed: false,
  }

  let lastEmit = 0
  const emit = (force = false): void => {
    const now = Date.now()
    if (!force && now - lastEmit < EMIT_INTERVAL_MS) return
    lastEmit = now
    opts.onProgress?.({ ...job })
  }
  const settle = (phase: DownloadPhase, message: string, percent?: number): VersionJob => {
    job.phase = phase
    job.message = message
    if (percent !== undefined) job.percent = percent
    if (phase === 'done' || phase === 'error' || phase === 'idle') job.finishedAt = Date.now()
    emit(true)
    return { ...job }
  }

  if (isVersionReady(opts.userDataDir, version)) {
    job.installed = true
    job.fetched = 0
    return settle('done', '本地已下载，可直接切换启动', 100)
  }

  try {
    fs.mkdirSync(appDir, { recursive: true })
    writeAppPackageJson(appDir, version)
  } catch (e) {
    job.error = errText(e)
    return settle('error', `无法创建版本目录：${job.error}`, 0)
  }

  const runner = npmRunner(
    opts.npmCli,
    opts.nodeExec,
    ['install', '--omit=dev', '--no-audit', '--no-fund', '--loglevel=http', ...platformArgs(platform)],
    platform
  )
  if (!opts.npmCli) {
    opts.onLog?.('[claw-lite] ⚠ 未找到内置 npm-cli.js，回退系统 PATH 上的 npm')
  }

  // ── 1) 预解析依赖总数（拿到分母）────────────────────────────────
  emit(true)
  const dryRunner = npmRunner(
    opts.npmCli,
    opts.nodeExec,
    ['install', '--dry-run', '--omit=dev', '--no-audit', '--no-fund', ...platformArgs(platform)],
    platform
  )
  const total = await resolveTotal(appDir, dryRunner, (l) => opts.onLog?.(l), opts.signal)
  if (opts.signal?.aborted) return settle('idle', '已取消下载', 0)
  job.total = total

  // ── 2) 正式安装（流式估算进度）──────────────────────────────────
  const tarballs = new Set<string>()
  let extracted = 0
  let lastWalk = 0

  const tick = (force = false): void => {
    const now = Date.now()
    if (force || now - lastWalk >= WALK_INTERVAL_MS) {
      lastWalk = now
      extracted = Math.max(extracted, countPackages(path.join(appDir, 'node_modules')))
    }
    job.fetched = tarballs.size
    const landed = Math.max(job.fetched, extracted)
    if (job.total > 0) {
      const fetchedAll = job.fetched >= job.total
      job.phase = fetchedAll ? 'installing' : 'downloading'
      job.percent = Math.min(95, Math.round(PCT_BASE + PCT_SPAN * Math.min(1, landed / job.total)))
      job.message = fetchedAll
        ? `正在安装依赖树 ${Math.min(landed, job.total)}/${job.total}`
        : `正在下载依赖包 ${job.fetched}/${job.total}`
    } else {
      job.phase = 'downloading'
      job.percent = 0
      job.message = `正在下载依赖包（已获取 ${job.fetched} 个）`
    }
    emit(force)
  }
  tick(true)

  const code = await runNpm(
    appDir,
    runner,
    (line) => {
      if (line.includes('.tgz')) {
        const m = line.match(/(https?:\/\/\S+\.tgz)/)
        if (m && !tarballs.has(m[1])) {
          tarballs.add(m[1])
          tick()
        }
        return
      }
      if (/^npm (error|ERR!)/i.test(line)) job.error = line.slice(0, MAX_ERROR_CHARS)
      // http/silly/verbose 等高频行只用于估算进度，不进日志面板
      if (!/^npm (http|silly|verbose|timing|notice)/i.test(line)) opts.onLog?.(line)
    },
    opts.signal
  )

  if (opts.signal?.aborted) return settle('idle', '已取消下载', 0)
  if (code !== 0) {
    job.error = job.error || `npm install 退出码 ${code}`
    return settle('error', `下载失败：${job.error}`, job.percent)
  }

  tick(true)

  // ── 3) 校验入口是否真的落地（原生模块可能需针对 Electron 重编）──
  job.phase = 'verifying'
  job.percent = 97
  job.message = '正在校验运行时…'
  emit(true)
  if (!fs.existsSync(bin)) {
    job.error = '安装完成但未找到 dsh 入口（原生模块可能需针对 Electron 重编）'
    return settle('error', `下载失败：${job.error}`, 97)
  }

  job.installed = true
  job.fetched = job.total || job.fetched
  return settle('done', '下载完成，可切换并启动', 100)
}
