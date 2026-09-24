# Claw Lite · v1.0 发布日志

> 版本号单一来源：`package.json` 的 `version` 字段。
> 本文件仅记录发布历史，最新分节在最前；历史内容只增不改。
> 版本纪律见 [README.md](README.md) 与 `AGENTS.md` §0。

---

## v1.0.0 — 初始基线（📝 待发布）

- **日期**：2026-09-24
- **状态**：📝 待发布（未发布前不推进版本号）
- **版本号**：`package.json` 已对齐至 `1.0.0`（由早期 `0.1.0` 同步）
- **范围**：首个文档化基线，确立 `AGENTS.md` 强制规范与版本纪律

### 本期内容

- **项目定位**：Electron 桌面宿主，内置 Electron 自带 Node 作为解释器，打包官方 `@deepseek-ai/dsh` 本地依赖树（约 300MB，置于 asar 之外），用户免装 Node 环境即得 dsh web
- **主进程能力**：单实例锁、主窗口与 DSH Web UI 窗口（`persist:dsh-web` 分区保留登录态 / 系统浏览器两种打开方式）、菜单、生命周期、`before-quit` 优雅停止
- **运行时托管**：`HarnessManager` 负责 dsh 子进程 spawn（带 `ELECTRON_RUN_AS_NODE=1` 与 `--expose-internals`）、HTTP 探活、日志流、状态机（`notInstalled`/`stopped`/`starting`/`running`/`error`）、优雅停止（SIGTERM → `STOP_GRACE_MS` 超时 SIGKILL）
- **访问地址捕获**：从 dsh 输出解析带 `token` 的完整 URL（`dsh web: http://127.0.0.1:<port>/?token=xxx`），作为 Web UI 信任凭据原样保留
- **IPC 契约三层对齐**：主进程 `ipcMain.handle` ↔ preload 暴露 `window.clawLite`（12 方法 + 2 事件）↔ 渲染层 `api.*` 调用，由 `scripts/check.mjs` 静态校验
- **设置持久化**：`userData/settings.json`（端口默认 8799 / 自动启动 / 打开方式 / 工作目录 / DSH_HOME / 窗口几何）
- **渲染层**：Vite 构建到 `dist/`，`base: './'` 保证 Electron 内 `file://` 加载；深色控制台 UI（严格 CSP，纯原生 JS，无前端框架）
- **自动更新**：electron-updater + GitHub Releases（`publish.provider: github`，owner `trexwb` / repo `clawLite`）
- **CI**：`.github/workflows/release.yml` 在 `v*` tag 或手动触发后，于 macOS / Windows runner 执行 `npm ci → npm run runtime → npm run check → npm run build:web → electron-builder` 并创建 Release
- **自检**：`npm run check` 覆盖 JSON / 关键文件 / 全量 JS 语法 / IPC 三层对齐 / 内置 DSH 运行时完整性 / 无残留 Tauri 依赖

### 已知限制

- macOS 包默认不签名 / 未公证，首次打开需右键「打开」绕过 Gatekeeper；仍被拦截可在终端执行 `xattr -dr com.apple.quarantine "/Applications/clawLite.app"`（路径按实际包名调整）解除隔离标记
- 依赖树约 300MB，安装包体积较大（压缩后 dmg 约 150MB）
- 内置 DSH 版本由 `scripts/fetch-runtime.mjs` 的 `DSH_VERSION`（当前 `0.1.5-rc.3`）决定，升级需重跑 `npm run runtime:force`

### 待发布优化（2026-09-24 · 不推进版本号）

- **启动/加载速度 · autoStart 重叠拉起**：`electron/main.cjs` 将 autoStart 场景下的 `harness.start()` 与 `createMainWindow()` 并行触发，移除原先 `setTimeout(…, 800)` 的串行等待。dsh 子进程冷启动（主导项）与 Electron 窗口渲染重叠，autoStart 下「DSH 就绪」体感更早到达。`harness.start()` 不依赖主窗口（启动期 state 广播在无窗口时 no-op，渲染层 boot 经 `harness:snapshot` 拉取当前态），行为安全一致。验证：`npm run check` 全绿、渲染层重建无回归。
- 版本号维持 **v1.0.0**（性能编排优化，未引入新功能/新根因修复，按 §0 不推进版本号）。

