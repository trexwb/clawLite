// Claw Lite · 状态与持久化层（Agent B）
// 会话存 localStorage（"clawlite.sessions.v1" / "clawlite.active.v1"），
// 配置经 bridge.invoke 持久化到 Rust 侧 config.json。
// 消息数组允许界面层直接变更后调 Store.persist()。
import { invoke } from "./bridge.js";

const SESSIONS_KEY = "clawlite.sessions.v1";
const ACTIVE_KEY = "clawlite.active.v1";

const DEFAULT_CONFIG = {
  apiKey: "",
  apiBase: "https://api.deepseek.com",
  model: "deepseek-chat",
  temperature: 0.7,
  workspacePath: "",
};

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function writeActive(id) {
  try {
    localStorage.setItem(ACTIVE_KEY, id == null ? "" : String(id));
  } catch {
    /* localStorage 不可用时忽略 */
  }
}

export const Store = {
  sessions: [],
  activeId: null,
  config: null,

  /* ---------------- 会话 ---------------- */

  load() {
    try {
      const raw = localStorage.getItem(SESSIONS_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      this.sessions = Array.isArray(parsed) ? parsed : [];
    } catch {
      this.sessions = [];
    }
    try {
      const active = localStorage.getItem(ACTIVE_KEY);
      this.activeId = active || (this.sessions[0] ? this.sessions[0].id : null);
    } catch {
      this.activeId = this.sessions[0] ? this.sessions[0].id : null;
    }
  },

  listSessions() {
    return this.sessions;
  },

  getSession(id) {
    return this.sessions.find((s) => s.id === id) || null;
  },

  createSession() {
    const session = {
      id: uid(),
      title: "新任务",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
    };
    this.sessions.unshift(session); // 新会话排最前
    this.setActive(session.id);
    this.persist();
    return session;
  },

  deleteSession(id) {
    this.sessions = this.sessions.filter((s) => s.id !== id);
    if (this.activeId === id) {
      this.activeId = this.sessions[0] ? this.sessions[0].id : null;
      writeActive(this.activeId);
    }
    this.persist();
  },

  renameSession(id, title) {
    const session = this.getSession(id);
    if (!session) return;
    session.title = String(title || "").trim() || session.title;
    session.updatedAt = Date.now();
    this.persist();
  },

  setActive(id) {
    this.activeId = id;
    writeActive(id);
  },

  getActiveId() {
    return this.activeId;
  },

  appendMessage(sid, msg) {
    const session = this.getSession(sid);
    if (!session) return;
    session.messages.push(msg);
    session.updatedAt = Date.now();
    this.persist();
  },

  persist() {
    try {
      localStorage.setItem(SESSIONS_KEY, JSON.stringify(this.sessions));
    } catch (e) {
      console.warn("Claw Lite：会话保存失败", e);
    }
  },

  /* ---------------- 配置 ---------------- */

  // 读取配置（Rust 侧 config.json；浏览器 mock 返回演示配置）
  async initConfig() {
    try {
      const cfg = await invoke("load_config");
      this.config = { ...DEFAULT_CONFIG, ...(cfg && typeof cfg === "object" ? cfg : {}) };
    } catch {
      this.config = { ...DEFAULT_CONFIG };
    }
    return this.config;
  },

  // 合并 patch → 持久化配置；workspacePath 变化时同步给后端（set_workspace）
  async saveConfig(patch) {
    if (!this.config) await this.initConfig();
    const prevWs = this.config.workspacePath || "";
    this.config = { ...this.config, ...patch };
    await invoke("save_config", { config: this.config });
    const nextWs = this.config.workspacePath || "";
    if (patch.workspacePath !== undefined && nextWs !== prevWs && nextWs) {
      await invoke("set_workspace", { path: nextWs });
    }
    return this.config;
  },
};
