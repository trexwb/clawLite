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
  logs: string[]
}

interface ClawLiteUpdateResult {
  ok?: boolean
  message?: string
  version?: string
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
  saveSettings(settings: Record<string, unknown>): Promise<unknown>
  open(mode: string): Promise<boolean>
  pickDirectory(): Promise<string | null>
  checkUpdate(): Promise<ClawLiteUpdateResult>
  relaunch(): Promise<void>
  appInfo(): Promise<Record<string, unknown>>

  /* 事件订阅：返回取消订阅函数 */
  onState(handler: (snap: ClawLiteSnapshot) => void): () => void
  onLog(handler: (line: string) => void): () => void
}

interface Window {
  clawLite?: ClawLiteApi
}
