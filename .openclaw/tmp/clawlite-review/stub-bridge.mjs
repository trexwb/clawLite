// 仅供复核用的桩模块：替代 bridge.js（ai.js 测试用）
export const isTauri = false;
export const MOCK = { enabled: false };

let responder = null;
export function setResponder(fn) {
  responder = fn;
}

export async function aiFetch(url, init) {
  if (!responder) throw new Error("no responder configured");
  return responder(url, init);
}

export async function invoke() {
  throw new Error("invoke should not be used in ai test");
}
