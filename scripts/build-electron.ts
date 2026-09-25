#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════
   Claw Lite — 主进程构建（.ts 源码 → dist-electron/*.js 产物）
   ───────────────────────────────────────────────────────────────────
   产物约定（两个文件，后缀统一为 .js，不出现 .cjs / .mjs）：
     dist-electron/main.js     主进程入口，ESM
                               （根 package.json type:module，故 .js 即 ESM）
     dist-electron/preload.js  preload 桥，CJS
                               （preload 忽略 type:module，Electron 一律按 CJS 加载，
                                故 .js 是唯一能同时满足「统一后缀」与「sandbox:true」的形式）

   为什么用 esbuild 打包而非 tsc 直出：
     • tsc 不重写 import 说明符，源码里 './harness.ts' 会被原样带进产物，
       Node 无法解析（且 tsc 本身不支持导入 .ts 扩展名后emit）。
     • esbuild 把 electron/*.ts 打成单文件，既有后缀问题一次性消除，
       也顺带避免产物目录里出现中间层文件。
   ═══════════════════════════════════════════════════════════════════ */
import { build } from 'esbuild'
import type { BuildOptions } from 'esbuild'
import { rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = join(ROOT, 'dist-electron')

// 全量重建：产物目录只应有本次构建结果，避免旧文件被 electron-builder 打进去
rmSync(OUT_DIR, { recursive: true, force: true })

const base: BuildOptions = {
  bundle: true,
  platform: 'node',
  // 与 Electron 44 内置 Node（22.x）对齐，不向下兼容已废弃语法
  target: 'node22',
  logLevel: 'info',
  minify: false,
  sourcemap: false,
}

// electron / electron-updater 由运行时提供，不打进产物：
// 前者是 Electron 注入的内置模块，后者在主进程里按需动态导入（懒加载）。
const main: BuildOptions = {
  ...base,
  entryPoints: [join(ROOT, 'electron', 'main.ts')],
  format: 'esm',
  outfile: join(OUT_DIR, 'main.js'),
  external: ['electron', 'electron-updater'],
}

const preload: BuildOptions = {
  ...base,
  entryPoints: [join(ROOT, 'electron', 'preload.ts')],
  format: 'cjs',
  outfile: join(OUT_DIR, 'preload.js'),
  external: ['electron'],
}

await build(main)
await build(preload)

console.log('[build-electron] ✓ 主进程产物已生成：dist-electron/main.js（ESM）、dist-electron/preload.js（CJS）')
