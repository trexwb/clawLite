/* ═══════════════════════════════════════════════════════════════════
   Claw Lite — 运行时控制台前端
   ───────────────────────────────────────────────────────────────────
   与 Electron 主进程契约（preload 暴露的 window.clawLite）：
     方法  snapshot / start / stop / restart / verify / clearLogs
           saveSettings / open / pickDirectory / checkUpdate
           relaunch / appInfo
     事件  onState → Snapshot
           onLog   → String（单行，空串表示清屏）
   ═══════════════════════════════════════════════════════════════════ */

const api = (typeof window !== 'undefined' && window.clawLite) || null
const IS_DESKTOP = !!api

const $ = (id) => document.getElementById(id)

const el = {
  statusPill: $('status-pill'),
  statusText: $('status-text'),
  heroDot: $('hero-dot'),
  heroTitle: $('hero-title'),
  heroMsg: $('hero-msg'),
  urlText: $('url-text'),
  btnCopy: $('btn-copy'),
  btnStart: $('btn-start'),
  btnStop: $('btn-stop'),
  btnRestart: $('btn-restart'),
  btnOpenWindow: $('btn-open-window'),
  btnOpenBrowser: $('btn-open-browser'),
  btnInstall: $('btn-install'),
  btnSave: $('btn-save'),
  btnPickWs: $('btn-pick-ws'),
  btnClearLog: $('btn-clear-log'),
  btnUpdate: $('btn-update'),
  infoRuntime: $('info-runtime'),
  infoNode: $('info-node'),
  infoDir: $('info-dir'),
  infoHome: $('info-home'),
  fPort: $('f-port'),
  fOpenMode: $('f-open-mode'),
  fWorkspace: $('f-workspace'),
  fDshHome: $('f-dsh-home'),
  fAuto: $('f-auto'),
  fAutoscroll: $('f-autoscroll'),
  saveHint: $('save-hint'),
  log: $('log'),
  toast: $('toast'),
  footVersion: $('foot-version'),
}

let snapshot = null
let logEmpty = true

/* ── 通用工具 ──────────────────────────────────────────────────── */

let toastTimer = null
function toast(msg, isErr = false) {
  el.toast.textContent = msg
  el.toast.classList.toggle('err', isErr)
  el.toast.classList.remove('hidden')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => el.toast.classList.add('hidden'), 3200)
}

/** 命令名 → preload 方法映射，保持原有调用点不变 */
const COMMANDS = {
  harness_snapshot: () => api.snapshot(),
  harness_start: () => api.start(),
  harness_stop: () => api.stop(),
  harness_restart: () => api.restart(),
  harness_install: () => api.verify(),
  harness_clear_logs: () => api.clearLogs(),
  harness_save_settings: (args) => api.saveSettings(args?.settings),
  harness_open: (args) => api.open(args?.mode),
}

async function call(cmd, args) {
  if (!api) throw new Error('当前不在桌面应用环境中')
  const fn = COMMANDS[cmd]
  if (!fn) throw new Error(`未知命令：${cmd}`)
  return fn(args)
}

/* ── 渲染 ──────────────────────────────────────────────────────── */

// 与 electron/harness.cjs 的 setState 取值严格对齐
// （scripts/check.mjs 会校验两处状态枚举一致性）
const STATE_LABEL = {
  notInstalled: '运行时缺失',
  stopped: '已就绪 · 未启动',
  starting: '正在启动…',
  stopping: '正在停止…',
  running: '运行中',
  error: '启动失败',
}

function render(snap) {
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
  // 避免「停止→启动」重入产生孤儿 dsh 子进程与状态误判。
  const busy = !!snap.starting || state === 'stopping'
  el.btnStart.disabled = busy || snap.running || !snap.installed
  el.btnStop.disabled = busy || !snap.running
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
  const s = snap.settings || {}
  if (document.activeElement !== el.fPort) el.fPort.value = s.port ?? 8799
  if (document.activeElement !== el.fWorkspace) el.fWorkspace.value = s.workspace || ''
  if (document.activeElement !== el.fDshHome) el.fDshHome.value = s.dshHome || ''
  el.fOpenMode.value = s.openMode || 'window'
  el.fAuto.checked = !!s.autoStart

  el.footVersion.textContent = snap.dshVersion ? `dsh ${snap.dshVersion}` : ''
}

// DOM 行数上限：长会话下日志节点只增不减会持续占用内存并拖慢渲染，
// 与主进程 LOG_LIMIT(800) 对齐，超出后从头部裁剪。
const LOG_DOM_LIMIT = 800

function logLine(text, kind) {
  if (logEmpty) {
    el.log.textContent = ''
    logEmpty = false
  }
  const span = document.createElement('span')
  if (kind) span.className = kind
  span.textContent = text + '\n'
  el.log.appendChild(span)
  while (el.log.childNodes.length > LOG_DOM_LIMIT) el.log.removeChild(el.log.firstChild)
  if (el.fAutoscroll.checked) el.log.scrollTop = el.log.scrollHeight
}

function classify(line) {
  if (line.startsWith('[claw-lite]')) return 'l-claw'
  if (/error|错误|失败|Error:/i.test(line)) return 'l-err'
  return null
}

function rebuildLog(lines) {
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

async function guard(fn, okMsg) {
  try {
    await fn()
    if (okMsg) toast(okMsg)
  } catch (e) {
    toast(String(e?.message || e), true)
  }
}

function bind() {
  el.btnStart.addEventListener('click', () =>
    guard(() => call('harness_start'), '正在启动 DSH 服务…')
  )
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
      const msg = await call('harness_install')
      toast(msg)
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
      const picked = await api.pickDirectory()
      if (typeof picked === 'string' && picked) el.fWorkspace.value = picked
    })
  )

  el.btnSave.addEventListener('click', () =>
    guard(async () => {
      const settings = {
        port: Number(el.fPort.value) || 8799,
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
      toast('设置已保存')
    })
  )

  el.btnUpdate.addEventListener('click', () => guard(checkUpdate))
}

/* ── 自动更新 ──────────────────────────────────────────────────── */

async function checkUpdate() {
  if (!api) {
    toast('仅在桌面应用中支持检查更新', true)
    return
  }
  el.btnUpdate.disabled = true
  el.btnUpdate.textContent = '检查中…'
  try {
    const res = await api.checkUpdate()
    toast(res?.message || '已检查更新', !res?.ok)
  } catch (e) {
    toast(`更新检查失败：${e?.message || e}`, true)
  } finally {
    el.btnUpdate.disabled = false
    el.btnUpdate.textContent = '检查更新'
  }
}

/* ── 启动 ──────────────────────────────────────────────────────── */

async function boot() {
  // macOS 桌面端顶栏需为原生交通灯预留左侧安全区
  // （与 main.cjs 的 trafficLightPosition 配套，样式见 main.css 的 --topbar-gutter）
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
      settings: { port: 8799, autoStart: false, openMode: 'window', dshHome: '', workspace: '' },
    })
    rebuildLog([])
    el.btnUpdate.classList.add('hidden')
    return
  }

  api.onState((snap) => {
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

  api.onLog((line) => {
    if (!line) {
      rebuildLog([])
      return
    }
    logLine(line, classify(line))
  })

  try {
    render(await call('harness_snapshot'))
  } catch (e) {
    toast(`读取运行状态失败：${e?.message || e}`, true)
  }
}

boot()