### 顶栏 UI 缺陷修复（2026-09-24 · 不推进版本号）

- **背景**：主窗口顶栏（`hiddenInset` 无边框标题栏）存在三处 UI 缺陷——父窗口无法拖动、macOS 交通灯关闭按钮与品牌标题重叠、标题左侧 logo 显示为纯橙色色块。
- **窗口无法拖动**：`titleBarStyle: 'hiddenInset'` 隐藏原生标题栏后窗口无任何拖动区。现由顶栏 `#topbar` 整体承担拖动区（`-webkit-app-region: drag` + `user-select: none`），顶栏内的「检查更新」按钮与状态胶囊显式 `-webkit-app-region: no-drag`，保证拖动区内交互元素仍可点击。
- **交通灯与标题重叠**：顶栏由内边距撑高改为固定高度 `--topbar-h: 62px`（内容垂直居中）；`electron/main.cjs` 新增 macOS 专用 `trafficLightPosition: { x: 16, y: 24 }`；渲染层在 macOS 桌面端为 `body` 打 `is-mac`，并以 `--topbar-gutter: 84px` 预留左侧安全区，二者配套消除重叠。
- **logo 纯橙色色块**：`.brand-mark` 原为 CSS `radial-gradient` 占位块，改为引用项目真实图标资源 `build/icon.png`（与 electron-builder / README 同一份图标），由 Vite 构建输出到 `dist/assets/icon-<hash>.png` 并相对路径引用，补 `alt` 与 `width`/`height`。
- **验证**：`npm run build:web` 成功（产物新增 `dist/assets/icon-DYtyWVWp.png`，`dist/index.html` 引用 `./assets/icon-DYtyWVWp.png`，`base: './'` 未改动）；`npm run check` 全绿；Electron 内加载 `dist/index.html` 实测顶栏 `height=62px`、`padding-left=84px`、`-webkit-app-region=drag`，按钮/胶囊为 `no-drag`，品牌图标 `naturalWidth=1024` 已加载且渲染为真实图标，0–84pt 区域无品牌内容（交通灯安全区为空）。
- 文档同步：`AGENTS.md` §1「静态资源路径」、§11「图片」补充顶栏品牌图标说明。
- 版本号维持 **v1.0.0**（纯 CSS / 结构打磨与同日同模块追加修复，按 §0 不推进版本号）。

### 核心代码审计与加固（2026-09-24 · 不推进版本号）

