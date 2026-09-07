// Claw Lite · 装配层：初始化 / 发送流程 / 事件绑定
import { invoke } from "./core/bridge.js";
import { Store } from "./core/store.js";
import { runAssistantTurn } from "./core/ai.js";
import { renderSidebar, bindNewTask } from "./ui/sidebar.js";
import { renderSession, appendMessageEl, updateMessageEl, clearChat, setStreaming } from "./ui/chat.js";
import { openSettings, showConfirm, toast } from "./ui/settings.js";

const input = document.getElementById("input");
const btnSend = document.getElementById("btn-send");
const btnStop = document.getElementById("btn-stop");
const btnSettings = document.getElementById("btn-settings");
const btnWorkspace = document.getElementById("btn-workspace");
const wsChip = document.getElementById("ws-chip");
const workspaceLabel = document.getElementById("workspace-label");
const sessionTitle = document.getElementById("session-title");
const chatCol = document.getElementById("chat-col");

let controller = null;
let sending = false;

function uid() {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : "m" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function activeSession() {
  return Store.getSession(Store.getActiveId());
}

/* ---------------- 渲染 ---------------- */

function loadSession() {
  const s = activeSession();
  clearChat();
  renderSession(s);
  sessionTitle.textContent = (s && s.title) || "新任务";
}

function refreshSidebar() {
  renderSidebar(Store, {
    onSelect,
    onDelete,
    onRename,
  });
}

function refreshWsUi() {
  const ws = (Store.config && Store.config.workspacePath) || "";
  const base = ws ? ws.split("/").filter(Boolean).pop() : "";
  wsChip.textContent = ws ? base || ws : "未设置工作目录";
  wsChip.title = ws || "点击设置工作目录";
  wsChip.classList.toggle("warn", !ws);
  workspaceLabel.textContent = ws ? base || ws : "未设置工作目录";
}

/* ---------------- 会话操作 ---------------- */

function onSelect(id) {
  if (sending) { toast("当前任务还在进行中，请先停止", "err"); return; }
  if (id === Store.getActiveId()) return;
  Store.setActive(id);
  loadSession();
  refreshSidebar();
}

function onNew() {
  if (sending) { toast("当前任务还在进行中，请先停止", "err"); return; }
  const s = Store.createSession();
  loadSession();
  refreshSidebar();
  input.focus();
  return s;
}

async function onDelete(id) {
  if (sending) { toast("当前任务还在进行中，请先停止", "err"); return; }
  const s = Store.getSession(id);
  const ok = await showConfirm({
    title: "删除任务",
    detail: "确定删除「" + ((s && s.title) || "新任务") + "」？聊天记录不可恢复。",
  });
  if (!ok) return;
  Store.deleteSession(id);
  if (!Store.getActiveId() || !Store.getSession(Store.getActiveId())) {
    if (!Store.listSessions().length) Store.createSession();
  }
  loadSession();
  refreshSidebar();
}

function onRename(id, title) {
  Store.renameSession(id, title);
  if (id === Store.getActiveId()) sessionTitle.textContent = title;
  refreshSidebar();
}

/* ---------------- 发送 ---------------- */

function autosize() {
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 168) + "px";
}

