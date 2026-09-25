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
- 内置 DSH 版本由 `scripts/fetch-runtime.ts` 的 `DSH_VERSION`（当前 `0.1.5-rc.3`）决定，升级需重跑 `npm run runtime:force`。**当前 Electron 版本与 DSH v0.1.7 存在兼容冲突，建议维持 `0.1.5-rc.3` 作为内置运行时**；待后续 Electron 升级迭代支持 v0.1.7-rc.2 后再切换

### DSH 运行时版本兼容性说明（2026-09-25 · 不推进版本号）

- **背景**：DSH v0.1.7 系列（含 v0.1.7-rc.2）引入了对更新版 Node / Electron 运行时的依赖，与当前项目锁定的 Electron 版本存在兼容冲突——直接使用 v0.1.7 作为内置运行时会启动失败或运行异常。
- **当前建议**：内置 DSH 运行时维持 **v0.1.5-rc.3**（`scripts/fetch-runtime.ts` 的 `DSH_VERSION` 默认值），该版本与当前 Electron 完全兼容，已在本项目多轮审计中验证稳定。
- **后续升级路径**：待 Electron 升级迭代并确认支持 v0.1.7-rc.2 后，将 `DSH_VERSION` 切换至 `0.1.7-rc.2` 并重跑 `npm run runtime:force` 刷新内置运行时。届时同步更新本说明与 `scripts/fetch-runtime.ts` 的默认值。
- **用户影响**：通过安装包分发的终端用户无需任何操作，安装包内已预置兼容的 v0.1.5-rc.3 运行时。开发者本地刷新运行时（`npm run runtime:force`）时请勿手动指定 v0.1.7 系列版本。
- 版本号维持 **v1.0.0**（纯文档说明，无代码变更，按 §0 不推进版本号）。

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

### 二次审计修复 C1/R2/R1（2026-09-24 · 不推进版本号）

- **背景**：修复后二次五轴审计，缺陷清单为 1 Critical / 4 Required / 8 Optional / 7 Nit / 3 FYI。本轮修复 C1、R2、R1 三项。
- **C1 停止态失配 → 竞态下误报已停止 / 新进程被误杀**：`stop()` 虽已声明 `stopping` 状态，却仍复用 `setState('starting', '正在停止…')`，致渲染层 `busy`（依赖 `state === 'stopping'`）在整个停止窗口恒为假——「停止→启动」按钮解禁即可能产生孤儿子进程；渲染层 `STATE_LABEL.stopping` 与 CSS `.pill.stopping` / `.dot.stopping` 也始终是死代码。同时 `start()` 在停止未收尾时仍可重入，两段流程互相覆盖 `child` 句柄，且超时强制结束沿用 `this.child` 会杀掉刚起来的新进程、收尾无条件置 `stopped` 会误报已停止。现三处收口：① `stop()` 置入 `stopping` 态，并在收尾解除 `_stopping`（无子进程的早退分支同样解除）；② `start()` 增加 `_stopping` 重入闸门，停止未收尾一律拒绝启动；③ 强杀改为本次捕获的 `child`（`timedOut && this.child === child`），收尾前以 `this.child !== child` 早退，不覆盖接管进程的状态与 URL。至此 `stopping` 全链路（主进程 → 快照 → `STATE_LABEL` → CSS）真实可达，自检的状态枚举对齐项由 5 项升至 6 项。
- **R2 启动探活期无取消入口**：子进程起来后探活最长 60s，该窗口内所有按钮禁用，用户只能干等超时。现快照新增 `canStop`（`!!this.child`），渲染层在 `starting && canStop` 时放行「停止」，可发信号中止本次启动（`waitForReady` 在 ≤400ms 轮询内因 `this.child !== child` 返回，状态由退出事件落 `stopped`）；启动按钮不再自行弹「正在启动 DSH 服务…」提示，改由 `harness:state` 快照驱动，避免取消后仍弹启动提示。浏览器预览模式的占位快照同步补 `canStop: false`。
- **R1 主窗口缺 `will-navigate` 守卫**：主窗口仅挂 `setWindowOpenHandler`（只挡 `window.open`），页内 self 导航（如把文件拖入窗口）可把挂有 preload 的主窗口导航到外部来源，等于交出 `window.clawLite` 暴露面。现新增 `will-navigate` 守卫：打包态仅放行入口页 `dist/index.html` 本体（`sameFilePath` 按平台归一化比对，兼容 Windows 的 `/C:/…` 形态与大小写），开发态仅放行 `DEV_SERVER` 同源，其余 `preventDefault()` 并交系统浏览器。
- **已知残留**：`stop()` 若落在「端口分配 / 数据目录准备」这一极短窗口（尚无子进程）仍无进程可终止——该窗口渲染层不提供「停止」按钮，仅菜单项可触发，且会如实回到 `stopped`。如需彻底覆盖可在 `start()` 内引入取消标记，本轮按最小改动未引入。
- **文档同步**：`AGENTS.md` §4「状态机」（`stopping` 来源与探活期可取消）、§8「按钮可用性」、§11「受信任内容窗口导航加固」（扩展至主窗口）同步。
- **验证**：`node --check` 覆盖 `electron/harness.cjs` / `electron/main.cjs` / `src/main.js` / `electron/preload.cjs` 全部通过；`node scripts/check.mjs` 全绿（状态枚举对齐 6 项、IPC 三层 12 通道 / 2 事件 / 12 方法，仅 1 WARN 为本地未拉取内置 DSH 运行时，与本次改动无关）。
- 版本号维持 **v1.0.0**（同日同模块缺陷修复，按 §0 不推进版本号）。

