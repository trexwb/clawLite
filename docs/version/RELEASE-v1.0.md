# Claw Lite · v1.0 发布日志

> 版本号单一来源：`package.json` 的 `version` 字段。
> 本文件仅记录发布历史，最新分节在最前；历史内容只增不改。
> 版本纪律见 [README.md](README.md) 与 `AGENTS.md` §0。

---

## v1.0.2 — 状态广播与日志渲染性能优化 + 功能闭环补齐（2026-09-28 · 📝 待发布 · 🔚 项目收尾版）

- **日期**：2026-09-28
- **状态**：📝 待发布 · 🔚 项目收尾版（本项目最后一个版本）
- **版本号**：`package.json` 由 `1.0.1` → `1.0.2`（修订号：向后兼容的性能修复、功能缺口补齐与文档修正；无架构改动、无新增/移除依赖、无既有 IPC 签名改动）。
  - 本次维护按用户指令将版本号**统一回退为 `1.0.2`**：同日曾因功能缺口补齐一度推进至 `1.0.3`，现该分节内容整体并入本分节；`package.json` / `package-lock.json` 根包、`AGENTS.md`、`README.md`、`CLAUDE.md`、`docs/version/` 中的版本表述一律以 `1.0.2` 为准，仓库内不再保留 `1.0.3` 表述。
- **范围**：`electron/harness.ts`、`electron/main.ts`、`electron/preload.ts`、`src/main.ts`、`src/env.d.ts`、`index.html`、`scripts/build-electron.ts`、`package.json` / `package-lock.json`、`AGENTS.md`、`README.md`、`CLAUDE.md`、`docs/version/`
- **说明**：本版包含两部分——①主进程状态广播与渲染层日志渲染的性能优化；②依据项目审查报告修复 7 项已确认问题（4 项功能闭环缺口 + 3 项框架/文档漂移）。**本版为项目收尾版本，发布后不再有后续迭代**（见下「项目收尾说明」）。

### 项目收尾说明（🔚 后续不再更新）

DeepSeek 官方已发布 **DeepSeek Harness 桌面版**（`deepseek-harness desktop`，官方版本 `0.1.7-rc.2`，提供 Windows x64 与 macOS (Apple Silicon) 安装包），官方桌面版已覆盖本项目原有的「免装 Node 直接使用 dsh web」场景。**本项目（Claw Lite）的性质为官方桌面版发布之前的自主研究探索，后续不再更新**——不再跟进 DSH 版本演进、不再新增功能、不再发布新版安装包，应用版本号冻结在 **v1.0.2**。如需正式使用，请下载官方版本：

- **Windows (x64)**：<https://download.deepseek.com/dsh-desk/bin/win-x64/deepseek-harness-0.1.7-rc.2-win-x64.exe>
- **macOS (Apple Silicon)**：<https://download.deepseek.com/dsh-desk/bin/mac-arm64/deepseek-harness-0.1.7-rc.2-mac-arm64.dmg>

> 收尾后如无用户明确指令，不再在本文件追加新分节；历史分节按「只增不改」原则保留。

### 本期内容（一）功能闭环补齐与文档对齐（审查报告 7 项修复）

