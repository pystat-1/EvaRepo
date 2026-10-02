// The desktop app's database: one SQLite file (eva.db) in the app's data
// folder, owned by this module. The React side reaches it only through the
// commands below (see apps/desktop/src/lib/db.ts).
//
// Safety rules:
// - WAL journal + synchronous=NORMAL: a crash or power cut can lose at most
//   the last moment's writes, never corrupt the file.
// - foreign_keys=ON: the database itself refuses orphaned rows.
// - Backups use SQLite's online backup API (a consistent copy even while
//   the app is running), into a backups/ folder next to the database.
// - Restore and import replace the file only after the caller has taken a
//   backup of the current one; the file is validated before it is used.
use rusqlite::{backup::Backup, params_from_iter, types::ValueRef, Connection, OpenFlags};
use serde::Serialize;
use serde_json::{Map, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

pub struct DbState {
    pub conn: Mutex<Option<Connection>>,
    pub dir: PathBuf,
}

impl DbState {
    pub fn new(dir: PathBuf) -> Self {
        Self { conn: Mutex::new(None), dir }
    }
    fn db_path(&self) -> PathBuf {
        self.dir.join("eva.db")
    }
    fn backups_dir(&self) -> PathBuf {
        self.dir.join("backups")
    }
}

type Res<T> = Result<T, String>;

fn err<E: std::fmt::Display>(prefix: &str) -> impl Fn(E) -> String + '_ {
    move |e| format!("{prefix}: {e}")
}

fn open_connection(path: &Path) -> Res<Connection> {
    let conn = Connection::open(path).map_err(err("تعذّر فتح قاعدة البيانات"))?;
    conn.busy_timeout(Duration::from_secs(5)).map_err(err("busy_timeout"))?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON;")
        .map_err(err("PRAGMA"))?;
    Ok(conn)
}

fn with_conn<T>(state: &DbState, f: impl FnOnce(&Connection) -> Res<T>) -> Res<T> {
    let guard = state.conn.lock().map_err(|_| "قفل قاعدة البيانات تالف — أعد تشغيل التطبيق".to_string())?;
    let conn = guard.as_ref().ok_or("قاعدة البيانات غير مفتوحة")?;
    f(conn)
}

fn to_sql(v: &Value) -> rusqlite::types::Value {
    use rusqlite::types::Value as V;
    match v {
        Value::Null => V::Null,
        Value::Bool(b) => V::Integer(*b as i64),
        Value::Number(n) => n.as_i64().map(V::Integer).unwrap_or_else(|| V::Real(n.as_f64().unwrap_or(0.0))),
        Value::String(s) => V::Text(s.clone()),
        other => V::Text(other.to_string()),
    }
}

fn to_json(v: ValueRef) -> Value {
    match v {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(i) => Value::from(i),
        ValueRef::Real(f) => serde_json::Number::from_f64(f).map(Value::Number).unwrap_or(Value::Null),
        ValueRef::Text(t) => Value::String(String::from_utf8_lossy(t).into_owned()),
        ValueRef::Blob(b) => Value::Array(b.iter().map(|x| Value::from(*x)).collect()),
    }
}

#[derive(Serialize)]
pub struct DbInfo {
    path: String,
    backups_dir: String,
    created: bool,
}

#[tauri::command]
pub fn db_open(state: tauri::State<DbState>) -> Res<DbInfo> {
    fs::create_dir_all(state.backups_dir()).map_err(err("تعذّر إنشاء مجلد النسخ الاحتياطية"))?;
    let path = state.db_path();
    let created = !path.exists();
    let conn = open_connection(&path)?;
    *state.conn.lock().map_err(|_| "lock".to_string())? = Some(conn);
    log::info!("database opened: {} (new: {created})", path.display());
    Ok(DbInfo { path: path.display().to_string(), backups_dir: state.backups_dir().display().to_string(), created })
}

#[tauri::command]
pub fn db_exec(state: tauri::State<DbState>, sql: String) -> Res<()> {
    with_conn(&state, |c| c.execute_batch(&sql).map_err(err("SQL")))
}

#[tauri::command]
pub fn db_run(state: tauri::State<DbState>, sql: String, params: Vec<Value>) -> Res<usize> {
    with_conn(&state, |c| {
        let mut stmt = c.prepare_cached(&sql).map_err(err("SQL"))?;
        stmt.execute(params_from_iter(params.iter().map(to_sql))).map_err(err("SQL"))
    })
}