### 二次审计 R4/R3/O1–O8/F1 门禁与其余项修复（2026-09-24 · 不推进版本号）

- **背景**：延续「二次审计修复 C1/R2/R1」，本轮按既定次序处理剩余全部条目——R4、R3、O1–O8 与 7 项 Nit、F1 门禁补齐。
- **R4 端口校验三处不一致 → 单一来源**：`index.html` 输入框为 1024–65535、`main.cjs` IPC 校验为 1–65535、渲染层 `Number(el.fPort.value) || 8799` 又会把 `0`/空/非法值静默改写成 8799。现将范围收敛到 `harness.cjs` 单一来源（新增并导出 `PORT_MIN = 1024` / `PORT_MAX = 65535` / `PORT_DEFAULT = 8799`），`pickPort` 钳制、`settings` 默认值、`main.cjs` 的 `harness:saveSettings` 校验、渲染层 `readPort()` 全部改用该来源；渲染层对非法输入显式回显「监听端口需为 1024-65535 的整数」，去掉 `||` 兜底。新增自检 §9 断言 `index.html` ↔ `harness.cjs` ↔ `src/main.js` 三方一致。
- **R3 文档与实现对齐**（随 C1 已修）：`AGENTS.md` §4 状态机条目改为双向可达表述（`setState` 取值 ⊆ 标签，且标签 ⊆ 取值，多出即死枚举），并注明校验由 `scripts/check.mjs` §7 承担；实测 6 个状态全部可达。
- **O1 次要文字对比度不足**：`--text-faint` 由 `#6b7383`（card 上 3.65:1，未达 AA）提到 `#7f8899`（4.88:1）；该令牌承载 11.5–12.5px 字段标签、卡片标题等小字。
- **O2 双 live region 重复播报**：`#status-pill` 去掉 `role="status" aria-live="polite"`，状态播报统一由状态主卡 `#hero-text` 承担；日志区保留 `role="log"` 但 `aria-live="off"`，避免逐行追加持续打断读屏。新增自检 §10 断言「播报区唯一」「日志区不播报」。
- **O3 toast 在 `display:none` 下赋值**：`toast()` 改为先 `classList.remove('hidden')` 再写 `textContent`，保证元素已在可访问树内，部分读屏不会漏播。
- **O4 reduced-motion 覆盖不全**：补 `.btn` / 输入控件的 `transition: none` 与 `.btn:active` 的 `transform: none`，与注释声明的「精确覆盖在用动效」对齐。
- **O5 日志逐行重排**：日志写入改为 `logQueue` + `requestAnimationFrame`（`flushLog`）合并，一帧内只做一次 `DocumentFragment` 追加与一次裁剪 / 滚动定位；`rebuildLog()` 重建前取消在帧任务并清空队列，避免重建后又被旧行追加。
- **O6 保存后未提示生效时机**：服务运行 / 启动探活期间保存设置时，toast 改为「设置已保存，将在下次启动 DSH 时生效」（端口等仅在下一次 spawn 读取）。
- **O7 `classify()` 误染红**：英文关键词要求「独立词 + 前置分隔符」（`ERR_WORD_RE`），中文 `错误`/`失败` 单独匹配（`ERR_CJK_RE`）。原 `/error/i` 会把 `/path/error-handler.js`、`token=errorless` 染成错误色。
- **O8 CSP `unsafe-inline` 说明**：`style-src` 的 `'unsafe-inline'` 确认为 Vite 开发模式注入 `<style>`（HMR）所必需，故不放宽脚本侧、也不在构建态特殊处理；改为在 `index.html`、`AGENTS.md` §4 显式注明来源与边界，并新增 §10 硬断言（`script-src` 仅 `'self'`、`connect-src` 仅 `'self'`）。
- **Nit 1 死样式**：移除 `main.css` 中 `classify()` 永不产出的 `.log .l-ok`；`--card-hover` 由 `#1c2029`（与 `--card` 差值极小、悬停不可辨）提亮为 `#222834`。
- **Nit 2 命令名误导**：`src/main.js` 的 `COMMANDS` 中 `harness_install`（实际映射 `api.verify()`）改名为 `harness_verify`，与通道 `harness:verify`、按钮语义一致。
- **Nit 3 回填不一致**：`el.fOpenMode.value` 回填补 `activeElement` 聚焦保护，与 `port`/`workspace`/`dshHome` 一致。
- **Nit 4 窗口几何写盘静默失败**：`persistNow()` 检查 `store.save()` 返回值，失败时写运行日志（`⚠ 窗口位置写入失败`）。
- **Nit 5 `broadcast` 群发**：收窄为仅推主窗口，不再把 `harness:state`/`harness:log` 外送到被托管的 dsh Web UI 窗口。
- **Nit 6 菜单 / autoStart 无 catch + 缺全局兜底**：新增 `safeHarness(action)`（同步 try/catch + 返回 Promise 的 catch 兜底），菜单三项与 autoStart 改走该包装；主进程注册 `process.on('unhandledRejection')` 作为最后一道网（落 `console.error` 与运行日志）。
- **Nit 7 文档滞后**：`README.md` 自检清单补齐 §7–§10 校验项与 `verify:dist`，配置表端口行补充范围；`AGENTS.md` §5 目录、§6 关键函数（`safeHarness`/`readPort`/`flushLog`/`classify`）、§11.2 图片、§11.4 console 豁免、§11.6 日志批处理、§12 自检与 CI 同步。
- **F1 门禁补齐（`scripts/check.mjs`）**：§7 状态枚举由单向包含改为**双向可达**（新增「无死枚举」断言，C1 类缺陷此后必被红灯拦下）；§8 新增日志着色类名 ↔ `main.css` **双向交叉**（同时拦死样式与死类名）；§9 新增端口范围**三方一致**；§10 新增**安全与无障碍基线硬断言**（`webPreferences` 逐块断言 `sandbox`/`contextIsolation`/`nodeIntegration:false`、CSP 脚本侧未放宽、`connect-src` 仅 `'self'`、播报区唯一、日志区不播报）。
- **F2 产物校验**：新增 `scripts/verify-dist.mjs`（`npm run verify:dist`），断言 `dist/index.html` 资源引用为相对路径、品牌图标真实产出到 `dist/assets/` 且被引用；CI 在 `build:web` 之后新增该步骤。
- **F3 埋点与规范张力**：`AGENTS.md` §11.4 显式豁免 `perfMark()` 启动埋点与 `unhandledRejection` 的 `console.error`。
- **已知边界**：`sandbox: true` 下渲染层不再有 Node 能力（本项目渲染层纯 DOM 操作，无回归）；O8 未在构建态剥离 `unsafe-inline`（需实机验证 dev HMR，改动收益小于风险）。
- **验证**：`node --check` 覆盖 `electron/`、`src/`、`scripts/` 全部脚本通过；`node scripts/check.mjs` 全绿（状态枚举双向 6 项可达、着色类名 2 项交叉、端口三方一致、安全基线全 PASS；仅 1 WARN 为本地未拉取内置 DSH 运行时）；`node scripts/verify-dist.mjs` 通过（`dist/assets/icon-DYtyWVWp.png` 已产出并被引用）。
- 版本号维持 **v1.0.0**（同日同模块缺陷修复，按 §0 不推进版本号）。

