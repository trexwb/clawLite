/* ═══════════════════════════════════════════════════════════════════
   Claw Lite — 运行时控制台前端
   ───────────────────────────────────────────────────────────────────
   与 Electron 主进程契约（preload 暴露的 window.clawLite）：
     方法  snapshot / start / stop / restart / verify / clearLogs
           saveSettings / open / pickDirectory / checkUpdate
           relaunch / appInfo
     事件  onState → Snapshot
           onLog   → String（单行，空串表示清屏）

   类型声明见 src/env.d.ts（全局合并 Window.clawLite）。
   ═══════════════════════════════════════════════════════════════════ */

import { PORT_MIN, PORT_MAX, PORT_DEFAULT, LOG_LIMIT } from './shared/constants.ts'

const api: ClawLiteApi | null = (typeof window !== 'undefined' && window.clawLite) || null
const IS_DESKTOP = !!api

/**
 * 取用 preload 桥。浏览器预览模式下 api 为 null，此处统一抛出，
 * 与原先 call() 的前置判断共用同一文案。
 */
function bridge(): ClawLiteApi {
  if (!api) throw new Error('当前不在桌面应用环境中')
  return api
}

/** 异常 → 可读文案（catch 到的值类型为 unknown，需显式收窄） */
const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/** 按 id 取元素：id 与 index.html 静态对应，取不到即为模板缺失，按 null 处理 */
const byId = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T

const el = {
  statusPill: byId('status-pill'),
  statusText: byId('status-text'),
  heroDot: byId('hero-dot'),
  heroTitle: byId('hero-title'),
  heroMsg: byId('hero-msg'),
  urlText: byId('url-text'),
  btnCopy: byId<HTMLButtonElement>('btn-copy'),
  btnStart: byId<HTMLButtonElement>('btn-start'),
  btnStop: byId<HTMLButtonElement>('btn-stop'),
  btnRestart: byId<HTMLButtonElement>('btn-restart'),
  btnOpenWindow: byId<HTMLButtonElement>('btn-open-window'),
  btnOpenBrowser: byId<HTMLButtonElement>('btn-open-browser'),
  btnInstall: byId<HTMLButtonElement>('btn-install'),
  btnSave: byId<HTMLButtonElement>('btn-save'),
  btnPickWs: byId<HTMLButtonElement>('btn-pick-ws'),
  btnClearLog: byId<HTMLButtonElement>('btn-clear-log'),
  btnUpdate: byId<HTMLButtonElement>('btn-update'),
  infoRuntime: byId('info-runtime'),
  infoNode: byId('info-node'),
  infoDir: byId('info-dir'),
  infoHome: byId('info-home'),
  fPort: byId<HTMLInputElement>('f-port'),
  fOpenMode: byId<HTMLSelectElement>('f-open-mode'),
  fWorkspace: byId<HTMLInputElement>('f-workspace'),
  fDshHome: byId<HTMLInputElement>('f-dsh-home'),
  fDshVersion: byId<HTMLInputElement>('f-dsh-version'),
  btnToggleVersionList: byId<HTMLButtonElement>('btn-toggle-version-list'),
  btnRefreshVersions: byId<HTMLButtonElement>('btn-refresh-versions'),
  versionDropdown: byId('version-dropdown'),
  versionDropdownList: byId('version-dropdown-list'),
  versionDownload: byId('version-download'),
  dlTitle: byId('dl-title'),
  dlPct: byId('dl-pct'),
  dlBar: byId('dl-bar'),
  dlFill: byId('dl-fill'),
  dlMsg: byId('dl-msg'),
  btnApplyVersion: byId<HTMLButtonElement>('btn-apply-version'),
  btnCancelDownload: byId<HTMLButtonElement>('btn-cancel-download'),
  fAuto: byId<HTMLInputElement>('f-auto'),
  fAutoscroll: byId<HTMLInputElement>('f-autoscroll'),
  saveHint: byId('save-hint'),
  log: byId('log'),
  toast: byId('toast'),
  footVersion: byId('foot-version'),
}

