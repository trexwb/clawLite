'use strict'
/* ═══════════════════════════════════════════════════════════════════
   Claw Lite — Electron 主进程入口
   ───────────────────────────────────────────────────────────────────
   职责：单实例、窗口、IPC 路由、DSH 生命周期调度、自动更新。
   ═══════════════════════════════════════════════════════════════════ */

const { app, BrowserWindow, ipcMain, shell, dialog, Menu } = require('electron')
const path = require('node:path')
const fs = require('node:fs')

const { HarnessManager } = require('./harness.cjs')
const { SettingsStore } = require('./settings.cjs')

// 启动性能：禁用后台节流，避免窗口被遮挡时 dsh 子进程 / 渲染层定时器被降速
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
app.commandLine.appendSwitch('disable-renderer-backgrounding')

// 启动埋点：进程启动为 T0，关键阶段打点写入 userData/startup.log 并打印，便于量化启动耗时
const PERF_T0 = Date.now()
const _perfMarked = new Set()
function perfMark(phase) {
  if (_perfMarked.has(phase)) return
  _perfMarked.add(phase)
  const dt = Date.now() - PERF_T0
  console.log(`[claw-lite][perf] ${phase} +${dt}ms`)
  try {
    fs.appendFileSync(
      path.join(app.getPath('userData'), 'startup.log'),
      `[${new Date().toISOString()}] perf ${phase} +${dt}ms\n`
    )
  } catch {}
}

const APP_ROOT = path.join(__dirname, '..')
const DEV_SERVER = process.env.CLAWLITE_DEV_SERVER || ''

let mainWindow = null
let webWindow = null
let store = null
let harness = null
let updater = null

/* ── 窗口 ───────────────────────────────────────────────────────── */

function iconPath() {
  const p = path.join(APP_ROOT, 'build', 'icon.png')
  return fs.existsSync(p) ? p : undefined
}

function createMainWindow() {
  const bounds = store.all.windowBounds || {}
  mainWindow = new BrowserWindow({
    width: bounds.width || 1120,
    height: bounds.height || 780,
    x: bounds.x,
    y: bounds.y,
    minWidth: 880,
    minHeight: 620,
    title: 'Claw Lite',
    backgroundColor: '#0f1115',
    icon: iconPath(),
    show: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    // macOS 专用（其他平台忽略）：把交通灯固定在 62px 顶栏内垂直居中、靠左留白，
    // 与渲染层 body.is-mac 下的 --topbar-gutter 左侧安全区配套，避免与品牌标题重叠
    trafficLightPosition: { x: 16, y: 24 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  })

  mainWindow.once('ready-to-show', () => {
    perfMark('window-ready')
    mainWindow.show()
  })

  if (!app.isPackaged && DEV_SERVER) {
    mainWindow.loadURL(DEV_SERVER)
  } else {
    mainWindow.loadFile(path.join(APP_ROOT, 'dist', 'index.html'))
  }

  // 窗口几何落盘：拖动 / 缩放期间 resize·move 按帧触发，逐事件同步写盘
  // 会造成大量冗余 IO。此处合并为 400ms 防抖，并在窗口关闭前补一次同步落盘，
  // 避免「刚拖完就退出」丢失最后位置。
  let persistTimer = null
  const persistNow = () => {
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMinimized()) return
    store.save({ windowBounds: mainWindow.getNormalBounds() })
  }
  const persistSoon = () => {
    clearTimeout(persistTimer)
    persistTimer = setTimeout(persistNow, 400)
  }
  mainWindow.on('resize', persistSoon)
  mainWindow.on('move', persistSoon)
  mainWindow.on('close', () => {
    clearTimeout(persistTimer)
    persistNow()
  })
  mainWindow.on('closed', () => {
    clearTimeout(persistTimer)
    mainWindow = null
  })

  // 外部链接交给系统浏览器，不在应用内开新窗
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  return mainWindow
}

