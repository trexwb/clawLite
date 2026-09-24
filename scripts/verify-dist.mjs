#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════
   Claw Lite · 渲染层产物校验（构建后运行）
   ───────────────────────────────────────────────────────────────────
   check.mjs 是纯静态自检，看不到 Vite 产出的 dist/。本脚本在
   `npm run build:web` 之后执行，断言：
     1. dist/index.html 存在，且资源引用为相对路径（file:// 可加载）
     2. 品牌图标真实产出到 dist/assets/ 且被 index.html 引用
   ═══════════════════════════════════════════════════════════════════ */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, "dist");
const htmlPath = join(dist, "index.html");
let fails = 0;

const ok = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  (" + extra + ")" : ""}`);
  if (!cond) fails++;
};

ok("dist/index.html 存在", existsSync(htmlPath), existsSync(htmlPath) ? "" : "请先执行 npm run build:web");

if (existsSync(htmlPath)) {
  const html = readFileSync(htmlPath, "utf8");
  ok("资源引用为相对路径（无 /src、/assets 绝对引用）", !/(?:src|href)="\/(?!\/)/.test(html));

  const assetsDir = join(dist, "assets");
  const icons = existsSync(assetsDir)
    ? readdirSync(assetsDir).filter((f) => /^icon.*\.png$/.test(f))
    : [];
  ok("品牌图标已产出到 dist/assets", icons.length > 0, icons.join(",") || "未找到 icon*.png");
  ok(
    "index.html 已引用产出的品牌图标",
    icons.some((f) => html.includes(`assets/${f}`)),
    icons.join(",")
  );
}

console.log(fails === 0 ? "\n产物校验通过 ✔" : `\n${fails} 项失败 ✘`);
process.exit(fails === 0 ? 0 : 1);