// 端口策略：PORT_MIN/MAX/DEFAULT 来自 src/shared/constants.ts（单一来源），
// 与 index.html `#f-port` 的 min/max 同源（scripts/check.ts §9 校验三方一致）
const PORT_HINT = `监听端口需为 ${PORT_MIN}-${PORT_MAX} 的整数`

// DSH 版本字段的默认说明文案：与 index.html #dsh-version-hint 的静态内容同源，
// 即时校验回落时用它恢复，避免两处文案漂移
const DEFAULT_VERSION_HINT =
  '当前运行的版本；选定版本后立即从 npm 下载，下载完成即可直接切换启动，无需重启应用'

/** 与当前 Electron 不兼容的 DSH 版本前缀：这些版本的原生模块 ABI 不匹配，
 *  下载后无法启动，需等后续修复后再开放使用 */
const INCOMPATIBLE_PREFIXES = ['0.1.7']
const INCOMPATIBLE_MSG =
  '该版本与当前 Electron 存在兼容性问题（原生模块 ABI 不匹配），请等待后续修复后再使用'

/** 检查版本号是否在已知不兼容列表中 */
function isIncompatible(version: string): boolean {
  return INCOMPATIBLE_PREFIXES.some((p) => version.startsWith(p))
}

/** 读取并校验端口输入：非整数或越界返回 null，由调用方显式回显错误 */
function readPort(): number | null {
  const raw = String(el.fPort.value ?? '').trim()
  if (!/^\d+$/.test(raw)) return null
  const n = Number(raw)
  return n >= PORT_MIN && n <= PORT_MAX ? n : null
}

let snapshot: ClawLiteSnapshot | null = null
let logEmpty = true

// 版本字段的显示基线与落盘基线：设置偏好为 latest 时，字段显示当前实际
// 运行版本（snap.dshVersion），但未改动的值保存时仍按 latest 语义落盘，
// 不因显示而意外钉死版本；用户改成了别的值则按输入值落盘
let versionDisplay = 'latest'
let versionStored = 'latest'

/* ── 通用工具 ──────────────────────────────────────────────────── */

let toastTimer: NodeJS.Timeout | null = null
function toast(msg: string, isErr = false): void {
  // 先解除隐藏再写文案：元素处于 display:none 时不在可访问树，
  // 先赋值会导致部分读屏不播报这条提示
  el.toast.classList.remove('hidden')
  el.toast.textContent = msg
  el.toast.classList.toggle('err', isErr)
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => el.toast.classList.add('hidden'), 3200)
}

interface CommandArgs {
  settings?: unknown
  mode?: string
}

/** 命令名 → preload 方法映射，保持原有调用点不变 */
const COMMANDS: Record<string, (args?: CommandArgs) => Promise<unknown>> = {
  harness_snapshot: () => bridge().snapshot(),
  harness_start: () => bridge().start(),
  harness_stop: () => bridge().stop(),
  harness_restart: () => bridge().restart(),
  // 语义与实现对齐：这里是「校验运行时」，通道为 harness:verify（preload 方法同名）
  harness_verify: () => bridge().verify(),
  harness_clear_logs: () => bridge().clearLogs(),
  harness_save_settings: (args) => bridge().saveSettings((args?.settings ?? {}) as Record<string, unknown>),
  harness_open: (args) => bridge().open(args?.mode ?? 'window'),
}

// 返回值即 IPC 透传结果（不同通道结构不同），调用点按需读取字段；
// 此处不逐通道建模，保持渲染层与主进程契约的松耦合。
async function call(cmd: string, args?: CommandArgs): Promise<any> {
  const fn = COMMANDS[cmd]
  if (!fn) throw new Error(`未知命令：${cmd}`)
  return fn(args)
}

/* ── 渲染 ──────────────────────────────────────────────────────── */

// 与 electron/harness.ts 的 setState 取值严格对齐
// （scripts/check.ts 会校验两处状态枚举一致性）
const STATE_LABEL: Record<string, string> = {
  notInstalled: '运行时缺失',
  stopped: '已就绪 · 未启动',
  starting: '正在启动…',
  stopping: '正在停止…',
  running: '运行中',
  error: '启动失败',
}

