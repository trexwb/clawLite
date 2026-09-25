/* ═══════════════════════════════════════════════════════════════════
   Claw Lite — Preload 桥
   在隔离上下文中向渲染进程暴露最小可用面（window.clawLite）。

   产物形态：dist-electron/preload.js（CJS）。
   preload 忽略 package.json 的 type:module，Electron 一律按 CJS 加载，
   故这里后缀为 .js 而非 .mjs；sandbox:true 下也必须走非 ESM 路径。
   ═══════════════════════════════════════════════════════════════════ */

import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'

type Handler = (payload: never) => void
type Wrapped = (event: IpcRendererEvent, payload: unknown) => void

const listeners = new Map<Handler, { channel: string; wrapped: Wrapped }>()

function on<T>(channel: string, handler: (payload: T) => void): () => void {
  const wrapped: Wrapped = (_event, payload) => (handler as (p: unknown) => void)(payload)
  ipcRenderer.on(channel, wrapped)
  listeners.set(handler as Handler, { channel, wrapped })
  return () => {
    ipcRenderer.off(channel, wrapped)
    listeners.delete(handler as Handler)
  }
}

contextBridge.exposeInMainWorld('clawLite', {
  /* 请求/响应 */
  snapshot: () => ipcRenderer.invoke('harness:snapshot'),
  start: () => ipcRenderer.invoke('harness:start'),
  stop: () => ipcRenderer.invoke('harness:stop'),
  restart: () => ipcRenderer.invoke('harness:restart'),
  verify: () => ipcRenderer.invoke('harness:verify'),
  clearLogs: () => ipcRenderer.invoke('harness:clearLogs'),
  saveSettings: (settings: unknown) => ipcRenderer.invoke('harness:saveSettings', settings),
  open: (mode: string) => ipcRenderer.invoke('harness:open', mode),
  pickDirectory: () => ipcRenderer.invoke('dialog:pickDirectory'),
  checkUpdate: () => ipcRenderer.invoke('updater:check'),
  relaunch: () => ipcRenderer.invoke('app:relaunch'),
  appInfo: () => ipcRenderer.invoke('app:info'),

  /* 事件订阅 */
  onState: (handler: (snap: unknown) => void) => on('harness:state', handler),
  onLog: (handler: (line: string) => void) => on('harness:log', handler),
})
