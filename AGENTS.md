# AGENTS.md — Claw Lite（DeepSeek Harness 桌面宿主）

## ⚠ 强制规范（所有 Agent 必须遵守）

**Claw Lite 是一个 Electron 桌面应用**，把官方 `@deepseek-ai/dsh` 本地化打包进安装包，用户**无需安装 Node 环境**即可直接使用 dsh web。它**不是**纯前端 `file://` 双击运行的 SPA——主进程由 `electron/main.cjs` 负责，渲染层由 Vite 构建为 `dist/` 后经 `BrowserWindow.loadFile` 在 Electron 内加载。

> 🔴 **所有 Agent 服务（包括 file-agent、browser-agent、computer-agent 等任何子 Agent）在本项目中执行任何任务时，必须无条件遵守本 `AGENTS.md` 文件中定义的所有规则，不得以任何理由违反。**

## 项目概述

Claw Lite 是 DeepSeek Harness（dsh）的桌面宿主：内置 Electron 自带 Node 作为解释器，spawn 出 dsh web 子进程并提供启动/停止/重启、实时状态与日志流、访问地址捕获（含 Web UI 信任 token）、两种打开方式（应用内窗口 / 系统浏览器）、可配置端口/工作目录/DSH_HOME、开机自启与 electron-updater 自动更新。

**技术分层**：
- **主进程**（`electron/` 下 `*.cjs`）：单实例锁、窗口、IPC 路由、DSH 生命周期调度、自动更新、菜单。
- **桥**（`electron/preload.cjs`）：`contextBridge` 暴露 `window.clawLite`（12 个方法 + 2 个事件），隔离渲染层与主进程。
- **运行时托管**（`electron/harness.cjs`）：`HarnessManager` 管理 dsh 子进程 spawn / 探活 / 日志 / 状态机 / 优雅停止。
- **设置**（`electron/settings.cjs`）：配置持久化到 `userData/settings.json`。
- **渲染层**（`src/` + `index.html`）：Vite 构建到 `dist/`，深色控制台 UI，纯原生 JS（**无前端框架**）。
- **内置运行时**（`resources/dsh/`）：`app/node_modules/@deepseek-ai/dsh` + `runtime.json` 清单，随安装包分发（约 300MB，置于 asar 之外以保证 `.node` 原生模块以真实文件存在）。

**构建产物**：`dist/`（渲染层）+ `electron/`（主进程）+ `resources/dsh/`（内置运行时），由 electron-builder 打包到 `release/`。

## 核心规则

### 0. 版本号递增

> **🔴 强制硬规则（所有 Agent 必须遵守）**：
> - **版本号单一来源**：`package.json` 的 `version` 字段。
>   - `electron-builder.yml` 通过 `artifactName` 中的 `${version}` 引用（产物名 `Claw-Lite-${version}-${arch}.${ext}`）。
>   - 自动更新（`electron/main.cjs` 的 `checkForUpdates`）与 `app:info` 均通过 `app.getVersion()` 读取此值。
>   - 本项目**无 Tauri / 无独立版本清单**，因此**唯一需要修改的版本位置就是 `package.json` 的 `version` 字段**（外加本文件「当前基准版本」便于人类核对）。
> - **当前基准版本**：**v1.0.0**（用户设定；未发布前不递增）。
> - **末位 +1 的唯一场景**：仅当新增了与现有问题**不同类、不同根因**的新功能 / 新修复，且用户明确允许推进版本号时，才将末位（x）加 1。
> - **🟥 以下情形绝对禁止推进版本号（写死不 +1）**：
>   1. 上一轮同一用户反馈的问题 / 同类问题**持续修复、多次往返排查、再次验证修复**
>   2. 用户明确要求「不修改版本号 / 版本号回退到 X.Y.Z」
>   3. 同日（自然日 00:00–23:59 本地时区）对同一模块 / 同一类 bug 的追加修复
>   4. 仅更新 `docs/`（发布日志、截图、操作手册等文档类修改）
>   5. 纯 CSS 微调 / 文案修正 / 去抖防抖等纯体验打磨，不引入新逻辑分支
> - **版本回退规则**：当用户要求"回退到 X.Y.Z"时，`package.json` 的 `version` 必须改写成用户指定的值，且本回合内不得再以"我刚才做了修改所以要 +1"为由推进。
> - **不推进版本号时仍必须写更新日志**：每次修复追加到 `docs/version/RELEASE-v{主版本}.md` 对应分节，标注日期并明确"不推进版本号"。发布日志只增不改。
> - **独立维度**：内置 DSH 运行时版本由 `scripts/fetch-runtime.mjs` 的 `DSH_VERSION` 常量决定，与应用版本（package.json）相互独立，升级需重跑 `npm run runtime:force`。