// 下载阶段文案：键必须与 electron/version-download.ts 的 DOWNLOAD_PHASES
// 完全一致（scripts/check.ts §12 做双向校验，杜绝两处漂移）
const PHASE_LABEL: Record<string, string> = {
  idle: '待下载',
  resolving: '正在解析版本…',
  downloading: '正在下载运行时…',
  installing: '正在安装依赖…',
  verifying: '正在校验运行时…',
  done: '下载完成',
  error: '下载失败',
}

/**
 * 版本下载进度面板。数据源为 Snapshot.versionJob：
 * - 主进程在每次进度变化时广播 harness:versionProgress（轻量帧），
 *   随后的 harness:state 快照也会带上 versionJob，故界面重载后可自动恢复进度；
 * - phase=idle 表示无进行中的任务（含已取消、已切换完成），面板收起。
 */
function renderVersionJob(job: ClawLiteVersionJob | null | undefined): void {
  if (!job || job.phase === 'idle') {
    el.versionDownload.classList.add('hidden')
    return
  }
  const done = job.phase === 'done'
  const failed = job.phase === 'error'
  const known = job.total > 0
  const percent = Math.max(0, Math.min(100, job.percent || 0))

  el.versionDownload.classList.remove('hidden')
  el.versionDownload.classList.toggle('done', done)
  el.versionDownload.classList.toggle('error', failed)
  el.dlTitle.textContent = `${PHASE_LABEL[job.phase] || job.phase}${job.version ? ` · ${job.version}` : ''}`
  el.dlPct.textContent = known || done ? `${Math.round(percent)}%` : '—'
  // 依赖总数未拿到前不显示假百分比，改为来回扫动的不确定进度
  el.dlBar.classList.toggle('indeterminate', !known && !done && !failed)
  el.dlFill.style.width = known || done ? `${percent}%` : ''
  el.dlMsg.textContent =
    job.message || (known ? `已获取 ${job.fetched} / ${job.total} 个依赖包` : '正在获取依赖清单…')

  // 完成且入口已落地才允许切换；失败态把按钮复用为「重试并启动」
  // （重试会先补齐下载再启动，与正常路径同一条链路）
  el.btnApplyVersion.disabled = failed ? false : !(done && job.installed)
  el.btnApplyVersion.textContent = failed ? '重试并启动' : '切换并启动'
  el.btnCancelDownload.textContent = done || failed ? '关闭' : '取消下载'
}

/** 面板按钮取值的唯一来源：以任务自身版本为准，避免用户改了输入框后按钮名不副实 */
let activeVersionJob: ClawLiteVersionJob | null = null

/** 自动切换进行中标记：防止 progress 帧重复触发 applyVersion（done 帧可能连发） */
let autoSwitching = false

/** 版本列表缓存（供下拉面板渲染用） */
let cachedVersionList: string[] = []

/** 下拉面板是否展开 */
let versionDropdownOpen = false

/** 切换下拉面板可见性 */
function toggleVersionDropdown(forceClose = false): void {
  if (forceClose || versionDropdownOpen) {
    versionDropdownOpen = false
    el.versionDropdown.classList.add('hidden')
    el.btnToggleVersionList.textContent = '▼'
    return
  }
  // 无列表数据时先不展开
  if (!cachedVersionList.length) return
  versionDropdownOpen = true
  el.versionDropdown.classList.remove('hidden')
  el.btnToggleVersionList.textContent = '▲'
  renderVersionDropdown()
}

/** 渲染下拉面板选项：始终显示全量列表，不兼容版本置灰 + 删除线 */
function renderVersionDropdown(): void {
  const ul = el.versionDropdownList
  ul.textContent = ''
  for (const v of cachedVersionList) {
    const li = document.createElement('li')
    li.textContent = v
    li.setAttribute('role', 'option')
    li.dataset.version = v
    if (isIncompatible(v)) li.classList.add('incompatible')
    ul.appendChild(li)
  }
}