#[derive(serde::Deserialize)]
pub struct Stmt {
    sql: String,
    #[serde(default)]
    params: Vec<Value>,
}

/// Several statements in ONE transaction: all applied or none.
#[tauri::command]
pub fn db_batch(state: tauri::State<DbState>, statements: Vec<Stmt>) -> Res<()> {
    let mut guard = state.conn.lock().map_err(|_| "lock".to_string())?;
    let conn = guard.as_mut().ok_or("قاعدة البيانات غير مفتوحة")?;
    let tx = conn.transaction().map_err(err("SQL"))?;
    for s in &statements {
        let mut stmt = tx.prepare_cached(&s.sql).map_err(err("SQL"))?;
        stmt.execute(params_from_iter(s.params.iter().map(to_sql))).map_err(err("SQL"))?;
    }
    tx.commit().map_err(err("SQL"))
}

#[tauri::command]
pub fn db_values(state: tauri::State<DbState>, sql: String, params: Vec<Value>) -> Res<Vec<Vec<Value>>> {
    with_conn(&state, |c| {
        let mut stmt = c.prepare_cached(&sql).map_err(err("SQL"))?;
        let n = stmt.column_count();
        let mut rows = stmt.query(params_from_iter(params.iter().map(to_sql))).map_err(err("SQL"))?;
        let mut out = Vec::new();
        while let Some(row) = rows.next().map_err(err("SQL"))? {
            out.push((0..n).map(|i| to_json(row.get_ref_unwrap(i))).collect());
        }
        Ok(out)
    })
}

#[tauri::command]
pub fn db_query(state: tauri::State<DbState>, sql: String, params: Vec<Value>) -> Res<Vec<Map<String, Value>>> {
    with_conn(&state, |c| {
        let mut stmt = c.prepare_cached(&sql).map_err(err("SQL"))?;
        let names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
        let mut rows = stmt.query(params_from_iter(params.iter().map(to_sql))).map_err(err("SQL"))?;
        let mut out = Vec::new();
        while let Some(row) = rows.next().map_err(err("SQL"))? {
            let mut obj = Map::new();
            for (i, name) in names.iter().enumerate() {
                obj.insert(name.clone(), to_json(row.get_ref_unwrap(i)));
            }
            out.push(obj);
        }
        Ok(out)
    })
}

/// "ok", or SQLite's description of what is damaged.
#[tauri::command]
pub fn db_integrity(state: tauri::State<DbState>) -> Res<String> {
    with_conn(&state, |c| c.query_row("PRAGMA integrity_check", [], |r| r.get::<_, String>(0)).map_err(err("integrity_check")))
}

/// Backup file names must look like eva-YYYYMMDD-HHmmss-reason.db (see
/// packages/db/src/backup.ts); anything else is rejected, so a command can
/// never be pointed at another file.
fn valid_backup_name(name: &str) -> bool {
    name.starts_with("eva-")
        && name.ends_with(".db")
        && name.len() < 80
        && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '.')
}

#[tauri::command]
pub fn backup_create(state: tauri::State<DbState>, name: String) -> Res<u64> {
    if !valid_backup_name(&name) {
        return Err("اسم نسخة احتياطية غير صالح".into());
    }
    let dest = state.backups_dir().join(&name);
    with_conn(&state, |c| {
        let mut out = Connection::open(&dest).map_err(err("تعذّر إنشاء النسخة الاحتياطية"))?;
        Backup::new(c, &mut out)
            .and_then(|b| b.run_to_completion(256, Duration::from_millis(0), None))
            .map_err(err("فشل النسخ الاحتياطي"))?;
        Ok(())
    })?;
    let size = fs::metadata(&dest).map(|m| m.len()).unwrap_or(0);
    log::info!("backup created: {name} ({size} bytes)");
    Ok(size)
}

#[derive(Serialize)]
pub struct BackupEntry {
    name: String,
    size: u64,
}

#[tauri::command]
pub fn backup_list(state: tauri::State<DbState>) -> Res<Vec<BackupEntry>> {
    let mut out = Vec::new();
    for entry in fs::read_dir(state.backups_dir()).map_err(err("تعذّر قراءة مجلد النسخ الاحتياطية"))? {
        let entry = entry.map_err(err("read_dir"))?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if valid_backup_name(&name) {
            out.push(BackupEntry { name, size: entry.metadata().map(|m| m.len()).unwrap_or(0) });
        }
    }
    Ok(out)
}

