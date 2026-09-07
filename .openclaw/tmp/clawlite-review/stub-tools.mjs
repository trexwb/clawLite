// 仅供复核用的桩模块：替代 tools.js（ai.js 测试用）
export const TOOL_SCHEMAS = [];
export function buildSystemPrompt() {
  return "SYS";
}
export const calls = [];
export async function executeTool(name, argsObj, opts) {
  calls.push({ name, argsObj, opts });
  return { result: "R:" + name, brief: "B:" + name, ok: true };
}