function render(snap: ClawLiteSnapshot | null | undefined): void {
  if (!snap) return
  snapshot = snap
  activeVersionJob = snap.versionJob || null
  renderVersionJob(activeVersionJob)

  const state = snap.state || 'stopped'
  const label = STATE_LABEL[state] || state

  el.heroDot.className = `dot ${state}`
  el.statusPill.className = `pill ${state}`
  el.statusText.textContent = label
  el.heroTitle.textContent = label
  el.heroMsg.textContent = snap.message || '—'

  el.urlText.textContent = snap.url || '—'
  el.btnCopy.disabled = !snap.url

  // 按钮可用性：停止过程中（state=stopping）同样视为忙碌，
  // 避免「停止→启动」重入产生孤儿 dsh 子进程与状态误判
  // （stopping 由主进程 stop() 置入，busy 才能覆盖整个停止窗口）。
  const busy = !!snap.starting || state === 'stopping'
  el.btnStart.disabled = busy || snap.running || !snap.installed
  // 启动探活最长 60s，「停止」在此期间必须可用：canStop 表示子进程已起、
  // 有信号可发，用于中止本次启动。
  el.btnStop.disabled = state === 'stopping' || !(snap.running || (snap.starting && snap.canStop))
  el.btnRestart.disabled = busy || !snap.installed
  el.btnOpenWindow.disabled = !snap.running || !snap.url
  el.btnOpenBrowser.disabled = !snap.running || !snap.url
  el.btnInstall.disabled = busy
  el.btnSave.disabled = busy

  // 运行信息
  el.infoRuntime.textContent = snap.installed
    ? `DSH ${snap.dshVersion || '未知'}`
    : '未检测到内置运行时'
  el.infoNode.textContent = snap.nodeVersion
    ? `Node ${snap.nodeVersion} · ${snap.runtimeKind || 'Electron 内置'}`
    : '—'
  el.infoDir.textContent = snap.dshDir || '—'
  el.infoHome.textContent = snap.dshHome || '—'

  // 设置（仅在未聚焦时回填，避免打断输入）
  const s = snap.settings || ({} as ClawLiteSettings)
  if (document.activeElement !== el.fPort) el.fPort.value = String(s.port ?? PORT_DEFAULT)
  if (document.activeElement !== el.fWorkspace) el.fWorkspace.value = s.workspace || ''
  if (document.activeElement !== el.fDshHome) el.fDshHome.value = s.dshHome || ''
  if (document.activeElement !== el.fDshVersion) {
    const pref = s.dshVersion || 'latest'
    const display = pref !== 'latest' ? pref : snap.dshVersion || pref
    el.fDshVersion.value = display
    versionDisplay = display
    versionStored = pref
  }
  // 与其它字段一致：聚焦时不回填，避免用户正按方向键选择打开方式时被覆盖
  if (document.activeElement !== el.fOpenMode) el.fOpenMode.value = s.openMode || 'window'
  el.fAuto.checked = !!s.autoStart

  el.footVersion.textContent = snap.dshVersion ? `dsh ${snap.dshVersion}` : ''
}

// DOM 行数上限：长会话下日志节点只增不减会持续占用内存并拖慢渲染，
// 与主进程 LOG_LIMIT（src/shared/constants.ts 同源）对齐，超出后从头部裁剪。

// 日志写入合并到下一帧批量执行：dsh 启动期日志密集，逐行 appendChild +
// 同步读 scrollHeight 会触发大量强制重排；合并后一帧只重排一次。
let logQueue: { text: string; kind: string | null }[] = []
let logFrame = 0

function flushLog(): void {
  logFrame = 0
  if (!logQueue.length) return
  const frag = document.createDocumentFragment()
  for (const { text, kind } of logQueue) {
    const span = document.createElement('span')
    if (kind) span.className = kind
    span.textContent = text + '\n'
    frag.appendChild(span)
  }
  logQueue = []
  if (logEmpty) {
    el.log.textContent = ''
    logEmpty = false
  }
  el.log.appendChild(frag)
  while (el.log.childNodes.length > LOG_LIMIT) el.log.removeChild(el.log.firstChild!)
  if (el.fAutoscroll.checked) el.log.scrollTop = el.log.scrollHeight
}

