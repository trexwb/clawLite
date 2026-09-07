// 复核验证：ai.js SSE 解析 / 双重 emit / 工具循环 / 错误文案 / 中止 / 12 轮上限
import { runAssistantTurn } from "./ai-patched.mjs";
import { setResponder } from "./stub-bridge.mjs";
import { calls } from "./stub-tools.mjs";

const enc = new TextEncoder();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function sse(chunks) {
  let i = 0;
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: { get: () => "text/event-stream" },
    body: {
      getReader() {
        return {
          async read() {
            await sleep(1);
            if (i < chunks.length) return { done: false, value: enc.encode(chunks[i++]) };
            return { done: true, value: undefined };
          },
        };
      },
    },
    async text() {
      return "";
    },
  };
}
const data = (obj) => "data: " + JSON.stringify(obj);

const config = { apiKey: "k", apiBase: "http://unit.test", model: "m", temperature: 0.7, workspacePath: "/w" };

let pass = 0;
let fail = 0;
function check(label, cond, extra) {
  if (cond) {
    pass++;
    console.log("PASS", label);
  } else {
    fail++;
    console.log("FAIL", label, extra === undefined ? "" : "=>", JSON.stringify(extra));
  }
}

/* ---------- T1 纯文本轮：跨 chunk 行缓冲 + 是否双重 emit ---------- */
{
  calls.length = 0;
  const deltas = [];
  const bodies = [];
  setResponder((url, init) => {
    bodies.push(JSON.parse(init.body));
    // 第一块在 JSON 中间截断且无换行 → 强制跨 chunk 缓冲
    return sse([
      'data: {"choices":[{"delta":{"content":"He',
      'llo"},"finish_reason":null}]}\n\n',
      data({ choices: [{ delta: {}, finish_reason: "stop" }] }) + "\n\n",
      "data: [DONE]\n\n",
    ]);
  });
  const { content } = await runAssistantTurn({
    messages: [{ role: "user", content: "hi" }],
    config,
    onDelta: (t) => deltas.push(t),
  });
  check("T1 SSE 跨 chunk 行缓冲解析出 Hello", content.includes("Hello"), content);
  check("T1 无双重 emit：content === deltas 拼接", content === deltas.join(""), { content, deltas: deltas.join("") });
  check("T1 content 恰为一次 Hello", content === "Hello", content);
  check("T1 system 提示词在首位", bodies[0].messages[0].role === "system" && bodies[0].messages[0].content === "SYS");
  check("T1 请求含 stream:true/max_tokens/tools", bodies[0].stream === true && bodies[0].max_tokens === 8192 && Array.isArray(bodies[0].tools));
}

/* ---------- T2 工具轮：tool_calls index 累积 + wire 消息 ---------- */
{
  calls.length = 0;
  const deltas = [];
  const events = [];
  const bodies = [];
  setResponder((url, init) => {
    bodies.push(JSON.parse(init.body));
    if (bodies.length === 1) {
      return sse([
        data({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "read_", arguments: '{"pa' } }] } }] }) + "\n\n",
        data({ choices: [{ delta: { tool_calls: [{ index: 0, function: { name: "file", arguments: 'th":"a.txt"}' } }] } }] }) + "\n\n",
        data({ choices: [{ delta: {}, finish_reason: "tool_calls" }] }) + "\n\n",
        "data: [DONE]\n\n",
      ]);
    }
    return sse([
      data({ choices: [{ delta: { content: "Done" } }] }) + "\n\n",
      data({ choices: [{ delta: {}, finish_reason: "stop" }] }) + "\n\n",
      "data: [DONE]\n\n",
    ]);
  });
  const { content } = await runAssistantTurn({
    messages: [{ role: "user", content: "read a.txt" }],
    config,
    onDelta: (t) => deltas.push(t),
    onToolEvent: (e) => events.push(e),
  });
  check("T2 工具恰好执行一次且参数拼接正确", calls.length === 1 && calls[0].name === "read_file" && calls[0].argsObj.path === "a.txt", calls);
  check("T2 start/end 事件各一次", events.length === 2 && events[0].type === "start" && events[1].type === "end", events);
  const m2 = bodies[1].messages;
  check(
    "T2 第二轮 wire: assistant(tool_calls)+tool 消息",
    m2.length === 3 &&
      m2[1].role === "assistant" &&
      m2[1].tool_calls &&
      m2[1].tool_calls[0].id === "call_1" &&
      m2[1].tool_calls[0].function.arguments === '{"path":"a.txt"}' &&
      m2[2].role === "tool" &&
      m2[2].tool_call_id === "call_1" &&
      m2[2].content === "R:read_file",
    m2
  );
  check("T2 最终文本无双重 emit", content === "Done", { content, deltas: deltas.join("") });
}

/* ---------- T3 HTTP 错误文案 ---------- */
{
  setResponder(() => ({ ok: false, status: 401, statusText: "Unauthorized", headers: { get: () => "application/json" }, text: async () => "{}" }));
  let e401 = "";
  try {
    await runAssistantTurn({ messages: [{ role: "user", content: "x" }], config, onDelta: () => {} });
  } catch (e) {
    e401 = e.message;
  }
  check("T3 401 文案", e401 === "API Key 无效或未填写（401）", e401);

  setResponder(() => ({ ok: false, status: 429, statusText: "Too Many Requests", headers: { get: () => "application/json" }, text: async () => "{}" }));
  let e429 = "";
  try {
    await runAssistantTurn({ messages: [{ role: "user", content: "x" }], config, onDelta: () => {} });
  } catch (e) {
    e429 = e.message;
  }
  check("T3 429 文案", e429 === "请求过于频繁（429）", e429);
}

/* ---------- T4 预先中止 ---------- */
{
  setResponder(() => sse([]));
  const ac = new AbortController();
  ac.abort();
  let ok = false;
  try {
    await runAssistantTurn({ messages: [{ role: "user", content: "x" }], config, onDelta: () => {}, signal: ac.signal });
  } catch (e) {
    ok = e.name === "AbortError";
  }
  check("T4 预先中止抛 AbortError", ok);
}

/* ---------- T5 12 轮上限（模型永远要工具） ---------- */
{
  calls.length = 0;
  let n = 0;
  setResponder(() => {
    n++;
    return sse([
      data({ choices: [{ delta: { tool_calls: [{ index: 0, id: "c" + n, function: { name: "list_dir", arguments: "{}" } }] } }] }) + "\n\n",
      data({ choices: [{ delta: {}, finish_reason: "tool_calls" }] }) + "\n\n",
      "data: [DONE]\n\n",
    ]);
  });
  const { content } = await runAssistantTurn({ messages: [{ role: "user", content: "loop" }], config, onDelta: () => {} });
  check("T5 恰好发 12 次请求后停止", n === 12, n);
  check("T5 正文注明已达上限", content.includes("上限"), content);
  check("T5 工具执行 11 次（第 12 轮拒绝执行）", calls.length === 11, calls.length);
}

console.log(`\n== ai.js: ${pass} pass, ${fail} fail ==`);
process.exit(fail ? 1 : 0);
