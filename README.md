# Claw Lite

**DeepSeek Harness 桌面宿主** —— 把官方 `@deepseek-ai/dsh` 本地化打包进 Electron 应用，
用户安装后**无需单独安装 Node 环境**即可直接使用 dsh web。

![Claw Lite 图标](app-icon.png)

## 为什么是 Electron

| 关注点 | 方案 |
|---|---|
| Node 运行时 | Electron 自带 Node（v24），`ELECTRON_RUN_AS_NODE` 直接复用，**不再外挂 node 二进制** |
| DSH 运行时 | 官方 `@deepseek-ai/dsh` 依赖树预置在 `resources/dsh/app`，随安装包分发，不走 npm 在线安装 |
| 原生模块 | DSH 依赖树含 `node-pty` / `sharp` 等平台相关原生模块，置于 asar 之外（`extraResources`）以保证 `.node` 以真实文件存在 |
| 平台差异 | 依赖树在各自平台的构建机上安装（CI matrix：macOS arm64 / Windows x64） |

## 功能

- **一键托管 DSH**：启动 / 停止 / 重启 dsh web 子进程，实时状态与日志流
- **免装 Node**：解释器即应用自身（Electron 内置 Node），开箱即用
- **自动捕获访问地址**：从 dsh 输出解析带 `token` 的完整 URL（Web UI 的信任凭据）
- **两种打开方式**：应用内窗口（`persist:dsh-web` 分区，登录态留存）或系统浏览器
- **运行时可配置**：端口、工作目录、DSH_HOME、开机自启、启动后是否自动打开界面
- **自动更新**：electron-updater + GitHub Releases

## 架构

| 层 | 文件 | 职责 |
|---|---|---|
| 主进程 | `electron/main.cjs` | 单实例锁、窗口、IPC 路由、菜单、生命周期、更新检查 |
| 桥 | `electron/preload.cjs` | `contextBridge` 暴露 `window.clawLite`（12 个方法 + 2 个事件） |
| 运行时托管 | `electron/harness.cjs` | `HarnessManager`：dsh 子进程 spawn / 探活 / 日志 / 状态机 / 优雅停止 |
| 设置 | `electron/settings.cjs` | 配置持久化（userData/settings.json） |
| 渲染层 | `src/` + `index.html` | Vite 构建到 `dist/`，深色控制台 UI |
| 内置运行时 | `resources/dsh/` | `app/node_modules/@deepseek-ai/dsh` + `runtime.json` 清单 |

**关键实现点**：dsh web 依赖 Node 内部 binding，spawn 时必须带 `--expose-internals`，否则 web profile 加载失败退出。

## 快速开始

前置要求：Node ≥ 20（仅开发需要；终端用户无需任何环境）。

```bash
npm install            # 安装依赖
npm run runtime        # 拉取内置 DSH 依赖树到 resources/dsh（约 300MB，首次必需）
npm start              # 构建渲染层 + 启动应用
```

开发模式（渲染层热更新）：

```bash
npm run dev            # Vite dev server
CLAWLITE_DEV_SERVER=http://localhost:1420 npm run electron
```

## 安装（终端用户）

1. 下载 `Claw-Lite-<版本>-arm64.dmg`（Apple Silicon）或 `Claw-Lite-Setup-<版本>.exe`（Windows）
2. 打开 dmg，**把 Claw Lite 拖入「应用程序」文件夹** —— 不要直接从磁盘映像里双击运行
3. 首次打开若提示「无法验证开发者」：右键点击应用图标 → 选择「打开」→ 确认

> macOS 限制：应用从 DMG 只读卷直接运行时，系统不允许其拉起内置运行时。
> 应用已内置检测，遇到这种情况会主动提示并引导你完成拖入步骤。

## 打包

```bash
npm run dist:mac       # macOS：dmg + zip
npm run dist:win       # Windows：NSIS 安装器
npm run dist:linux     # Linux：AppImage
npm run dist           # 当前平台
```

产物输出到 `release/`。macOS 本地打包默认不签名（`CSC_IDENTITY_AUTO_DISCOVERY=false`），
正式分发需在具备证书的机器上签名 / 公证。

## CI 流水线

`.github/workflows/release.yml`：推送 `v*` tag（或手动触发）后，
在 macOS / Windows runner 上分别执行 `npm ci → npm run runtime → npm run check → npm run build:web → electron-builder`，
产物汇总后由 `publish` job 创建 GitHub Release。

## 自检

```bash
npm run check
```

覆盖：JSON 合法性、关键文件存在性、全部 JS 语法（`electron/`、`scripts/`、`src/`）、
**IPC 契约三层对齐**（渲染层 `api.*` → preload 暴露方法 → 主进程 `ipcMain.handle` 通道 / `broadcast` 事件）、
内置 DSH 运行时完整性、无残留 Tauri 依赖。

## 配置

配置文件位于 `userData/settings.json`（macOS：`~/Library/Application Support/Claw Lite/settings.json`）。

| 项 | 默认 | 说明 |
|---|---|---|
| 端口 | `8799` | dsh web 监听端口 |
| 工作目录 | 用户主目录 | dsh 的工作目录 |
| DSH_HOME | userData/dsh-home | DSH 数据目录（留空则用默认） |
| 开机自启 | 关 | 应用启动后自动拉起 dsh |
| 打开方式 | 应用内窗口 | 或系统浏览器 |

## 目录结构

```
clawLite/
├─ electron/
│  ├─ main.cjs            # 主进程入口
│  ├─ preload.cjs         # contextBridge 桥
│  ├─ harness.cjs         # HarnessManager（dsh 子进程托管）
│  └─ settings.cjs        # 设置持久化
├─ src/                   # 渲染层（Vite 构建到 dist/）
├─ resources/dsh/         # 内置 DSH 运行时（app/ + runtime.json）
├─ scripts/
│  ├─ fetch-runtime.mjs   # 拉取 / 刷新内置 DSH 依赖树
│  └─ check.mjs           # 静态自检
├─ build/                 # 打包资源（图标、entitlements）
├─ electron-builder.yml   # 打包配置
└─ .github/workflows/     # CI（构建 + 发布）
```

## 已知限制

- macOS 包未签名 / 未公证，首次打开需右键「打开」绕过 Gatekeeper
- 依赖树约 300MB，安装包体积较大（压缩后 dmg 约 150MB）
- 内置 DSH 版本由 `scripts/fetch-runtime.mjs` 的 `DSH_VERSION` 决定，升级需重新执行 `npm run runtime:force`