#[tauri::command]
pub fn backup_delete(state: tauri::State<DbState>, names: Vec<String>) -> Res<usize> {
    let mut n = 0;
    for name in names.iter().filter(|n| valid_backup_name(n)) {
        if fs::remove_file(state.backups_dir().join(name)).is_ok() {
            n += 1;
        }
    }
    Ok(n)
}

/// Checks that a file is an Eva database before it replaces the current one.
fn check_eva_file(path: &Path) -> Res<()> {
    let c = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(err("الملف ليس قاعدة بيانات"))?;
    let ok: String = c.query_row("PRAGMA integrity_check", [], |r| r.get(0)).map_err(err("الملف ليس قاعدة بيانات SQLite"))?;
    if ok != "ok" {
        return Err(format!("الملف تالف: {ok}"));
    }
    c.query_row("SELECT COUNT(*) FROM _migrations", [], |r| r.get::<_, i64>(0))
        .map_err(|_| "هذا الملف ليس قاعدة بيانات Eva".to_string())?;
    Ok(())
}

/// Replaces eva.db with `source` (a backup or an exported file) and reopens.
fn replace_with(state: &DbState, source: &Path) -> Res<()> {
    check_eva_file(source)?;
    let path = state.db_path();
    let mut guard = state.conn.lock().map_err(|_| "lock".to_string())?;
    // Close (flushes the WAL into the file), then swap the file.
    if let Some(c) = guard.take() {
        c.close().map_err(|(_, e)| format!("تعذّر إغلاق قاعدة البيانات: {e}"))?;
    }
    for suffix in ["-wal", "-shm"] {
        let _ = fs::remove_file(PathBuf::from(format!("{}{suffix}", path.display())));
    }
    let staged = state.dir.join("eva.db.incoming");
    fs::copy(source, &staged).map_err(err("تعذّر نسخ الملف"))?;
    fs::rename(&staged, &path).map_err(err("تعذّر استبدال قاعدة البيانات"))?;
    *guard = Some(open_connection(&path)?);
    log::warn!("database replaced from {}", source.display());
    Ok(())
}

#[tauri::command]
pub fn backup_restore(state: tauri::State<DbState>, name: String) -> Res<()> {
    if !valid_backup_name(&name) {
        return Err("اسم نسخة احتياطية غير صالح".into());
    }
    replace_with(&state, &state.backups_dir().join(name))
}

#[tauri::command]
pub fn db_import_file(state: tauri::State<DbState>, path: String) -> Res<()> {
    replace_with(&state, Path::new(&path))
}

/// The bytes of one backup file (to encrypt and upload), sent to the page as
/// raw bytes rather than JSON.
#[tauri::command]
pub fn backup_read(state: tauri::State<DbState>, name: String) -> Res<tauri::ipc::Response> {
    if !valid_backup_name(&name) {
        return Err("اسم نسخة احتياطية غير صالح".into());
    }
    let bytes = fs::read(state.backups_dir().join(&name)).map_err(err("تعذّر قراءة النسخة"))?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Saves a backup downloaded from online storage into the backups folder,
/// after checking it is an intact Eva database. The name comes in the
/// `x-backup-name` header, the file as the raw request body.
#[tauri::command]
pub fn backup_write(state: tauri::State<DbState>, request: tauri::ipc::Request) -> Res<u64> {
    let name = request
        .headers()
        .get("x-backup-name")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    if !valid_backup_name(&name) {
        return Err("اسم نسخة احتياطية غير صالح".into());
    }
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("لا توجد بيانات".into());
    };
    fs::create_dir_all(state.backups_dir()).map_err(err("مجلد النسخ الاحتياطية"))?;
    let dest = state.backups_dir().join(&name);
    let staged = state.backups_dir().join(format!("{name}.incoming"));
    fs::write(&staged, bytes).map_err(err("تعذّر حفظ النسخة"))?;
    if let Err(e) = check_eva_file(&staged) {
        let _ = fs::remove_file(&staged);
        return Err(e);
    }
    fs::rename(&staged, &dest).map_err(err("تعذّر حفظ النسخة"))?;
    log::info!("backup downloaded: {name} ({} bytes)", bytes.len());
    Ok(bytes.len() as u64)
}