- **自动更新闭环（功能缺口）**：`electron/main.ts` 在既有 `autoUpdater.on('error')` 之外补 `autoUpdater.on('update-downloaded')`——写运行日志并广播新事件 `updater:downloaded`（携带 `{ version }`）；`electron/preload.ts` 新增订阅方法 `onUpdateDownloaded`；`index.html` 顶栏新增默认隐藏的「立即重启并安装」按钮，渲染层收到广播后亮出，点击调用此前已存在但无入口的 `relaunch()`（`app:relaunch` → `app.relaunch() + app.quit()`，dsh 子进程经 `before-quit` 优雅停止）。原先 `autoInstallOnAppQuit` 只在退出时静默安装，应用内无任何反馈，链路断在半程。
- **版本清理入口（功能缺口）**：版本管理区新增「清理未使用版本」按钮，调用已实现但无调用方的 `harness:pruneVersions`；`keep` 传「当前运行版本 + 下载中任务的版本」（后者可能已下载完成尚未切换，不能当场删除），点击前 `window.confirm` 二次确认，结果以 toast 反馈（`已清理 N 个未使用版本` / `没有可清理的旧版本`）。
- **应用信息展示（功能缺口）**：页脚在原有 DSH 版本之外新增 `#foot-app`，由 `app:info` 填充「Claw Lite 版本 · Electron 版本 · Node 版本」；仅在启动时读取一次（进程生命周期内不变），失败不打断主流程，降级为「应用信息读取失败」占位。
- **渲染进程崩溃恢复（功能缺口）**：`createMainWindow()` 补 `render-process-gone` 监听——渲染进程崩溃（OOM / 原生模块段错误）后窗口只剩空白且 Electron 不会自愈；监听内先 `harness.log()` 写入运行日志留痕（重载后渲染层回填历史，原因可直接在界面看到），窗口未销毁时 `webContents.reload()` 重建界面（界面对主进程状态零持有，重载即恢复）。
- **构建目标修正（框架漂移）**：`scripts/build-electron.ts` 的 esbuild `target` 由 `node22` 改为 `node24`，注释同步为实测的「Electron 44 内置 Node（24.x，实测 24.21.0）」（原注释与实测不符）。本机 esbuild 支持 `node24` 目标，构建验证通过。
- **`engines` 声明（框架漂移）**：`package.json` 新增 `"engines": { "node": ">=24.0.0" }`，与 README「前置要求：Node ≥ 24」及 `scripts/*.ts` 依赖 node 原生类型擦除直跑的事实对齐。
- **`AGENTS.md` 滞后修订（文档漂移）**：preload 暴露面「12 方法 + 2 事件」修正为 17 方法 + 4 事件；§4 IPC 契约补齐版本管理 5 方法与 `onVersionProgress` / `onUpdateDownloaded` 订阅，广播清单补 `harness:versionProgress` / `updater:downloaded`；§5 目录树与 §6 清单补 `electron/version-fetch.ts`、`electron/version-download.ts`、`src/shared/constants.ts` 及 `HarnessManager.listVersions/prepareVersion/applyVersion/cancelVersion/pruneVersions`、`downloadVersion`、`fetchLatestVersion/fetchAllVersions`、`resolveNpmCli`；§1 依赖表述由「仅 electron 与 electron-updater」修正为与 `package.json` 实际依赖（`electron-updater` + `npm`）一致；§11.5 新增「渲染进程崩溃自愈（禁止移除）」条目；§0「当前基准版本」同步为 v1.0.2，并补「项目已收尾（版本号冻结）」说明。
- **`README.md` 同步**：架构表桥的暴露面计数修正为 17 方法 + 4 事件、补「版本管理」一行；功能清单补「DSH 版本管理」「界面崩溃自愈」，自动更新条目补「立即重启并安装」入口。
- **`package-lock.json` 同步**：根包 `name`/`version` 字段由 `1.0.1`（此前版本号提升时漏同步）更新为 `1.0.2`，与 `package.json` 保持一致；未新增/变更任何依赖及其版本。

### 本期内容（二）状态广播与日志渲染性能优化

- **状态广播帧不再携带日志正文**：`HarnessManager.snapshot()` 新增 `includeLogs` 参数（默认 `true`，保持请求/响应式通道语义不变）；`setState()` 与 `_captureUrl()` 这两条高频推送路径改用 `snapshot(false)`，`electron/main.ts` 中 `harness:saveSettings` 的广播同步调整为 `harness.snapshot(false)`。日志本身始终由独立的 `harness:log` 逐行通道送达，原先每帧额外重复搬运一份完整缓冲。
- **`dshVersion` 读取改为记忆化**：新增 `_versionCache` / `_versionCacheRoot`，以运行时根目录为缓存键；仅在读取成功时写入，目录变化（切换版本）自动失效。此前每次 `snapshot()` 会做 2 次 `readFileSync` + `JSON.parse`（同一份 package.json 被 `checkRuntime()` 与快照字段各读一次）。
- **渲染层日志区不再逐帧全量重建**：`onState` 的重建判断改为「仅当主进程确实给了整段日志」才执行。原先缓冲区满后长度恒为 `LOG_LIMIT` 且首行不断滚动，`truncated` 被判为恒真，导致每个状态帧都清空并重建整片日志区（连带打掉用户滚动位置）。
- **历史日志回填改由 `boot()` 显式执行**：广播帧不再带日志后，原先「靠下一个状态帧顺便回填历史日志」的时机失效，`harness:snapshot` 的返回值处显式调用 `rebuildLog(snap.logs)`，保证界面加载与重载后历史日志仍完整。
- **`render()` 改为脏值写入**：新增 `setText` / `setClassName` / `setDisabled` / `setInputValue` / `setChecked` 五个写入助手，赋值前先比对，值未变则跳过，消除每帧无谓的样式失效与表单控件写入。

### 未改动项（明确区分，避免误改）

