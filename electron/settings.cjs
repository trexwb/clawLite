'use strict'
/* ═══════════════════════════════════════════════════════════════════
   Claw Lite — 设置持久化（userData/settings.json）
   ═══════════════════════════════════════════════════════════════════ */

const fs = require('node:fs')
const path = require('node:path')

const DEFAULTS = {
  port: 8799,
  autoStart: false,
  openMode: 'window', // window | browser
  workspace: '',
  dshHome: '',
  windowBounds: null,
}

class SettingsStore {
  constructor(userDataDir) {
    this.file = path.join(userDataDir, 'settings.json')
    this.data = { ...DEFAULTS }
    this.load()
  }

  load() {
    this.loadError = ''
    try {
      if (fs.existsSync(this.file)) {
        const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'))
        this.data = { ...DEFAULTS, ...raw }
      }
    } catch (e) {
      // 读盘 / 解析失败不再完全静默：回落默认值，同时记录原因由主进程写入运行日志
      this.data = { ...DEFAULTS }
      this.loadError = `设置读取失败（已回落默认值）：${e.message}`
    }
    return this.data
  }

  /** 写盘；返回 { ok, error } 让 IPC 调用方能感知失败原因 */
  save(patch) {
    this.data = { ...this.data, ...patch }
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2) + '\n', 'utf8')
      return { ok: true, error: '' }
    } catch (e) {
      return { ok: false, error: `设置写入失败：${e.message}` }
    }
  }

  get all() {
    return { ...this.data }
  }
}

module.exports = { SettingsStore, DEFAULTS }