### 1. 构建与运行原则（Electron 宿主，最高优先级）

所有 Agent 服务在修改本项目时**必须无条件遵守**以下针对渲染层构建与运行的强制约束：

- **Vite 配置必须保持**：`vite.config.js` 中的 `base: './'`（相对路径，保证 `BrowserWindow.loadFile` 经 `file://` 加载 `dist/index.html` 时资源路径正确）不得移除或改为绝对路径。`build.target: 'es2022'` 与 `outDir: 'dist'` / `emptyOutDir: true` 保持不变。
- **渲染层为普通 Vite 模块构建**：本项目渲染层通过 `BrowserWindow` 加载（Electron 支持 `file://` 下的 `<script type="module">`），**不需要**像纯 `file://` SPA 那样强制 `iife` 或 `demoteModuleScripts()` 降级插件。改动 Vite 配置前必须确认不会破坏 `npm run build:web` 产物在 Electron 内的加载。
- **产物验证标准**：修改后的项目必须在 `npm run build:web` 成功后，经 `npm start`（或 `npm run dev` + `CLAWLITE_DEV_SERVER` + `npm run electron`）在 Electron 内完整加载并正常交互；自检必须 `npm run check` 全绿。
- **禁止引入额外运行时依赖**：渲染层保持纯原生 JS（无 React/Vue/jQuery/lodash 等）；主进程仅允许 `electron` 与 `electron-updater` 作为运行时依赖（`dependencies`/`devDependencies` 中不得出现 Tauri 残留，详见 `scripts/check.mjs` §6）。
- **静态资源路径**：渲染层引用资源须使用相对路径；当前渲染层仅依赖 `src/styles/main.css` 与系统字体栈（无外部字体/图标 CDN）。

> 以上约束适用于所有 Sub-Agent（file-agent、browser-agent、computer-agent 等），无论其在何种上下文中执行任务，均不得以任何理由违反。

### 2. 文件操作根目录

本项目所有文件操作默认以以下路径为根目录，**不得偏离**：
```
/Users/wbtrex/website/localServer/node/trexwb/git/clawLite/
```

### 3. 编辑策略

- **针对性修复优先**：UI bug、功能缺陷等采用最小改动修复，禁止重构或大范围重写
- **编辑后必须验证**：必须 grep/read 验证关键改动是否落盘
- **分区编辑**：每次 edit 只替换一个独立区块（如单个函数、CSS 块、IPC 分支），避免多区块一次替换引发意外匹配
- **禁止假设**：不可凭记忆推测已有函数名、变量名、CSS 类名、IPC 通道名，修改前必须读取确认
- **版本号规则**：编辑 `src/` 或 `electron/` 模块后，按 §0 规则判断是否递增 `package.json` 末位（用户明确允许才 +1）
- **IPC 契约三层对齐**：新增/修改任何主进程能力时，必须同步更新三处——① `electron/main.cjs` 的 `ipcMain.handle('channel', …)`；② `electron/preload.cjs` 暴露的方法或事件订阅；③ `src/main.js` 的 `api.*` 调用或 `COMMANDS` 映射。`scripts/check.mjs` 会自动校验三层对齐

