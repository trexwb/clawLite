#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════
   Claw Lite · 静态自检（Electron 版）
   ───────────────────────────────────────────────────────────────────
   覆盖：
     1. JSON 合法性
     2. 关键文件存在性
     3. 源码形态门禁（无残留 .cjs/.mjs）＋ TS 类型检查（tsc --noEmit）
     4. IPC 契约三层对齐
        渲染层 api.*  →  preload 暴露方法  →  主进程 ipcMain.handle 通道
     5. 内置 DSH 运行时完整性（本地缺失仅告警，CI 在 runtime 步骤后校验）
     6. 无残留 Tauri 依赖 / 入口指向产物 / type:module 保留
     7. 状态枚举双向可达（harness.setState ↔ 渲染层 STATE_LABEL）
     8. 日志着色类名交叉（渲染层 classify() ↔ main.css 定义）
     9. 端口范围三方一致（index.html ↔ harness.ts ↔ 渲染层）
    10. 安全与无障碍基线硬断言（webPreferences / CSP / 播报区唯一）
    11. 构建产物模块形态（dist-electron/main.js 必须 ESM、preload.js 必须 CJS）
    12. 下载阶段枚举双向可达（DOWNLOAD_PHASES ↔ 渲染层 PHASE_LABEL）

   源码为 .ts（node 原生类型擦除直跑），产物为 .js；本脚本自身即 .ts。
   ═══════════════════════════════════════════════════════════════════ */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
let fails = 0
let warns = 0

