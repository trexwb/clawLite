// Claw Lite · Tauri 后端（lib.rs）
// 文件办公命令（工作目录路径沙箱）+ 配置持久化。接口契约见 CONTRACT.md §3。
use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;
use tauri::{AppHandle, Manager, State};
use walkdir::WalkDir;

/* ---------------- 全局状态 ---------------- */

#[derive(Default)]
pub struct AppState(Mutex<Option<PathBuf>>);

fn workspace_root(state: &State<'_, AppState>) -> Result<PathBuf, String> {
    let guard = state.0.lock().map_err(|_| "内部状态错误".to_string())?;
    guard
        .clone()
        .ok_or_else(|| "未设置工作目录，请先在设置中选择".to_string())
}

/* ---------------- 路径沙箱（契约 §3.7） ---------------- */

fn resolve_existing(ws: &Path, raw: &str) -> Result<PathBuf, String> {
    let p = Path::new(raw);
    let joined = if p.is_absolute() {
        p.to_path_buf()
    } else {
        ws.join(p)
    };
    let canonical = fs::canonicalize(&joined)
        .map_err(|e| format!("路径不存在或无法访问: {} ({})", raw, e))?;
    if !canonical.starts_with(ws) {
        return Err(format!("路径越界：仅允许访问工作目录内的文件（{}）", raw));
    }
    Ok(canonical)
}

fn resolve_for_write(ws: &Path, raw: &str) -> Result<PathBuf, String> {
    let p = Path::new(raw);
    let joined = if p.is_absolute() {
        p.to_path_buf()
    } else {
        ws.join(p)
    };
    // 文本级越界预检：绝对路径越界先拒，避免被拒路径在沙箱外留下 mkdir 副作用
    if !joined.starts_with(ws) {
        return Err(format!("路径越界：仅允许写入工作目录内（{}）", raw));
    }
    let name = joined
        .file_name()
        .ok_or_else(|| "路径缺少文件名".to_string())?
        .to_os_string();
    let parent = joined.parent().ok_or_else(|| "路径缺少父目录".to_string())?;
    fs::create_dir_all(parent).map_err(|e| format!("无法创建父目录: {}", e))?;
    let parent_canon =
        fs::canonicalize(parent).map_err(|e| format!("无法解析父目录: {}", e))?;
    if !parent_canon.starts_with(ws) {
        return Err(format!("路径越界：仅允许写入工作目录内（{}）", raw));
    }
    let target = parent_canon.join(name);
    // 符号链接防护：目标若是链接（含悬空）一律拒绝，防止跟随链接写到沙箱外
    if fs::symlink_metadata(&target)
        .map(|m| m.file_type().is_symlink())
        .unwrap_or(false)
    {
        return Err(format!("目标路径是符号链接，拒绝写入: {}", raw));
    }
    Ok(target)
}

