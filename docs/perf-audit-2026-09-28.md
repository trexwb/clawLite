# Claw Lite · 性能审计报告（2026-09-28）

> 对应版本：v1.0.1 → **v1.0.2**（修订号：向后兼容的性能修复）
> 审计范围：主进程 `electron/harness.ts`、`electron/main.ts`，渲染层 `src/main.ts`
> 流程：观测 → 定位 → 优化 → 验证

---

## 1. 观测结论：瓶颈不在包体积

先看可观测的构建产物量化指标：

以上为**改动前遗留的构建产物**（`dist/` 尚未纳入用户当时的源码改动），仅用于判断「是否需要做包体积优化」——结论是不需要：渲染层总量 72K，gzip 后 5.18 kB。

### 干净重建后的实际产物（本次验证）

清空 `dist/` 与 `node_modules/.vite` 缓存后完整重建：

| 产物 | 大小 | gzip |
|---|---|---|
| `dist/index.html` | 10.84 kB | 3.43 kB |
| `dist/assets/index-*.js` | 14.73 kB | 5.65 kB |
| `dist/assets/index-*.css` | 10.50 kB | 3.09 kB |
| `dist-electron/main.js` | 52.7 kb | — |

**关于体积对比的诚实说明**：工作区在本轮开始前就存在未提交的源码改动（新增「立即重启并安装」「清理未使用版本」按钮、`footApp` 元素、自动更新下载完成事件、`engines` 字段等），因此无法构造一个干净的「同源码基线」来做精确的前后体积差值。本次优化只新增了 5 个共 15 行的写入助手函数，已确认其注释被 minify 完全移除，不构成体积负担；上表数字即当前最终态。

渲染层总量不过数十 KB、完整构建 140–350ms，且**没有任何重型依赖**（`dependencies` 只有 `electron-updater` 与 `npm`，无前端框架，符合 `AGENTS.md` §1「渲染层保持纯原生 JS」的约束）。因此「减小首屏包体积」这条路在本项目没有收益空间。

真正的热点在**运行时高频路径**：Electron 主进程 ↔ 渲染层之间的 IPC 广播，以及渲染层对数千行日志 DOM 的维护。

---

## 2. 定位结果与修复

### CRITICAL 1 — 每次状态广播都背着一整份日志

- **证据**：`electron/main.ts:252` 把完整 `Snapshot` 推给渲染层，而 `Snapshot` 含 `logs: string[]`（上限 800 行，`src/shared/constants.ts:25` 的 `LOG_LIMIT`）。日志同时另有独立的逐行通道 `harness:log`（`main.ts:254`）。同一份数据走了两条路重复传输，且每帧都要 `[...this.logs]` 新建数组。
- **改法**：`HarnessManager.snapshot(includeLogs = true)` 增加开关；`setState()` 与 `_captureUrl()` 两条高频推送路径改用 `snapshot(false)`（新增位点 `harness.ts:541/564/578/600`）；`main.ts:407` 的 `harness:saveSettings` 广播同步调整为 `harness.snapshot(false)`。请求/响应式通道 `harness:snapshot` 保持 `includeLogs` 默认值不变。
- **预期收益**：每帧免除一次 800 元素数组复制与 70.7 KB → 0.50 KB 的 IPC 负载。

### CRITICAL 2 — `snapshot()` 每次重复同步读盘

- **证据**：`electron/harness.ts:552-576`（原行号）。一次 `snapshot()` 内发生：`checkRuntime()` → `dshVersion` getter → `readFileSync` + `JSON.parse`（6.7 KB 的 package.json），随后快照字段 `dshVersion: this.dshVersion` **又把同一份文件完整读一遍再 parse 一次**。而 `dshVersion` 只在版本切换后才变化。
- **改法**：`harness.ts:188-219` 新增 `_versionCache` / `_versionCacheRoot` 记忆化，以运行时根目录为缓存键。**仅在读取成功时写缓存**，读取失败时清空 key——否则运行时尚未安装时缓存了空结果，用户点「安装运行时」后界面将永远感知不到新值。切换版本时 `_resolvedRoot` 变化，缓存自动失效。
- **预期收益**：每帧的 `readFileSync` 次数由 2 降为 0，`JSON.parse` 由 2 次降为 0 次。

### CRITICAL 3 — 日志满 800 行后，每个状态帧全量重建 800 行 DOM

- **证据**：`harness.ts:528` 用 `splice` 维持缓冲区定长 800，于是长度恒为 800、但**首行每新增一行就变一次**。而渲染层 `src/main.ts:757-761`（原行号）的判断是：

  ```js
  const truncated = prevCount === -1 || snap.logs.length < prevCount ||
    (snap.logs.length === prevCount && snap.logs[0] !== prevFirst)
  ```

  两个条件同时成立 → `truncated` 恒为 true → 每个状态帧都触发 `rebuildLog()`：清空 DOM 容器、800 次 `classify()`（每个 2 个正则）、重建 800 个 span。而这些内容早已呈现在屏幕上。附带副作用：用户手动滚动的查看位置被打掉。
