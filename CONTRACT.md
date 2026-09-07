# ClawLite 开发契约（所有开发者必读，接口唯一真源）

项目：Claw Lite —— 参考 AutoClaw 的极简桌面 AI 助手（Node 工具链 + Tauri v2）
根目录：/Users/wbtrex/AI助手/node/trexwb/clawLite

## 0. 全局约定
- 前端：原生 JavaScript（ESM）+ Vite 6，无框架；所有 UI 文案为简体中文
- 后端：Tauri v2（Rust）；node 只承担构建工具链
- 注释适量中文；命名清晰；不引入契约之外的第三方依赖
- 禁止：运行 npm/cargo 安装或构建、git 操作、改动不属于你的文件
- 写文件到 /Users/wbtrex/...（workspace 之外）时，若 write/edit 工具被权限拒绝，用 exec + python3 或 cat heredoc 写入

## 1. 文件归属（只能创建/修改分配给你的文件）
- 主控：package.json、vite.config.js、.gitignore、src/core/bridge.js、scripts/check.mjs、README.md、CONTRACT.md
- Agent A（Tauri 后端）：src-tauri/Cargo.toml、src-tauri/build.rs、src-tauri/src/main.rs、src-tauri/src/lib.rs、src-tauri/tauri.conf.json、src-tauri/capabilities/default.json
- Agent B（AI 核心逻辑）：src/core/ai.js、src/core/tools.js、src/core/markdown.js、src/core/store.js
- Agent C（界面）：index.html、src/main.js、src/styles/main.css、src/ui/sidebar.js、src/ui/chat.js、src/ui/settings.js

## 2. 设计语言（preset 11 Build · 奢侈极简）
CSS 变量在 src/styles/main.css 的 :root 定义，全部文件只引用变量：
:root {
  --bg: #FAF9F7;            /* 暖纸白，页面底色 */
  --surface: #FFFFFF;        /* 卡片 / 输入区 */
  --ink: #16130E;            /* 主文字 */
  --muted: #8B857A;          /* 次级文字 */
  --line: #EAE6DE;           /* 发丝分隔线 */
  --accent: #C8501B;         /* 唯一强调色 · 焦橙 */
  --accent-soft: rgba(200, 80, 27, 0.08);
  --danger: #B3261E;         /* 仅失败状态使用 */
  --radius: 14px;
  --radius-sm: 10px;
  --shadow: 0 1px 2px rgba(22,19,14,.04), 0 16px 48px rgba(22,19,14,.07);
  --font: -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Segoe UI", sans-serif;
}
- 70%+ 留白；字重只用 300/400/600；强调色只用于：发送按钮、活动会话标记、状态点、链接、警示文案
- 不用渐变横幅、不用彩色大图标、不引入外部字体/图标库；图标一律内联 SVG 线性图标（stroke 1.5，currentColor）
- 布局：左侧栏 264px（--line 右发丝线）+ 主区；聊天列最大 720px 水平居中；正文行高 1.75
- 圆角 14px（卡片/弹窗）、10px（按钮/输入）；阴影只用于弹窗与悬浮 composer

## 3. Rust 侧（Agent A 实现）
### 3.1 Cargo.toml（照抄，勿加别的依赖）
[package]
name = "claw-lite"
version = "0.1.0"
edition = "2021"
description = "Claw Lite - 简易桌面 AI 助手"

[lib]
name = "claw_lite_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-dialog = "2"
tauri-plugin-http = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
walkdir = "2"

### 3.2 build.rs
fn main() { tauri_build::build() }

### 3.3 main.rs
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
fn main() { claw_lite_lib::run() }