async function send() {
  const text = input.value.trim();
  if (!text || sending) return;
  if (!Store.config || !Store.config.workspacePath) {
    toast("请先设置工作目录", "err");
    openSettings(Store, { onSaved: refreshWsUi });
    return;
  }

  const session = activeSession() || onNew();
  const userMsg = { id: uid(), role: "user", content: text, createdAt: Date.now() };
  Store.appendMessage(session.id, userMsg);

  // 首条用户消息自动作为会话标题（前 20 字）
  if (session.messages.filter((m) => m.role === "user").length === 1) {
    Store.renameSession(session.id, text.slice(0, 20));
  }
  sessionTitle.textContent = session.title;
  refreshSidebar();

  // 历史快照（只含文本；空的 assistant 占位不进历史）
  const history = session.messages
    .filter((m) => m.role === "user" || (m.role === "assistant" && (m.content || "").trim()))
    .map((m) => ({ role: m.role, content: m.content }));

  const aiMsg = { id: uid(), role: "assistant", content: "", toolEvents: [], createdAt: Date.now() };
  Store.appendMessage(session.id, aiMsg);

  input.value = "";
  autosize();

  setStreaming(aiMsg.id);
  appendMessageEl(userMsg);
  appendMessageEl(aiMsg);

  sending = true;
  controller = new AbortController();
  btnSend.classList.add("hidden");
  btnStop.classList.remove("hidden");

  try {
    const { content } = await runAssistantTurn({
      messages: history,
      config: Store.config,
      onDelta: (t) => {
        aiMsg.content += t; // onDelta 为增量 chunk
        updateMessageEl(aiMsg);
      },
      onToolEvent: (evt) => {
        if (evt.type === "start") aiMsg.toolEvents.push({ name: evt.name, args: evt.args, ok: null });
        else aiMsg.toolEvents.push({ name: evt.name, ok: !!evt.ok, brief: evt.brief, args: evt.args });
        updateMessageEl(aiMsg);
      },
      signal: controller.signal,
      onConfirmDelete: (args) =>
        controller.signal.aborted
          ? Promise.resolve(false) // 已中止：直接拒绝，避免删除确认卡住停止流程
          : showConfirm({
              title: "确认删除",
              detail: "即将删除「" + ((args && args.path) || "（未知路径）") + "」，目录会连同其中全部内容一起删除，且不可恢复。确定继续吗？",
            }),
    });
    aiMsg.content = content || aiMsg.content;
  } catch (err) {
    const isAbort = err && (err.name === "AbortError" || /abort/i.test(String(err && err.message)));
    if (isAbort) {
      aiMsg.content += "\n\n（已停止）";
    } else {
      const msg = "⚠ " + (err && err.message ? err.message : "发生未知错误");
      aiMsg.content = aiMsg.content ? aiMsg.content + "\n\n" + msg : msg;
      toast(err && err.message ? err.message : "发生未知错误", "err");
    }
  } finally {
    sending = false;
    controller = null;
    setStreaming(null);
    btnStop.classList.add("hidden");
    btnSend.classList.remove("hidden");
    const el = chatCol.querySelector('.msg[data-id="' + aiMsg.id + '"]');
    if (el) el.classList.remove("msg-streaming");
    updateMessageEl(aiMsg);
    Store.persist();
  }
}

/* ---------------- 事件绑定 ---------------- */

input.addEventListener("keydown", (e) => {
  // Enter 发送；Shift / Ctrl / ⌘ + Enter 换行；中文输入法组词中的 Enter 不发送
  if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.isComposing) {
    e.preventDefault();
    send();
  }
});
input.addEventListener("input", autosize);
btnSend.addEventListener("click", send);
btnStop.addEventListener("click", () => controller && controller.abort());
btnSettings.addEventListener("click", () => openSettings(Store, { onSaved: refreshWsUi }));
btnWorkspace.addEventListener("click", () => openSettings(Store, { onSaved: refreshWsUi }));
wsChip.addEventListener("click", () => openSettings(Store, { onSaved: refreshWsUi }));

chatCol.addEventListener("click", (e) => {
  const chip = e.target.closest(".chip");
  if (!chip) return;
  if (sending) { toast("当前任务还在进行中", "err"); return; }
  input.value = chip.dataset.suggest || chip.textContent || "";
  autosize();
  send();
});

bindNewTask(onNew);

/* ---------------- 初始化 ---------------- */

async function init() {
  Store.load();
  await Store.initConfig();

  if (Store.config && Store.config.workspacePath) {
    try {
      await invoke("set_workspace", { path: Store.config.workspacePath });
    } catch (e) {
      toast(String(e && e.message ? e.message : e), "err");
    }
  }

  if (!Store.getSession(Store.getActiveId())) {
    if (Store.listSessions().length) Store.setActive(Store.listSessions()[0].id);
    else Store.createSession();
  }

  refreshSidebar();
  loadSession();
  refreshWsUi();

  // 首次使用：未配置 Key 或工作目录时自动打开设置
  if (!Store.config.apiKey || !Store.config.workspacePath) {
    openSettings(Store, { onSaved: refreshWsUi });
  }
}

init();
