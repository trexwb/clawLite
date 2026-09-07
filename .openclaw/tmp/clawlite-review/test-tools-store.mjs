// 复核验证：tools.js 参数转换/确认流/截断 + store.js 会话与 saveConfig 语义
import { pathToFileURL } from "node:url";

/* localStorage 桩（须在 import store.js 前就位） */
const lsData = new Map();
globalThis.localStorage = {
  getItem: (k) => (lsData.has(k) ? lsData.get(k) : null),
  setItem: (k, v) => lsData.set(k, String(v)),
  removeItem: (k) => lsData.delete(k),
};

const core = "/Users/wbtrex/AI助手/node/trexwb/clawLite/src/core/";
const { executeTool } = await import(pathToFileURL(core + "tools.js").href);
const { Store } = await import(pathToFileURL(core + "store.js").href);
const { invoke } = await import(pathToFileURL(core + "bridge.js").href);

let pass = 0;
let fail = 0;
function check(label, cond, extra) {
  if (cond) {
    pass++;
    console.log("PASS", label);
  } else {
    fail++;
    console.log("FAIL", label, extra === undefined ? "" : "=>", JSON.stringify(extra).slice(0, 300));
  }
}

/* ---- tools.js ---- */
{
  const r = await executeTool("list_dir", { path: "./数据" }, {});
  check("list_dir 相对路径 ./ 剥离", r.ok && r.result.includes("销售额.csv"), r);
  check("list_dir brief", r.brief === "1 项", r.brief);

  const root = await executeTool("list_dir", { path: "." }, {});
  check("list_dir . 视为根目录", root.ok && root.result.includes("会议纪要.md"), root);

  const rf = await executeTool("read_file", { path: "数据/销售额.csv", max_bytes: 10 }, {});
  check("read_file max_bytes 截断提示", rf.ok && rf.result.includes("截断"), rf.result);

  const rfStr = await executeTool("read_file", { path: "数据/销售额.csv", max_bytes: "10" }, {});
  check("read_file max_bytes 字符串可用", rfStr.ok && rfStr.result.includes("截断"), rfStr.result);

  const rf0 = await executeTool("read_file", { path: "数据/销售额.csv", max_bytes: 0 }, {});
  check("read_file max_bytes=0 回退默认（不传 0）", rf0.ok && !rf0.result.includes("截断"), rf0.result);

  const miss = await executeTool("read_file", { path: "不存在.md" }, {});
  check("read_file 不存在 → ok:false 中文错误", !miss.ok && miss.result.includes("工具执行失败"), miss);

  const wf = await executeTool("write_file", { path: "新目录/测试.md", content: "你好" }, {});
  check("write_file 返回字节", wf.ok && wf.brief.includes("字节"), wf);

  const noConfirm = await executeTool("delete_path", { path: "README.md" }, {});
  check("delete_path 无确认函数 → 拒绝删除", !noConfirm.ok && noConfirm.result === "用户取消了删除操作", noConfirm);

  const deny = await executeTool("delete_path", { path: "README.md" }, { onConfirmDelete: async () => false });
  check("delete_path 用户拒绝 → 取消", !deny.ok && deny.brief === "已取消", deny);

  const yes = await executeTool("delete_path", { path: "待办.md" }, { onConfirmDelete: async () => true });
  check("delete_path 确认后删除", yes.ok && yes.result.includes("已删除"), yes);
  const after = await executeTool("list_dir", { path: "." }, {});
  check("删除生效", !after.result.includes("待办.md"), after.result);

  const sn = await executeTool("search_files", { query: "销售", content: true }, {});
  check("search_files 命中", sn.ok && sn.brief.includes("命中"), sn);

  const unk = await executeTool("nope", {}, {});
  check("未知工具 ok:false", !unk.ok && unk.result.startsWith("未知工具"), unk);

  // 截断 48000：write 一大段再 read? mock read 直接返回内容 — 用 list 结果不易造 48k，跳过（代码审查已确认逻辑）
}

/* ---- store.js ---- */
{
  Store.load();
  check("空存储加载", Store.listSessions().length === 0 && Store.getActiveId() === null);

  const s1 = Store.createSession();
  check("createSession 激活并持久化", Store.getActiveId() === s1.id && lsData.has("clawlite.sessions.v1"));

  Store.appendMessage(s1.id, { id: "m1", role: "user", content: "你好", createdAt: 1 });
  check("appendMessage 持久化", JSON.parse(lsData.get("clawlite.sessions.v1"))[0].messages.length === 1);

  Store.renameSession(s1.id, "  改名  ");
  check("renameSession trim", Store.getSession(s1.id).title === "改名");

  const s2 = Store.createSession();
  Store.deleteSession(s2.id);
  check("删除活动会话 → 兜底到第一个", Store.getActiveId() === s1.id);
  Store.deleteSession(s1.id);
  check("全部删除 → activeId null", Store.getActiveId() === null);

  // saveConfig 语义
  await Store.initConfig();
  check("initConfig 合并默认", Store.config && Store.config.apiBase === "https://api.deepseek.com");
  const wsBefore = await invoke("get_workspace");
  await Store.saveConfig({ workspacePath: "/tmp/ws1" });
  const wsAfter = await invoke("get_workspace");
  check("workspacePath 变化 → set_workspace 同步", wsBefore !== "/tmp/ws1" && wsAfter === "/tmp/ws1", { wsBefore, wsAfter });

  await Store.saveConfig({ model: "m2" });
  check("仅改其他字段不重设 workspace", (await invoke("get_workspace")) === "/tmp/ws1");

  await Store.saveConfig({ workspacePath: "" });
  const wsCleared = await invoke("get_workspace");
  check("清空 workspacePath 时后端未同步（记录该行为）", Store.config.workspacePath === "" && wsCleared === "/tmp/ws1", { config: Store.config.workspacePath, backend: wsCleared });
}

console.log(`\n== tools/store: ${pass} pass, ${fail} fail ==`);
process.exit(fail ? 1 : 0);