### 4. 架构约定

- **进程模型**：主进程（`electron/main.cjs`）↔ 桥（`electron/preload.cjs`，`contextIsolation: true` / `nodeIntegration: false` / `sandbox: true`）↔ 渲染层（`src/main.js`）。DSH 子进程由 `HarnessManager` 在**主进程** spawn，不进渲染层。
- **IPC 契约（三层对齐，修改前必须确认）**：
  - **方法（preload 暴露 → 渲染层调用）**：`snapshot` / `start` / `stop` / `restart` / `verify` / `clearLogs` / `saveSettings` / `open` / `pickDirectory` / `checkUpdate` / `relaunch` / `appInfo`
  - **事件订阅**：`onState → harness:state`（推送 `Snapshot`）/ `onLog → harness:log`（推送单行字符串，空串表示清屏）
  - **主进程通道**（`ipcMain.handle`）：`harness:snapshot` / `harness:start` / `harness:stop` / `harness:restart` / `harness:verify` / `harness:clearLogs` / `harness:saveSettings` / `harness:open` / `dialog:pickDirectory` / `updater:check` / `app:relaunch` / `app:info`
  - **广播事件**（`main.cjs` 的 `broadcast`）：`harness:state` / `harness:log`
- **CSP（index.html）**：`<meta http-equiv="Content-Security-Policy">` 为 `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'`。**禁止**放宽到 `'unsafe-inline'` 脚本、`https:` connect 或外链脚本——保持仅加载本地 `self` 资源。
- **状态机**（`HarnessManager.state`）：`notInstalled` / `stopped` / `starting` / `running` / `error`，由 `setState()` 统一驱动并经 `harness:state` 广播。
- **DSH 启动关键细节（禁止移除）**：spawn 时必须带 `ELECTRON_RUN_AS_NODE=1`（以 Electron 可执行文件作纯 Node 解释器）且命令行首参为 `--expose-internals`（dsh 的 cordis-plugin-hmr 依赖 Node 内部 binding，缺失会导致 web profile 加载失败退出）；`--no-open` 避免 dsh 自行拉起浏览器。
- **访问地址捕获**：dsh web 就绪时打印 `dsh web: http://127.0.0.1:<port>/?token=xxx`；`HarnessManager._captureUrl` 捕获该带 token 的完整 URL 作为 Web UI 信任凭据，**必须原样保留**（`token` 缺失会被拒）。
- **设置体系**：`userData/settings.json`（macOS：`~/Library/Application Support/Claw Lite/settings.json`），字段 `port`（默认 8799）/ `autoStart` / `openMode`（`window`|`browser`）/ `workspace` / `dshHome` / `windowBounds`。

### 5. 文件结构

```
clawLite/
├── electron/                     ← 主进程（CommonJS，*.cjs）
│   ├── main.cjs                  ← 入口：单实例锁、窗口、IPC 路由、菜单、生命周期、更新检查
│   ├── preload.cjs               ← contextBridge 桥（window.clawLite：12 方法 + 2 事件）
│   ├── harness.cjs               ← HarnessManager：dsh 子进程 spawn/探活/日志/状态机/优雅停止
│   └── settings.cjs              ← 设置持久化（userData/settings.json）
├── src/                          ← 渲染层（Vite 构建到 dist/）
│   ├── main.js                   ← 控制台前端逻辑（与 window.clawLite 契约交互）
│   └── styles/
│       └── main.css              ← 深色控制台样式（CSS 变量 / 设计令牌在 :root）
├── resources/dsh/                ← 内置 DSH 运行时（app/ + runtime.json，约 300MB）
├── scripts/
│   ├── check.mjs                 ← 静态自检（JSON/文件/语法/IPC 契约/运行时/无 Tauri）
│   └── fetch-runtime.mjs         ← 拉取 / 刷新内置 DSH 依赖树（DSH_VERSION 常量）
├── build/                        ← 打包资源（icon.png / entitlements.mac.plist）
├── index.html                    ← 渲染层入口（含严格 CSP meta）
├── vite.config.js                ← Vite 配置：base './' + target es2022 + outDir dist
├── electron-builder.yml          ← 打包配置（${version} / extraResources 不打进 asar）
├── .github/workflows/release.yml ← CI（构建 + 发布到 GitHub Releases）
├── package.json                  ← 版本号单一来源（version 字段）
├── docs/
│   └── version/                  ← 版本迭代日志（README.md + RELEASE-v{主版本}.md）
└── dist/                         ← Vite 构建产物（Electron 内 loadFile 加载）
```