function logLine(text: string, kind: string | null): void {
  logQueue.push({ text, kind })
  if (!logFrame) logFrame = requestAnimationFrame(flushLog)
}

// 英文关键词要求「独立词 + 前置分隔符」：原实现 /error/i 会把
// `/path/error-handler.js`、URL 查询参数（含 token 取值）这类内容误染成错误色。
// 中文不参与 \b 判定（CJK 非 \w），单独匹配。
const ERR_WORD_RE = /(?:^|[\s(\["'「:：])(?:error|fatal)\b/i
const ERR_CJK_RE = /错误|失败/

function classify(line: string): string | null {
  if (line.startsWith('[claw-lite]')) return 'l-claw'
  if (ERR_WORD_RE.test(line) || ERR_CJK_RE.test(line)) return 'l-err'
  return null
}

function rebuildLog(lines: string[] | null | undefined): void {
  // 丢弃尚未刷入的队列并取消在帧任务，避免重建后又被旧行追加
  logQueue = []
  if (logFrame) {
    cancelAnimationFrame(logFrame)
    logFrame = 0
  }
  el.log.textContent = ''
  logEmpty = true
  if (!lines || !lines.length) {
    el.log.textContent = '（暂无日志）'
    logEmpty = true
    return
  }
  for (const l of lines) logLine(l, classify(l))
}

/* ── 设置保存 ──────────────────────────────────────────────────── */

/** 卡片底部临时提示的展示时长（「已保存」/「端口无效」等） */
const SAVE_HINT_MS = 2400

let saveHintTimer: NodeJS.Timeout | null = null

/** 表单当前值与最近一次快照设置比对：有差异即视为未保存修改 */
function settingsChanged(): boolean {
  const s = snapshot?.settings
  if (!s) return false
  if (el.fPort.value.trim() !== String(s.port ?? PORT_DEFAULT)) return true
  if (el.fWorkspace.value.trim() !== (s.workspace || '')) return true
  if (el.fDshHome.value.trim() !== (s.dshHome || '')) return true
  if (el.fDshVersion.value.trim() !== versionDisplay) return true
  if (el.fOpenMode.value !== (s.openMode || 'window')) return true
  return el.fAuto.checked !== !!s.autoStart
}

/** 依据未保存状态刷新常驻提示；临时提示（计时中）不被覆盖 */
function updateSaveHint(): void {
  if (saveHintTimer) return
  el.saveHint.textContent = settingsChanged() ? '有未保存修改' : ''
}

/** 临时提示：展示 SAVE_HINT_MS 后回落到未保存状态判断 */
function flashSaveHint(msg: string): void {
  if (saveHintTimer) clearTimeout(saveHintTimer)
  el.saveHint.textContent = msg
  saveHintTimer = setTimeout(() => {
    saveHintTimer = null
    updateSaveHint()
  }, SAVE_HINT_MS)
}

/** 保存设置：由保存按钮与表单内回车共用 */
async function submitSettings(): Promise<void> {
  // 端口先在前端按同一范围校验：原实现 `Number(...) || 8799` 会把
  // 空值/非法值静默改写成 8799 保存，用户看到的输入与落盘值不一致
  const port = readPort()
  if (port === null) {
    flashSaveHint('端口无效')
    toast(PORT_HINT, true)
    return
  }
  // 不兼容版本拦截：用户直接点保存（不经过 change）也要阻止
  const pendingVersion =
    el.fDshVersion.value.trim() === versionDisplay
      ? versionStored
      : el.fDshVersion.value.trim() || 'latest'
  if (isIncompatible(pendingVersion)) {
    toast(INCOMPATIBLE_MSG, true)
    return
  }
  const settings = {
    port,
    autoStart: el.fAuto.checked,
    openMode: el.fOpenMode.value,
    dshHome: el.fDshHome.value.trim(),
    workspace: el.fWorkspace.value.trim(),
    // 未改动的版本字段保持原偏好（latest 语义不被显示值钉死）
    dshVersion:
      el.fDshVersion.value.trim() === versionDisplay
        ? versionStored
        : el.fDshVersion.value.trim() || 'latest',
  }
  const res = await call('harness_save_settings', { settings })
  render(res?.snap || res)
  if (res && res.ok === false) {
    flashSaveHint('保存失败')
    toast(res.error || '设置保存失败', true)
    return
  }
  flashSaveHint('已保存')
  // 端口/工作目录等只在下一次 spawn 时读取：服务在运行中保存设置，
  // 旧配置仍在生效，必须显式说明，避免误以为已即刻切换
  const restartNeeded = !!(res?.snap?.running || res?.snap?.starting)
  toast(restartNeeded ? '设置已保存，将在下次启动 DSH 时生效' : '设置已保存')
}

/* ── 交互 ──────────────────────────────────────────────────────── */

async function guard(fn: () => Promise<unknown>, okMsg?: string): Promise<void> {
  try {
    await fn()
    if (okMsg) toast(okMsg)
  } catch (e) {
    toast(errText(e), true)
  }
}

function bind(): void {
  // 启动结果由 harness:state 快照驱动（探活期间可能被「停止」中止），
  // 故不在此提示「正在启动」，避免取消后仍弹启动提示
  el.btnStart.addEventListener('click', () => guard(() => call('harness_start')))
  el.btnStop.addEventListener('click', () => guard(() => call('harness_stop'), '已停止 DSH'))
  el.btnRestart.addEventListener('click', () =>
    guard(() => call('harness_restart'), '正在重启…')
  )
  el.btnOpenWindow.addEventListener('click', () =>
    guard(() => call('harness_open', { mode: 'window' }))
  )
  el.btnOpenBrowser.addEventListener('click', () =>
    guard(() => call('harness_open', { mode: 'browser' }))
  )
  el.btnInstall.addEventListener('click', () =>
    guard(async () => {
      const msg = await call('harness_verify')
      toast(String(msg))
    })
  )
  el.btnClearLog.addEventListener('click', () =>
    guard(async () => {
      await call('harness_clear_logs')
      rebuildLog([])
    })
  )

  el.btnCopy.addEventListener('click', async () => {
    if (!snapshot?.url) return
    try {
      await navigator.clipboard.writeText(snapshot.url)
      toast('访问地址已复制')
    } catch {
      toast('复制失败，请手动选择', true)
    }
  })

  el.btnSave.addEventListener('click', () => guard(submitSettings))

  // 表单内文本输入回车即保存（与保存按钮同一路径，含端口校验与提示）
  for (const input of [el.fPort, el.fWorkspace, el.fDshHome, el.fDshVersion]) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !el.btnSave.disabled) void guard(submitSettings)
    })
    // 输入即刷新「有未保存修改」常驻提示
    input.addEventListener('input', updateSaveHint)
  }
  el.fOpenMode.addEventListener('change', updateSaveHint)
  el.fAuto.addEventListener('change', updateSaveHint)
  el.btnPickWs.addEventListener('click', () =>
    guard(async () => {
      const picked = await bridge().pickDirectory()
      if (typeof picked === 'string' && picked) {
        el.fWorkspace.value = picked
        updateSaveHint()
      }
    })
  )

  // 刷新 npm 上的 DSH 版本列表，填充下拉面板（始终显示全量列表）
  el.btnRefreshVersions.addEventListener('click', () =>
    guard(async () => {
      el.btnRefreshVersions.disabled = true
      el.btnRefreshVersions.classList.add('busy')
      el.btnRefreshVersions.textContent = '获取中…'
      try {
        const versions = (await bridge().listVersions()) as string[]
        cachedVersionList = versions
        if (versions.length) renderVersionDropdown()
        toast(versions.length ? `已刷新版本列表（${versions.length} 个）` : '无可用版本')
      } finally {
        el.btnRefreshVersions.disabled = false
        el.btnRefreshVersions.classList.remove('busy')
        el.btnRefreshVersions.textContent = '刷新列表'
      }
    })
  )

  // 版本号即时校验：不兼容版本拦截 + 列表外手输值弱提示
  el.fDshVersion.addEventListener('input', () => {
    updateSaveHint()
    const v = el.fDshVersion.value.trim()
    const hintEl = document.getElementById('dsh-version-hint')
    if (!hintEl) return
    if (!v || v === 'latest' || v === versionDisplay) {
      hintEl.textContent = DEFAULT_VERSION_HINT
      hintEl.classList.remove('warn')
    } else if (isIncompatible(v)) {
      hintEl.textContent = INCOMPATIBLE_MSG
      hintEl.classList.add('warn')
    } else if (cachedVersionList.length && !cachedVersionList.includes(v)) {
      hintEl.textContent = `「${v}」不在已获取的版本列表中，仍会立即尝试下载，失败会回退内置运行时`
      hintEl.classList.add('warn')
    } else {
      hintEl.textContent = DEFAULT_VERSION_HINT
      hintEl.classList.remove('warn')
    }
  })

  // 选定版本即开始下载：下拉选中或手输确认（change，非逐键 input）后立即拉取，
  // 不再等保存、也不等下次启动。保存路径另有兜底触发（主进程 saveSettings），
  // 两条路径最终都收敛到 harness.prepareVersion 的幂等复用。
  // 不兼容版本直接拦截，不发起下载。
  el.fDshVersion.addEventListener('change', () => {
    const v = el.fDshVersion.value.trim()
    if (!v || v === versionDisplay) return
    if (isIncompatible(v)) {
      toast(INCOMPATIBLE_MSG, true)
      return
    }
    void guard(async () => {
      render(await bridge().prepareVersion(v))
    })
  })

  // 下拉面板切换按钮
  el.btnToggleVersionList.addEventListener('click', (e) => {
    e.stopPropagation()
    toggleVersionDropdown()
  })

  // 下拉面板选项点击：不兼容版本拦截，兼容版本填入输入框并触发 change
  el.versionDropdownList.addEventListener('click', (e) => {
    const target = e.target as HTMLElement
    const version = target.dataset?.version
    if (!version) return
    if (isIncompatible(version)) {
      toast(INCOMPATIBLE_MSG, true)
      return
    }
    el.fDshVersion.value = version
    toggleVersionDropdown(true)
    el.fDshVersion.dispatchEvent(new Event('change', { bubbles: true }))
  })

  // 点击面板外部收起下拉
  document.addEventListener('click', (e) => {
    if (!versionDropdownOpen) return
    const target = e.target as HTMLElement
    if (
      el.versionDropdown.contains(target) ||
      el.btnToggleVersionList.contains(target) ||
      el.fDshVersion.contains(target)
    )
      return
    toggleVersionDropdown(true)
  })

  // 下载完成后热切换：主进程用新版本重启 DSH 子进程并重新探活，应用本身不重启
  el.btnApplyVersion.addEventListener('click', () =>
    guard(async () => {
      const job = activeVersionJob
      const v = job?.version || el.fDshVersion.value.trim()
      if (!v) {
        toast('请先选择 DSH 版本', true)
        return
      }
      if (isIncompatible(v)) {
        toast(INCOMPATIBLE_MSG, true)
        return
      }
      el.btnApplyVersion.disabled = true
      el.btnApplyVersion.classList.add('busy')
      el.btnApplyVersion.textContent = '正在切换…'
      try {
        render(await bridge().applyVersion(v, true))
        toast(`已切换到 DSH ${v}`)
      } finally {
        el.btnApplyVersion.classList.remove('busy')
        // 失败时按钮需恢复为可点（成功路径的快照已把面板收起）
        renderVersionJob(activeVersionJob)
      }
    })
  )

  // 取消下载：中止进行中的 npm 进程（保留已落盘内容与缓存，不删目录）；
  // 已完成/失败时按钮转为「关闭」，仅收起面板
  el.btnCancelDownload.addEventListener('click', () =>
    guard(async () => {
      render(await bridge().cancelVersion())
    })
  )

  el.btnUpdate.addEventListener('click', () => guard(checkUpdate))
}

