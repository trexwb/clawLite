/* ═══════════════════════════════════════════════════════════════════
   Claw Lite — 设置持久化（userData/settings.json）
   ═══════════════════════════════════════════════════════════════════ */

import fs from 'node:fs'
import path from 'node:path'

export interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface Settings {
  port: number
  autoStart: boolean
  openMode: 'window' | 'browser'
  workspace: string
  dshHome: string
  windowBounds: WindowBounds | null
}

export interface SaveResult {
  ok: boolean
  error: string
}

export const DEFAULTS: Settings = {
  port: 8799,
  autoStart: false,
  openMode: 'window', // window | browser
  workspace: '',
  dshHome: '',
  windowBounds: null,
}

export class SettingsStore {
  readonly file: string
  data: Settings
  /** 读盘/解析失败原因，由主进程取走写入运行日志（不静默吞错） */
  loadError = ''

  constructor(userDataDir: string) {
    this.file = path.join(userDataDir, 'settings.json')
    this.data = { ...DEFAULTS }
    this.load()
  }

  load(): Settings {
    this.loadError = ''
    try {
      if (fs.existsSync(this.file)) {
        const raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Partial<Settings>
        this.data = { ...DEFAULTS, ...raw }
      }
    } catch (e) {
      // 读盘 / 解析失败不再完全静默：回落默认值，同时记录原因由主进程写入运行日志
      this.data = { ...DEFAULTS }
      this.loadError = `设置读取失败（已回落默认值）：${e instanceof Error ? e.message : String(e)}`
    }
    return this.data
  }

  /** 写盘；返回 { ok, error } 让 IPC 调用方能感知失败原因 */
  save(patch: Partial<Settings>): SaveResult {
    this.data = { ...this.data, ...patch }
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2) + '\n', 'utf8')
      return { ok: true, error: '' }
    } catch (e) {
      return { ok: false, error: `设置写入失败：${e instanceof Error ? e.message : String(e)}` }
    }
  }

  get all(): Settings {
    return { ...this.data }
  }
}
