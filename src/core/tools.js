// Claw Lite · 工具层（Agent B）
// 6 个文件工具的 JSON Schema + 执行器。模型侧参数用 snake_case（如 max_bytes），
// 调 bridge.invoke 时统一转 camelCase（maxBytes）。executeTool 返回 {result, brief, ok}：
// result 给模型（截断到 48000 字符），brief 给 UI 工具卡片，ok 表示是否成功执行。
import { invoke } from "./bridge.js";

/* ---------------- 工具 Schema（OpenAI function calling 格式） ---------------- */

export const TOOL_SCHEMAS = [
  {
    type: "function",
    function: {
      name: "list_dir",
      description:
        '列出指定目录的内容，返回其中的文件与子目录（名称、类型、大小、修改时间）。path 省略或为 "." 时列出工作目录根目录。',
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: '目录路径，相对工作目录，如 "数据" 或 "数据/报表"；省略时为工作目录根目录',
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description:
        "读取工作目录内文本文件的内容（仅支持文本文件，二进制会被拒绝）。可用 max_bytes 限制读取字节数；读大文件时建议限制字节数或分段读取。 max_bytes 上限 2MB，超出会被拒绝。",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: '文件路径，相对工作目录，如 "数据/销售额.csv"',
          },
          max_bytes: {
            type: "integer",
            description: "最多读取的字节数，默认 262144（256 KB）",
          },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description:
        "把文本内容写入工作目录内的文件：自动创建父目录，同名文件会被覆盖。写入前请先确认内容完整、目标路径正确。",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: '目标文件路径，相对工作目录，如 "周报.md"',
          },
          content: {
            type: "string",
            description: "要写入的完整文本内容（正文建议用 Markdown 组织）",
          },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_dir",
      description: "在工作目录内创建目录（会自动创建缺失的父目录）。",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: '目录路径，相对工作目录，如 "数据/备份"',
          },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_path",
      description:
        "删除工作目录内的文件或目录（目录会被递归删除，不可恢复）。⚠ 删除前必须征得用户同意：先在回复中说明要删除什么，用户明确同意后才能调用本工具；调用后界面还会弹出确认框。",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "要删除的文件或目录路径，相对工作目录",
          },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_files",
      description:
        "在工作目录内搜索文件：默认按文件名关键词匹配（忽略大小写）；content 为 true 时同时按内容逐行匹配并返回命中行摘要。",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "搜索关键词（忽略大小写）",
          },
          content: {
            type: "boolean",
            description: "是否同时搜索文件内容，默认 false",
          },
          path: {
            type: "string",
            description: "限定搜索的子目录，省略时搜索整个工作目录",
          },
        },
        required: ["query"],
      },
    },
  },
];

/* ---------------- 系统提示词 ---------------- */

export function buildSystemPrompt(workspacePath, model) {
  const ws = workspacePath || "（未设置）";
  const base = `你是 Claw Lite，一个运行在用户 macOS 桌面上的本地 AI 助手。
当前工作目录：${ws}
你可以通过工具在该目录内读取、创建、修改、搜索文件。规则：
1. path 参数使用相对工作目录的相对路径（如 "数据/销售额.csv"）；越界路径会被系统拒绝。
2. write_file 会自动创建父目录并覆盖同名文件；写前确认内容完整。
3. 删除文件前必须先在回复中说明要删除什么并征得用户明确同意，用户同意后才能调用 delete_path（界面还会弹出确认框）。
4. 需要了解目录结构时先 list_dir；读大文件时用 max_bytes 限制或分段读取。
5. 用用户的语言回复（默认简体中文），简洁、结构化；写入文件的正文用 Markdown。
6. 完成文件操作后用一句话说明结果。`;
  // reasoner 模型不支持 function calling
  if (String(model || "").includes("reasoner")) {
    return base + "\n该模型暂不支持工具调用，请直接用文字回答。";
  }
  return base;
}

/* ---------------- 执行器 ---------------- */

const MAX_RESULT_CHARS = 48000;

function str(v) {
  return v === undefined || v === null ? "" : String(v);
}

