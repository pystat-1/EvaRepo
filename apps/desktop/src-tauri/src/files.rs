// Writes a file the user chose in a save dialog (Excel templates and
// exports). Only the file types Eva produces are allowed.
use std::fs;
use std::path::Path;

const ALLOWED: [&str; 3] = ["xlsx", "csv", "db"];

#[tauri::command]
pub fn file_write(path: String, bytes: Vec<u8>) -> Result<(), String> {
    let p = Path::new(&path);
    let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    if !ALLOWED.contains(&ext.as_str()) {
        return Err(format!("نوع الملف غير مسموح: .{ext}"));
    }
    fs::write(p, bytes).map_err(|e| format!("تعذّر حفظ الملف: {e}"))?;
    log::info!("file written: {} ", p.display());
    Ok(())
}