/** 打开 DSH Web UI（应用内窗口） */
function openWebWindow() {
  if (!harness.url) return
  if (webWindow && !webWindow.isDestroyed()) {
    webWindow.loadURL(harness.url)
    webWindow.focus()
    return
  }
  webWindow = new BrowserWindow({
    width: 1320,
    height: 900,
    title: 'DeepSeek Harness',
    backgroundColor: '#0f1115',
    icon: iconPath(),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition: 'persist:dsh-web',
    },
  })
  webWindow.loadURL(harness.url)
  webWindow.on('closed', () => { webWindow = null })
  webWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  // 仅放行与当前 dsh 服务同源的站内导航；页面内点击外链时改交系统浏览器，
  // 避免宿主窗口（持久分区 persist:dsh-web）被导航到任意外部站点。
  webWindow.webContents.on('will-navigate', (event, url) => {
    let sameOrigin = false
    try {
      sameOrigin = !!harness.url && new URL(url).origin === new URL(harness.url).origin
    } catch {
      sameOrigin = false
    }
    if (sameOrigin) return
    event.preventDefault()
    if (/^https?:/i.test(url)) shell.openExternal(url)
  })
}

/* ── 广播 ───────────────────────────────────────────────────────── */

function broadcast(channel, payload) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

function wireHarness() {
  harness.on('state', (snap) => {
    if (snap.state === 'running') perfMark('dsh-ready')
    broadcast('harness:state', snap)
  })
  harness.on('log', (line) => broadcast('harness:log', line))
}

/* ── 自动更新 ───────────────────────────────────────────────────── */

function getUpdater() {
  if (updater) return updater
  if (!app.isPackaged) return null
  try {
    const { autoUpdater } = require('electron-updater')
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    // 后台下载阶段若抛出 'error' 事件而无人监听，EventEmitter 会抛未处理异常
    // 直接崩溃主进程；try/catch 只能覆盖 checkForUpdates() 的同步/await 段。
    autoUpdater.on('error', (err) => {
      harness.log(`[claw-lite] ⚠ 自动更新失败：${err?.message || err}`)
    })
    updater = autoUpdater
    return updater
  } catch {
    return null
  }
}

async function checkForUpdates() {
  const up = getUpdater()
  if (!up) {
    return { ok: false, message: '开发模式下不支持检查更新（需安装包运行）' }
  }
  try {
    const result = await up.checkForUpdates()
    if (!result || !result.updateInfo) return { ok: true, message: '当前已是最新版本' }
    const latest = result.updateInfo.version
    if (latest === app.getVersion()) return { ok: true, message: '当前已是最新版本' }
    return { ok: true, message: `发现新版本 ${latest}，正在后台下载…`, version: latest }
  } catch (e) {
    return { ok: false, message: `更新检查失败：${e?.message || e}` }
  }
}

/* ── IPC ────────────────────────────────────────────────────────── */

function registerIpc() {
  ipcMain.handle('harness:snapshot', () => harness.snapshot())

  ipcMain.handle('harness:start', async () => {
    const snap = await harness.start()
    if (snap.running && snap.settings.openMode === 'window') {
      // 自动启动场景下直接呈现界面
      setTimeout(() => { if (harness.url) openWebWindow() }, 300)
    }
    return snap
  })

  ipcMain.handle('harness:stop', () => harness.stop())
  ipcMain.handle('harness:restart', () => harness.restart())

  ipcMain.handle('harness:verify', () => {
    const rt = harness.checkRuntime()
    if (rt.ok) {
      return `运行时完整：DSH ${harness.dshVersion} · Node ${process.versions.node}（Electron 内置）`
    }
    return `运行时异常：${rt.reason}`
  })

  ipcMain.handle('harness:clearLogs', () => {
    harness.clearLogs()
    return true
  })

  ipcMain.handle('harness:saveSettings', (_e, settings) => {
    const port = Number(settings?.port)
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return { ok: false, error: '监听端口需为 1-65535 之间的整数', snap: harness.snapshot() }
    }
    const patch = {
      port,
      autoStart: !!settings?.autoStart,
      openMode: settings?.openMode === 'browser' ? 'browser' : 'window',
      workspace: String(settings?.workspace || '').trim(),
      dshHome: String(settings?.dshHome || '').trim(),
    }
    // 写盘结果回传渲染层：此前静默吞错，用户会看到「已保存」但重启后设置回退。
    const saved = store.save(patch)
    harness.settings = { ...harness.settings, ...patch }
    const snap = harness.snapshot()
    broadcast('harness:state', snap)
    return { ok: saved.ok !== false, error: saved.error || '', snap }
  })

  ipcMain.handle('harness:open', async (_e, mode) => {
    if (!harness.url) throw new Error('DSH 未运行，请先启动')
    if (mode === 'browser') await shell.openExternal(harness.url)
    else openWebWindow()
    return true
  })

  ipcMain.handle('dialog:pickDirectory', async () => {
    const parent = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined
    const res = await dialog.showOpenDialog(parent, {
      title: '选择工作目录',
      properties: ['openDirectory', 'createDirectory'],
    })
    if (res.canceled || !res.filePaths.length) return null
    return res.filePaths[0]
  })

  ipcMain.handle('updater:check', () => checkForUpdates())

  ipcMain.handle('app:relaunch', () => {
    // 用 app.quit() 而非 app.exit(0)：exit 不触发 before-quit，
    // dsh 子进程不会被优雅停止，重启后会残留孤儿进程。
    app.relaunch()
    app.quit()
  })

  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    name: app.getName(),
    platform: process.platform,
    arch: process.arch,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    packaged: app.isPackaged,
  }))
}

