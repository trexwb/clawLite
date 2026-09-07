# Claw Lite

参考 AutoClaw 的极简桌面 AI 助手：**DeepSeek 对话 + 本地工作目录办公**。
Tauri v2 + 原生 JavaScript（Vite 构建），无前端框架，安装包轻、启动快。

![Claw Lite 图标](app-icon.png)

## 功能

- **AI 对话（DeepSeek）**：流式输出（SSE），支持 deepseek-chat / deepseek-reasoner / 自定义模型；OpenAI 兼容端点可自行改 API 地址
- **本地目录办公**：AI 可在授权的工作目录内 `list_dir` / `read_file` / `write_file` / `create_dir` / `search_files`，**删除文件需双重确认**（AI 先征得同意 + 界面确认弹窗）
- **路径沙箱**：所有文件命令在 Rust 侧校验 canonicalize 后必须位于工作目录内，越界一律拒绝
- **多任务会话**：左侧栏任务列表，自动以首条消息命名，双击改名，删除有确认；会话存 localStorage，重启保留
- **设置**：API Key（本地保存）、API 地址、模型、温度、工作目录（系统目录选择器），带「测试连接」
- **浏览器演示模式**：无 Tauri 环境直接 `npm run dev` 也能看界面——内置 mock 后端与确定性演示回复

## 技术栈与架构

| 层 | 文件 | 职责 |
|---|---|---|
| 桥接 | `src/core/bridge.js` | Tauri IPC / 浏览器 mock 双模式；目录选择；HTTP（plugin-http 免 CORS） |
| AI | `src/core/ai.js` | SSE 流式解析、工具调用循环（≤12 轮）、错误处理、mock 演示 |
| 工具 | `src/core/tools.js` | 6 个工具的 JSON Schema、执行与摘要、系统提示词 |
| 存储 | `src/core/store.js` | 会话（localStorage）+ 配置（Rust config.json） |
| 渲染 | `src/core/markdown.js` | 安全 Markdown（先转义后转换） |
| 界面 | `src/ui/*.js` + `index.html` + `src/styles/main.css` | 侧栏 / 聊天 / 设置 / 确认弹窗 / Toast |
| 后端 | `src-tauri/src/lib.rs` | 10 条命令：工作目录、文件办公（沙箱）、配置持久化 |

设计语言：Build 奢侈极简——暖纸白底、发丝分隔线、唯一强调色（焦橙 #C8501B）、70%+ 留白。

## 快速开始

前置要求：Node ≥ 20、Rust（`rustup` 安装）、macOS 或 Windows。

```bash
npm install          # 安装依赖
npm run tauri dev    # 开发模式（首次会编译 Rust，需数分钟）
npm run tauri build  # 打包安装包
```

浏览器预览界面（不连真实 AI）：

```bash
npm run dev          # http://localhost:1420，mock 模式演示
```

## 配置

首次启动会自动打开设置：

