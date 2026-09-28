# CLAUDE.md — Claw Lite

> 面向 AI 编程助手的项目速览。内容依据当前代码库实扫（应用版本 `1.0.2`）。
> **项目已收尾**：DeepSeek 官方已发布桌面版（`deepseek-harness desktop 0.1.7-rc.2`），本项目为官方桌面版发布前的自主研究探索，后续不再更新，版本号冻结在 `1.0.2`（详见 `README.md` 顶部说明）。
> **项目内最高约束是根目录 `AGENTS.md`**（强制规范、版本纪律、编码规范、自检门禁），本文件与其冲突时以 `AGENTS.md` 为准。

## 1. 项目定位

Claw Lite 是 **DeepSeek Harness（`@deepseek-ai/dsh`）的 Electron 桌面宿主**：把官方 dsh 依赖树本地化打包进安装包，用 Electron 自带的 Node 运行时 spawn `dsh web` 子进程，**用户无需安装 Node 环境**即可使用 dsh web。

- 交付形态：Electron 桌面应用（**不是**纯前端 `file://` 双击运行的 SPA）。
- 主进程负责 DSH 生命周期调度；渲染层是一个深色控制台 UI（启动/停止/重启、实时状态与日志流、访问地址捕获、打开方式、端口/工作目录/DSH_HOME 配置、DSH 版本下载与热切换、自动更新检查）。
- 技术栈（`package.json` 实值）：Electron `^44.4.5`、TypeScript `^7.0.2`、Vite `^8.3.1`、esbuild `^0.28.2`、electron-builder `^26.15.3`；运行时依赖仅 `electron-updater`、`npm`。渲染层**零框架**（原生 JS + CSS，无 React/Vue/jQuery/lodash）。
- 运行环境要求：**Node ≥ 24**（`scripts/*.ts` 依赖 Node 原生类型擦除直跑，仓库不含 `.cjs`/`.mjs` 源码）。

## 2. 常用命令

| 命令 | 作用 |
|---|---|
| `npm run dev` | 启动 Vite 开发服务器（浏览器预览模式；无 `window.clawLite` 时界面降级为静态占位） |
| `npm run build:electron` | esbuild 构建主进程 → `dist-electron/main.js`（ESM）+ `dist-electron/preload.js`（CJS） |
| `npm run build:web` | Vite 构建渲染层 → `dist/` |
| `npm run build` | `build:electron` + `build:web` |
| `npm start` | `npm run build && electron .`，本地完整启动 |
| `npm run electron` | 直接 `electron .`（不重新构建；配合 `CLAWLITE_DEV_SERVER` 指向 dev server 使用） |
| `npm run runtime` | 拉取内置 DSH 依赖树到 `resources/dsh/`（含 `runtime.json` 清单） |
| `npm run runtime:force` | 强制重新拉取内置 DSH（升级 `DSH_VERSION` 后使用） |
| `npm run check` | **静态自检（任何改动后必跑，须全绿）** |
| `npm run verify:dist` | 校验渲染层产物（相对路径 + 品牌图标），需先 `build:web` |
| `npm run dist` / `dist:mac` / `dist:win` / `dist:linux` | 打包安装程序到 `release/` |

开发态加载 dev server 的环境变量为 **`CLAWLITE_DEV_SERVER`**（`electron/main.ts` 读取，仅非打包态生效）。

## 3. 目录结构

