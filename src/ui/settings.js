// Claw Lite · 设置弹窗 / 确认弹窗 / Toast
import { invoke, pickDirectory, aiFetch, MOCK } from "../core/bridge.js";

const DEFAULT_BASE = "https://api.deepseek.com";

const modal = document.getElementById("settings-modal");
const btnClose = document.getElementById("settings-close");
const apikeyEl = document.getElementById("set-apikey");
const eyeEl = document.getElementById("set-key-eye");
const apibaseEl = document.getElementById("set-apibase");
const modelEl = document.getElementById("set-model");
const modelCustomEl = document.getElementById("set-model-custom");
const tempEl = document.getElementById("set-temp");
const tempValEl = document.getElementById("set-temp-val");
const workspaceEl = document.getElementById("set-workspace");
const pickEl = document.getElementById("set-pick");
const btnTest = document.getElementById("btn-test");
const btnSave = document.getElementById("btn-save");

const confirmModal = document.getElementById("confirm-modal");
const confirmTitle = document.getElementById("confirm-title");
const confirmDetail = document.getElementById("confirm-detail");
const confirmOk = document.getElementById("confirm-ok");
const confirmCancel = document.getElementById("confirm-cancel");

const toastEl = document.getElementById("toast");

const EYE_OPEN =
  '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_CLOSED =
  '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><path d="M1 1l22 22"/></svg>';

/* ---------------- Toast ---------------- */
let toastTimer = 0;
export function toast(msg, type) {
  if (!toastEl) return;
  toastEl.textContent = String(msg || "");
  toastEl.classList.toggle("err", type === "err");
  toastEl.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.add("hidden"), 2600);
}

/* ---------------- 确认弹窗 ---------------- */
let confirmResolve = null;
function closeConfirm(result) {
  if (!confirmModal) return;
  confirmModal.classList.add("hidden");
  if (confirmResolve) {
    const r = confirmResolve;
    confirmResolve = null;
    r(result);
  }
}
export function showConfirm({ title, detail }) {
  return new Promise((resolve) => {
    if (!confirmModal) { resolve(false); return; }
    if (confirmResolve) { // 单飞：新弹窗顶掉旧弹窗时，先以 false 结算旧的，避免调用方永挂
      const prev = confirmResolve;
      confirmResolve = null;
      prev(false);
    }
    confirmResolve = resolve;
    confirmTitle.textContent = title || "确认操作";
    confirmDetail.textContent = detail || "";
    confirmModal.classList.remove("hidden");
  });
}

/* ---------------- 设置弹窗 ---------------- */
let savedCallback = null;

function fillForm() {
  const cfg = (window.__store && window.__store.config) || {};
  apikeyEl.value = cfg.apiKey && cfg.apiKey !== "***" ? cfg.apiKey : "";
  apibaseEl.value = cfg.apiBase || DEFAULT_BASE;
  const known = ["deepseek-chat", "deepseek-reasoner"].includes(cfg.model);
  modelEl.value = cfg.model ? (known ? cfg.model : "__custom__") : "deepseek-chat";
  modelCustomEl.classList.toggle("hidden", modelEl.value !== "__custom__");
  modelCustomEl.value = known ? "" : cfg.model || "";
  tempEl.value = typeof cfg.temperature === "number" ? cfg.temperature : 0.7;
  tempValEl.textContent = Number(tempEl.value).toFixed(1);
  workspaceEl.value = cfg.workspacePath || "";
  apikeyEl.type = "password";
  eyeEl.innerHTML = EYE_OPEN;
}

export function openSettings(store, { onSaved } = {}) {
  if (!modal) return;
  window.__store = store;
  savedCallback = onSaved || null;
  fillForm();
  modal.classList.remove("hidden");
  setTimeout(() => apikeyEl && apikeyEl.focus(), 30);
}

function resolveModel() {
  return modelEl.value === "__custom__"
    ? modelCustomEl.value.trim()
    : modelEl.value;
}

async function save() {
  const store = window.__store;
  if (!store) return;
  const patch = {
    apiKey: apikeyEl.value.trim(),
    apiBase: (apibaseEl.value.trim() || DEFAULT_BASE).replace(/\/+$/, ""),
    model: resolveModel() || "deepseek-chat",
    temperature: Number(tempEl.value),
    workspacePath: workspaceEl.value.trim(),
  };
  if (!patch.model) { toast("请填写模型名", "err"); return; }
  btnSave.disabled = true;
  try {
    await store.saveConfig(patch);
    modal.classList.add("hidden");
    toast("已保存");
    if (savedCallback) savedCallback(store.config);
  } catch (e) {
    toast("保存失败：" + (e && e.message ? e.message : e), "err");
  } finally {
    btnSave.disabled = false;
  }
}

async function testConnection() {
  const base = (apibaseEl.value.trim() || DEFAULT_BASE).replace(/\/+$/, "");
  const key = apikeyEl.value.trim();
  if (!key) { toast("请先填写 API Key", "err"); return; }
  btnTest.disabled = true;
  btnTest.textContent = "测试中…";
  try {
    const res = await aiFetch(base + "/models", {
      headers: { Authorization: "Bearer " + key },
    });
    if (res.ok) toast("连接成功");
    else {
      let detail = "";
      try { detail = (await res.text()).slice(0, 120); } catch { /* 忽略 */ }
      toast("连接失败（" + res.status + "）" + (detail ? "：" + detail : ""), "err");
    }
  } catch (e) {
    toast("连接失败：" + (e && e.message ? e.message : e), "err");
  } finally {
    btnTest.disabled = false;
    btnTest.textContent = "测试连接";
  }
}

/* ---------------- 一次性事件绑定 ---------------- */
if (modal) {
  btnClose && btnClose.addEventListener("click", () => modal.classList.add("hidden"));
  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.classList.add("hidden");
  });
  eyeEl && eyeEl.addEventListener("click", () => {
    apikeyEl.type = apikeyEl.type === "password" ? "text" : "password";
    eyeEl.innerHTML = apikeyEl.type === "password" ? EYE_OPEN : EYE_CLOSED;
  });
  modelEl && modelEl.addEventListener("change", () => {
    modelCustomEl.classList.toggle("hidden", modelEl.value !== "__custom__");
    if (modelEl.value !== "__custom__") modelCustomEl.value = "";
    else modelCustomEl.focus();
  });
  tempEl && tempEl.addEventListener("input", () => {
    tempValEl.textContent = Number(tempEl.value).toFixed(1);
  });
  pickEl && pickEl.addEventListener("click", async () => {
    try {
      const dir = await pickDirectory();
      if (dir) workspaceEl.value = dir;
      else if (!MOCK.enabled) toast("未选择目录");
    } catch (e) {
      toast("选择目录失败：" + (e && e.message ? e.message : e), "err");
    }
  });
  if (MOCK.enabled && pickEl) pickEl.style.display = "none"; // 浏览器演示模式手动输入路径
  btnTest && btnTest.addEventListener("click", testConnection);
  btnSave && btnSave.addEventListener("click", save);
}

if (confirmModal) {
  confirmOk && confirmOk.addEventListener("click", () => closeConfirm(true));
  confirmCancel && confirmCancel.addEventListener("click", () => closeConfirm(false));
  confirmModal.addEventListener("click", (e) => {
    if (e.target === confirmModal) closeConfirm(false);
  });
}

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (confirmModal && !confirmModal.classList.contains("hidden")) closeConfirm(false);
  else if (modal && !modal.classList.contains("hidden")) modal.classList.add("hidden");
});

// 防止未使用告警：invoke 由 saveConfig 间接使用（保持 import 以便后续扩展）
void invoke;
