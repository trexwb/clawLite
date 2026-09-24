#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════
   Claw Lite · 静态自检（Electron 版）
   ───────────────────────────────────────────────────────────────────
   覆盖：
     1. JSON 合法性
     2. 关键文件存在性
     3. JS 语法（electron / scripts / src）
     4. IPC 契约三层对齐
        渲染层 api.*  →  preload 暴露方法  →  主进程 ipcMain.handle 通道
     5. 内置 DSH 运行时完整性（本地缺失仅告警，CI 在 runtime 步骤后校验）
     6. 无残留 Tauri 依赖
     7. 状态枚举双向可达（harness.setState ↔ 渲染层 STATE_LABEL）
     8. 日志着色类名交叉（渲染层 classify() ↔ main.css 定义）
     9. 端口范围三方一致（index.html ↔ main.cjs ↔ harness.cjs）
    10. 安全与无障碍基线硬断言（webPreferences / CSP / 播报区唯一）
   ═══════════════════════════════════════════════════════════════════ */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
let fails = 0;
let warns = 0;

const ok = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  (" + extra + ")" : ""}`);
  if (!cond) fails++;
};
const warn = (name, extra = "") => {
  console.log(`WARN  ${name}${extra ? "  (" + extra + ")" : ""}`);
  warns++;
};

/* ── 1) JSON 合法性 ─────────────────────────────────────────────── */
for (const f of ["package.json"]) {
  const p = join(root, f);
  if (!existsSync(p)) {
    ok(f, false, "文件缺失");
    continue;
  }
  try {
    JSON.parse(readFileSync(p, "utf8"));
    ok(f, true);
  } catch (e) {
    ok(f, false, e.message);
  }
}

/* ── 2) 关键文件存在性 ──────────────────────────────────────────── */
const REQUIRED = [
  "electron/main.cjs",
  "electron/preload.cjs",
  "electron/harness.cjs",
  "electron/settings.cjs",
  "electron-builder.yml",
  "build/entitlements.mac.plist",
  "build/icon.png",
  "index.html",
  "src/main.js",
  "src/styles/main.css",
  "vite.config.js",
  ".github/workflows/release.yml",
];
for (const f of REQUIRED) {
  const exists = existsSync(join(root, f));
  ok(`存在 ${f}`, exists, exists ? "" : "缺失");
}

/* ── 3) JS 语法 ─────────────────────────────────────────────────── */
function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (["node_modules", "dist", "release", ".git", "_legacy-tauri"].includes(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(mjs|cjs|js)$/.test(name)) out.push(p);
  }
  return out;
}
const jsFiles = [
  ...walk(join(root, "electron")),
  ...walk(join(root, "scripts")),
  ...walk(join(root, "src")),
];
for (const f of jsFiles) {
  const r = spawnSync(process.execPath, ["--check", f], { encoding: "utf8" });
  ok(relative(root, f), r.status === 0, (r.stderr || "").split("\n")[0]);
}

/* ── 4) IPC 契约三层对齐 ────────────────────────────────────────── */
const mainSrc = readFileSync(join(root, "electron/main.cjs"), "utf8");
const preloadSrc = readFileSync(join(root, "electron/preload.cjs"), "utf8");
const rendererSrc = readFileSync(join(root, "src/main.js"), "utf8");

