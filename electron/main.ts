/* ═══════════════════════════════════════════════════════════════════
   Claw Lite — Electron 主进程入口
   ───────────────────────────────────────────────────────────────────
   职责：单实例、窗口、IPC 路由、DSH 生命周期调度、自动更新。

   模块形态：ESM。根 package.json 声明 type:module，产物 dist-electron/main.js
   按 ESM 加载，故此处不出现 __dirname / require —— 路径基准改用
   import.meta.url 推导（打包后产物仍在 dist-electron/，与源码同层级，
   APP_ROOT 的 '..' 语义保持不变）。
   ═══════════════════════════════════════════════════════════════════ */

import { app, BrowserWindow, ipcMain, shell, dialog, Menu } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

import { HarnessManager, PORT_MIN, PORT_MAX } from './harness.ts'
import type { HarnessSettings, Snapshot } from './harness.ts'
import { SettingsStore } from './settings.ts'

// 启动性能：禁用后台节流，避免窗口被遮挡时 dsh 子进程 / 渲染层定时器被降速
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
app.commandLine.appendSwitch('disable-renderer-backgrounding')

// 启动埋点：进程启动为 T0，关键阶段打点写入 userData/startup.log 并打印，便于量化启动耗时
const PERF_T0 = Date.now()
const _perfMarked = new Set<string>()
function perfMark(phase: string): void {
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

/** 本模块所在目录（ESM 下 import.meta.url 推导，等价于 CJS 的 __dirname） */
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url))
const APP_ROOT = path.join(MODULE_DIR, '..')
const DEV_SERVER = process.env.CLAWLITE_DEV_SERVER || ''
const MAIN_ENTRY = path.join(APP_ROOT, 'dist', 'index.html')

/** 仅用于导航白名单比对的路径归一化（Windows 的 file:// pathname 形如 /C:/…） */
function sameFilePath(urlPath: string, absPath: string): boolean {
  const a = decodeURIComponent(urlPath).replace(/^\/+/, '').replace(/\\/g, '/')
  const b = absPath.replace(/\\/g, '/')
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}

/**
 * 主窗口允许停留的地址：开发态为 DEV_SERVER 同源，其余为 dist/index.html。
 * 与 createMainWindow 的加载分支保持一致。
 */
function isMainWindowNavAllowed(target: string): boolean {
  try {
    const u = new URL(target)
    if (!app.isPackaged && DEV_SERVER) return u.origin === new URL(DEV_SERVER).origin
    return u.protocol === 'file:' && sameFilePath(u.pathname, MAIN_ENTRY)
  } catch {
    return false
  }
}

let mainWindow: BrowserWindow | null = null
let webWindow: BrowserWindow | null = null
// 二者均在 app.whenReady() 内完成初始化，其后所有调用点（IPC / 菜单 / 生命周期）
// 都在 ready 之后才可能触达，故用明确赋值断言而非到处散布空值判断。
let store!: SettingsStore
let harness!: HarnessManager
let updater: import('electron-updater').AppUpdater | null = null

/* ── 窗口 ───────────────────────────────────────────────────────── */

function iconPath(): string | undefined {
  const p = path.join(APP_ROOT, 'build', 'icon.png')
  return fs.existsSync(p) ? p : undefined
}