### 6. 关键函数/模块清单（修改前必须确认）

| 函数 / 通道 | 所在文件 | 用途 |
|------|---------|------|
| `HarnessManager.start()` | harness.cjs | spawn dsh web 子进程、探活、捕获 URL |
| `HarnessManager.stop()` | harness.cjs | 优雅停止（SIGTERM → 超时 SIGKILL） |
| `HarnessManager.restart()` | harness.cjs | 先停后启 |
| `HarnessManager.snapshot()` | harness.cjs | 汇总状态/日志/版本/路径快照 |
| `HarnessManager.checkRuntime()` | harness.cjs | 校验内置 DSH 运行时完整（入口与版本） |
| `HarnessManager._captureUrl()` | harness.cjs | 捕获带 token 的访问地址（信任凭据） |
| `HarnessManager.dshVersion` | harness.cjs | 读内置 DSH 运行时版本（不启动进程） |
| `registerIpc()` | main.cjs | 注册全部 `ipcMain.handle` 通道 |
| `broadcast()` | main.cjs | 向所有窗口广播 `harness:state` / `harness:log` |
| `checkForUpdates()` | main.cjs | electron-updater 检查（仅打包态） |
| `createMainWindow()` / `openWebWindow()` | main.cjs | 主窗口 / DSH Web UI 窗口 |
| `SettingsStore.save/load` | settings.cjs | 设置读写（userData/settings.json） |
| `exposeInMainWorld('clawLite', …)` | preload.cjs | 暴露 12 方法 + `onState`/`onLog` |
| `call(cmd, args)` / `COMMANDS` | src/main.js | 渲染层命令 → preload 方法映射 |
| `render(snap)` | src/main.js | 渲染状态与设置回填 |
| `boot()` | src/main.js | 启动：桌面环境绑定 IPC / 浏览器预览降级 |

### 7. CSS 约定

- **CSS 变量优先**：颜色、间距、圆角、阴影、字体栈等全部定义在 `src/styles/main.css` 的 `:root` 中（如 `--bg` / `--card` / `--line` / `--text` / `--accent` / `--ok` / `--warn` / `--err` / `--radius` / `--mono` / `--sans`），禁止硬编码色值/尺寸
- **深色控制台基调**：背景 `#0e1014` 系、品牌橙 `--accent: #e2673a` 作唯一强调色
- **系统字体栈**：`--sans` / `--mono` 均为系统字体，无外部字体依赖
- **命名**：短横线分词（`.btn` / `.card` / `.pill` / `.log` / `.kv`）
- **选择器嵌套**：不超过 3 层；`!important` 禁止使用（仅 `@media (prefers-reduced-motion)` 无障碍场景例外）
- **新增样式**统一写入 `src/styles/main.css`，保持分区组织

### 8. 交互约定

