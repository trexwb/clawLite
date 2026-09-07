// Claw Lite · AI 核心逻辑（Agent B）
// SSE 流式对话 + 工具调用循环（最多 12 轮）+ 浏览器演示模式（mockTurn）。
// UI 只需调用 runAssistantTurn({ messages, config, onDelta, onToolEvent, signal })。
import { aiFetch, MOCK } from "./bridge.js";
import { TOOL_SCHEMAS, buildSystemPrompt, executeTool } from "./tools.js";

export const DEFAULT_API_BASE = "https://api.deepseek.com";

const MAX_TOOL_ROUNDS = 12;
const MAX_TOKENS = 8192;

const abortError = () => new DOMException("已中止", "AbortError");

/* ---------------- 主入口 ---------------- */

export async function runAssistantTurn({ messages, config, onDelta, onToolEvent, signal, onConfirmDelete }) {
  if (MOCK.enabled) return mockTurn({ config, onDelta, onToolEvent, signal });

  const apiBase = String(config.apiBase || DEFAULT_API_BASE).replace(/\/+$/, "");
  // 未注入确认弹窗时删除一律拒绝（安全兜底）；确认弹窗由 main.js 注入，core 不反向 import UI
  const confirmDelete = onConfirmDelete || (async () => false);

  // wire 消息：system + 历史（只含 user/assistant 文本），工具中间消息只在当轮追加
  const wire = [
    { role: "system", content: buildSystemPrompt(config.workspacePath || "（未设置）", config.model) },
    ...messages.map((m) => ({ role: m.role, content: m.content })),
  ];

  let full = "";
  const emit = (t) => {
    if (t) {
      full += t;
      onDelta?.(t);
    }
  };

  for (let round = 1; ; round++) {
    if (signal?.aborted) throw abortError();

    const body = {
      model: config.model || "deepseek-chat",
      messages: wire,
      temperature: typeof config.temperature === "number" ? config.temperature : 0.7,
      max_tokens: MAX_TOKENS,
      stream: true,
    };
    // reasoner 模型不支持工具调用，省略 tools
    if (!String(config.model || "").includes("reasoner")) body.tools = TOOL_SCHEMAS;

    const res = await aiFetch(apiBase + "/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + (config.apiKey || ""),
      },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) await throwHttpError(res);

    const parsed = await parseStreamResponse(res, emit, signal);

    const wantsTool = parsed.finishReason === "tool_calls" && parsed.toolCalls.length > 0;
    if (!wantsTool) return { content: full };

    // 达到工具轮数上限：在正文中注明并结束
    if (round >= MAX_TOOL_ROUNDS) {
      emit("\n\n（已达工具调用轮数上限（12 轮），本次到此为止。）");
      return { content: full };
    }

    // assistant(tool_calls 原样) + 每个工具一条 tool 消息，进入下一轮
    wire.push({
      role: "assistant",
      content: parsed.text || null,
      tool_calls: parsed.toolCalls.map((tc) => ({
        id: tc.id || "call_" + tc.index,
        type: "function",
        function: { name: tc.name, arguments: tc.arguments || "{}" },
      })),
    });
    for (const tc of parsed.toolCalls) {
      let argsObj = {};
      try {
        argsObj = tc.arguments ? JSON.parse(tc.arguments) : {};
      } catch {
        argsObj = {};
      }
      if (!argsObj || typeof argsObj !== "object") argsObj = {};
      onToolEvent?.({ type: "start", name: tc.name, args: argsObj });
      const { result, brief, ok } = await executeTool(tc.name, argsObj, { onConfirmDelete: confirmDelete });
      onToolEvent?.({ type: "end", name: tc.name, ok, brief });
      wire.push({ role: "tool", tool_call_id: tc.id || "call_" + tc.index, content: result });
    }
  }
}

/* ---------------- HTTP 错误（全中文） ---------------- */

async function throwHttpError(res) {
  let detail = "";
  try {
    detail = (await res.text()).replace(/\s+/g, " ").trim().slice(0, 200);
  } catch {
    /* 响应体读取失败则只报状态码 */
  }
  if (res.status === 401) throw new Error("API Key 无效或未填写（401）");
  if (res.status === 429) throw new Error("请求过于频繁（429）");
  throw new Error(`请求失败（${res.status}）：${detail || res.statusText || "请检查网络与 API 地址"}`);
}

/* ---------------- SSE / 兜底解析 ---------------- */

