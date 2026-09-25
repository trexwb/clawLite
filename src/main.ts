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
  fAuto: byId<HTMLInputElement>('f-auto'),
  fAutoscroll: byId<HTMLInputElement>('f-autoscroll'),
  saveHint: byId('save-hint'),
  log: byId('log'),
  toast: byId('toast'),
  footVersion: byId('foot-version'),
}

// 端口策略：与 electron/harness.ts 的 PORT_MIN / PORT_MAX / PORT_DEFAULT、
// index.html `#f-port` 的 min/max 同源（scripts/check.ts §9 校验三方一致）
const PORT_MIN = 1024
const PORT_MAX = 65535
const PORT_DEFAULT = 8799
const PORT_HINT = `监听端口需为 ${PORT_MIN}-${PORT_MAX} 的整数`

/** 读取并校验端口输入：非整数或越界返回 null，由调用方显式回显错误 */
function readPort(): number | null {
  const raw = String(el.fPort.value ?? '').trim()
  if (!/^\d+$/.test(raw)) return null
  const n = Number(raw)
  return n >= PORT_MIN && n <= PORT_MAX ? n : null
}

let snapshot: ClawLiteSnapshot | null = null
let logEmpty = true

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

function render(snap: ClawLiteSnapshot | null | undefined): void {
  if (!snap) return
  snapshot = snap

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
  // 与其它字段一致：聚焦时不回填，避免用户正按方向键选择打开方式时被覆盖
  if (document.activeElement !== el.fOpenMode) el.fOpenMode.value = s.openMode || 'window'
  el.fAuto.checked = !!s.autoStart

  el.footVersion.textContent = snap.dshVersion ? `dsh ${snap.dshVersion}` : ''
}

// DOM 行数上限：长会话下日志节点只增不减会持续占用内存并拖慢渲染，
// 与主进程 LOG_LIMIT(800) 对齐，超出后从头部裁剪。
const LOG_DOM_LIMIT = 800

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
  while (el.log.childNodes.length > LOG_DOM_LIMIT) el.log.removeChild(el.log.firstChild!)
  if (el.fAutoscroll.checked) el.log.scrollTop = el.log.scrollHeight
}

function logLine(text: string, kind: string | null): void {
  logQueue.push({ text, kind })
  if (!logFrame) logFrame = requestAnimationFrame(flushLog)
}

// 英文关键词要求「独立词 + 前置分隔符」：原实现 /error/i 会把
// `/path/error-handler.js`、`token=errorless` 这类内容误染成错误色。
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

  el.btnPickWs.addEventListener('click', () =>
    guard(async () => {
      const picked = await bridge().pickDirectory()
      if (typeof picked === 'string' && picked) el.fWorkspace.value = picked
    })
  )

  el.btnSave.addEventListener('click', () =>
    guard(async () => {
      // 端口先在前端按同一范围校验：原实现 `Number(...) || 8799` 会把
      // 空值/非法值静默改写成 8799 保存，用户看到的输入与落盘值不一致
      const port = readPort()
      if (port === null) {
        el.saveHint.textContent = '端口无效'
        setTimeout(() => (el.saveHint.textContent = ''), 2400)
        toast(PORT_HINT, true)
        return
      }
      const settings = {
        port,
        autoStart: el.fAuto.checked,
        openMode: el.fOpenMode.value,
        dshHome: el.fDshHome.value.trim(),
        workspace: el.fWorkspace.value.trim(),
      }
      const res = await call('harness_save_settings', { settings })
      render(res?.snap || res)
      if (res && res.ok === false) {
        el.saveHint.textContent = '保存失败'
        setTimeout(() => (el.saveHint.textContent = ''), 2400)
        toast(res.error || '设置保存失败', true)
        return
      }
      el.saveHint.textContent = '已保存'
      setTimeout(() => (el.saveHint.textContent = ''), 2400)
      // 端口/工作目录等只在下一次 spawn 时读取：服务在运行中保存设置，
      // 旧配置仍在生效，必须显式说明，避免误以为已即刻切换
      const restartNeeded = !!(res?.snap?.running || res?.snap?.starting)
      toast(restartNeeded ? '设置已保存，将在下次启动 DSH 时生效' : '设置已保存')
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
      logs: [],
      settings: {
        port: PORT_DEFAULT,
        autoStart: false,
        openMode: 'window',
        dshHome: '',
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
