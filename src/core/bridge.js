// Claw Lite · 桥接层（主控实现，勿改）
// Tauri 环境 → IPC / 官方插件；浏览器环境 → 内置 mock（无 Tauri 时可预览界面与演示工具流）
export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export const MOCK = { enabled: !isTauri };

let _invokeFn = null;
async function tauriInvoke() {
  if (!_invokeFn) {
    const mod = await import("@tauri-apps/api/core");
    _invokeFn = mod.invoke;
  }
  return _invokeFn;
}

/* ---------------- mock 后端（浏览器演示模式） ---------------- */
const mockConfig = {
  apiKey: "sk-demo-key",
  apiBase: "https://api.deepseek.com",
  model: "deepseek-chat",
  temperature: 0.7,
  workspacePath: "/Users/demo/ClawLite工作目录"
};

const now = Date.now();
const mockFiles = new Map([
  ["README.md", { content: "# 工作目录\n\n这是 Claw Lite 浏览器演示模式的虚拟文件。", mtime: now - 86400000 }],
  ["会议纪要.md", { content: "# 产品周会\n\n- 推进 Claw Lite v0.2\n- 修复导出问题\n- 下周评审图标方案\n", mtime: now - 3600000 }],
  ["待办.md", { content: "- [ ] 整理目录\n- [ ] 写周报\n", mtime: now - 1800000 }],
  ["数据/销售额.csv", { content: "月份,销售额\n1月,12800\n2月,15400\n3月,18220\n4月,21050\n", mtime: now - 7200000 }]
]);

function mockKey(raw) {
  return String(raw || "").replace(/^\/+/, "").replace(/\/+$/, "");
}

const mockHandlers = {
  set_workspace({ path }) {
    mockConfig.workspacePath = path;
    return { path, fileCount: mockFiles.size, dirCount: 2, totalBytes: 2048 };
  },
  get_workspace() {
    return mockConfig.workspacePath || null;
  },
  list_dir({ path }) {
    const base = mockKey(path);
    const seen = new Map();
    for (const key of mockFiles.keys()) {
      if (base && !key.startsWith(base + "/")) continue;
      const rest = base ? key.slice(base.length + 1) : key;
      const top = rest.split("/")[0];
      const isDir = rest.includes("/");
      if (!seen.has(top)) {
        seen.set(top, {
          name: top,
          kind: isDir ? "dir" : "file",
          size: isDir ? 0 : mockFiles.get(key).content.length,
          modified: mockFiles.get(key).mtime
        });
      }
    }
    return [...seen.values()];
  },
  read_file({ path, maxBytes }) {
    const key = mockKey(path);
    const f = mockFiles.get(key);
    if (!f) throw new Error("文件不存在: " + path);
    const max = maxBytes || 262144;
    return { content: f.content.slice(0, max), size: f.content.length, truncated: f.content.length > max };
  },
  write_file({ path, content }) {
    const key = mockKey(path);
    mockFiles.set(key, { content, mtime: Date.now() });
    return { path: key, bytes: content.length };
  },
  create_dir({ path }) {
    return mockKey(path);
  },
  delete_path({ path }) {
    const key = mockKey(path);
    for (const k of [...mockFiles.keys()]) {
      if (k === key || k.startsWith(key + "/")) mockFiles.delete(k);
    }
    return key;
  },
  search_files({ query, content }) {
    const hits = [];
    const q = String(query).toLowerCase();
    for (const [k, f] of mockFiles) {
      if (k.toLowerCase().includes(q)) {
        hits.push({ path: k, kind: "file", line: 0, snippet: "" });
      } else if (content && f.content.toLowerCase().includes(q)) {
        const lines = f.content.split("\n");
        const idx = lines.findIndex((l) => l.toLowerCase().includes(q));
        hits.push({ path: k, kind: "file", line: idx + 1, snippet: (lines[idx] || "").trim().slice(0, 120) });
      }
      if (hits.length >= 300) break;
    }
    return hits;
  },
  load_config() {
    return { ...mockConfig };
  },
  save_config({ config }) {
    Object.assign(mockConfig, config);
    return null;
  }
};

export async function invoke(cmd, args = {}) {
  if (MOCK.enabled) {
    const h = mockHandlers[cmd];
    if (!h) throw new Error("未知命令: " + cmd);
    return h(args);
  }
  const fn = await tauriInvoke();
  return fn(cmd, args);
}

export async function pickDirectory() {
  if (MOCK.enabled) return null; // 浏览器演示模式请手动输入路径
  const { open } = await import("@tauri-apps/plugin-dialog");
  const sel = await open({ directory: true, multiple: false, title: "选择工作目录" });
  return typeof sel === "string" ? sel : null;
}

export async function aiFetch(url, init) {
  if (MOCK.enabled) return fetch(url, init);
  const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http");
  return tauriFetch(url, init);
}
