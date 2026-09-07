// Claw Lite · 聊天主区（消息流 / 工具卡片 / 空态 / 流式渲染节流）
import { renderMarkdown } from "../core/markdown.js";

const col = document.getElementById("chat-col");
const scroller = document.getElementById("chat-scroll");

// 工具名 → 中文标签（原始名放在卡片 title 上）
const TOOL_LABELS = {
  list_dir: "浏览目录",
  read_file: "读取文件",
  write_file: "写入文件",
  create_dir: "新建目录",
  delete_path: "删除文件",
  search_files: "搜索文件",
};

// 空态建议 chips（点击即发送，由 main.js 事件委托处理）
const SUGGESTIONS = [
  "列出工作目录的文件",
  "把会议纪要整理成待办清单",
  "读取 数据/销售额.csv 并总结趋势",
  "新建 周报.md 并写入本周要点",
];

const CHEV_ICON =
  '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';

const THROTTLE = 130; // 流式 markdown 渲染最小间隔（契约要求 ≥120ms），配合 rAF 绘制

let streamingId = null;          // 当前流式中的 assistant 消息 id
const paintState = new WeakMap(); // 消息元素 → { last, timer, raf }

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ---------- 滚动 ---------- */
function nearBottom() {
  if (!scroller) return true;
  return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 160;
}
function scrollToBottom(force = false) {
  if (!scroller) return;
  if (force || nearBottom()) scroller.scrollTop = scroller.scrollHeight;
}

/* ---------- 导出 API ---------- */
export function clearChat() {
  if (col) col.innerHTML = "";
}

/** 设置/清除流式中的消息 id（供 main.js 在发送开始/结束时调用） */
export function setStreaming(id) {
  streamingId = id || null;
}

/** 全量渲染一个会话；{streaming:true} 时最后一条 assistant 消息进入流式态 */
export function renderSession(session, { streaming = false } = {}) {
  if (!col) return;
  clearChat();
  const messages = (session && session.messages) || [];
  if (!messages.length) {
    renderEmptyState();
    return;
  }
  if (!streaming) {
    streamingId = null;
  } else if (!streamingId) {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") { streamingId = messages[i].id; break; }
    }
  }
  const list = document.createElement("div");
  list.className = "msg-list";
  for (const m of messages) list.appendChild(buildMessage(m));
  col.appendChild(list);
  scrollToBottom(true);
}

/** 追加一条消息元素（同时移除空态） */
export function appendMessageEl(msg) {
  if (!col || !msg) return null;
  const emptyState = col.querySelector(".empty-state");
  if (emptyState) emptyState.remove();
  let list = col.querySelector(".msg-list");
  if (!list) {
    list = document.createElement("div");
    list.className = "msg-list";
    col.appendChild(list);
  }
  const node = buildMessage(msg);
  list.appendChild(node);
  scrollToBottom(true);
  return node;
}

/** 更新一条消息（工具卡片增量重建 + 正文按流式/完成态渲染） */
export function updateMessageEl(msg) {
  if (!col || !msg) return;
  const root = col.querySelector('.msg[data-id="' + msg.id + '"]');
  if (!root) return;

  if (msg.role === "user") {
    const bubble = root.querySelector(".msg-bubble");
    if (bubble) bubble.textContent = msg.content || "";
    return;
  }

  // 工具卡片：签名（名称/状态/摘要）变化才重建，避免打字期间频繁重绘、保留展开态
  const events = msg.toolEvents || [];
  if (events.length) {
    const sig = events
      .map((e) => e.name + ":" + (e.ok == null ? "r" : e.ok ? "1" : "0") + ":" + (e.brief || ""))
      .join("|");
    if (root.dataset.toolSig !== sig) {
      root.dataset.toolSig = sig;
      let toolList = root.querySelector(".tool-list");
      if (!toolList) {
        toolList = document.createElement("div");
        toolList.className = "tool-list";
        root.prepend(toolList);
      } else {
        toolList.innerHTML = "";
      }
      for (const evt of events) renderToolCard(toolList, evt);
    }
  }

  // 正文：流式走 raf + 120ms 节流，完成态全量渲染
  const body = root.querySelector(".msg-body");
  if (body) {
    if (root.classList.contains("msg-streaming")) paintStreaming(root, body, msg);
    else body.innerHTML = renderMarkdown(msg.content || "");
  }
  root.classList.toggle("msg-error", String(msg.content || "").startsWith("⚠"));
  scrollToBottom(false);
}

