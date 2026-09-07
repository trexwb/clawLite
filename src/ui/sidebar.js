// Claw Lite · 侧栏（会话列表：选择 / 新建 / 删除 / 行内改名）
const list = document.getElementById("session-list");
const btnNew = document.getElementById("btn-new-task");

const X_ICON =
  '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>';

/** 全量渲染侧栏；handlers: {onSelect, onDelete, onRename} */
export function renderSidebar(store, { onSelect, onDelete, onRename }) {
  if (!list) return;
  list.innerHTML = "";
  const sessions = store.listSessions();

  if (!sessions.length) {
    const li = document.createElement("li");
    li.className = "session-empty";
    li.textContent = "暂无任务";
    list.appendChild(li);
    return;
  }

  const activeId = store.getActiveId();
  for (const s of sessions) {
    const li = document.createElement("li");
    li.className = "session-item" + (s.id === activeId ? " active" : "");
    li.dataset.id = s.id;

    const title = document.createElement("button");
    title.type = "button";
    title.className = "session-title";
    title.textContent = s.title || "新任务";
    title.title = "双击重命名";
    title.addEventListener("click", () => onSelect && onSelect(s.id));
    title.addEventListener("dblclick", () => startRename(li, s, onRename));

    const del = document.createElement("button");
    del.type = "button";
    del.className = "session-del";
    del.title = "删除任务";
    del.setAttribute("aria-label", "删除任务");
    del.innerHTML = X_ICON;
    del.addEventListener("click", (e) => {
      e.stopPropagation();
      onDelete && onDelete(s.id);
    });

    li.append(title, del);
    list.appendChild(li);
  }
}

/** 行内改名：标题替换为输入框，Enter/失焦提交，Esc 取消 */
function startRename(li, session, onRename) {
  if (li.querySelector(".session-rename")) return;
  const titleBtn = li.querySelector(".session-title");
  if (!titleBtn) return;

  const input = document.createElement("input");
  input.type = "text";
  input.className = "session-rename";
  input.value = session.title || "";
  input.maxLength = 40;

  let done = false;
  const commit = () => {
    if (done) return;
    done = true;
    const v = input.value.trim();
    onRename && onRename(session.id, v || session.title || "新任务");
  };
  const cancel = () => {
    if (done) return;
    done = true;
    input.remove();
    titleBtn.style.display = "";
  };

  titleBtn.style.display = "none";
  li.prepend(input);
  input.focus();
  input.select();
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); commit(); }
    else if (e.key === "Escape") { e.preventDefault(); cancel(); }
  });
  input.addEventListener("blur", commit);
  input.addEventListener("click", (e) => e.stopPropagation());
}

/** 新任务按钮只需绑定一次（由 main.js 传入 onNew） */
export function bindNewTask(onNew) {
  if (!btnNew || btnNew.dataset.bound) return;
  btnNew.dataset.bound = "1";
  btnNew.addEventListener("click", onNew);
}