- **改法**：`src/main.ts:755` 起改为「仅当主进程确实给了整段日志才考虑重建」，广播帧 `logs` 为空数组时直接返回走纯增量追加。同时将 `boot()` 中的历史回填改为显式 `rebuildLog(snap.logs)`——原实现依赖「下一个状态帧顺便回填」的时机，广播帧不再带日志后这条路径会断裂导致历史日志空白，这是本次改动中**唯一需要额外补偿的行为变更**。
- **预期收益**：每帧免除 800 行双正则与整片 DOM 节点重建。

### HIGH 4 — `render()` 无差别重写约 30 个 DOM 属性

- **证据**：`src/main.ts:288-339`（原 `render()`）。每次状态帧到达即使值完全没变，也全量赋值 `className` / `disabled` / `textContent` / `value` / `checked`。`className` 与 `disabled` 的重写会触发样式失效与重算；表单控件的 `value` 重写还需小心 selection 被重置。
- **改法**：新增 `setText` / `setClassName` / `setDisabled` / `setInputValue` / `setChecked` 五个写入助手（`src/main.ts:263-277`），赋值前先比对，值相同则整个跳过。
- **预期收益**：消除每帧无谓的样式失效计算。

---

## 3. 验证

### 3.1 构建与自检

| 项目 | 结果 |
|---|---|
| `npm run build` | ✅ 成功，140ms（清空 `dist/` 与 Vite 缓存后完整重建）；`dist-electron/main.js` 52.7kb、`preload.js` 2.0kb、`dist/assets/index-*.js` 14.73 kB / gzip 5.65 kB |
| 产物确定性校验 | 已验证 `package.json` 版本号不影响产物（产物 hash 完全一致）；注释已被 minify 完全移除，写入助手不构成体积负担 |
| `npm run check` | ✅ **38 项全部通过**，无失败无告警 |
| 其中 `tsc --noEmit` | ✅ 通过（五个助手的参数类型与 `el` 元素类型均匹配） |
| IPC 三层对齐 / 状态枚举双向可达 / 下载阶段双向可达 | ✅ 均未受影响 |

**未改动 IPC 契约**：12 个方法通道与 3 个订阅通道无增删，`window.clawLite` 暴露面与 `src/env.d.ts` 未改。

### 3.2 性能实测（及口径限制）

CPU 侧在本地 Node 22.22.2 实测可信：

| 项目 | 优化前 | 优化后 |
|---|---|---|
| 每帧 IPC 负载 | 70.7 KB | **0.50 KB** |
| 每帧序列化 + 结构化克隆 | 105.07 µs | **1.75 µs** |
| 每帧 `[...logs]` 800 元素复制 | 0.34 µs | 0 µs |
| 每帧 `JSON.parse`（6.7 KB package.json） | 7.8 µs × 2 次 | 0 µs |
| 渲染层每帧 800 行 `classify()` 双正则 | 44.1 µs | 0 µs（仅 `boot()` 一次） |
| 每帧 `readFileSync` 次数 | 2 | **0** |

**口径限制（必须说明）**：本机 `readFileSync` 读数不可用——实测连 `/tmp` 下一个 9 字节文件亦需约 5.5 ms，而 `existsSync` 仅 1.1 µs、`JSON.parse` 仅 7.8 µs，说明该开销来自沙箱环境对文件操作的审计而非真实磁盘。因此上表只给 `readFileSync` 的**次数变化**（代码事实，2 → 0），不给耗时数字。同理，800 节点 DOM 重建的耗时需在 Electron 内用 Performance 面板测量，本报告**不给出未验证的数字**。

---

## 4. 待办（本次未做，按优先级）

| 优先级 | 项 | 位置 | 说明 |
|---|---|---|---|
| P1 | 主进程日志 IPC 批量化 | `harness.ts:736-752` / `main.ts:254` | dsh 启动期日志密集，当前逐行 `emit` → 逐次 `send`。可合并 16ms 批次；**清屏信号（空串）必须立即单独发送**，否则重建时序错乱。需改动 `onLog` 契约支持数组，涉及三层对齐。 |
| P1 | 探活轮询改退避 | `harness.ts:755-768` | 当前固定 400ms、最多 150 次请求。改 200ms→800ms 退避可更快感知就绪。属延迟优化而非 CPU 优化。 |
| P2 | `_captureUrl` 正则短路 | `harness.ts:538-545` | 每行日志跑两个正则；URL 已带 token 后可提前返回。 |
| P2 | 分发包体积 | `resources/dsh/` 285 MB | 属安装包分发体积，与运行时性能无关。需单独评估精简依赖树的可行性。 |

---

## 5. 后续行动清单

1. 在 Electron 内实测：启动 DSH 后用 Performance 面板对比 `npm run electron` 前后帧时间，重点看日志密集期的长任务是否消失。
2. 回归验证两个易漏场景：**界面运行中点 Cmd+R 重载**（历史日志应完整回填）、**日志滚过 800 行后手动向上滚动查看**（滚动位置不应被状态帧打掉）。
3. 若确认需要，按上表 P1 继续推进日志 IPC 批量化。
