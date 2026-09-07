#!/usr/bin/env node
// Claw Lite · 静态自检：JSON 合法性 / JS 语法 / JS↔Rust 命令对齐
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
let fails = 0;
const ok = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  (" + extra + ")" : ""}`);
  if (!cond) fails++;
};

// 1) JSON 文件合法性
for (const f of ["package.json", "src-tauri/tauri.conf.json", "src-tauri/capabilities/default.json"]) {
  const p = join(root, f);
  if (!existsSync(p)) { ok(f, false, "文件缺失"); continue; }
  try { JSON.parse(readFileSync(p, "utf8")); ok(f, true); }
  catch (e) { ok(f, false, e.message); }
}

// 2) JS 语法检查（node --check，type:module 下按 ESM 解析）
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (["node_modules", "dist", ".git"].includes(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(mjs|js)$/.test(name)) out.push(p);
  }
  return out;
}
const jsFiles = [...walk(join(root, "src")), ...walk(join(root, "scripts"))];
for (const f of jsFiles) {
  const r = spawnSync(process.execPath, ["--check", f], { encoding: "utf8" });
  ok(relative(root, f), r.status === 0, (r.stderr || "").split("\n")[0]);
}

// 3) Rust generate_handler 命令 ↔ bridge mock / tools.js 调用 对齐
const libPath = join(root, "src-tauri/src/lib.rs");
const bridgePath = join(root, "src/core/bridge.js");
if (existsSync(libPath) && existsSync(bridgePath)) {
  const lib = readFileSync(libPath, "utf8");
  const m = lib.match(/generate_handler!\[([\s\S]*?)\]/);
  const rustCmds = m ? [...m[1].matchAll(/[a-z_][a-z0-9_]*/g)].map((x) => x[0]) : [];
  const bridge = readFileSync(bridgePath, "utf8");
  const missingMock = rustCmds.filter((c) => !bridge.includes(c));
  ok("Rust 命令在 bridge.js 中对齐", missingMock.length === 0, missingMock.join(",") || `${rustCmds.length} 条命令`);
  const toolsPath = join(root, "src/core/tools.js");
  if (existsSync(toolsPath)) {
    const tools = readFileSync(toolsPath, "utf8");
    const called = [...tools.matchAll(/invoke\(\s*"([a-z_]+)"/g)].map((x) => x[1]);
    const missingRust = called.filter((c) => !rustCmds.includes(c));
    ok("tools.js 调用的命令存在于 Rust", missingRust.length === 0, missingRust.join(",") || `${called.length} 处调用`);
  }
} else {
  ok("lib.rs / bridge.js 存在", false, "缺文件");
}

console.log(fails === 0 ? "\n全部通过 ✔" : `\n${fails} 项失败 ✘`);
process.exit(fails === 0 ? 0 : 1);
