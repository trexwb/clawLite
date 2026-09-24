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

console.log(
  fails === 0 ? `\n全部通过 ✔${warns ? `（${warns} 项告警）` : ""}` : `\n${fails} 项失败 ✘`
);
process.exit(fails === 0 ? 0 : 1);