- **背景**：对全量核心源码（`main.cjs` / `preload.cjs` / `harness.cjs` / `settings.cjs` / `src/main.js`，约 2900 行）做五轴静态审计，缺陷清单为 1 Critical / 8 Required / 13 Optional / 10 Nit / 6 FYI。本轮修复全部 Critical、Required 与 4 项 Optional。
- **C1 启动失败无错误边界 → 界面死锁**：`HarnessManager.start()` 中 `pickPort()` 与 `fs.mkdirSync(dshHome)` 抛错会击穿调用点，`starting` 恒为 `true`、状态停在 `starting`，所有按钮禁用且无自愈路径。现将端口分配与数据目录准备包入 try/catch，失败即复位 `starting`/`_stopping`/`url` 并落 `error` 状态与日志。
- **R1 端口取值越界崩溃**：`pickPort()` 未校验范围，负数 / `>65535` / NaN 会令 `srv.listen` 抛 `RangeError`。现钳制到 1–65535，非法值回落 OS 自动分配。
- **R1b 子进程退出事件竞态**：`child.on('exit')` 未校验事件来源，restart 的「停→启」窗口内旧进程退出会清掉新进程句柄并误报「意外退出」。现以 `this.child !== child` 早退过滤。
- **R2 停止态语义错位**：`stop()` 复用 `starting` 状态与文案，UI 显示「正在启动…」，且渲染层枚举中根本没有 `stopping`。现新增 `stopping` 状态并在 harness / 渲染层 `STATE_LABEL` / CSS（`.dot.stopping`·`.pill.stopping`）三处对齐；停止期间 `starting = true`，渲染层将 `stopping` 一并视为忙碌，杜绝「停止→启动」重入。
- **R3 窗口几何逐帧写盘**：`resize`/`move` 每事件同步 `store.save()`。现改为 400ms 防抖，并在 `close` 前补一次同步落盘（避免「刚拖完就退出」丢失位置）。
- **R4 设置读写静默吞错**：`store.save()` 无返回值、`load()` 失败静默回落默认值，渲染层据此固定弹「已保存」。现 `save()` 返回 `{ ok, error }`、`load()` 记录 `loadError` 并由主进程启动时写入运行日志；`harness:saveSettings` 回传 `{ ok, error, snap }`，渲染层区分成功 / 失败提示；主进程侧同时校验端口范围，非法即拒绝写盘。
- **R5 日志 DOM 只增不减**：渲染层保留行数改为与主进程 `LOG_LIMIT`（800）对齐并从头裁剪；主进程缓冲截断后行数不再变化，故以「行数相同但首行变化」作为重建信号，避免界面残留过期行。
- **R6 可访问性缺失**：状态胶囊 / 状态主卡 / 日志区 / 提示条补 `role` 与 `aria-live`，装饰性色点 `aria-hidden`；新增 `:focus-visible` 键盘焦点样式；新增 `prefers-reduced-motion: reduce` 分支关闭状态点脉冲与过渡（§11.3 禁用 `!important`，故按选择器精确覆盖而非全局通杀；150ms 级 hover 过渡未纳入）。
- **R7 文档路径失真**：`AGENTS.md` §2 声明的项目根目录与实际 clone 位置不符，改为「当前 clone 的项目根目录」并明确禁止硬编码绝对路径。
- **R8 开发端口文档错误**：README 开发模式写 `localhost:1420`，而 `vite.config.js` 为 `strictPort: 5173`，照抄会白屏。已更正为 5173。
- **O9 失效产物入库**：移除 `.openclaw/tmp/clawlite-review/` 下 6 个遗留 stub/test 文件，`.gitignore` 增加 `.openclaw/`。
- **O10 重启残留子进程**：`app:relaunch` 由 `app.exit(0)` 改为 `app.quit()`，经 `before-quit` 优雅停止 dsh，不再残留孤儿进程。
- **O11 dsh web 窗口缺 `will-navigate` 守卫**：仅 `setWindowOpenHandler` 只挡 `window.open`，页内点击外链仍会把宿主窗口（持久分区 `persist:dsh-web`）导航到任意外部站点。现新增 `will-navigate` 守卫，仅放行与 `harness.url` 同源的站内导航，其余 `preventDefault()` 并交系统浏览器打开。
- **O12 自动更新异步 `error` 击穿主进程**：`autoUpdater` 开启了 `autoDownload`，但未注册 `'error'` 监听；后台下载阶段异步抛出的 error 事件会以未处理异常崩溃主进程（`try/catch` 只能覆盖 `checkForUpdates()` 的 await 段）。现注册 `autoUpdater.on('error', …)` 落运行日志并提示。
- **自检增强**：`scripts/check.mjs` 关键文件清单补 `src/styles/main.css`；新增「状态枚举一致性」校验（`harness.setState` 取值 ↔ 渲染层 `STATE_LABEL` 键），防止 R2 类问题复发。
- **验证**：`npm run check` 全绿（新增校验项 PASS，5 个状态对齐；1 项告警为本地未拉取内置 DSH 运行时，与本次改动无关）；`node --check` 覆盖全部 `electron/`、`src/`、`scripts/` 脚本通过；渲染层构建验证通过（借用本机其它项目已装的 Vite：`5 modules transformed`，`dist/index.html` 引用 `./assets/...` 相对路径，`base: './'` 未改动）。本仓库未安装 devDependencies（无 `node_modules`），`npm run build:web` 需先执行 `npm install`。
- 版本号维持 **v1.0.0**（同日同模块缺陷修复，按 §0 不推进版本号）。

---

> 后续迭代分节追加于此文件顶部，格式同上（日期 + 状态 + 版本号是否推进的说明）。
