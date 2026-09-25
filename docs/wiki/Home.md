# Claw Lite Wiki

**Claw Lite 是 DeepSeek Harness（dsh）的桌面宿主。** 它把官方 `@deepseek-ai/dsh` 依赖树本地化打包进 Electron 应用，用户**无需单独安装 Node 环境**即可直接使用 dsh web。

![Claw Lite 主控制面板](images/0.png)

## 这是什么

| 关注点 | 方案 |
|---|---|
| Node 运行时 | 直接用 Electron 自带的 Node（v24），`ELECTRON_RUN_AS_NODE=1` 让应用自身充当解释器，不外挂 node 二进制 |
| DSH 运行时 | 官方依赖树预置在 `resources/dsh/app`，随安装包分发，用户侧不走 npm 在线安装 |
| 原生模块 | 依赖树含 `node-pty` / `sharp` 等平台相关模块，置于 asar 之外以保证 `.node` 以真实文件存在 |
| 平台构建 | 依赖树在各自平台的构建机上安装（CI matrix：macOS arm64 / Windows x64） |

## 核心能力

- **一键托管 DSH**：启动 / 停止 / 重启 dsh web 子进程，实时状态与日志流
- **免装 Node**：解释器即应用自身，开箱即用
- **自动捕获访问地址**：从 dsh 输出解析带 `token` 的完整 URL（Web UI 的信任凭据）
- **两种打开方式**：应用内窗口（`persist:dsh-web` 分区，登录态留存）或系统浏览器
- **DSH 版本管理与热切换**：设置页选定版本后立即异步下载并显示进度，下载完成即可切换启动，无需重启应用
- **运行时可配置**：端口、工作目录、DSH_HOME、开机自启、启动后是否自动打开界面
- **自动更新**：electron-updater + GitHub Releases

## 页面导航

| 页面 | 内容 |
|---|---|
| [[案例-用-dsh-开发-Claw-Lite]] | 实践案例：用 dsh 会话开发出 Claw Lite 的完整闭环、踩坑记录与工程门禁 |
| [[快速开始]] | 终端用户安装指引 + 开发者上手命令 |
| [[架构总览]] | 进程模型、IPC 契约三层对齐、状态机、数据流 |
| [[DSH-版本管理与热切换]] | 版本列表、异步下载与进度上报、切换生效时机 |
| [[自检与发布流程]] | `npm run check` / `verify:dist` / CI / 打包 |
| [[常见问题]] | 安装被拦、dsh 起不来、端口冲突、体积与版本等高频问题 |

## 仓库

- 源码：<https://github.com/trexwb/clawLite>
- 版本迭代日志：仓库内 `docs/version/RELEASE-v{主版本}.md`