### 3.4 tauri.conf.json（照抄）
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "ClawLite",
  "version": "0.1.0",
  "identifier": "com.trexwb.clawlite",
  "build": {
    "beforeDevCommand": "npm run dev",
    "devUrl": "http://localhost:1420",
    "beforeBuildCommand": "npm run build",
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [{
      "title": "Claw Lite", "width": 1240, "height": 820,
      "minWidth": 960, "minHeight": 620, "center": true
    }],
    "security": { "csp": null }
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": ["icons/32x32.png", "icons/128x128.png", "icons/128x128@2x.png", "icons/icon.icns", "icons/icon.ico"]
  }
}
（icons/* 文件由主控生成，你只负责写这份配置）

### 3.5 capabilities/default.json（照抄）
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Claw Lite 主窗口默认能力",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "dialog:default",
    { "identifier": "http:default", "allow": [
      { "url": "https://**" },
      { "url": "http://localhost:*" },
      { "url": "http://127.0.0.1:*" }
    ] }
  ]
}

### 3.6 lib.rs 结构与命令签名（命令名逐字一致；除 max_bytes 外参数都用单词名）
use tauri::Manager;
#[derive(Default)] struct AppState(std::sync::Mutex<Option<std::path::PathBuf>>);
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_http::init())
    .manage(AppState::default())
    .invoke_handler(tauri::generate_handler![
      set_workspace, get_workspace, list_dir, read_file, write_file,
      create_dir, delete_path, search_files, load_config, save_config
    ])
    .run(tauri::generate_context!())
    .expect("Claw Lite 启动失败");
}

| 命令 | JS 调用参数 | Rust 签名（async） | 返回 |
|---|---|---|---|
| set_workspace | {path} | (path: String, state: State<'_, AppState>) | WorkspaceInfo{path:String, fileCount:u64, dirCount:u64, totalBytes:u64} |
| get_workspace | {} | (state) | Option<String> |
| list_dir | {path} | (path: String, state) | Vec<FsEntry{name:String, kind:String("file"\|"dir"), size:u64, modified:u64 毫秒}> |
| read_file | {path, maxBytes?} | (path: String, max_bytes: Option<u64>, state) | FileContent{content:String, size:u64, truncated:bool} |
| write_file | {path, content} | (path: String, content: String, state) | WriteResult{path:String, bytes:u64} |
| create_dir | {path} | (path: String, state) | String（创建的路径） |
| delete_path | {path} | (path: String, state) | String（被删路径） |
| search_files | {query, content?, path?} | (query: String, content: Option<bool>, path: Option<String>, state) | Vec<SearchHit{path, kind, line:u64, snippet}>（文件名命中 line=0 snippet=""） |
| load_config | {} | (app: tauri::AppHandle) | Config{apiKey, apiBase, model, temperature, workspacePath} |
| save_config | {config} | (config: Config, app: tauri::AppHandle) | ()（返回 Ok(())） |

- 返回结构体一律 #[derive(Serialize)] + #[serde(rename_all = "camelCase")]；Config 另加 #[derive(Deserialize, Clone)] + #[serde(default)]
- Config 字段：api_key:String, api_base:String, model:String, temperature:f64, workspace_path:String；impl Default（api_base 默认 "https://api.deepseek.com"，model 默认 "deepseek-chat"，temperature 0.7，其余空串）
- 配置文件路径：app.path().app_config_dir() 目录下 config.json（先 create_dir_all）；load 读不到返回 Default
- 全部命令返回 Result<T, String>；不 panic、不 unwrap/expect 用户输入；错误信息中文
- 所有文件命令在 workspace 未设置时返回 Err("未设置工作目录，请先在设置中选择")

### 3.7 路径沙箱（必须照此实现，两个函数都要）
fn resolve_existing(ws: &std::path::Path, raw: &str) -> Result<std::path::PathBuf, String> {
    let p = std::path::Path::new(raw);
    let joined = if p.is_absolute() { p.to_path_buf() } else { ws.join(p) };
    let canonical = std::fs::canonicalize(&joined)
        .map_err(|e| format!("路径不存在或无法访问: {} ({})", raw, e))?;
    if !canonical.starts_with(ws) {
        return Err(format!("路径越界：仅允许访问工作目录内的文件（{}）", raw));
    }
    Ok(canonical)
}

fn resolve_for_write(ws: &std::path::Path, raw: &str) -> Result<std::path::PathBuf, String> {
    let p = std::path::Path::new(raw);
    let joined = if p.is_absolute() { p.to_path_buf() } else { ws.join(p) };
    // 文本级越界预检：绝对路径越界先拒（避免沙箱外 mkdir 副作用）
    if !joined.starts_with(ws) {
        return Err(format!("路径越界：仅允许写入工作目录内（{}）", raw));
    }
    let name = joined.file_name().ok_or_else(|| "路径缺少文件名".to_string())?;
    let parent = joined.parent().ok_or_else(|| "路径缺少父目录".to_string())?;
    std::fs::create_dir_all(parent).map_err(|e| format!("无法创建父目录: {}", e))?;
    let pcanon = std::fs::canonicalize(parent).map_err(|e| e.to_string())?;
    if !pcanon.starts_with(ws) {
        return Err(format!("路径越界：仅允许写入工作目录内（{}）", raw));
    }
    let target = pcanon.join(name);
    // 符号链接防护：目标是链接（含悬空）一律拒绝，防止跟随链接逃逸
    if std::fs::symlink_metadata(&target)
        .map(|m| m.file_type().is_symlink())
        .unwrap_or(false)
    {
        return Err(format!("目标路径是符号链接，拒绝写入: {}", raw));
    }
    Ok(target)
}

- set_workspace：校验存在且是目录 → canonicalize → 存 state（保存到配置由前端负责）
- read_file：读字节；含 NUL(0x00) → Err("疑似二进制文件，Claw Lite 仅支持文本文件")；max_bytes 默认 262144，硬顶 2_097_152（超出返回 Err）；String::from_utf8_lossy；truncated = 原始字节数 > max_bytes
- write_file：resolve_for_write → 写入 → 返回 {path(显示路径字符串), bytes}
- delete_path：resolve_existing 后：等于 workspace 根 → Err("不能删除工作目录根目录")；目录 → fs::remove_dir_all；文件 → fs::remove_file
- 配置文件写入后设置 0o600 权限（unix 门控）；写入路径目标为符号链接（含悬空）一律拒绝；被拒的相对路径可能已在工作区内创建空父目录（已知怪癖，接受）
- search_files：walkdir；跳过目录名 .git / node_modules / dist / target / .DS_Store；文件名包含(忽略大小写)即命中；content=true 时再读文件内容(≤1MB、非二进制)按行匹配(忽略大小写)，snippet=命中行 trim 后 ≤200 字符；单文件内容命中≤5 条；总命中≤300；遍历≤20000 项（含目录）
- WorkspaceInfo 统计：遍历工作目录（同样跳过上述目录名，上限 20000 项）累计文件数/目录数/总字节

## 4. JS 桥接层（主控已实现 src/core/bridge.js，直接 import，勿改）
- isTauri: boolean；MOCK: { enabled: boolean }（浏览器模式为 true，全部命令走内存 mock）
- invoke(cmd, args?) → Promise：命令名与 §3.6 表格一致；mock 已实现全部 10 条
- pickDirectory() → Promise<string|null>：系统目录选择；mock 返回 null（设置页需允许手动输入路径）
- aiFetch(url, init?) → Promise<Response>：Tauri 下走 plugin-http（无 CORS 问题），浏览器走原生 fetch

## 5. AI 核心逻辑（Agent B 实现）
### src/core/tools.js
- TOOL_SCHEMAS：OpenAI function calling 格式数组，6 个工具（description 用中文给模型看）：
  list_dir{path?} / read_file{path!, max_bytes?} / write_file{path!, content!} / create_dir{path!} / delete_path{path!} / search_files{query!, content?, path?}
- buildSystemPrompt(workspacePath, model) → string：内容按 §7，reasoner 模型附一条「该模型暂不支持工具调用，请直接用文字回答」
- executeTool(name, argsObj, { onConfirmDelete }) → Promise<{result:string, brief:string, ok:boolean}>：
  - 内部 bridge.invoke 对应命令；参数名转 camelCase（max_bytes→maxBytes，content→content 等）
  - delete_path：先 await onConfirmDelete(argsObj)，false → {ok:false, result:"用户取消了删除操作", brief:"已取消"}
  - result 传给模型前截断 48000 字符（追加 "\n...（内容过长已截断）"）
  - brief 给 UI：如 "12 项 · 3 目录" / "读取 1.2 KB" / "写入 84 字节" / "命中 3 处" / "已删除"
### src/core/ai.js
- export const DEFAULT_API_BASE = "https://api.deepseek.com"
- runAssistantTurn({ messages, config, onDelta, onToolEvent, signal, onConfirmDelete }) → Promise<{content:string}>（onConfirmDelete 由 main.js 注入确认弹窗；core 不反向 import UI，未注入时删除一律拒绝）
  - messages: [{role:"user"|"assistant", content}]（历史只带文本，工具中间消息不进历史）
  - 请求体：POST `${apiBase}/chat/completions`，aiFetch，headers Bearer，body {model, messages:[system+...], tools（model 含 "reasoner" 时省略）, temperature, max_tokens: 8192, stream: true}
  - SSE 解析：reader 循环 + 跨 chunk 行缓冲；行 "data: ..."；[DONE] 结束；delta.content → onDelta(text)；delta.tool_calls 按 index 累积 {id, name, arguments 字符串拼接}
  - finish_reason === "tool_calls"：逐个工具 → onToolEvent({type:"start", name, args}) → executeTool → onToolEvent({type:"end", name, ok, brief}) → wire 消息追加 assistant(tool_calls 原样) + 每个工具一条 {role:"tool", tool_call_id, content: result} → 下一轮请求；最多 12 轮（超出在 content 注明已达上限）
  - 最终把累积文本通过 onDelta 全部送出后 return {content}
  - MOCK.enabled → mockTurn()：确定性演示脚本：流式一段开场（提及当前工作目录与虚拟文件）→ onToolEvent start/end 演示 list_dir（真实调 executeTool 走 mock）→ 流式总结目录内容；≤80 行实现
  - 错误：非 2xx → throw Error（401 → "API Key 无效或未填写（401）"；429 → "请求过于频繁（429）"；其他带状态码与响应摘要，全部中文）；AbortError 透传
### src/core/markdown.js
- renderMarkdown(text) → string：先整体 HTML 转义再做转换：围栏代码块 ```lang、行内 `code`、**粗体**、*斜体*、#/##/### 标题、- 与 1. 列表（含嵌套一层）、> 引用、[文本](http/https)（target="_blank" rel="noopener"）、--- 分隔线、| a | b | 简单表格；类名：md-code-block、md-inline-code、md-quote、md-table；输出不含任何事件属性
### src/core/store.js
- localStorage：会话 "clawlite.sessions.v1"，活动会话 "clawlite.active.v1"
- Store 对象方法：load()、listSessions()、getSession(id)、createSession()（返回新会话）、deleteSession(id)、renameSession(id, title)、setActive(id)、getActiveId()、appendMessage(sid, msg)、persist()
- 会话：{id, title, createdAt, updatedAt, messages: []}；消息：{id, role:"user"|"assistant", content, toolEvents?: [{name, ok, brief, args?}], createdAt}（消息数组允许直接变更后调 persist()）
- 配置：Store.initConfig() → Promise（invoke load_config 存 Store.config）；Store.saveConfig(patch) → merge 后 invoke("save_config", {config: Store.config})，若 workspacePath 变化再 invoke("set_workspace", {path})；返回更新后的 config

## 6. 界面层（Agent C 实现）
### DOM 骨架（id 必须一致；结构可优化但 id 不许改名）
body > #app
  aside#sidebar：.brand（"Claw Lite" 字标 + accent 小圆点）、button#btn-new-task（+ 新任务）、ul#session-list、.sidebar-footer（button#btn-workspace 工作目录 chip、button#btn-settings 齿轮）
  main > header#topbar：#session-title、span#ws-chip（title=完整路径；未设置显示"未设置工作目录"+ .warn）
  section#chat-scroll > .chat-col：空态 .empty-state（大字标 "Claw Lite"、副标一句、.chip×3 建议按钮）或消息流
  footer#composer > .composer-card：textarea#input（autosize 1~6 行，placeholder "给 Claw Lite 派个任务…"）、button#btn-send（accent 圆形箭头）、button#btn-stop.hidden（方形停止）
弹窗（.modal-backdrop > .modal-card）：#settings-modal（§6 设置表单）、#confirm-modal（#confirm-title、#confirm-detail、#confirm-cancel、#confirm-ok）
#toast（底部居中）

### src/ui/chat.js 导出
- renderSession(session, {streaming}) / appendMessageEl / updateMessageEl(msg) / renderToolCard(container, evt) / clearChat()
- 消息渲染：user 右对齐浅色块；assistant 无气泡左对齐正文（流式时 markdown 渲染 raf 节流 ≥120ms，结束后全量渲染一次）；toolEvents 渲染为 .tool-card 列表（状态点：进行中 spinner / 成功 accent / 失败 --danger；点击展开 args 的 JSON pre）；错误消息文案前缀 "⚠ "
### src/ui/sidebar.js 导出
- renderSidebar(store, {onSelect, onNew, onDelete, onRename})：活动项 accent 左条；hover 出现删除 ×（删除走 confirm 弹窗二次确认）；双击标题行内改名（input，Enter/失焦提交）
### src/ui/settings.js 导出
- openSettings(store, {onSaved})：字段 API Key（password + 显隐切换）、API 地址（默认 https://api.deepseek.com）、模型（select deepseek-chat / deepseek-reasoner / 自定义→切 input）、温度（range 0–2 step .1 + 数值）、工作目录（可编辑 text + 「选择目录」按钮 pickDirectory，mock 模式按钮隐藏）、按钮「测试连接」（aiFetch GET base+"/models"，Bearer key，ok→toast"连接成功"，否则 toast 错误）与「保存」（Store.saveConfig → toast "已保存" → onSaved）
- 导出 showConfirm({title, detail}) → Promise<boolean>（给 delete_path 的 onConfirmDelete 用）
- 导出 toast(msg, type?)（type: "ok"|"err"，2.6s 自动消失）
### src/main.js 装配
- init 顺序：Store.load + Store.initConfig → 渲染侧栏/会话 → 若 workspacePath 非空 invoke set_workspace → 若无 apiKey 或 workspacePath 自动 openSettings
- 发送流程：空输入忽略；未设工作目录 → toast + openSettings；push user 消息 → 渲染 → new AbortController → runAssistantTurn({messages: 会话文本消息, config: Store.config, onDelta, onToolEvent, signal})；assistant 消息先建占位（id 唯一），onDelta 更新 content，onToolEvent push toolEvents；结束 persist + 全量渲染；AbortError → content += "\n\n（已停止）"；其他 Error → assistant 消息显示错误文案
- Enter 发送；Shift / Ctrl / ⌘ + Enter 换行；流式中 Enter 不发送
- 会话标题：首条用户消息前 20 字；#btn-new-task 新建并激活；#ws-chip 点击打开设置
- 空态建议 chips（点击即发送）："列出工作目录的文件"、"把会议纪要整理成待办清单"、"读取 数据/销售额.csv 并总结趋势"、"新建 周报.md 并写入本周要点"

## 7. 系统提示词（buildSystemPrompt 输出，{ws} 替换为工作目录）
你是 Claw Lite，一个运行在用户 macOS 桌面上的本地 AI 助手。
当前工作目录：{ws}
你可以通过工具在该目录内读取、创建、修改、搜索文件。规则：
1. path 参数使用相对工作目录的相对路径（如 "数据/销售额.csv"）；越界路径会被系统拒绝。
2. write_file 会自动创建父目录并覆盖同名文件；写前确认内容完整。
3. 删除文件前必须先在回复中说明要删除什么并征得用户明确同意，用户同意后才能调用 delete_path（界面还会弹出确认框）。
4. 需要了解目录结构时先 list_dir；读大文件时用 max_bytes 限制或分段读取。
5. 用用户的语言回复（默认简体中文），简洁、结构化；写入文件的正文用 Markdown。
6. 完成文件操作后用一句话说明结果。

## 8. 交付与回传
- 代码写完后逐文件自检（JS：node --check；Rust：逐行对照本契约模板自查括号/导入/生命周期/拼写）
- 每人把 ≤25 行总结写到 /Users/wbtrex/.openclaw-autoclaw/workspace/.cluster/clawlite-20260907/subagent_0X.md：文件清单 / 关键实现决策 / 与契约的偏离 / 自检结果
- 回传消息 ≤15 行，中文
