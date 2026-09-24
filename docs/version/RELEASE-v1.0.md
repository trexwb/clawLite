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

- macOS 包默认不签名 / 未公证，首次打开需右键「打开」绕过 Gatekeeper
- 依赖树约 300MB，安装包体积较大（压缩后 dmg 约 150MB）
- 内置 DSH 版本由 `scripts/fetch-runtime.mjs` 的 `DSH_VERSION`（当前 `0.1.5-rc.3`）决定，升级需重跑 `npm run runtime:force`

---

> 后续迭代分节追加于此文件顶部，格式同上（日期 + 状态 + 版本号是否推进的说明）。