/** 渲染一张工具卡片（状态点 + 名称 + 摘要，点击展开 args JSON） */
export function renderToolCard(container, evt) {
  const e = evt || {};
  const card = document.createElement("div");
  card.className = "tool-card" + (e.ok === false ? " fail" : "");

  const row = document.createElement("button");
  row.type = "button";
  row.className = "tool-row";
  row.title = e.name || "";

  const dot = document.createElement("span");
  dot.className = "tool-dot " + (e.ok === true ? "ok" : e.ok === false ? "err" : "run");

  const name = document.createElement("span");
  name.className = "tool-name";
  name.textContent = TOOL_LABELS[e.name] || e.name || "工具调用";

  const brief = document.createElement("span");
  brief.className = "tool-brief";
  brief.textContent = e.ok == null ? "运行中…" : e.brief || "";

  const chev = document.createElement("span");
  chev.className = "tool-chev";
  chev.innerHTML = CHEV_ICON;

  row.append(dot, name, brief, chev);

  const args = document.createElement("pre");
  args.className = "tool-args";
  args.textContent = JSON.stringify(e.args || {}, null, 2);

  row.addEventListener("click", () => card.classList.toggle("open"));
  card.append(row, args);
  container.appendChild(card);
  return card;
}

/* ---------- 内部 ---------- */
function buildMessage(msg) {
  const root = document.createElement("div");
  const isUser = msg.role === "user";
  root.className = "msg " + (isUser ? "msg-user" : "msg-assistant");
  root.dataset.id = msg.id;

  if (isUser) {
    const bubble = document.createElement("div");
    bubble.className = "msg-bubble";
    bubble.textContent = msg.content || "";
    root.appendChild(bubble);
    return root;
  }

  if (msg.id === streamingId) root.classList.add("msg-streaming");

  const events = msg.toolEvents || [];
  if (events.length) {
    const toolList = document.createElement("div");
    toolList.className = "tool-list";
    for (const evt of events) renderToolCard(toolList, evt);
    root.appendChild(toolList);
  }

  const body = document.createElement("div");
  body.className = "msg-body";
  body.innerHTML = renderMarkdown(msg.content || "");
  root.appendChild(body);

  if (String(msg.content || "").startsWith("⚠")) root.classList.add("msg-error");
  return root;
}

function renderEmptyState() {
  const box = document.createElement("div");
  box.className = "empty-state";

  const mark = document.createElement("div");
  mark.className = "empty-mark";
  mark.append(document.createTextNode("Claw Lite"));
  const dot = document.createElement("span");
  dot.className = "brand-dot";
  mark.appendChild(dot);

  const sub = document.createElement("p");
  sub.className = "empty-sub";
  sub.textContent = "连接 DeepSeek，读写你的工作目录，派个任务试试。";

  const chips = document.createElement("div");
  chips.className = "chips";
  for (const text of SUGGESTIONS) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.dataset.suggest = text;
    chip.textContent = text;
    chips.appendChild(chip);
  }

  box.append(mark, sub, chips);
  col.appendChild(box);
}

/** 流式渲染：≥120ms 节流 + rAF 绘制，始终绘制最新内容 */
function paintStreaming(root, body, msg) {
  let st = paintState.get(root);
  if (!st) paintState.set(root, (st = { last: 0, timer: 0, raf: 0 }));

  const paint = () => {
    if (st.timer) { clearTimeout(st.timer); st.timer = 0; }
    if (st.raf) cancelAnimationFrame(st.raf);
    st.raf = requestAnimationFrame(() => {
      st.raf = 0;
      st.last = Date.now();
      body.innerHTML = renderMarkdown(msg.content || "");
      scrollToBottom(false);
    });
  };

  const since = Date.now() - st.last;
  if (since >= THROTTLE) {
    paint();
  } else if (!st.timer && !st.raf) {
    st.timer = setTimeout(() => { st.timer = 0; paint(); }, THROTTLE - since);
  }
}

// escapeHtml 当前未直接使用（用户消息走 textContent），保留给空态扩展
void escapeHtml;