- **架构与依赖**：未新增 / 移除任何依赖；`electron-builder.yml`、`.github/workflows/release.yml`、`vite.config.ts`、`index.html` 的 CSP、`resources/dsh` 内置运行时（`DSH_VERSION` 仍为 `0.1.5-rc.3`）均未改动。
- **既有 IPC 契约**：`harness:*` / `dialog:pickDirectory` / `updater:check` / `app:relaunch` / `app:info` 的通道名、参数与返回值均未变，仅新增 `updater:downloaded` 广播与 `onUpdateDownloaded` 订阅（只增不改）；`window.clawLite` 契约与 `src/env.d.ts` 类型声明随新增项同步，无删改。
- **状态机与下载阶段枚举**：`HarnessState` 六态与 `DOWNLOAD_PHASES` 七阶段取值不变，仅调整快照构造时的负载。
- **`electron/harness.ts` 版本管理实现**：`pruneVersions` 等既有实现未改动，本版只补调用入口（按钮）与文档。
- **`resources/dsh` 内置运行时**：`fetch-runtime.ts` 的 `DSH_VERSION` 与依赖树 `package.json` 版本均未改动。
- **构建脚本**：`scripts/build-electron.ts` 仅调整 esbuild `target`（`node22` → `node24`）与注释，构建流程与产物结构未变。
- **项目状态**：无 `git commit`，改动保持未提交状态。

### 验证

- `npm run check` **全部通过 ✔**：51 项全绿（含 `tsc --noEmit` 类型检查、IPC 三层对齐 `17 个通道 / 4 个事件 / 21 个方法`、状态枚举与下载阶段双向可达、安全与无障碍基线），无失败无告警。
- `npm run build`（`build:electron` + `build:web`）成功：`dist-electron/main.js` 53.4kb（ESM）、`dist-electron/preload.js` 2.1kb（CJS）、`dist/assets/index-*.js` 14.73 kB、`dist/assets/index-*.css` 10.50 kB、`dist/index.html` 10.84 kB，构建耗时 54ms。
- `npm run verify:dist` **产物校验通过 ✔**：`dist/index.html` 存在、资源引用为相对路径、品牌图标已产出并被引用。
- 性能实测见 `docs/perf-audit-2026-09-28.md`（含测量口径与受限说明）。
- 版本一致性：`package.json` / `package-lock.json`（根包）均为 `1.0.2`，`AGENTS.md` §0、`README.md`、`CLAUDE.md`、`docs/version/` 表述同步为 `v1.0.2`，仓库内已无 `1.0.3` 残留表述（第三方依赖版本号 `1.0.3` 不属应用版本，未改动）。

---

## v1.0.1 — 正式发布后切换至语义化版本迭代（2026-09-25 · ✅ 已发布）

- **日期**：2026-09-25
- **状态**：✅ 已发布
- **版本号**：`package.json` 由 `1.0.0` → `1.0.1`（项目正式发布后的首个修订号迭代）
- **范围**：版本纪律由「发布前冻结、末位 +1 需用户明确允许」切换为「正式发布后按语义化版本正常迭代」，并同步更新全部相关文档

### 本期内容

- **应用版本号推进**：`package.json` 的 `version` 提升至 `1.0.1`。版本号单一来源不变——`electron-builder.yml` 的产物名 `${version}`、`app.getVersion()` 与 `app:info` 均读此值，故打包产物名相应变为 `Claw-Lite-1.0.1-<arch>.dmg` / `Claw-Lite-Setup-1.0.1.exe`。
- **`AGENTS.md` §0 版本纪律改写**：基准版本更新为 **v1.0.1（已正式发布）**；原「末位 +1 的唯一场景 + 写死不 +1 的禁止清单」替换为按语义化版本（SemVer）正常迭代——主版本对应不向后兼容的破坏性变更、次版本对应向后兼容的新功能、修订号对应向后兼容的修复与文档 / 样式等非功能性改动；保留并强化四条不变式：版本号单一来源、每次迭代必须写发布日志（只增不改）、用户要求回退 / 指定版本号时以用户指令为准、DSH 运行时版本为独立维度；新增「内置 DSH 依赖树自身的 `package.json` 的 `version` 不属于应用版本，不得随应用版本号改动」。同步修正 §3「编辑策略」与 §10「用户偏好」中引用旧规则的表述。
- **`docs/version/README.md`**：版本纪律段与日志索引表同步为发布后口径（当前基准 v1.0.1，v1.0 日志状态 ✅ 已发布），「约定」段由「发布前 / 发布后」改为「每次迭代 / 发布后」。
- **`docs/version/RELEASE-v1.0.md`**：本分节按只增不改原则追加于文件顶部；v1.0.0 分节的状态标记由 📝 待发布 更新为 ✅ 已发布（2026-09-25 正式发布），正文内容未改动。
- **`docs/wiki/` 与 `docs/case/`**：`自检与发布流程` §六「版本纪律与发布日志」、`常见问题`「改了代码要写发布日志吗」、`案例-用-dsh-开发-Claw-Lite` §七与 `CASE-dsh-clawlite.md` §7 的版本纪律表述同步为发布后语义化版本口径，并保留对发布前 v1.0.0 基线阶段更严口径的历史说明。

