'use strict'
/* ═══════════════════════════════════════════════════════════════════
   Claw Lite — Preload 桥
   在隔离上下文中向渲染进程暴露最小可用面（window.clawLite）。
   ═══════════════════════════════════════════════════════════════════ */

const { contextBridge, ipcRenderer } = require('electron')

const listeners = new Map()

function on(channel, handler) {
  const wrapped = (_event, payload) => handler(payload)
  ipcRenderer.on(channel, wrapped)
  listeners.set(handler, { channel, wrapped })
  return () => {
    ipcRenderer.off(channel, wrapped)
    listeners.delete(handler)
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
  saveSettings: (settings) => ipcRenderer.invoke('harness:saveSettings', settings),
  open: (mode) => ipcRenderer.invoke('harness:open', mode),
  pickDirectory: () => ipcRenderer.invoke('dialog:pickDirectory'),
  checkUpdate: () => ipcRenderer.invoke('updater:check'),
  relaunch: () => ipcRenderer.invoke('app:relaunch'),
  appInfo: () => ipcRenderer.invoke('app:info'),

  /* 事件订阅 */
  onState: (handler) => on('harness:state', handler),
  onLog: (handler) => on('harness:log', handler),
})