const ok = (name: string, cond: boolean, extra = ''): void => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`)
  if (!cond) fails++
}
const warn = (name: string, extra = ''): void => {
  console.log(`WARN  ${name}${extra ? '  (' + extra + ')' : ''}`)
  warns++
}

/* ── 1) JSON 合法性 ─────────────────────────────────────────────── */
for (const f of ['package.json', 'tsconfig.json']) {
  const p = join(root, f)
  if (!existsSync(p)) {
    ok(f, false, '文件缺失')
    continue
  }
  try {
    JSON.parse(readFileSync(p, 'utf8'))
    ok(f, true)
  } catch (e) {
    ok(f, false, (e as Error).message)
  }
}

/* ── 2) 关键文件存在性 ──────────────────────────────────────────── */
const REQUIRED = [
  'electron/main.ts',
  'electron/preload.ts',
  'electron/harness.ts',
  'electron/settings.ts',
  'src/shared/constants.ts',
  'scripts/build-electron.ts',
  'scripts/check.ts',
  'scripts/verify-dist.ts',
  'scripts/fetch-runtime.ts',
  'electron-builder.yml',
  'build/entitlements.mac.plist',
  'build/icon.png',
  'index.html',
  'src/main.ts',
  'src/env.d.ts',
  'src/styles/main.css',
  'vite.config.ts',
  'tsconfig.json',
  '.github/workflows/release.yml',
]
for (const f of REQUIRED) {
  const exists = existsSync(join(root, f))
  ok(`存在 ${f}`, exists, exists ? '' : '缺失')
}

/* ── 3) 源码形态门禁 + 类型检查 ─────────────────────────────────── */
// 后缀统一后的硬约束：electron/scripts/src 下不得再出现 .cjs/.mjs 源码，
// 且不得残留迁移前的 .js 源码（渲染层/脚本一律 .ts，产物一律 .js）。
function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    if (['node_modules', 'dist', 'dist-electron', 'release', '.git', '_legacy-tauri'].includes(name)) {
      continue
    }
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}
const sourceFiles = ['electron', 'scripts', 'src'].flatMap((d) => walk(join(root, d)))
const legacySuffix = sourceFiles.filter((f) => /\.(cjs|mjs)$/.test(f))
ok(
  '无残留 .cjs/.mjs 源码（后缀已统一）',
  legacySuffix.length === 0,
  legacySuffix.map((f) => relative(root, f)).join(',') || `${sourceFiles.length} 个源文件`
)

// 若源码目录里出现 .js，视为漏改（产物只应落在 dist / dist-electron）
const strayJs = sourceFiles.filter((f) => /\.js$/.test(f))
ok(
  '源码目录无 .js 残留（应为 .ts）',
  strayJs.length === 0,
  strayJs.map((f) => relative(root, f)).join(',') || 'clean'
)

// 残留 .js 仍逐个做语法校验（一旦出现报错能定位到具体文件）
for (const f of strayJs) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' })
  ok(`语法 ${relative(root, f)}`, r.status === 0, (r.stderr || '').split('\n')[0])
}

// 类型检查：tsc --noEmit 覆盖全部源码（含渲染层 DOM 与 Node 侧两组 lib）
const tscEntry = join(root, 'node_modules', 'typescript', 'bin', 'tsc')
if (existsSync(tscEntry)) {
  const r = spawnSync(process.execPath, [tscEntry, '--noEmit', '-p', 'tsconfig.json'], {
    cwd: root,
    encoding: 'utf8',
  })
  const firstLine = (r.stdout || r.stderr || '').split('\n').find((l) => l.trim()) || ''
  ok('TypeScript 类型检查（tsc --noEmit）', r.status === 0, firstLine.slice(0, 120))
} else {
  ok('TypeScript 类型检查（tsc --noEmit）', false, '未安装 typescript，先执行 npm install')
}

/* ── 4) IPC 契约三层对齐 ────────────────────────────────────────── */
const mainSrc = readFileSync(join(root, 'electron/main.ts'), 'utf8')
const preloadSrc = readFileSync(join(root, 'electron/preload.ts'), 'utf8')
const rendererSrc = readFileSync(join(root, 'src/main.ts'), 'utf8')

const handled = [...mainSrc.matchAll(/ipcMain\.handle\(\s*'([^']+)'/g)].map((m) => m[1])
const invoked = [
  ...new Set([...preloadSrc.matchAll(/ipcRenderer\.invoke\(\s*'([^']+)'/g)].map((m) => m[1])),
]

const missingHandlers = invoked.filter((c) => !handled.includes(c))
ok(
  'preload 调用的通道均已在主进程注册',
  missingHandlers.length === 0,
  missingHandlers.join(',') || `${handled.length} 个通道`
)

const notExposed = handled.filter((c) => !invoked.includes(c))
if (notExposed.length) warn('主进程注册但 preload 未暴露的通道', notExposed.join(','))

const mainEvents = [...new Set([...mainSrc.matchAll(/broadcast\(\s*'([^']+)'/g)].map((m) => m[1]))]
// preload 通过内部 on() 包装订阅事件，通道名以字面量传入该包装函数，
// 故同时收集 ipcRenderer.on( 与 on( 两处调用。
const preloadEvents = [
  ...new Set([
    ...[...preloadSrc.matchAll(/ipcRenderer\.on\(\s*'([^']+)'/g)].map((m) => m[1]),
    ...[...preloadSrc.matchAll(/\bon\(\s*'([^']+)'/g)].map((m) => m[1]),
  ]),
]
const missingEvents = mainEvents.filter((c) => !preloadEvents.includes(c))
ok(
  '主进程广播的事件均已在 preload 订阅',
  missingEvents.length === 0,
  missingEvents.join(',') || `${mainEvents.length} 个事件`
)

const exposed = [...preloadSrc.matchAll(/^\s{2}(\w+):\s*\(/gm)].map((m) => m[1])
// 渲染层经 bridge() 取桥后调用（api 直调与 bridge(). 两种写法都收集）
const called = [
  ...new Set([
    ...[...rendererSrc.matchAll(/api\.(\w+)\(/g)].map((m) => m[1]),
    ...[...rendererSrc.matchAll(/bridge\(\)\.(\w+)\(/g)].map((m) => m[1]),
  ]),
]
const missingApi = called.filter((m) => !exposed.includes(m))
ok(
  '渲染层调用的 preload 方法均已暴露',
  called.length > 0 && missingApi.length === 0,
  missingApi.join(',') || `${called.length} 个方法`
)

/* ── 5) 内置 DSH 运行时 ─────────────────────────────────────────── */
const dshEntry = join(root, 'resources/dsh/app/node_modules/@deepseek-ai/dsh/lib/bin.js')
if (existsSync(dshEntry)) {
  ok('内置 DSH 运行时', true, 'resources/dsh/app')
} else {
  warn('内置 DSH 运行时缺失', '执行 npm run runtime 拉取')
}

/* ── 6) 入口 / 依赖基线 ─────────────────────────────────────────── */
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const allDeps = { ...pkg.dependencies, ...pkg.devDependencies }
const tauriDeps = Object.keys(allDeps).filter((d) => d.includes('tauri'))
ok('无残留 Tauri 依赖', tauriDeps.length === 0, tauriDeps.join(',') || 'clean')
ok('入口指向构建产物', pkg.main === 'dist-electron/main.js', pkg.main || '(未设置)')
ok('保留 type:module（主进程按 ESM 运行）', pkg.type === 'module', pkg.type || '(未设置)')

/* ── 7) 状态枚举双向可达 ───────────────────────────────────────── */
// 原实现只断言「harness.setState 取值 ⊆ 渲染层标签」：那只能保证主进程用到的
// 状态都有文案；反过来「渲染层写了标签、主进程永不置入」的死枚举（stopping 曾
// 如此）会随全绿漏网。故补反向可达性断言。
const harnessSrc = readFileSync(join(root, 'electron/harness.ts'), 'utf8')
const harnessStates = [
  ...new Set(
    [...harnessSrc.matchAll(/setState\(([^)]*)\)/g)].flatMap((m) =>
      [...m[1].matchAll(/'([a-zA-Z]+)'/g)].map((x) => x[1])
    )
  ),
]
// 渲染层 STATE_LABEL 为「无分号」风格，故块结束符匹配 \n}
// （类型注解 `: Record<string, string>` 允许存在，故 `=` 前用 [^=]* 跳过）
const labelBlock = rendererSrc.match(/const STATE_LABEL\s*[^=]*=\s*\{([\s\S]*?)\n\}/)
const labelKeys = [
  ...new Set([...(labelBlock ? labelBlock[1] : '').matchAll(/(\w+)\s*:/g)].map((m) => m[1])),
]
const missingLabels = harnessStates.filter((s) => !labelKeys.includes(s))
ok(
  '状态枚举正向对齐（harness.setState ⊆ 渲染层 STATE_LABEL）',
  harnessStates.length > 0 && !missingLabels.length,
  missingLabels.join(',') || `${harnessStates.length} 个状态`
)
const deadLabels = labelKeys.filter((s) => !harnessStates.includes(s))
ok(
  '状态枚举无死枚举（渲染层 STATE_LABEL ⊆ harness.setState）',
  labelKeys.length > 0 && !deadLabels.length,
  deadLabels.join(',') || '全部可达'
)

/* ── 8) 日志着色类名 ↔ CSS 交叉 ────────────────────────────────── */
// classify() 返回的类名必须在 main.css 有定义；main.css 里 `.log .l-*` 的规则
// 也必须真能被 classify() 产出——两侧都能拦住死样式 / 死类名。
const cssSrc = readFileSync(join(root, 'src/styles/main.css'), 'utf8')
const classifyBlock = rendererSrc.match(/function classify\(line[^)]*\)[^{]*\{([\s\S]*?)\n\}/)
const classifyClasses = [
  ...new Set([...(classifyBlock ? classifyBlock[1] : '').matchAll(/'(l-[a-z]+)'/g)].map((m) => m[1])),
]
const logClasses = [...new Set([...cssSrc.matchAll(/\.log\s+\.(l-[a-z]+)\s*\{/g)].map((m) => m[1]))]
const classNoStyle = classifyClasses.filter((c) => !logClasses.includes(c))
ok(
  '日志着色类名均有 CSS 定义（classify() → main.css）',
  classifyClasses.length > 0 && !classNoStyle.length,
  classNoStyle.join(',') || classifyClasses.join(',')
)
const styleNoClass = logClasses.filter((c) => !classifyClasses.includes(c))
ok(
  '无死样式（main.css 的 .log .l-* 均能被 classify() 产出）',
  !styleNoClass.length,
  styleNoClass.join(',') || '无'
)

/* ── 9) 端口范围三方一致 ───────────────────────────────────────── */
// 端口常量已抽至 src/shared/constants.ts（单一来源），主进程与渲染层均从此导入；
// 此处校验「共享常量 ↔ index.html 输入框约束」两方一致即可，杜绝
// 「输入框拦住 / 主进程放行 / 渲染层静默改写」三条互不一致的路径。
const sharedSrc = readFileSync(join(root, 'src/shared/constants.ts'), 'utf8')
const htmlSrc = readFileSync(join(root, 'index.html'), 'utf8')
const htmlPort = htmlSrc.match(/id="f-port"[^>]*min="(\d+)"[^>]*max="(\d+)"/)
const cMin = sharedSrc.match(/export const PORT_MIN\s*=\s*(\d+)/)
const cMax = sharedSrc.match(/export const PORT_MAX\s*=\s*(\d+)/)
const cDef = sharedSrc.match(/export const PORT_DEFAULT\s*=\s*(\d+)/)
ok(
  '端口范围一致（index.html ↔ src/shared/constants.ts PORT_MIN/MAX）',
  !!htmlPort &&
    !!cMin &&
    !!cMax &&
    htmlPort[1] === cMin[1] &&
    htmlPort[2] === cMax[1],
  htmlPort && cMin && cMax ? `${htmlPort[1]}-${htmlPort[2]} / 常量 ${cMin[1]}-${cMax[1]}` : '未匹配'
)
ok(
  'PORT_DEFAULT 落在 [PORT_MIN, PORT_MAX] 区间内',
  !!cMin &&
    !!cMax &&
    !!cDef &&
    Number(cDef[1]) >= Number(cMin[1]) &&
    Number(cDef[1]) <= Number(cMax[1]),
  cDef ? `默认 ${cDef[1]}` : '未匹配'
)
// 共享常量文件不得引入 Node 内置模块：渲染层由 Vite 以 browser 上下文打包，
// 若此处出现 `node:*` 导入，浏览器包会尝试解析 Node API 而构建失败。
ok(
  'src/shared/constants.ts 无 Node 内置模块导入（纯常量，可安全被渲染层导入）',
  !/from\s+['"]node:/.test(sharedSrc),
  /from\s+['"]node:/.test(sharedSrc) ? '发现 node: 导入' : 'clean'
)

/* ── 10) 安全与无障碍基线硬断言 ───────────────────────────────── */
const prefBlocks = mainSrc
  .split('webPreferences: {')
  .slice(1)
  .map((s) => s.slice(0, s.indexOf('}')))
ok('主进程 webPreferences 块存在', prefBlocks.length >= 2, `${prefBlocks.length} 处`)
prefBlocks.forEach((b, i) => {
  ok(
    `webPreferences #${i + 1} 安全三项（sandbox / contextIsolation / nodeIntegration:false）`,
    /sandbox:\s*true/.test(b) &&
      /contextIsolation:\s*true/.test(b) &&
      /nodeIntegration:\s*false/.test(b),
    b.replace(/\s+/g, ' ').trim().slice(0, 56)
  )
})
const cspMeta = htmlSrc.match(/http-equiv="Content-Security-Policy"[\s\S]*?content="([^"]+)"/)
const cspText = cspMeta ? cspMeta[1] : ''
ok('CSP meta 存在', !!cspMeta)
ok(
  "CSP 未放宽脚本内联（script-src 仅 'self'）",
  /script-src[^;]*'self'/.test(cspText) && !/script-src[^;]*unsafe-inline/.test(cspText),
  cspText.slice(0, 34)
)
ok(
  "CSP connect-src 仅 'self'（无 https: / ws:）",
  /connect-src\s+'self'/.test(cspText) && !/connect-src[^;]*(https:|ws:)/.test(cspText)
)
const pillTag = htmlSrc.match(/<span id="status-pill"[^>]*>/)
const heroTag = htmlSrc.match(/<div class="hero-text"[^>]*>/)
ok(
  '状态播报区唯一（#hero-text 承担播报，#status-pill 不参与）',
  !!pillTag && !!heroTag && !/aria-live/.test(pillTag[0]) && /aria-live="polite"/.test(heroTag[0]),
  (pillTag ? pillTag[0] : '').trim()
)
ok('日志区不做 live 播报（高频追加不打断读屏）', /id="log"[^>]*aria-live="off"/.test(htmlSrc))
// §11.3 禁用 !important，唯一例外是 @media (prefers-reduced-motion) 内的覆盖。
// 算法：先剥除 CSS 注释（避免注释中提及该术语导致误报），再挖掉
// prefers-reduced-motion 块，最后在剩余文本里搜 !important。
const cssNoComments = cssSrc.replace(/\/\*[\s\S]*?\*\//g, '')
const cssWithoutReducedMotion = cssNoComments.replace(
  /@media\s*\(prefers-reduced-motion[^)]*\)\s*\{[\s\S]*?\n\}/g,
  ''
)
const importantLines = cssWithoutReducedMotion
  .split('\n')
  .map((l, i) => (l.includes('!important') ? i + 1 : -1))
  .filter((n) => n >= 0)
