/* ═══════════════════════════════════════════════════════════════════
   Claw Lite — DSH 版本运行时拉取（主进程侧）
   ───────────────────────────────────────────────────────────────────
   职责：把 scripts/fetch-runtime.ts 的"构建时拉取"逻辑下沉为"运行时拉取"，
   使 DSH 版本与应用版本解耦：用户装一次 clawLite，即可在设置里选 latest
   （自动跟随 npm 最新版）或锁定某个具体版本，无需等应用发版。

   本文件只负责"查版本号 + 定位 npm"两件与安装过程无关的事；
   真正的下载/安装（带进度上报、可取消）在 version-download.ts。

   设计要点：
     • 版本号来自 npm registry（HTTPS），不经过渲染层 CSP 限制
       （主进程是纯 Node，无 CSP 约束）。
     • 安装到 userData/dsh-versions/<ver>/app/node_modules，与构建时
       resources/dsh/app 目录结构一致，harness 的 dshEntry 路径不变。
     • npm 由应用打包内置（electron-builder extraResources → resourcesPath/npm），
       不依赖用户系统装有 npm / Node。
     • 原生模块 ABI：下载的预编译二进制若与 Electron 44 ABI 不兼容，
       拉起会失败——此时 harness 回退内置 DSH 并记日志，需实测后补
       @electron/rebuild（见 AGENTS.md / 本文件底部 TODO）。
   ═══════════════════════════════════════════════════════════════════ */

import fs from 'node:fs'
import path from 'node:path'

const REGISTRY = 'https://registry.npmjs.org'
const PKG = '@deepseek-ai/dsh'

export const errText = (e: unknown): string =>
  e instanceof Error ? e.message : String(e)

/** 查 npm registry 拿 latest 版本号 */
export async function fetchLatestVersion(): Promise<string> {
  const res = await fetch(`${REGISTRY}/${PKG}/latest`)
  if (!res.ok) throw new Error(`registry 查询失败（latest）：${res.status}`)
  const data = (await res.json()) as { version?: string }
  if (!data.version) throw new Error('registry 未返回版本号')
  return data.version
}

/** 查 npm registry 拿全部版本号（含 prerelease），降序排列（最新在前） */
export async function fetchAllVersions(): Promise<string[]> {
  const res = await fetch(`${REGISTRY}/${PKG}`)
  if (!res.ok) throw new Error(`registry 查询失败（versions）：${res.status}`)
  const data = (await res.json()) as { versions?: Record<string, unknown> }
  if (!data.versions) throw new Error('registry 未返回版本列表')
  // sensitivity 仅接受 'base' | 'accent' | 'case' | 'variant'，'version' 会被 ICU
  // 直接拒绝并在运行时抛 RangeError（此前用 as any 压掉类型错误，等于把编译期报错
  // 换成了运行期崩溃）。版本号排序只需 numeric:true，sensitivity 用默认值 'variant'。
  return Object.keys(data.versions).sort((a, b) =>
    b.localeCompare(a, undefined, { numeric: true })
  )
}

/**
 * 定位 npm-cli.js：优先级
 *   1. 应用内置（electron-builder 把 npm 打到 resourcesPath/npm）
 *   2. 项目/应用自身依赖树（开发态 node_modules/npm，或 asar 内的 npm）
 *   3. Electron 自带（开发态 process.execPath 旁）
 *   4. 系统 PATH（兜底，用户机器通常没有）
 */
export function resolveNpmCli(
  electronExecPath: string,
  resourcesPath: string,
  appRoot = ''
): string | null {
  const exeDir = path.dirname(electronExecPath)
  const candidates = [
    path.join(resourcesPath, 'npm', 'bin', 'npm-cli.js'),
    appRoot ? path.join(appRoot, 'node_modules', 'npm', 'bin', 'npm-cli.js') : '',
    path.join(exeDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(exeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ]
  for (const c of candidates) if (c && fs.existsSync(c)) return c
  return null
}

/* 说明：旧版同步阻塞的 ensureVersionInstalled 已迁移至 version-download.ts，
   升级为可上报进度的异步实现（downloadVersion）。此处只保留 registry 查询
   与 npm-cli 定位这两件"与安装过程无关"的纯函数。 */
