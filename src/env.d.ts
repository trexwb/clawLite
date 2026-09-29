/* ═══════════════════════════════════════════════════════════════════
   Claw Lite — 渲染层类型声明（preload 桥 window.clawLite）

   本文件为全局声明（无 import/export），与 DOM 的 Window 接口合并：
   src/main.ts 直接使用 window.clawLite / ClawLiteApi，无需运行时导入。
   字段与 electron/harness.ts 的 Snapshot 保持一致。
   ═══════════════════════════════════════════════════════════════════ */

interface ClawLiteWindowBounds {
  x: number
  y: number
  width: number
  height: number
}

interface ClawLiteSettings {
  port: number
  autoStart: boolean
  openMode: string
  workspace: string
  dshHome: string
  dshVersion: string
  windowBounds?: ClawLiteWindowBounds | null
}

/**
 * 版本下载任务状态（对齐 electron/version-download.ts 的 VersionJob）。
 * phase 的取值由主进程 DOWNLOAD_PHASES 决定，渲染层 PHASE_LABEL 的键
 * 必须与其一致（scripts/check.ts §12 双向校验，杜绝死枚举）。
 */
interface ClawLiteVersionJob {
  policy: string
  version: string
  phase:
    | 'idle'
    | 'resolving'
    | 'downloading'
    | 'installing'
    | 'verifying'
    | 'done'
    | 'error'
  /** 0–100；为 0 且 total 为 0 时表示总量未知（不确定进度条） */
  percent: number
  fetched: number
  total: number
  message: string
  error: string
  startedAt: number
  finishedAt: number
  installed: boolean
}

interface ClawLiteSnapshot {
  installed: boolean
  running: boolean
  starting: boolean
  canStop: boolean
  // 与主进程 electron/harness.ts 的 HarnessState 联合类型严格对齐：
  // scripts/check.ts §7 双向校验 harness.setState 取值 ⊆ 此处标签键，
  // 且渲染层 STATE_LABEL 键 ⊆ harness.setState 取值（无死枚举）。
  state: 'notInstalled' | 'stopped' | 'starting' | 'running' | 'stopping' | 'error'
  message: string
  url: string
  dshVersion: string
  nodeVersion: string
  runtimeKind: string
  nodeBin: string
  dshDir: string
  dshHome: string
  workspace: string
  settings: ClawLiteSettings
  /** 版本下载任务快照（无任务为 null） */
  versionJob: ClawLiteVersionJob | null
  logs: string[]
}

/**
 * 应用更新任务状态（对齐 electron/main.ts 的 UpdateJob）。
 * 更新策略为方案 C：只检测、不下载、不安装，故不存在任何进度字段。
 * phase 的取值由主进程决定，必须与渲染层 UPDATE_PHASE_LABEL 的键一一
 * 对应；状态帧走独立轻量通道 updater:progress，不随快照重传。
 */
interface ClawLiteUpdateJob {
  /** idle：无任务（未检查 / 已是最新 / 面板已收起）；available：检测到新版本；error：检测失败 */
  phase: 'idle' | 'available' | 'error'
  version: string
  message: string
  error: string
}

interface ClawLiteUpdateResult {
  ok?: boolean
  message?: string
  version?: string
  /** 当前更新任务快照：渲染层据此点亮 / 收起更新提示面板 */
  job?: ClawLiteUpdateJob
}

interface ClawLiteApi {
  /* 请求/响应 */
  snapshot(): Promise<ClawLiteSnapshot>
  start(): Promise<ClawLiteSnapshot>
  stop(): Promise<ClawLiteSnapshot>
  restart(): Promise<ClawLiteSnapshot>
  verify(): Promise<string>
  clearLogs(): Promise<boolean>
  listVersions(): Promise<string[]>
  pruneVersions(keep: string[]): Promise<{ ok: boolean; removed: string[]; error?: string }>
  /** 选定版本即开始下载（幂等，同版本复用同一任务） */
  prepareVersion(policy: string): Promise<ClawLiteSnapshot>
  /** 下载完成后热切换并（默认）立即启动新版本 */
  applyVersion(policy: string, start?: boolean): Promise<ClawLiteSnapshot>
  cancelVersion(): Promise<ClawLiteSnapshot>
  saveSettings(settings: Record<string, unknown>): Promise<unknown>
  open(mode: string): Promise<boolean>
  pickDirectory(): Promise<string | null>
  checkUpdate(): Promise<ClawLiteUpdateResult>
  /** 打开 GitHub 发布页，由用户手动下载安装包覆盖安装（方案 C 升级入口） */
  openUpdateDownload(): Promise<ClawLiteUpdateResult>
  relaunch(): Promise<void>
  appInfo(): Promise<Record<string, unknown>>

  /* 事件订阅：返回取消订阅函数 */
  onState(handler: (snap: ClawLiteSnapshot) => void): () => void
  onLog(handler: (line: string) => void): () => void
  onVersionProgress(handler: (job: ClawLiteVersionJob) => void): () => void
  /** 应用更新状态（检测到新版本 / 检测失败），独立轻量通道 */
  onUpdateProgress(handler: (job: ClawLiteUpdateJob) => void): () => void
}

interface Window {
  clawLite?: ClawLiteApi
}