- **按钮可用性**：`render(snap)` 按状态机禁用/启用量（启动中禁用全部操作；未运行时禁用打开界面；运行时禁用启动）
- **状态/日志流**：`harness:state` 推送整体快照驱动 `render()`；`harness:log` 推送单行（空串 = 清屏），渲染层按 `classify()` 着色（`[claw-lite]` → `l-claw`；含 error/失败/Error → `l-err`）
- **自动滚动**：日志区仅在 `f-autoscroll` 勾选时自动滚到底部
- **复制地址**：`navigator.clipboard.writeText(snapshot.url)`，需在 Electron 桌面环境（浏览器预览模式无 clipboard 权限时降级提示）
- **设置回填**：仅在对应输入框未聚焦时回填 `port`/`workspace`/`dshHome`，避免打断用户输入
- **外部链接**：主窗口/`webWindow` 的 `setWindowOpenHandler` 将 `https?` 链接交 `shell.openExternal`，应用内不另开新窗

### 9. 数据流

```
用户操作 → 渲染层 call('harness_*') → preload api.* → ipcMain.handle('harness:*')
                                                                  ↓
                                              HarnessManager 状态/子进程变更
                                                                  ↓
                                              setState()/log() → emit('state'/'log')
                                                                  ↓
                                  main.cjs broadcast('harness:state'/'harness:log')
                                                                  ↓
                                              渲染层 onState(snap) → render(snap)
                                              渲染层 onLog(line)  → logLine(classify)
```

URL 捕获（带 token 的信任凭据）：
```
dsh 子进程 stdout → attachPipes → log(line) → _captureUrl(line) 匹配
  `dsh web: http://127.0.0.1:<port>/?token=xxx` → this.url → emit('state')
