// Facts about this installation for the self-check and the diagnostic
// report: version, where the data lives, sizes, free disk space, the log
// folder and its latest lines. Folders can be opened in Explorer, but only
// Eva's own (logs, backups, data): the page never names an arbitrary path.
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

use crate::db::DbState;

#[derive(Serialize)]
pub struct SystemInfo {
    version: String,
    data_dir: String,
    log_dir: String,
    db_bytes: u64,
    wal_bytes: u64,
    free_disk_bytes: Option<u64>,
    os: String,
}

fn size(p: &Path) -> u64 {
    fs::metadata(p).map(|m| m.len()).unwrap_or(0)
}

fn log_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path().app_log_dir().map_err(|e| format!("مجلد السجلات: {e}"))
}

#[tauri::command]
pub fn system_info(app: tauri::AppHandle, state: tauri::State<DbState>) -> Result<SystemInfo, String> {
    let db = state.dir.join("eva.db");
    Ok(SystemInfo {
        version: app.package_info().version.to_string(),
        data_dir: state.dir.display().to_string(),
        log_dir: log_dir(&app)?.display().to_string(),
        db_bytes: size(&db),
        wal_bytes: size(&state.dir.join("eva.db-wal")),
        free_disk_bytes: fs2::available_space(&state.dir).ok(),
        os: format!("{} {}", std::env::consts::OS, std::env::consts::ARCH),
    })
}

/// The last `lines` lines of the newest log file (for the diagnostic report).
#[tauri::command]
pub fn log_tail(app: tauri::AppHandle, lines: usize) -> Result<String, String> {
    let dir = log_dir(&app)?;
    let newest = fs::read_dir(&dir)
        .map_err(|e| format!("تعذّر قراءة مجلد السجلات: {e}"))?
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().is_some_and(|x| x == "log"))
        .max_by_key(|e| e.metadata().and_then(|m| m.modified()).ok());
    let Some(file) = newest else { return Ok(String::new()) };
    let text = fs::read_to_string(file.path()).unwrap_or_default();
    let all: Vec<&str> = text.lines().collect();
    Ok(all[all.len().saturating_sub(lines.min(2000))..].join("\n"))
}

/// Opens one of Eva's own folders in Explorer.
#[tauri::command]
pub fn open_folder(app: tauri::AppHandle, state: tauri::State<DbState>, which: String) -> Result<(), String> {
    let dir = match which.as_str() {
        "logs" => log_dir(&app)?,
        "backups" => state.dir.join("backups"),
        "data" => state.dir.clone(),
        _ => return Err("مجلد غير معروف".into()),
    };
    fs::create_dir_all(&dir).map_err(|e| format!("{e}"))?;
    std::process::Command::new("explorer").arg(&dir).spawn().map_err(|e| format!("تعذّر فتح المجلد: {e}"))?;
    Ok(())
}