/* ---------------- 返回结构 ---------------- */

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceInfo {
    pub path: String,
    pub file_count: u64,
    pub dir_count: u64,
    pub total_bytes: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsEntry {
    pub name: String,
    pub kind: String, // "file" | "dir"
    pub size: u64,
    pub modified: u64, // 毫秒时间戳
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileContent {
    pub content: String,
    pub size: u64,
    pub truncated: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteResult {
    pub path: String,
    pub bytes: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub path: String,
    pub kind: String,
    pub line: u64, // 内容命中行号；文件名命中为 0
    pub snippet: String,
}

/* ---------------- 配置 ---------------- */

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct Config {
    pub api_key: String,
    pub api_base: String,
    pub model: String,
    pub temperature: f64,
    pub workspace_path: String,
}

impl Default for Config {
    fn default() -> Self {
        Config {
            api_key: String::new(),
            api_base: "https://api.deepseek.com".to_string(),
            model: "deepseek-chat".to_string(),
            temperature: 0.7,
            workspace_path: String::new(),
        }
    }
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("无法定位配置目录: {}", e))?;
    Ok(dir.join("config.json"))
}

/* ---------------- 遍历辅助 ---------------- */

const SCAN_LIMIT: usize = 20000;

fn is_skipped(name: &str) -> bool {
    matches!(name, ".git" | "node_modules" | "dist" | "target" | ".DS_Store")
}

/// 遍历目录（跳过构建产物目录名，条目数上限 SCAN_LIMIT）
fn iter_ws(root: &Path) -> impl Iterator<Item = walkdir::DirEntry> {
    WalkDir::new(root)
        .into_iter()
        .filter_entry(|e| {
            if e.depth() == 0 {
                return true;
            }
            let name = e.file_name().to_string_lossy();
            if name == ".DS_Store" {
                return false;
            }
            !(e.file_type().is_dir() && is_skipped(name.as_ref()))
        })
        .filter_map(|e| e.ok())
        .take(SCAN_LIMIT)
}

fn modified_ms(md: &fs::Metadata) -> u64 {
    md.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn rel_display(ws: &Path, p: &Path) -> String {
    p.strip_prefix(ws)
        .unwrap_or(p)
        .to_string_lossy()
        .into_owned()
}

/* ---------------- 命令：工作目录 ---------------- */

#[tauri::command]
async fn set_workspace(
    path: String,
    state: State<'_, AppState>,
) -> Result<WorkspaceInfo, String> {
    let p = PathBuf::from(&path);
    if !p.exists() || !p.is_dir() {
        return Err(format!("目录不存在或不是文件夹: {}", path));
    }
    let canonical = fs::canonicalize(&p).map_err(|e| format!("无法解析目录: {}", e))?;
    let (mut file_count, mut dir_count, mut total_bytes) = (0u64, 0u64, 0u64);
    for e in iter_ws(&canonical) {
        if e.depth() == 0 {
            continue;
        }
        if e.file_type().is_dir() {
            dir_count += 1;
        } else {
            file_count += 1;
            total_bytes += e.metadata().map(|m| m.len()).unwrap_or(0);
        }
    }
    let mut guard = state.0.lock().map_err(|_| "内部状态错误".to_string())?;
    *guard = Some(canonical);
    Ok(WorkspaceInfo {
        path,
        file_count,
        dir_count,
        total_bytes,
    })
}

#[tauri::command]
async fn get_workspace(state: State<'_, AppState>) -> Result<Option<String>, String> {
    let guard = state.0.lock().map_err(|_| "内部状态错误".to_string())?;
    Ok(guard
        .clone()
        .map(|p| p.to_string_lossy().into_owned()))
}

/* ---------------- 命令：文件办公 ---------------- */

#[tauri::command]
async fn list_dir(
    path: String,
    state: State<'_, AppState>,
) -> Result<Vec<FsEntry>, String> {
    let ws = workspace_root(&state)?;
    let target = resolve_existing(&ws, &path)?;
    if !target.is_dir() {
        return Err(format!("不是目录: {}", path));
    }
    let mut entries: Vec<FsEntry> = Vec::new();
    let rd = fs::read_dir(&target).map_err(|e| format!("无法读取目录: {}", e))?;
    for entry in rd {
        let entry = entry.map_err(|e| format!("读取目录项失败: {}", e))?;
        let name = entry.file_name().to_string_lossy().into_owned();
        let md = match fs::metadata(entry.path()) {
            Ok(m) => m,
            Err(_) => continue,
        };
        let is_dir = md.is_dir();
        entries.push(FsEntry {
            name,
            kind: if is_dir { "dir".into() } else { "file".into() },
            size: if is_dir { 0 } else { md.len() },
            modified: modified_ms(&md),
        });
    }
    entries.sort_by(|a, b| {
        (a.kind != "dir")
            .cmp(&(b.kind != "dir"))
            .then_with(|| a.name.cmp(&b.name))
    });
    Ok(entries)
}

#[tauri::command]
async fn read_file(
    path: String,
    max_bytes: Option<u64>,
    state: State<'_, AppState>,
) -> Result<FileContent, String> {
    let ws = workspace_root(&state)?;
    let target = resolve_existing(&ws, &path)?;
    let md = fs::metadata(&target).map_err(|e| format!("无法读取文件信息: {}", e))?;
    if md.is_dir() {
        return Err(format!("这是一个目录，请指定文件: {}", path));
    }
    let requested = max_bytes.unwrap_or(262_144);
    if requested > 2_097_152 {
        return Err("max_bytes 超过上限（2MB）".to_string());
    }
    let max = requested as usize;
    let file = File::open(&target).map_err(|e| format!("无法打开文件: {}", e))?;
    let mut buf: Vec<u8> = Vec::new();
    file.take(max as u64)
        .read_to_end(&mut buf)
        .map_err(|e| format!("读取文件失败: {}", e))?;
    if buf.contains(&0u8) {
        return Err("疑似二进制文件，Claw Lite 仅支持文本文件".to_string());
    }
    let size = md.len();
    Ok(FileContent {
        content: String::from_utf8_lossy(&buf).into_owned(),
        size,
        truncated: size > max as u64,
    })
}

#[tauri::command]
async fn write_file(
    path: String,
    content: String,
    state: State<'_, AppState>,
) -> Result<WriteResult, String> {
    let ws = workspace_root(&state)?;
    let target = resolve_for_write(&ws, &path)?;
    let bytes = content.len() as u64;
    fs::write(&target, content).map_err(|e| format!("写入文件失败: {}", e))?;
    Ok(WriteResult {
        path: target.to_string_lossy().into_owned(),
        bytes,
    })
}

#[tauri::command]
async fn create_dir(path: String, state: State<'_, AppState>) -> Result<String, String> {
    let ws = workspace_root(&state)?;
    let target = resolve_for_write(&ws, &path)?;
    fs::create_dir_all(&target).map_err(|e| format!("创建目录失败: {}", e))?;
    Ok(target.to_string_lossy().into_owned())
}

#[tauri::command]
async fn delete_path(path: String, state: State<'_, AppState>) -> Result<String, String> {
    let ws = workspace_root(&state)?;
    let target = resolve_existing(&ws, &path)?;
    if target == ws {
        return Err("不能删除工作目录根目录".to_string());
    }
    if target.is_dir() {
        fs::remove_dir_all(&target).map_err(|e| format!("删除目录失败: {}", e))?;
    } else {
        fs::remove_file(&target).map_err(|e| format!("删除文件失败: {}", e))?;
    }
    Ok(target.to_string_lossy().into_owned())
}

#[tauri::command]
async fn search_files(
    query: String,
    content: Option<bool>,
    path: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<SearchHit>, String> {
    let ws = workspace_root(&state)?;
    let q = query.trim().to_lowercase();
    if q.is_empty() {
        return Err("搜索词不能为空".to_string());
    }
    let do_content = content.unwrap_or(false);
    let root = match &path {
        Some(p) if !p.is_empty() => resolve_existing(&ws, p)?,
        _ => ws.clone(),
    };

    let mut hits: Vec<SearchHit> = Vec::new();
    for entry in iter_ws(&root) {
        if entry.depth() == 0 || !entry.file_type().is_file() {
            continue;
        }
        let p = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        let rel = rel_display(&ws, p);

        // 1) 文件名命中
        if name.to_lowercase().contains(&q) && hits.len() < 300 {
            hits.push(SearchHit {
                path: rel.clone(),
                kind: "file".into(),
                line: 0,
                snippet: String::new(),
            });
        }

        // 2) 内容命中（文本文件，单文件 ≤1MB，≤5 条/文件）
        if do_content && hits.len() < 300 {
            let mut buf: Vec<u8> = Vec::new();
            let readable = File::open(p)
                .and_then(|f| f.take(1_048_576).read_to_end(&mut buf))
                .is_ok();
            if readable && !buf.contains(&0u8) {
                let text = String::from_utf8_lossy(&buf);
                let mut in_file = 0u64;
                for (idx, line) in text.lines().enumerate() {
                    if in_file >= 5 || hits.len() >= 300 {
                        break;
                    }
                    if line.to_lowercase().contains(&q) {
                        in_file += 1;
                        hits.push(SearchHit {
                            path: rel.clone(),
                            kind: "file".into(),
                            line: (idx + 1) as u64,
                            snippet: line.trim().chars().take(200).collect(),
                        });
                    }
                }
            }
        }

        if hits.len() >= 300 {
            break;
        }
    }
    Ok(hits)
}

/* ---------------- 命令：配置 ---------------- */

#[tauri::command]
async fn load_config(app: AppHandle) -> Result<Config, String> {
    let path = config_path(&app)?;
    match fs::read_to_string(&path) {
        Ok(s) => serde_json::from_str(&s).map_err(|e| format!("配置文件损坏: {}", e)),
        Err(_) => Ok(Config::default()),
    }
}

#[tauri::command]
async fn save_config(config: Config, app: AppHandle) -> Result<(), String> {
    let path = config_path(&app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("无法创建配置目录: {}", e))?;
    }
    let json =
        serde_json::to_string_pretty(&config).map_err(|e| format!("配置序列化失败: {}", e))?;
    fs::write(&path, json).map_err(|e| format!("配置写入失败: {}", e))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

/* ---------------- 入口 ---------------- */

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            set_workspace,
            get_workspace,
            list_dir,
            read_file,
            write_file,
            create_dir,
            delete_path,
            search_files,
            load_config,
            save_config
        ])
        .run(tauri::generate_context!())
        .expect("Claw Lite 启动失败");
}