const handled = [...mainSrc.matchAll(/ipcMain\.handle\(\s*'([^']+)'/g)].map((m) => m[1]);
const invoked = [...new Set([...preloadSrc.matchAll(/ipcRenderer\.invoke\(\s*'([^']+)'/g)].map((m) => m[1]))];

const missingHandlers = invoked.filter((c) => !handled.includes(c));
ok(
  "preload 调用的通道均已在主进程注册",
  missingHandlers.length === 0,
  missingHandlers.join(",") || `${handled.length} 个通道`
);

const notExposed = handled.filter((c) => !invoked.includes(c));
if (notExposed.length) warn("主进程注册但 preload 未暴露的通道", notExposed.join(","));

const mainEvents = [...new Set([...mainSrc.matchAll(/broadcast\(\s*'([^']+)'/g)].map((m) => m[1]))];
// preload 通过内部 on() 包装订阅事件，通道名以字面量传入该包装函数，
// 故同时收集 ipcRenderer.on( 与 on( 两处调用。
const preloadEvents = [
  ...new Set([
    ...[...preloadSrc.matchAll(/ipcRenderer\.on\(\s*'([^']+)'/g)].map((m) => m[1]),
    ...[...preloadSrc.matchAll(/\bon\(\s*'([^']+)'/g)].map((m) => m[1]),
  ]),
];
const missingEvents = mainEvents.filter((c) => !preloadEvents.includes(c));
ok(
  "主进程广播的事件均已在 preload 订阅",
  missingEvents.length === 0,
  missingEvents.join(",") || `${mainEvents.length} 个事件`
);

const exposed = [...preloadSrc.matchAll(/^\s{2}(\w+):\s*\(/gm)].map((m) => m[1]);
const called = [...new Set([...rendererSrc.matchAll(/api\.(\w+)\(/g)].map((m) => m[1]))];
const missingApi = called.filter((m) => !exposed.includes(m));
ok(
  "渲染层调用的 preload 方法均已暴露",
  missingApi.length === 0,
  missingApi.join(",") || `${called.length} 个方法`
);

/* ── 5) 内置 DSH 运行时 ─────────────────────────────────────────── */
const dshEntry = join(root, "resources/dsh/app/node_modules/@deepseek-ai/dsh/lib/bin.js");
if (existsSync(dshEntry)) {
  ok("内置 DSH 运行时", true, "resources/dsh/app");
} else {
  warn("内置 DSH 运行时缺失", "执行 npm run runtime 拉取");
}

/* ── 6) 无残留 Tauri 依赖 ───────────────────────────────────────── */
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
const tauriDeps = Object.keys(allDeps).filter((d) => d.includes("tauri"));
ok("无残留 Tauri 依赖", tauriDeps.length === 0, tauriDeps.join(",") || "clean");
ok("入口指向 Electron 主进程", pkg.main === "electron/main.cjs", pkg.main || "(未设置)");

/* ── 7) 状态枚举双向可达 ───────────────────────────────────────── */
// 原实现只断言「harness.setState 取值 ⊆ 渲染层标签」：那只能保证主进程用到的
// 状态都有文案；反过来「渲染层写了标签、主进程永不置入」的死枚举（stopping 曾
// 如此）会随全绿漏网。故补反向可达性断言。
const harnessSrc = readFileSync(join(root, "electron/harness.cjs"), "utf8");
const harnessStates = [
  ...new Set(
    [...harnessSrc.matchAll(/setState\(([^)]*)\)/g)].flatMap((m) =>
      [...m[1].matchAll(/'([a-zA-Z]+)'/g)].map((x) => x[1])
    )
  ),
];
// 渲染层 STATE_LABEL 为「无分号」风格，故块结束符匹配 \n}
const labelBlock = rendererSrc.match(/const STATE_LABEL\s*=\s*\{([\s\S]*?)\n\}/);
const labelKeys = [
  ...new Set([...(labelBlock ? labelBlock[1] : "").matchAll(/(\w+)\s*:/g)].map((m) => m[1])),
];
const missingLabels = harnessStates.filter((s) => !labelKeys.includes(s));
ok(
  "状态枚举正向对齐（harness.setState ⊆ 渲染层 STATE_LABEL）",
  harnessStates.length > 0 && !missingLabels.length,
  missingLabels.join(",") || `${harnessStates.length} 个状态`
);
const deadLabels = labelKeys.filter((s) => !harnessStates.includes(s));
ok(
  "状态枚举无死枚举（渲染层 STATE_LABEL ⊆ harness.setState）",
  labelKeys.length > 0 && !deadLabels.length,
  deadLabels.join(",") || "全部可达"
);

/* ── 8) 日志着色类名 ↔ CSS 交叉 ────────────────────────────────── */
// classify() 返回的类名必须在 main.css 有定义；main.css 里 `.log .l-*` 的规则
// 也必须真能被 classify() 产出——两侧都能拦住死样式 / 死类名。
const cssSrc = readFileSync(join(root, "src/styles/main.css"), "utf8");
const classifyBlock = rendererSrc.match(/function classify\(line\)\s*\{([\s\S]*?)\n\}/);
const classifyClasses = [
  ...new Set([...(classifyBlock ? classifyBlock[1] : "").matchAll(/'(l-[a-z]+)'/g)].map((m) => m[1])),
];
const logClasses = [...new Set([...cssSrc.matchAll(/\.log\s+\.(l-[a-z]+)\s*\{/g)].map((m) => m[1]))];
const classNoStyle = classifyClasses.filter((c) => !logClasses.includes(c));
ok(
  "日志着色类名均有 CSS 定义（classify() → main.css）",
  classifyClasses.length > 0 && !classNoStyle.length,
  classNoStyle.join(",") || classifyClasses.join(",")
);
const styleNoClass = logClasses.filter((c) => !classifyClasses.includes(c));
ok(
  "无死样式（main.css 的 .log .l-* 均能被 classify() 产出）",
  !styleNoClass.length,
  styleNoClass.join(",") || "无"
);

/* ── 9) 端口范围三方一致 ───────────────────────────────────────── */
// 输入框约束、主进程 IPC 校验、harness 分配策略必须同源，否则会出现
// 「输入框拦住 / 主进程放行 / 渲染层静默改写」三条互不一致的路径。
const htmlSrc = readFileSync(join(root, "index.html"), "utf8");
const htmlPort = htmlSrc.match(/id="f-port"[^>]*min="(\d+)"[^>]*max="(\d+)"/);
const cjsPort = harnessSrc.match(/const PORT_MIN\s*=\s*(\d+)[\s\S]*?const PORT_MAX\s*=\s*(\d+)/);
const cjsDefault = harnessSrc.match(/const PORT_DEFAULT\s*=\s*(\d+)/);
const jsPorts = [...rendererSrc.matchAll(/const PORT_(MIN|MAX|DEFAULT)\s*=\s*(\d+)/g)].reduce(
  (acc, m) => ({ ...acc, [m[1]]: m[2] }),
  {}
);
ok(
  "端口范围一致（index.html ↔ harness.cjs PORT_MIN/MAX）",
  !!htmlPort && !!cjsPort && htmlPort[1] === cjsPort[1] && htmlPort[2] === cjsPort[2],
  htmlPort && cjsPort ? `${htmlPort[1]}-${htmlPort[2]}` : "未匹配到端口声明"
);
ok(
  "渲染层端口常量与 harness.cjs 同源（PORT_MIN/MAX/DEFAULT）",
  !!cjsPort &&
    !!cjsDefault &&
    jsPorts.MIN === cjsPort[1] &&
    jsPorts.MAX === cjsPort[2] &&
    jsPorts.DEFAULT === cjsDefault[1],
  `${jsPorts.MIN ?? "?"}-${jsPorts.MAX ?? "?"} · 默认 ${jsPorts.DEFAULT ?? "?"}`
);

/* ── 10) 安全与无障碍基线硬断言 ───────────────────────────────── */
const prefBlocks = mainSrc
  .split("webPreferences: {")
  .slice(1)
  .map((s) => s.slice(0, s.indexOf("}")));
ok("主进程 webPreferences 块存在", prefBlocks.length >= 2, `${prefBlocks.length} 处`);
prefBlocks.forEach((b, i) => {
  ok(
    `webPreferences #${i + 1} 安全三项（sandbox / contextIsolation / nodeIntegration:false）`,
    /sandbox:\s*true/.test(b) &&
      /contextIsolation:\s*true/.test(b) &&
      /nodeIntegration:\s*false/.test(b),
    b.replace(/\s+/g, " ").trim().slice(0, 56)
  );
});
const cspMeta = htmlSrc.match(/http-equiv="Content-Security-Policy"[\s\S]*?content="([^"]+)"/);
const cspText = cspMeta ? cspMeta[1] : "";
ok("CSP meta 存在", !!cspMeta);
ok(
  "CSP 未放宽脚本内联（script-src 仅 'self'）",
  /script-src[^;]*'self'/.test(cspText) && !/script-src[^;]*unsafe-inline/.test(cspText),
  cspText.slice(0, 34)
);
ok(
  "CSP connect-src 仅 'self'（无 https: / ws:）",
  /connect-src\s+'self'/.test(cspText) && !/connect-src[^;]*(https:|ws:)/.test(cspText)
);
const pillTag = htmlSrc.match(/<span id="status-pill"[^>]*>/);
const heroTag = htmlSrc.match(/<div class="hero-text"[^>]*>/);
ok(
  "状态播报区唯一（#hero-text 承担播报，#status-pill 不参与）",
  !!pillTag && !!heroTag && !/aria-live/.test(pillTag[0]) && /aria-live="polite"/.test(heroTag[0]),
  (pillTag ? pillTag[0] : "").trim()
);
ok(
  "日志区不做 live 播报（高频追加不打断读屏）",
  /id="log"[^>]*aria-live="off"/.test(htmlSrc)
);

console.log(
  fails === 0 ? `\n全部通过 ✔${warns ? `（${warns} 项告警）` : ""}` : `\n${fails} 项失败 ✘`
);
process.exit(fails === 0 ? 0 : 1);
