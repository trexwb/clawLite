/* ═══════════════════════════════════════════════════════════════════
   Claw Lite — 跨进程共享常量
   ───────────────────────────────────────────────────────────────────
   主进程（electron/）与渲染层（src/）分属不同构建上下文：
     • 主进程由 esbuild 打包为 dist-electron/main.js（platform:node）
     • 渲染层由 Vite 打包为 dist/（browser 上下文）

   两处无法互导含 Node 内置模块（node:fs / node:child_process 等）的
   源文件，否则 Vite 会把 Node API 打进浏览器包而失败。本文件只放纯
   常量（无 import、无 Node API），双方均可安全导入。

   端口范围、日志上限等"单一来源"集中于此，scripts/check.ts §9 校验
   本文件与 index.html 的三方一致性，杜绝"输入框拦住 / 主进程放行 /
   渲染层静默改写"三条互不一致的路径。
   ═══════════════════════════════════════════════════════════════════ */

// 端口策略单一来源：渲染层输入框校验、主进程 IPC 校验、harness 分配三处共用
export const PORT_MIN = 1024
export const PORT_MAX = 65535
export const PORT_DEFAULT = 8799

// 日志行数上限：主进程缓冲（harness.ts LOG_LIMIT）与渲染层 DOM 节点数
// （src/main.ts 使用 LOG_LIMIT）对齐，超出后从头部裁剪，避免内存只增不减
export const LOG_LIMIT = 800