function formatBytes(n) {
  n = Number(n) || 0;
  if (n < 1024) return `${n} 字节`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function fmtTime(ms) {
  const d = new Date(Number(ms) || 0);
  if (!Number(ms)) return "未知时间";
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function truncate(result) {
  if (typeof result !== "string") return String(result);
  if (result.length <= MAX_RESULT_CHARS) return result;
  return result.slice(0, MAX_RESULT_CHARS) + "\n...（内容过长已截断）";
}

// 规范化相对路径："." 视为根目录，剥离前缀 "./"；
// Rust 侧 join("") 即为工作目录根，mock 同样以空串表示根，两端行为一致
function relPath(v) {
  const raw = str(v).trim();
  if (raw === ".") return "";
  return raw.replace(/^\.\//, "");
}

export async function executeTool(name, argsObj, { onConfirmDelete } = {}) {
  const args = argsObj && typeof argsObj === "object" ? argsObj : {};
  try {
    switch (name) {
      case "list_dir": {
        const entries = await invoke("list_dir", { path: relPath(args.path) });
        const list = Array.isArray(entries) ? entries : [];
        const dirs = list.filter((e) => e && e.kind === "dir");
        const files = list.filter((e) => !e || e.kind !== "dir");
        const row = (e) =>
          e.kind === "dir"
            ? `- [目录] ${e.name}`
            : `- [文件] ${e.name}（${formatBytes(e.size)} · ${fmtTime(e.modified)}）`;
        const result = list.length
          ? `共 ${list.length} 项（目录 ${dirs.length}，文件 ${files.length}）：\n` +
            [...dirs, ...files].map(row).join("\n")
          : "目录为空";
        const brief =
          list.length === 0 ? "空目录" : dirs.length ? `${list.length} 项 · ${dirs.length} 目录` : `${list.length} 项`;
        return { result: truncate(result), brief, ok: true };
      }

      case "read_file": {
        const invokeArgs = { path: relPath(args.path) };
        const mbRaw = args.max_bytes ?? args.maxBytes;
        const mb = Number(mbRaw);
        if (mbRaw !== undefined && mbRaw !== null && mbRaw !== "" && Number.isFinite(mb) && mb > 0) {
          invokeArgs.maxBytes = Math.floor(mb);
        }
        const fc = await invoke("read_file", invokeArgs);
        let result = (fc && fc.content) || "";
        if (fc && fc.truncated) {
          result += `\n\n（文件共 ${formatBytes(fc.size)}，本次按字节数限制截断；可用更大的 max_bytes 或分段继续读取。）`;
        }
        return { result: truncate(result), brief: `读取 ${formatBytes(fc ? fc.size : 0)}`, ok: true };
      }

      case "write_file": {
        const wr = await invoke("write_file", { path: relPath(args.path), content: str(args.content) });
        const bytes = wr && wr.bytes !== undefined ? wr.bytes : str(args.content).length;
        return {
          result: `已写入 ${wr && wr.path ? wr.path : str(args.path)}（${formatBytes(bytes)}）`,
          brief: `写入 ${formatBytes(bytes)}`,
          ok: true,
        };
      }

      case "create_dir": {
        const p = await invoke("create_dir", { path: relPath(args.path) });
        return { result: `已创建目录 ${p || str(args.path)}`, brief: "已创建", ok: true };
      }

      case "delete_path": {
        // 删除前必须征得用户同意：确认函数由 AI 层注入（底层是界面确认弹窗）
        let confirmed = false;
        try {
          confirmed = !!(await onConfirmDelete?.(args));
        } catch {
          confirmed = false;
        }
        if (!confirmed) return { ok: false, result: "用户取消了删除操作", brief: "已取消" };
        const p = await invoke("delete_path", { path: relPath(args.path) });
        return { result: `已删除 ${p || str(args.path)}`, brief: "已删除", ok: true };
      }

      case "search_files": {
        const invokeArgs = { query: str(args.query) };
        if (typeof args.content === "boolean") invokeArgs.content = args.content;
        const sub = relPath(args.path);
        if (sub) invokeArgs.path = sub;
        const hits = await invoke("search_files", invokeArgs);
        const list = Array.isArray(hits) ? hits : [];
        const result = list.length
          ? `共命中 ${list.length} 处：\n` +
            list
              .map((h) =>
                h && h.line
                  ? `${h.path}:${h.line}: ${h.snippet || ""}`
                  : `○ ${h && h.path ? h.path : "?"}（文件名匹配）`
              )
              .join("\n")
          : "未找到匹配结果";
        return {
          result: truncate(result),
          brief: list.length ? `命中 ${list.length} 处` : "未命中",
          ok: true,
        };
      }

      default:
        return { ok: false, result: `未知工具: ${name}`, brief: "失败" };
    }
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    return { ok: false, result: `工具执行失败：${msg}`, brief: "失败" };
  }
}
