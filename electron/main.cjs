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
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  })

  mainWindow.once('ready-to-show', () => mainWindow.show())

  if (!app.isPackaged && DEV_SERVER) {
    mainWindow.loadURL(DEV_SERVER)
  } else {
    mainWindow.loadFile(path.join(APP_ROOT, 'dist', 'index.html'))
  }

  const persist = () => {
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMinimized()) return
    store.save({ windowBounds: mainWindow.getNormalBounds() })
  }
  mainWindow.on('resize', persist)
  mainWindow.on('move', persist)
  mainWindow.on('closed', () => { mainWindow = null })

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
}

/* ── 广播 ───────────────────────────────────────────────────────── */

function broadcast(channel, payload) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

function wireHarness() {
  harness.on('state', (snap) => broadcast('harness:state', snap))
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
    const patch = {
      port: Number(settings?.port) || 8799,
      autoStart: !!settings?.autoStart,
      openMode: settings?.openMode === 'browser' ? 'browser' : 'window',
      workspace: String(settings?.workspace || '').trim(),
      dshHome: String(settings?.dshHome || '').trim(),
    }
    store.save(patch)
    harness.settings = { ...harness.settings, ...patch }
    const snap = harness.snapshot()
    broadcast('harness:state', snap)
    return snap
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
    app.relaunch()
    app.exit(0)
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

    wireHarness()
    registerIpc()
    buildMenu()
    createMainWindow()

    if (harness.settings.autoStart) {
      setTimeout(() => harness.start(), 800)
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