```
clawLite/
├── electron/                     ← 主进程源码（TypeScript → dist-electron/*.js）
│   ├── main.ts                  ← 入口：单实例锁、窗口、IPC 路由、菜单、生命周期、自动更新检查
│   ├── preload.ts               ← contextBridge 桥（window.clawLite：17 方法 + 3 事件）
│   ├── harness.ts               ← HarnessManager：dsh 子进程 spawn/探活/日志/状态机/优雅停止/版本热切换
│   ├── settings.ts              ← 设置持久化（userData/settings.json）
│   ├── version-download.ts      ← 从 npm 拉取指定 DSH 版本（下载/解包/校验/取消，含 VersionJob 阶段机）
│   └── version-fetch.ts         ← npm registry 版本查询（最新版/全量列表）+ npm CLI 解析 + 错误文案
├── src/                          ← 渲染层（Vite → dist/）
│   ├── main.ts                   ← 控制台前端逻辑（与 window.clawLite 契约交互）
│   ├── env.d.ts                  ← 全局类型声明（Window.clawLite 契约、Snapshot/VersionJob 类型）
│   ├── shared/
│   │   └── constants.ts          ← 跨进程共享常量单一来源（PORT_MIN/PORT_MAX/PORT_DEFAULT/LOG_LIMIT）
│   └── styles/
│       └── main.css              ← 深色控制台样式（CSS 变量/设计令牌在 :root）
├── resources/dsh/                ← 内置 DSH 运行时（含 node_modules/@deepseek-ai/dsh + runtime.json，约 300MB，不入库）
├── scripts/                      ← 构建与自检脚本（TypeScript，node ≥ 24 直跑）
│   ├── build-electron.ts        ← esbuild 构建（main.ts→ESM，preload.ts→CJS）
│   ├── check.ts                 ← 静态自检（12 组断言，见 §5）
│   ├── verify-dist.ts           ← 渲染层产物校验（图标资产 + 相对路径）
│   └── fetch-runtime.ts         ← 拉取/刷新内置 DSH 依赖树（`DSH_VERSION` 常量在此）
├── build/                        ← 打包资源（icon.png / entitlements.mac.plist）
├── docs/                         ← 文档（version/ 版本日志、case/ 案例、wiki/ GitHub wiki、images/ 配图）
├── index.html                    ← 渲染层入口（含严格 CSP meta）
├── vite.config.ts                ← base './'、target es2022、outDir dist
├── tsconfig.json                 ← 类型检查（noEmit，覆盖 electron/ scripts/ src/）
├── electron-builder.yml          ← 打包配置（${version} 产物名 / extraResources 不入 asar）
├── .github/workflows/release.yml  ← CI：构建 + 发布 GitHub Release
└── package.json                  ← 版本号单一来源（version 字段）
```

构建产物：`dist/`（渲染层）、`dist-electron/`（主进程 `main.js` ESM + `preload.js` CJS）、`release/`（安装包）。

## 4. 架构与数据流

**进程模型**

```
主进程 electron/main.ts  ── 桥 electron/preload.ts ── 渲染层 src/main.ts
（单实例锁 / 窗口 / IPC / 菜单 / 自动更新）  （contextBridge，contextIsolation:true + nodeIntegration:false + sandbox:true）
                 │
                 └── HarnessManager（electron/harness.ts）── spawn ──> dsh web 子进程（127.0.0.1:<port>）
```

**IPC 契约（三层对齐，`scripts/check.ts` §4 自动校验）**

- 方法（17）：`snapshot` / `start` / `stop` / `restart` / `verify` / `clearLogs` / `listVersions` / `pruneVersions` / `prepareVersion` / `applyVersion` / `cancelVersion` / `saveSettings` / `open` / `pickDirectory` / `checkUpdate` / `relaunch` / `appInfo`
- 事件订阅（3）：`onState → harness:state`（整体快照）、`onLog → harness:log`（单行，空串=清屏）、`onVersionProgress → harness:versionProgress`（轻量下载进度帧）
- 主进程通道：上表方法对应的 `ipcMain.handle` 通道（`harness:*`、`dialog:pickDirectory`、`updater:check`、`app:relaunch`、`app:info`）
- 广播事件：`harness:state` / `harness:log` / `harness:versionProgress`（仅推主窗口，不外送 dsh Web UI 窗口）

**数据流**

```
用户操作 → 渲染层 call('harness_*') → preload api.* → ipcMain.handle('harness:*')
        → HarnessManager 变更 → setState()/log() → emit('state'/'log')
        → broadcast('harness:state'/'harness:log') → 渲染层 render(snap)/logLine(classify)
```

**访问地址捕获**：dsh 就绪时 stdout 打印 `dsh web: http://127.0.0.1:<port>/?token=xxx`，`HarnessManager._captureUrl` 捕获该**带 token 的完整 URL**（Web UI 信任凭据，必须原样保留，缺失会被拒）。