### 未改动项（明确区分，避免误改）

- **内置 DSH 依赖树自身的 `package.json` 的 `version`**：`resources/dsh/app/package.json`（`1.0.0`）与 `resources/dsh/app/node_modules/@deepseek-ai/dsh/package.json` 均保持原值；`scripts/fetch-runtime.ts`、`electron/version-download.ts` 中生成依赖树清单时写入的 `version: '1.0.0'` 同属依赖树维度，亦未改动。
- **内置 DSH 运行时版本**：`scripts/fetch-runtime.ts` 的 `DSH_VERSION` 维持 `0.1.5-rc.3`（`resources/dsh/runtime.json` 记录一致），不随应用版本变动。
- **源码逻辑、构建配置与 CI**：`electron/`、`src/`、`scripts/` 的业务逻辑，`electron-builder.yml`、`.github/workflows/release.yml` 均未改动；`README.md` 不含硬编码应用版本号，无需同步。

### 验证

- `npm run build`（`build:electron` + `build:web`）成功：`dist-electron/main.js`（ESM）、`dist-electron/preload.js`（CJS）、`dist/` 渲染层产物均正常生成。
- `npm run check` **全部通过 ✔**（JSON / 关键文件 / 源码后缀门禁 / `tsc --noEmit` 类型检查 / IPC 三层对齐 / 状态枚举双向可达 / 日志着色类名与 CSS 交叉 / 端口范围一致 / 安全与无障碍基线 / 产物模块形态 / 下载阶段枚举双向可达，无失败无告警）。
- `npm run verify:dist` 产物校验通过 ✔（`dist/index.html` 资源引用为相对路径、品牌图标已产出并被引用）。

---

## v1.0.0 — 初始基线（✅ 已发布）

- **日期**：2026-09-24
- **状态**：✅ 已发布（2026-09-25 正式发布；正文按只增不改原则未作改动）
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

### 实践案例文档与 GitHub Wiki 文件集（2026-09-25 · 不推进版本号）

- **背景**：项目此前只有 `README.md`（功能与操作）与 `docs/version/`（版本迭代日志），缺少「怎么用 dsh 把本项目做出来」的经验记录，也没有面向 GitHub Wiki 的发布物料。
- **新增 `docs/case/`（实践案例）**：`CASE-dsh-clawlite.md` 为主案例——开发侧（dsh 会话即开发入口、`AGENTS.md` 作为规范基线、每轮产出必须过门禁）、产物侧（主控制面板 → `HarnessManager` 托管链路与界面元素源码出处对照）、一轮会话的完整路径、六条踩坑记录（`--expose-internals`、token 必须整条捕获、preload 只能 CJS、dsh 0.1.7 兼容冲突、约 300MB 依赖树不进 asar、EventEmitter 异步 `error` 击穿主进程）、三层门禁与版本纪律；同目录 `README.md` 为案例索引，并说明截图素材与 wiki 发布方式。
- **新增 `docs/wiki/`（可直接发布的 GitHub wiki 文件集）**：`Home.md`、`_Sidebar.md`、`_Footer.md` 与内容页（案例、快速开始、架构总览、DSH 版本管理与热切换、自检与发布流程、常见问题），页面之间以 `[[页面名]]` 互链，页面名与文件名严格一致。
- **截图引用**：案例文档引用 `docs/images/0.png`（主控制面板）与 `docs/images/1.png`（dsh web 新会话界面）；wiki 侧图片随包复制到 `docs/wiki/images/`（wiki 与主仓库是两个独立 git 仓库，图片不随包提交会 404）。两处一律使用仓库内相对路径，不写绝对路径、不使用外链。
- **未改动**：源码、构建脚本、`package.json`、CI 与 `docs/images/` 原图均未变动。
- 版本号维持 **v1.0.0**（仅文档更新，按 §0 不推进版本号）。

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