/* ── 菜单 ───────────────────────────────────────────────────────── */

function buildMenu() {
  const isMac = process.platform === 'darwin'
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: '运行',
      submenu: [
        { label: '启动 DSH', accelerator: 'CmdOrCtrl+R', click: () => harness.start() },
        { label: '停止 DSH', accelerator: 'CmdOrCtrl+.', click: () => harness.stop() },
        { label: '重启 DSH', click: () => harness.restart() },
        { type: 'separator' },
        { label: '打开界面', accelerator: 'CmdOrCtrl+O', click: () => openWebWindow() },
        {
          label: '在浏览器中打开',
          click: () => { if (harness.url) shell.openExternal(harness.url) },
        },
      ],
    },
    { role: 'editMenu' },
    {
      label: '视图',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        {
          label: '项目主页',
          click: () => shell.openExternal('https://github.com/trexwb/clawLite'),
        },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

/* ── 启动 ───────────────────────────────────────────────────────── */

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(async () => {
    perfMark('app-ready')
    // macOS：应用从 DMG 只读卷（或 App Translocation 临时路径）直接运行时，
    // 系统不允许其拉起内置运行时。这里引导用户完成标准安装步骤（拖入「应用程序」）。
    if (process.platform === 'darwin' && app.isPackaged) {
      const exe = app.getPath('exe')
      // 只读位置判定：DMG 挂载卷、App Translocation 临时路径，或所在目录不可写
      // 标准 DMG 挂载路径为 /Volumes/<卷名>/，App Translocation 为系统临时路径；
      // 两者均为只读位置，Electron 与内置运行时都无法在其中完成初始化。
      const fromReadOnly =
        exe.startsWith('/Volumes/') || exe.includes('/AppTranslocation/')
      if (fromReadOnly) {
        try {
          fs.appendFileSync(
            path.join(app.getPath('userData'), 'startup.log'),
            `[${new Date().toISOString()}] blocked-launch read-only location: ${exe}\n`
          )
        } catch {}
        const { response } = await dialog.showMessageBox({
          type: 'warning',
          message: '请先将 Claw Lite 拖入「应用程序」文件夹',
          detail:
            '检测到应用正在从磁盘映像（DMG）中直接运行。\n\n' +
            '该方式下 macOS 不允许启动内置的 DSH 运行时。' +
            '请将 Claw Lite 拖入「应用程序」文件夹后，再从那里打开。',
          buttons: ['打开「应用程序」文件夹', '仍然继续'],
          defaultId: 0,
          cancelId: 1,
          noLink: true,
        })
        if (response === 0) {
          shell.openPath('/Applications')
          app.exit(0)
          return
        }
      }
    }

    store = new SettingsStore(app.getPath('userData'))
    harness = new HarnessManager({
      appRoot: APP_ROOT,
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      userDataDir: app.getPath('userData'),
    })
    harness.settings = { ...harness.settings, ...store.all }
    if (store.loadError) harness.log(`[claw-lite] ⚠ ${store.loadError}`)

    wireHarness()
    registerIpc()
    buildMenu()
    createMainWindow()

    // autoStart：与窗口创建并行拉起 dsh，重叠其冷启动与窗口渲染，
    // 缩短 autoStart 场景下「DSH 就绪」的体感耗时。harness.start 不依赖主窗口，
    // 启动期间的 state 广播在无窗口时自动 no-op，渲染层 boot 时通过 snapshot 拉取当前态。
    if (harness.settings.autoStart) {
      harness.start()
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', async (e) => {
    if (harness && harness.child) {
      e.preventDefault()
      await harness.stop()
      app.exit(0)
    }
  })
}
