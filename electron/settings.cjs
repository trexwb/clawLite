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
    try {
      if (fs.existsSync(this.file)) {
        const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'))
        this.data = { ...DEFAULTS, ...raw }
      }
    } catch {
      this.data = { ...DEFAULTS }
    }
    return this.data
  }

  save(patch) {
    this.data = { ...this.data, ...patch }
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2) + '\n', 'utf8')
    } catch {
      /* 写入失败不阻断主流程 */
    }
    return this.data
  }

  get all() {
    return { ...this.data }
  }
}

module.exports = { SettingsStore, DEFAULTS }