```

### 10. 用户偏好

- 用户指令风格：直接给动作词（"修复"、"优化"、"审查"），期望 Agent 直接执行而非仅建议
- 偏好针对性局部修复，拒绝重构
- 涉及文件改动时默认直接动手，无需先征求确认
- **修复完成后不要主动执行 git commit**，由用户自行验证后再提交
- 版本号以用户手动操作为准（曾手动回退过版本号），Agent 递增版本号时以 `package.json` 当前值为基准、且需用户明确允许
- **改动后必须运行 `npm run check` 验证**（JSON / 文件 / 语法 / IPC 三层对齐 / 无 Tauri 残留）

### 11. 编码规范

> 以下规范适用于本项目所有代码编写，所有 Agent 在新增或修改代码时必须遵守。

#### 11.1 命名规范

| 类别 | 规则 | 示例 |
|------|------|------|
| 文件命名 | 全小写，短横线分词（主进程 `*.cjs`、渲染 `*.js`、样式 `*.css`） | `harness.cjs`、`main.css` |
| CSS 类名 | 短横线分词 | `.order-card`、`.pill` |
| 变量/函数 | 小驼峰 | `dshRoot`、`renderState()` |
| 常量 | 全大写下划线 | `LOG_LIMIT`、`READY_TIMEOUT_MS`、`DEFAULT_PORT` |
| 布尔变量 | is/has/should 开头 | `isPackaged`、`hasPermission` |
| 函数命名 | 动词开头 | `start()`、`checkRuntime()` |
| 私有变量/方法 | 下划线前缀 | `_captureUrl`、`_stopping` |

#### 11.2 HTML 规范（index.html / 渲染层）

- **语义化标签**：`header`/`main`/`section`/`footer`/`aside`/`nav`，避免全 `<div>`
- **类名短横线**：禁止下划线或驼峰类名
- **图片**：必须加 `alt`；当前仅 SVG data-uri favicon，无外部图片
- **表单**：`label` 与 `input` 关联（`for`/`id`），输入框需 `placeholder`
- **内联脚本**：禁止 `<script>inline</script>`（CSP 已禁 `script-src 'unsafe-inline'`），所有逻辑走 `src/main.js`

#### 11.3 CSS 规范

- **CSS 变量优先**：所有颜色、间距、圆角、阴影必须使用 `:root` 中变量，禁止硬编码
- **选择器嵌套**：不超过 3 层
- **`!important` 禁止使用**：唯一例外是 `@media (prefers-reduced-motion)` 无障碍场景
- **单位**：优先 `rem`/`vh`/`%`，固定像素场景（border-width、box-shadow）可用 `px`
- **重复规则**：禁止同一选择器定义两次，发现重复必须合并

#### 11.4 JavaScript 规范（渲染层 + 主进程）

- **禁止 `var`**：一律使用 `const`（默认）或 `let`（需重新赋值时）
- **魔法数字**：禁止在代码中直接写无含义数字，必须抽为命名常量（如 `LOG_LIMIT = 800`、`READY_TIMEOUT_MS = 60_000`、`STOP_GRACE_MS = 6_000`）
- **箭头函数**：回调优先使用箭头函数
- **异步**：优先 `async/await`，避免 `.then()` 链
- **嵌套深度**：不超过 3 层
- **数组操作**：优先 `map`/`filter`/`reduce`
- **console 语句**：生产代码禁止 `console.log`（调试日志）；`console.error`/`console.warn` 仅用于 catch 块中的错误处理
- **HTML 拼接**：渲染层操作 DOM 一律用 `document.createElement` / `textContent`（当前实现已遵循，禁止改用 `innerHTML` 拼接未转义用户数据）
- **单行函数**：禁止将多逻辑函数压缩为单行，影响可读性
- **CommonJS 主进程**：`electron/*.cjs` 使用 `require` + `module.exports`（与渲染层 ESM 区分明确，不得混用）

#### 11.5 安全规范（CSP 强制）

- **CSP 严守**：`index.html` 的 CSP 不得放宽到 `'unsafe-inline'` 脚本、`https:`/`ws:` connect 或外链脚本/字体/图片——仅加载 `self` 本地资源（`img-src`/`font-src` 允许 `data:`）
- **contextIsolation**：主进程 `contextIsolation: true` + `nodeIntegration: false` + `sandbox: true` 不得关闭
- **XSS 防护**：渲染层禁止 `innerHTML` 注入未转义内容；DOM 更新用 `textContent`/`createElement`
- **无外部网络**：本项目不调用任何外部接口（DSH 子进程仅监听 `127.0.0.1`）；自动更新走 electron-updater 自有通道
- **密钥/Token**：DSH Web UI 的访问 token 仅存于内存（`HarnessManager.url`），不落盘、不打印到日志以外的地方

#### 11.6 性能规范

- **日志上限**：`HarnessManager.log` 受 `LOG_LIMIT = 800` 约束，超出截断旧日志
- **探活节流**：`waitForReady` 轮询间隔 400ms、单次超时 `READY_TIMEOUT_MS = 60_000`，避免忙等
- **防抖/节流**：高频 UI 事件（如日志追加）保持轻量 DOM 操作；设置回填避免打断输入
- **无障碍**：支持 `@media (prefers-reduced-motion: reduce)`

#### 11.7 Git 提交规范

提交格式：`type(scope): content`

| type | 说明 |
|------|------|
| `feat` | 新功能 |
| `fix` | 修复 |
| `style` | 格式调整（不影响代码逻辑） |
| `refactor` | 重构 |
| `perf` | 性能优化 |
| `test` | 测试 |
| `chore` | 构建/工具 |
| `docs` | 文档 |

示例：`fix(harness): 修复 dsh 子进程探活超时误判为失败`

### 12. 自检与 CI

- **本地自检**：`npm run check`（覆盖 JSON 合法性、关键文件存在、全量 JS 语法、IPC 契约三层对齐、内置 DSH 运行时完整性、无残留 Tauri 依赖）。任何改动后必须全绿。
- **CI 流水线**：`.github/workflows/release.yml` 在推送 `v*` tag（或手动触发）后，于 macOS / Windows runner 执行 `npm ci → npm run runtime → npm run check → npm run build:web → electron-builder`，产物汇总后由 `publish` job 创建 GitHub Release。
- **打包**：`npm run dist:mac` / `dist:win` / `dist:linux` / `dist`，产物输出 `release/`。macOS 本地打包默认不签名（`CSC_IDENTITY_AUTO_DISCOVERY=false`），正式分发需具备证书的机器签名/公证。
