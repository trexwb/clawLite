#!/usr/bin/env node
// Claw Lite · 无头浏览器交互验证（浏览器 mock 模式）：空态 / 发送 / 工具卡片 / 持久化 / 设置弹窗
// 用法: PREVIEW_URL=http://localhost:4173 SHOT_DIR=/abs/shots node scripts/preview-check.mjs
import puppeteer from "puppeteer-core";
import { mkdirSync, writeFileSync } from "node:fs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL = process.env.PREVIEW_URL || "http://localhost:4173";
const OUT = process.env.SHOT_DIR || "shots";
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, cond, extra = "") => {
  results.push({ name, pass: !!cond, extra: String(extra).slice(0, 120) });
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  (" + String(extra).slice(0, 80) + ")" : ""}`);
};

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  defaultViewport: { width: 1240, height: 820 },
});
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("PAGE-ERROR:", e.message));

try {
  await page.goto(URL, { waitUntil: "networkidle0", timeout: 20000 });
  await page.waitForSelector("#app", { timeout: 10000 });
  await sleep(500);
  await page.screenshot({ path: OUT + "/01-empty-state.png" });

  check("空态品牌字渲染", await page.$eval("#chat-col", (el) => !!el.querySelector(".empty-state .empty-mark")));
  check("建议 chips ≥3", (await page.$$(".chip")).length >= 3);

  // 点击第一个建议 chip → 发送（mock 模式：流式回复 + list_dir 工具卡片）
  await page.click(".chip");
  await page.waitForSelector(".tool-card", { timeout: 20000 });
  await sleep(400);
  await page.screenshot({ path: OUT + "/02-tool-card.png" });

  await page.waitForFunction(
    () => { const s = document.getElementById("btn-stop"); return !s || s.classList.contains("hidden"); },
    { timeout: 30000 }
  );
  await sleep(600);
  await page.screenshot({ path: OUT + "/03-conversation.png" });

  check("用户消息渲染", (await page.$$(".msg-user")).length >= 1);
  check("助手回复渲染", (await page.$$(".msg-assistant")).length >= 1);
  check("工具卡片(浏览目录)", await page.$$eval(".tool-card", (els) => els.some((e) => e.textContent.includes("浏览目录"))));
  const last = await page.$$eval(".msg-assistant .msg-body", (els) => els[els.length - 1].textContent);
  check("回复包含目录内容", /README\.md|会议纪要|销售额/.test(last), last.slice(0, 60));
  check("会话标题自动生成", await page.$eval("#session-title", (el) => el.textContent.length > 0 && el.textContent !== "新任务"));

  // 工具卡片点击展开 args
  await page.click(".tool-card .tool-row");
  await sleep(200);
  check("工具卡片可展开 args", await page.$eval(".tool-card", (el) => el.classList.contains("open")));

  // 刷新 → localStorage 会话持久化
  await page.reload({ waitUntil: "networkidle0" });
  await sleep(500);
  check("刷新后会话保留", (await page.$$(".msg-user")).length >= 1);
  check("刷新后侧栏会话项", (await page.$$(".session-item")).length >= 1);

  // 设置弹窗
  await page.click("#btn-settings");
  await page.waitForSelector("#settings-modal:not(.hidden)", { timeout: 5000 });
  await sleep(300);
  await page.screenshot({ path: OUT + "/04-settings.png" });
  check("设置字段齐全", await page.evaluate(() =>
    ["#set-apikey", "#set-apibase", "#set-model", "#set-temp", "#set-workspace"].every((s) => document.querySelector(s))
  ));
  check("默认 API 地址", await page.$eval("#set-apibase", (el) => el.value.includes("api.deepseek.com")));
  await page.keyboard.press("Escape");
  await sleep(250);
  check("Esc 关闭设置", await page.$eval("#settings-modal", (el) => el.classList.contains("hidden")));
} catch (e) {
  check("流程无异常", false, e.message);
  await page.screenshot({ path: OUT + "/99-error.png" }).catch(() => {});
}

await browser.close();
writeFileSync(OUT + "/preview-results.json", JSON.stringify(results, null, 2));
const fails = results.filter((r) => !r.pass).length;
console.log(fails === 0 ? "\nPREVIEW-CHECK-ALL-PASS" : `\nPREVIEW-CHECK-FAILS=${fails}`);
process.exit(fails ? 1 : 0);