// 返回 { text, toolCalls: [{index, id, name, arguments}], finishReason }
// onText 会在 delta.content 到达时被逐段调用（流式）。
async function parseStreamResponse(res, onText, signal) {
  const ct = (res.headers && res.headers.get && res.headers.get("content-type")) || "";
  // 兜底：服务端忽略 stream:true 返回一次性 JSON
  if (!res.body || ct.includes("application/json")) {
    const json = await res.json();
    const choice = (json && json.choices && json.choices[0]) || {};
    const msg = choice.message || {};
    if (msg.content) onText(msg.content);
    const toolCalls = (msg.tool_calls || []).map((tc, i) => ({
      index: typeof tc.index === "number" ? tc.index : i,
      id: tc.id || "",
      name: (tc.function && tc.function.name) || "",
      arguments: (tc.function && tc.function.arguments) || "",
    }));
    return {
      text: msg.content || "",
      toolCalls,
      finishReason: choice.finish_reason || (toolCalls.length ? "tool_calls" : "stop"),
    };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = ""; // 跨 chunk 行缓冲
  let text = "";
  let finishReason = null;
  let stopped = false; // 收到 [DONE]
  const toolCalls = [];

  const handleLine = (raw) => {
    const line = raw.trim();
    if (!line || !line.startsWith("data:")) return; // 忽略空行 / 注释 / 其他字段
    const payload = line.slice(5).trim(); // 剥离 "data:" 前缀
    if (payload === "[DONE]") {
      stopped = true;
      return;
    }
    let json;
    try {
      json = JSON.parse(payload);
    } catch {
      return; // 非完整 JSON 的数据行直接忽略
    }
    const choice = json && json.choices && json.choices[0];
    if (!choice) return;
    if (choice.finish_reason) finishReason = choice.finish_reason;
    const delta = choice.delta || {};
    if (typeof delta.content === "string" && delta.content) {
      text += delta.content;
      onText(delta.content);
    }
    // tool_calls delta 按 index 累积：id / function.name / function.arguments 字符串拼接
    if (Array.isArray(delta.tool_calls)) {
      for (const tc of delta.tool_calls) {
        const idx = typeof tc.index === "number" ? tc.index : toolCalls.length;
        let slot = toolCalls.find((t) => t.index === idx);
        if (!slot) {
          slot = { index: idx, id: "", name: "", arguments: "" };
          toolCalls.push(slot);
        }
        if (tc.id) slot.id += tc.id;
        if (tc.function) {
          if (tc.function.name) slot.name += tc.function.name;
          if (tc.function.arguments) slot.arguments += tc.function.arguments;
        }
      }
    }
  };

  try {
    while (!stopped) {
      if (signal?.aborted) throw abortError();
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, "");
        buf = buf.slice(nl + 1);
        handleLine(line);
        if (stopped) break;
      }
    }
    // 流意外结束时处理残余缓冲（最后一行可能没有换行符）
    if (!stopped && buf.trim()) handleLine(buf);
  } finally {
    if (stopped) {
      try {
        await reader.cancel();
      } catch {
        /* 忽略取消失败 */
      }
    }
  }
  return { text, toolCalls, finishReason: finishReason || "stop" };
}

/* ---------------- 浏览器演示模式（确定性脚本，≤80 行） ---------------- */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function mockTurn({ config, onDelta, onToolEvent, signal }) {
  let full = "";
  // 按小块"流式"输出，模拟打字机效果
  const emit = async (text) => {
    for (let i = 0; i < text.length; i += 3) {
      if (signal?.aborted) throw abortError();
      const chunk = text.slice(i, i + 3);
      full += chunk;
      onDelta?.(chunk);
      await sleep(16);
    }
  };

  const ws = config.workspacePath || "（未设置）";
  await emit(
    `你好，我是 Claw Lite（当前是浏览器演示模式，回复为确定性脚本）。\n\n` +
      `当前工作目录是 **${ws}**，里面有几份虚拟文件，比如「会议纪要.md」和「数据/销售额.csv」。` +
      `我先列一下目录：\n\n`
  );

  // 真实调用 executeTool（走 bridge mock），并发出工具事件供 UI 渲染工具卡片
  onToolEvent?.({ type: "start", name: "list_dir", args: { path: "." } });
  const { result, brief, ok } = await executeTool("list_dir", { path: "." }, {});
  onToolEvent?.({ type: "end", name: "list_dir", ok, brief });

  await emit(
    `${result}\n\n接下来你可以让我读取某份文件、把会议纪要整理成待办清单，或新建一份周报。` +
      `配置真实 API Key 并在 Tauri 中运行后，这些操作将由真实模型完成。`
  );
  return { content: full };
}