ok(
  'CSS 无 !important（prefers-reduced-motion 块内例外）',
  !importantLines.length,
  importantLines.length ? `第 ${importantLines.join(', ')} 行` : 'clean'
)

/* ── 11) 构建产物模块形态 ─────────────────────────────────────── */
// 迁移路线的核心不变量：主进程产物必须是 ESM（纯 ESM 主进程），
// preload 产物必须是 CJS（sandbox:true 下 Electron 只按 CJS 加载 preload）。
// 产物缺失（未构建）仅告警，CI 在 build:electron 之后跑本检查即为硬门禁。
const distMain = join(root, 'dist-electron', 'main.js')
const distPreload = join(root, 'dist-electron', 'preload.js')
if (existsSync(distMain) && existsSync(distPreload)) {
  const bundleMain = readFileSync(distMain, 'utf8')
  const bundlePreload = readFileSync(distPreload, 'utf8')
  ok(
    '主进程产物为 ESM（有 import，无 require）',
    /^\s*import\s/m.test(bundleMain) && !/\brequire\(/.test(bundleMain),
    `import=${/^\s*import\s/m.test(bundleMain)} require=${/\brequire\(/.test(bundleMain)}`
  )
  ok(
    'preload 产物为 CJS（有 require，无 import/export）',
    /\brequire\(/.test(bundlePreload) && !/^\s*(import|export)\s/m.test(bundlePreload),
    `require=${/\brequire\(/.test(bundlePreload)} import=${/^\s*(import|export)\s/m.test(bundlePreload)}`
  )
} else {
  warn('构建产物模块形态检查已跳过', '先执行 npm run build:electron 生成 dist-electron/')
}

/* ── 12) 下载阶段枚举双向可达 ─────────────────────────────────── */
// 与 §7 同一思路：进度面板按 phase 选文案，若主进程新增阶段而渲染层漏配，
// 界面会退化成显示英文原值（如 "verifying"）；反之渲染层多写的键则是死代码。
// 两侧都断言，避免新增阶段时静默漏改。
const downloadSrc = readFileSync(join(root, 'electron/version-download.ts'), 'utf8')
const phasesBlock = downloadSrc.match(/DOWNLOAD_PHASES\s*=\s*\[([\s\S]*?)\]/)
const phases = [
  ...new Set([...(phasesBlock ? phasesBlock[1] : '').matchAll(/'([a-z]+)'/g)].map((m) => m[1])),
]
const phaseLabelBlock = rendererSrc.match(/const PHASE_LABEL\s*[^=]*=\s*\{([\s\S]*?)\n\}/)
const phaseLabelKeys = [
  ...new Set([...(phaseLabelBlock ? phaseLabelBlock[1] : '').matchAll(/(\w+)\s*:/g)].map((m) => m[1])),
]
const missingPhaseLabels = phases.filter((p) => !phaseLabelKeys.includes(p))
ok(
  '下载阶段正向对齐（DOWNLOAD_PHASES ⊆ 渲染层 PHASE_LABEL）',
  phases.length > 0 && !missingPhaseLabels.length,
  missingPhaseLabels.join(',') || `${phases.length} 个阶段`
)
const deadPhaseLabels = phaseLabelKeys.filter((p) => !phases.includes(p))
ok(
  '下载阶段无死枚举（渲染层 PHASE_LABEL ⊆ DOWNLOAD_PHASES）',
  phaseLabelKeys.length > 0 && !deadPhaseLabels.length,
  deadPhaseLabels.join(',') || '全部可达'
)

console.log(
  fails === 0 ? `\n全部通过 ✔${warns ? `（${warns} 项告警）` : ''}` : `\n${fails} 项失败 ✘`
)
process.exit(fails === 0 ? 0 : 1)