**状态机**（`HarnessManager.state`）：`notInstalled` / `stopped` / `starting` / `stopping` / `running` / `error`，由 `setState()` 统一驱动；渲染层 `STATE_LABEL` 与之双向一致。

**DSH 版本运行时（热切换）**：`settings.dshVersion`（`latest` 或具体版本号）→ `resolveRuntime()` 按「用户已下载版本目录 `userData/dsh-versions/<ver>` → 现场从 npm 拉取 → 回退内置 `resources/dsh`」的优先级解析；`prepareVersion/applyVersion/cancelVersion` 支持选定即下载、下载完成**不重启应用**直接停旧起新切换。

## 5. 关键约定与红线

**版本号纪律**

- 应用版本**单一来源** = `package.json` 的 `version`：`electron-builder.yml` 用 `${version}` 生成产物名（mac/linux `Claw-Lite-${version}-${arch}.${ext}`、win `Claw-Lite-Setup-${version}.${ext}`），运行期由 `app.getVersion()` 读取。项目**无 Tauri、无独立版本清单**。
- **内置 DSH 版本是独立维度**：由 `scripts/fetch-runtime.ts` 的 `DSH_VERSION`（当前 `0.1.5-rc.3`）决定，与应用版本互不影响；`resources/dsh/app/package.json` 与 `resources/dsh/app/node_modules/@deepseek-ai/dsh/package.json` 的 `version`（`1.0.0`）**不得随应用版本改动**。
- 按 SemVer 迭代（破坏性→主版本，向后兼容新功能→次版本，修复/文档/样式→修订号），并在 `docs/version/RELEASE-v{主版本}.md` 顶部追加分节；历史日志只增不改。

**代码形态硬约束**

- `electron/`、`scripts/`、`src/` 源码一律 `.ts`，仓库不出现 `.cjs`/`.mjs`；产物一律 `.js`。
- 主进程产物按 **ESM** 运行（根 `type:module`，路径用 `import.meta.url`，禁 `require`/`__dirname`）；**preload 产物必须为 CJS**（Electron 在 `sandbox:true` 下忽略 `type:module`）。
- 改动主进程/preload 后必须重跑 `npm run build:electron`——运行期加载的是产物而非源码。

**构建与资源**

- `vite.config.ts` 的 `base: './'`、`target: 'es2022'`、`outDir: 'dist'` 不得改动（`BrowserWindow.loadFile` 经 `file://` 加载，须依赖相对路径）。
- 渲染层资源引用一律相对路径，仅用 `src/styles/main.css` + 系统字体栈；顶栏品牌图标引用 `build/icon.png`（Vite 构建时复制到 `dist/assets/`，由 `verify:dist` 断言）。
- `extraResources` 把 `resources/dsh` 与 `node_modules/npm` 打到 asar **之外**（内含 `.node` 原生模块，须为真实文件）。

**安全红线**

- `index.html` 的 CSP 不得放宽：`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'`（`style-src 'unsafe-inline'` 仅为 Vite dev HMR 保留；脚本侧禁止内联）。
- `contextIsolation: true` + `nodeIntegration: false` + `sandbox: true` 不得关闭。
- 主窗口与 dsh Web UI 窗口均须同时挂 `setWindowOpenHandler` 与 `will-navigate` 守卫（后者只放行自身入口/同源站内导航），外部 `https?` 链接交 `shell.openExternal`。
- 渲染层禁用 `innerHTML` 注入未转义内容，DOM 更新用 `textContent`/`createElement`。
- 禁止引入前端框架、Tauri 残留或其他额外运行时依赖；禁用 `!important`（仅 `@media (prefers-reduced-motion)` 例外）。

**DSH 启动细节（禁止移除）**

- spawn 解释器为 `process.execPath`（打包后即应用自身可执行文件），环境变量 `ELECTRON_RUN_AS_NODE=1`，命令行首参 `--expose-internals`（dsh 的 cordis-plugin-hmr 依赖 Node 内部 binding，缺失会导致 web profile 加载失败退出），并以 `--no-open` 禁止 dsh 自拉浏览器、`--host 127.0.0.1 --port <port>` 仅监听本机。
- 就绪判定为 HTTP 探活轮询（400ms 间隔，超时 `READY_TIMEOUT_MS = 60_000`）；探活通过后短暂等待 token URL 到达。
- 停止为 `SIGTERM` → 超过 `STOP_GRACE_MS = 6_000` 后 `SIGKILL`（Windows 走 `taskkill /f /t`）。