/* ── 自动更新 ──────────────────────────────────────────────────── */

async function checkUpdate(): Promise<void> {
  if (!IS_DESKTOP) {
    toast('仅在桌面应用中支持检查更新', true)
    return
  }
  el.btnUpdate.disabled = true
  el.btnUpdate.textContent = '检查中…'
  try {
    const res = await bridge().checkUpdate()
    toast(res?.message || '已检查更新', !res?.ok)
  } catch (e) {
    toast(`更新检查失败：${errText(e)}`, true)
  } finally {
    el.btnUpdate.disabled = false
    el.btnUpdate.textContent = '检查更新'
  }
}

/* ── 启动 ──────────────────────────────────────────────────────── */

async function boot(): Promise<void> {
  // macOS 桌面端顶栏需为原生交通灯预留左侧安全区
  // （与 main.ts 的 trafficLightPosition 配套，样式见 main.css 的 --topbar-gutter）
  if (IS_DESKTOP && /Mac/i.test(navigator.userAgent)) {
    document.body.classList.add('is-mac')
  }

  bind()

  if (!IS_DESKTOP) {
    // 浏览器预览模式：给出静态占位，便于 `npm run dev` 查看界面
    render({
      installed: false,
      running: false,
      starting: false,
      canStop: false,
      state: 'stopped',
      message: '浏览器预览模式（未运行在 Electron 桌面应用中）',
      dshVersion: '',
      nodeVersion: '',
      runtimeKind: '',
      url: '',
      nodeBin: '',
      dshDir: '',
      dshHome: '',
      workspace: '',
      versionJob: null,
      logs: [],
      settings: {
        port: PORT_DEFAULT,
        autoStart: false,
        openMode: 'window',
        dshHome: '',
        dshVersion: 'latest',
        workspace: '',
      },
    })
    rebuildLog([])
    el.btnUpdate.classList.add('hidden')
    return
  }

  bridge().onState((snap) => {
    // 需重建整段日志的两种情况：首次渲染，或主进程日志缓冲已从头部截断
    // （缓冲区满后行数不再变化，只能靠首行变化识别，否则界面会残留过期行）
    const prevCount = snapshot?.logs?.length ?? -1
    const prevFirst = snapshot?.logs?.[0]
    render(snap)
    const truncated =
      prevCount === -1 ||
      snap.logs.length < prevCount ||
      (snap.logs.length === prevCount && snap.logs[0] !== prevFirst)
    if (truncated) rebuildLog(snap.logs)
  })

  // 下载进度走独立轻量通道：不随 harness:state 快照重传整段日志，
  // 只刷新进度面板，避免下载期间的高频帧把日志区一起重绘
  bridge().onVersionProgress((job) => {
    activeVersionJob = job || null
    renderVersionJob(activeVersionJob)
    // 下载完成的下一拍自动切换并启动：应用不重启，由主进程停旧起新。
    // 以任务自身版本为准（而非输入框当前值），避免用户在下载期间改了输入。
    // 完成后仍保留面板与「关闭」按钮，切换失败时用户可手动重试。
    if (job?.phase === 'done' && job.installed && job.version && !autoSwitching) {
      // 不兼容版本不应走到下载完成，但防御性检查
      if (isIncompatible(job.version)) {
        toast(`${job.version} ${INCOMPATIBLE_MSG}`, true)
        return
      }
      autoSwitching = true
      toast(`DSH ${job.version} 下载完成，正在切换并启动…`)
      void guard(async () => {
        try {
          render(await bridge().applyVersion(job.version, true))
          toast(`已切换到 DSH ${job.version}`)
        } finally {
          autoSwitching = false
        }
      })
    }
  })

  bridge().onLog((line) => {
    if (!line) {
      rebuildLog([])
      return
    }
    logLine(line, classify(line))
  })

  try {
    render(await call('harness_snapshot'))
  } catch (e) {
    toast(`读取运行状态失败：${errText(e)}`, true)
  }
}

void boot()