### TypeScript 化与源码后缀统一迁移（2026-09-25 · 不推进版本号）

- **背景**：源码此前混用 `.cjs`（主进程）/ `.mjs`（脚本）/ `.js`（渲染层）三种后缀，构建链与自检脚本各自适配，维护成本高。用户选定**路线 A：主进程纯 ESM**，目标为「`electron/`、`scripts/`、`src/` 源码一律 `.ts`，产物一律 `.js`，仓库不再出现 `.cjs` / `.mjs`」。
- **源码全量 TS 化**：`electron/main.ts`、`electron/preload.ts`、`electron/harness.ts`、`electron/settings.ts`、`src/main.ts`（新增 `src/env.d.ts` 声明 `window.clawLite` 桥契约）、`scripts/check.ts`、`scripts/verify-dist.ts`、`scripts/fetch-runtime.ts`、`vite.config.ts`；原 9 个 `.cjs` / `.mjs` / `.js` 源文件全部删除（`index.html` 入口同步指向 `/src/main.ts`）。
- **新增构建层 `scripts/build-electron.ts`（esbuild）**：产出 `dist-electron/main.js`（ESM）与 `dist-electron/preload.js`（CJS），并打印产物清单。`package.json` 的 `main` 改指 `dist-electron/main.js`，新增 `build:electron` / `build` 脚本，`start` / `dist*` / CI 均先构建再打包。新增 `tsconfig.json`（ESM + bundler 解析 + strict + `noEmit`，覆盖 `electron/` `scripts/` `src/`）。
- **主进程走纯 ESM**：路径基准由 `__dirname` 改为 `import.meta.url`（`MODULE_DIR` / `APP_ROOT` 推导），清除全部 `require`；根 `package.json` 保留 `type:module`（撤掉反而会请回 `.mjs`）。
- **preload 是唯一例外**：产物 `preload.js` 由 Electron 按 CJS 加载（Electron 忽略 `type:module`，仅按 preload 语义处理），这也是 `sandbox:true` 下唯一可行形式（ESM preload 必须 `.mjs` 且要求 `sandbox:false`，不可用于本项目）。安全基线 `sandbox` / `contextIsolation` / `nodeIntegration:false` 三项未动。
- **脚本层直跑 `.ts`**：`scripts/*.ts` 依赖 node 原生类型擦除直接执行（无编译步骤），故本机与 CI 需 node ≥ 24——`.github/workflows/release.yml` 的 `node-version` 由 `22` 提到 `24`，并在 `npm ci` 后新增「构建主进程产物」步骤（自检与打包都要吃 `dist-electron/`）。
- **门禁升级（`scripts/check.ts`）**：新增三类断言——① **源码后缀门禁**（`electron/` `scripts/` `src/` 无残留 `.cjs` / `.mjs` / `.js`，本次实测 11 个源文件全为 `.ts` / `.d.ts` / `.css`）；② `tsc --noEmit` **类型检查**；③ **产物模块形态**（主进程产物必须有 `import` 且无 `require`，preload 产物必须有 `require` 且无 `import`/`export`）。原 §7 状态枚举双向、§8 类名交叉、§9 端口三方、§10 安全基线断言全部保留。
- **打包与忽略**：`electron-builder.yml` 的 `files` 由 `electron/**/*` 改为 `dist-electron/**/*`（`.ts` 源码不再随包分发）；`.gitignore` 增补 `dist-electron/`。
- **文档同步**：`AGENTS.md`（强制规范新增「源码后缀统一」条、架构分层、文件结构树、关键函数表、命名与 ESM 主进程规范）、`README.md`（架构表新增「源码与产物」说明、前置要求 node ≥ 24、自检覆盖清单、目录结构树）逐项对齐。本文件 2026-09-24 的历史分节按「历史只增不改」保留原有 `.cjs` / `.mjs` 路径记述。
- **验证**：`tsc --noEmit` 无类型错误；`npm run build` 成功（`dist-electron/main.js` 头部为 ESM `import`、`preload.js` 为 CJS）；`npm run check` **全绿**（1 项 WARN 为本地未拉取内置 DSH 运行时，与本次改动无关）；`npm run verify:dist` 通过；**真实启动冒烟**通过（`perf app-ready +46ms` / `perf window-ready +246ms`，渲染层无 console 报错）；**preload 桥探针**通过（沙箱与隔离与生产一致，`window.clawLite` 暴露 12 方法 + 2 事件，`window.require` / `window.process` 均未泄漏）。
- 版本号维持 **v1.0.0**（用户明确「版本暂维持 v1.0.0」，按 §0 不推进版本号）。

---

> 后续迭代分节追加于此文件顶部，格式同上（日期 + 状态 + 版本号是否推进的说明）。