**单一来源常量**（`src/shared/constants.ts`，三方对齐由 `check.ts` §9/§12 校验）

- 端口 `PORT_MIN = 1024` / `PORT_MAX = 65535` / `PORT_DEFAULT = 8799`（`index.html` 输入框 min/max、渲染层 `readPort()`、主进程 `pickPort()` 同源；越界或占用时由 OS 分配空闲端口）。
- 日志上限 `LOG_LIMIT = 800`（主进程缓冲与渲染层 DOM 节点数对齐，超出从头部裁剪）。
- 下载阶段文案 `PHASE_LABEL`（`src/main.ts`）与 `DOWNLOAD_PHASES`（`electron/version-download.ts`）须双向一致。

**设置与状态持久化**

- `userData/settings.json`（macOS：`~/Library/Application Support/Claw Lite/settings.json`），字段：`port` / `autoStart` / `openMode`（`window`|`browser`）/ `workspace` / `dshHome` / `dshVersion` / `windowBounds`（窗口几何 400ms 防抖 + close 前同步落盘）。
- 运行日志缓冲 `HarnessManager.logs`（上限 800 行）；启动埋点追加写入 `userData/startup.log`。

**工作方式约定**

- 文件操作以项目根目录为根，**禁止硬编码绝对路径**；编辑采用最小改动、分区替换，改前先读取确认，改后 grep/read 验证。
- 新增/修改任何主进程能力，必须同步更新三处：`electron/main.ts` 的 `ipcMain.handle`、`electron/preload.ts` 的暴露面、`src/main.ts` 的调用点。
- 任何改动后必须 `npm run check` 全绿；**不要主动执行 `git commit`**，由用户验证后自行提交。
- 自检 `npm run check` 覆盖 12 组断言：JSON 合法性、关键文件存在、源码后缀门禁 + `tsc` 类型检查、IPC 契约三层对齐、内置 DSH 运行时完整性、入口/依赖基线（无 Tauri 残留）、状态枚举双向可达、日志着色类名 ↔ CSS 交叉、端口三方一致、CSP 与无障碍安全基线、产物模块形态、下载阶段文案双向校验。

## 6. 已知限制

- **macOS 未签名 / 未公证**：`electron-builder.yml` 已备好 `hardenedRuntime` 与 `entitlements`，但当前 `CSC_IDENTITY_AUTO_DISCOVERY: "false"` 显式关闭证书自动发现，CI 与本地产物一致为未签名版本，首次打开需右键「打开」绕过 Gatekeeper。启用签名/公证的完整步骤以注释形式预留在 `.github/workflows/release.yml`，启用后须同步更新 README 与 `docs/wiki/自检与发布流程.md` 的表述。
- **安装包体积大**：内置 DSH 依赖树约 300MB（含 node-pty / sharp 等平台相关原生模块），必须置于 asar 之外，因此无法压缩进单个归档；`resources/dsh/` 不入库，需各平台在自身构建机上执行 `npm run runtime` 生成。
- **CI 平台覆盖不全**：`release.yml` 仅构建 macOS（`macos-14`，arm64）与 Windows（`windows-latest`，x64）；`npm run dist:linux` 存在但未接入 CI。
- **DSH 版本兼容性**：内置版本为 `0.1.5-rc.3`；`0.1.7` 系列与当前 Electron 存在原生模块 ABI 不匹配问题，渲染层已硬拦截（`INCOMPATIBLE_PREFIXES = ['0.1.7']`，选中即提示并阻止下载）。
- **运行时版本按机器缓存**：通过 npm 拉取的 DSH 版本落在 `userData/dsh-versions/<ver>`，不随安装包分发；registry 不可达时回退内置运行时。
- **preload 为唯一 CJS 特例**：源码用 ESM 写法，但产物必须是 CJS，改动该文件时不要改为 `.mjs` 或 ESM 产物。