| 项 | 说明 |
|---|---|
| API Key | 在 [platform.deepseek.com](https://platform.deepseek.com) 创建；仅保存在本地配置文件 |
| API 地址 | 默认 `https://api.deepseek.com`（可换任意 OpenAI 兼容端点） |
| 模型 | `deepseek-chat`（支持工具调用）/ `deepseek-reasoner`（不支持工具，自动关闭工具）/ 自定义 |
| 温度 | 0–2，默认 0.7 |
| 工作目录 | AI 的文件操作范围；建议选一个专用文件夹 |

配置存放位置（macOS）：`~/Library/Application Support/com.trexwb.clawlite/config.json`。

## 使用指南

- **输入框**：Enter 发送；Shift / Ctrl / ⌘ + Enter 换行；中文输入法组词中的 Enter 不会误发
- **工具卡片**：AI 每次文件操作都会在回复前显示一张卡片（操作名 + 摘要），点击可展开参数
- **删除保护**：AI 会先在回复里说明要删除什么并征得你同意，真正执行时界面还会弹确认框
- **建议任务**：空态页的快捷任务（列目录 / 整理纪要 / 总结 CSV / 写周报）点击即发送

## 安全模型

1. 文件命令全部由 Rust 执行，路径先 canonicalize 再校验 `starts_with(工作目录)`，`..`、符号链接逃逸、绝对路径越界均被拒绝
2. `read_file` 默认上限 256KB 且拒绝二进制；`search_files` 限制遍历 2 万文件 / 命中 300 条 / 单文件 1MB
3. 删除是唯一破坏性操作，双重确认（AI 征求同意 → 界面确认弹窗）
4. API Key 明文存于本机用户配置目录（与大多数本地桌面工具一致）；请勿把该目录纳入同步/备份到不受信位置
5. 网络访问白名单：`https://**` + `http://localhost:*`（Tauri capability 层限制）

## 验证结果

| 验证项 | 结果 |
|---|---|
| `node scripts/check.mjs`（JSON 合法性 / 全部 JS 语法 / JS↔Rust 命令对齐） | ✅ 全部 PASS |
| `vite build` 前端构建 | ✅ 138ms 通过，产出 dist/ |
| 无头 Chrome 交互测试（`scripts/preview-check.mjs`，mock 模式） | ✅ 13/13 PASS（空态、发送、流式、工具卡片展开、刷新持久化、设置弹窗、Esc 关闭） |
| `cargo check` Rust 编译 | ✅ EXIT 0 · 0 warning（修复 `pub async fn` 宏冲突后） |
| 独立复核 Rust（review-rust） | ✅ 1 项严重（写路径符号链接逃逸）已修复 · 7 项建议已采纳 |
| 独立复核 前端（review-frontend） | ✅ 2 项严重（流式双倍输出 / 确认弹窗竞态）已修复 · XSS 与 Key 处理核验通过 |

## 修改指南

| 想改什么 | 改哪里 |
|---|---|
| 配色 / 字体 / 间距 | `src/styles/main.css` 顶部 `:root` 变量 |
| 增加工具（如重命名、移动） | `src-tauri/src/lib.rs` 加命令 → `CONTRACT.md` 登记 → `src/core/tools.js` 加 Schema 与 executeTool 分支 → `bridge.js` 加 mock |
| 换模型默认值 | `src-tauri/src/lib.rs` `Config::default` + `src/core/store.js` `DEFAULT_CONFIG` |
| 系统提示词 | `src/core/tools.js` `buildSystemPrompt` |
| 窗口尺寸 / 标题 | `src-tauri/tauri.conf.json` `app.windows` |
| 应用图标 | 替换 `app-icon.png` 后重跑 `npx tauri icon app-icon.png` |

## 已知限制

- deepseek-reasoner 不支持 function calling，选中后工具自动禁用（界面与提示词会说明）
- 会话存 localStorage（WKWebView 持久化），未做导出/导入
- 无暗色模式；无 Windows 签名
- 工具循环上限 12 轮；单文件读取默认 256KB（可按需调大参数）

## 目录结构

```
clawLite/
├─ index.html               # 应用入口（Vite）
├─ src/
│  ├─ main.js               # 装配层
│  ├─ core/                 # bridge / ai / tools / store / markdown
│  ├─ ui/                   # sidebar / chat / settings
│  └─ styles/main.css       # 全部样式（Build 极简 tokens）
├─ src-tauri/               # Tauri v2 后端（Rust）
│  ├─ src/lib.rs            # 10 条命令 + 路径沙箱
│  ├─ capabilities/         # 权限声明（dialog / http）
│  └─ icons/                # 全平台图标
├─ scripts/                 # check.mjs 静态自检 / preview-check.mjs 交互验证
├─ app-icon.png             # 图标源文件（1024px）
└─ CONTRACT.md              # 开发契约（接口唯一真源）
```