function createMainWindow(): BrowserWindow {
  const bounds = store.all.windowBounds
  const win = new BrowserWindow({
    width: bounds?.width || 1120,
    height: bounds?.height || 780,
    x: bounds?.x,
    y: bounds?.y,
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
      preload: path.join(MODULE_DIR, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  })
  mainWindow = win

  win.once('ready-to-show', () => {
    perfMark('window-ready')
    win.show()
  })

  if (!app.isPackaged && DEV_SERVER) {
    win.loadURL(DEV_SERVER)
  } else {
    win.loadFile(path.join(APP_ROOT, 'dist', 'index.html'))
  }

  // 窗口几何落盘：拖动 / 缩放期间 resize·move 按帧触发，逐事件同步写盘
  // 会造成大量冗余 IO。此处合并为 400ms 防抖，并在窗口关闭前补一次同步落盘，
  // 避免「刚拖完就退出」丢失最后位置。
  let persistTimer: NodeJS.Timeout | null = null
  const persistNow = () => {
    if (win.isDestroyed() || win.isMinimized()) return
    // 写盘失败（磁盘只读 / 写满）不再静默吞掉：此处没有可回显的 UI，
    // 至少落到运行日志，避免「窗口位置下次启动回退」无从排查
    const res = store.save({ windowBounds: win.getNormalBounds() })
    if (res.ok === false) harness.log(`[claw-lite] ⚠ 窗口位置写入失败：${res.error}`)
  }
  const persistSoon = () => {
    if (persistTimer) clearTimeout(persistTimer)
    persistTimer = setTimeout(persistNow, 400)
  }
  win.on('resize', persistSoon)
  win.on('move', persistSoon)
  win.on('close', () => {
    if (persistTimer) clearTimeout(persistTimer)
    persistNow()
  })
  win.on('closed', () => {
    if (persistTimer) clearTimeout(persistTimer)
    mainWindow = null
  })

  // 外部链接交给系统浏览器，不在应用内开新窗
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  // 仅放行本地渲染层页面的自身导航。setWindowOpenHandler 只挡 window.open，
  // 挡不住页内导航（如把文件拖入窗口）；而主窗口挂有 preload，一旦被导航到
  // 外部来源，window.clawLite 的暴露面就会随页面一起交出去。
  win.webContents.on('will-navigate', (event, url) => {
    if (isMainWindowNavAllowed(url)) return
    event.preventDefault()
    if (/^https?:/i.test(url)) shell.openExternal(url)
  })

  return win
}

/** 打开 DSH Web UI（应用内窗口） */
function openWebWindow(): void {
  if (!harness.url) return
  if (webWindow && !webWindow.isDestroyed()) {
    webWindow.loadURL(harness.url)
    webWindow.focus()
    return
  }
  const win = new BrowserWindow({
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
  webWindow = win
  win.loadURL(harness.url)
  win.on('closed', () => {
    webWindow = null
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  // 仅放行与当前 dsh 服务同源的站内导航；页面内点击外链时改交系统浏览器，
  // 避免宿主窗口（持久分区 persist:dsh-web）被导航到任意外部站点。
  win.webContents.on('will-navigate', (event, url) => {
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

// 只推给渲染层宿主窗口：dsh Web UI 窗口（webWindow）没有 preload、也不订阅
// 这两个通道，无差别群发虽无实际影响，却会把宿主状态外送到被托管的第三方页面
function broadcast(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload)
  }
}

/**
 * 无 UI 承接错误的调用点（菜单项 / autoStart）专用：
 * harness 生命周期方法内部已有错误边界，这里补最后一道网，
 * 避免未捕获的拒绝冒泡成主进程未处理异常。
 */
function safeHarness(action: () => unknown): void {
  const failed = (e: unknown) => {
    if (harness) harness.log(`[claw-lite] ✗ ${e instanceof Error ? e.message : String(e)}`)
  }
  try {
    const r = action()
    if (r && typeof (r as Promise<unknown>).catch === 'function') {
      ;(r as Promise<unknown>).catch(failed)
    }
  } catch (e) {
    failed(e)
  }
}

function wireHarness(): void {
  harness.on('state', (snap: Snapshot) => {
    if (snap.state === 'running') perfMark('dsh-ready')
    broadcast('harness:state', snap)
  })
  harness.on('log', (line: string) => broadcast('harness:log', line))
}

/* ── 自动更新 ───────────────────────────────────────────────────── */

type AppUpdater = import('electron-updater').AppUpdater

async function getUpdater(): Promise<AppUpdater | null> {
  if (updater) return updater
  if (!app.isPackaged) return null
  try {
    // 懒加载 + 动态导入：electron-updater 只在打包态才需要，避免拖慢启动；
    // 其自身为 CJS，命名导出经 cjs-module-lexer 未必可见，故取两种形态兜底。
    const mod = (await import('electron-updater')) as {
      autoUpdater?: AppUpdater
      default?: { autoUpdater?: AppUpdater }
    }
    const autoUpdater = mod.autoUpdater ?? mod.default?.autoUpdater
    if (!autoUpdater) return null
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    // 后台下载阶段若抛出 'error' 事件而无人监听，EventEmitter 会抛未处理异常
    // 直接崩溃主进程；try/catch 只能覆盖 checkForUpdates() 的同步/await 段。
    autoUpdater.on('error', (err: Error) => {
      harness.log(`[claw-lite] ⚠ 自动更新失败：${err?.message || err}`)
    })
    updater = autoUpdater
    return updater
  } catch {
    return null
  }
}

interface UpdateResult {
  ok: boolean
  message: string
  version?: string
}

async function checkForUpdates(): Promise<UpdateResult> {
  const up = await getUpdater()
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
    return { ok: false, message: `更新检查失败：${e instanceof Error ? e.message : String(e)}` }
  }
}

/* ── IPC ────────────────────────────────────────────────────────── */

interface SettingsPayload {
  port?: unknown
  autoStart?: unknown
  openMode?: unknown
  workspace?: unknown
  dshHome?: unknown
}

function registerIpc(): void {
  ipcMain.handle('harness:snapshot', () => harness.snapshot())

  ipcMain.handle('harness:start', async () => {
    const snap = await harness.start()
    if (snap.running && snap.settings.openMode === 'window') {
      // 自动启动场景下直接呈现界面
      setTimeout(() => {
        if (harness.url) openWebWindow()
      }, 300)
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

  ipcMain.handle('harness:saveSettings', (_e, settings: SettingsPayload) => {
    const port = Number(settings?.port)
    // 范围与 index.html `#f-port` 的 min/max、渲染层 saveSettings 前校验同源，
    // 统一由 harness.ts 的 PORT_MIN / PORT_MAX 决定（检查见 scripts/check.ts §9）
    if (!Number.isInteger(port) || port < PORT_MIN || port > PORT_MAX) {
      return {
        ok: false,
        error: `监听端口需为 ${PORT_MIN}-${PORT_MAX} 之间的整数`,
        snap: harness.snapshot(),
      }
    }
    const patch: Partial<HarnessSettings> = {
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

  ipcMain.handle('harness:open', async (_e, mode: string) => {
    if (!harness.url) throw new Error('DSH 未运行，请先启动')
    if (mode === 'browser') await shell.openExternal(harness.url)
    else openWebWindow()
    return true
  })

  ipcMain.handle('dialog:pickDirectory', async () => {
    const parent = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
    const opts = {
      title: '选择工作目录',
      properties: ['openDirectory', 'createDirectory'] as const,
    }
    const res = parent
      ? await dialog.showOpenDialog(parent, { ...opts, properties: [...opts.properties] })
      : await dialog.showOpenDialog({ ...opts, properties: [...opts.properties] })
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

function buildMenu(): void {
  const isMac = process.platform === 'darwin'
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' } as MenuItemConstructorOptions] : []),
    {
      label: '运行',
      submenu: [
        { label: '启动 DSH', accelerator: 'CmdOrCtrl+R', click: () => safeHarness(() => harness.start()) },
        { label: '停止 DSH', accelerator: 'CmdOrCtrl+.', click: () => safeHarness(() => harness.stop()) },
        { label: '重启 DSH', click: () => safeHarness(() => harness.restart()) },
        { type: 'separator' },
        { label: '打开界面', accelerator: 'CmdOrCtrl+O', click: () => openWebWindow() },
        {
          label: '在浏览器中打开',
          click: () => {
            if (harness.url) shell.openExternal(harness.url)
          },
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

  // 最后一道网：漏 catch 的异步异常不应静默击穿主进程（无窗口时无从提示）
  process.on('unhandledRejection', (reason) => {
    console.error('[claw-lite] unhandledRejection:', reason)
    if (harness) {
      harness.log(
        `[claw-lite] ✗ 未处理的异步异常：${reason instanceof Error ? reason.message : String(reason)}`
      )
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
      const fromReadOnly = exe.startsWith('/Volumes/') || exe.includes('/AppTranslocation/')
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
      safeHarness(() => harness.start())
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
