mod db;
mod files;

use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .plugin(
            // Log file in the app's log folder (kept for crash reports), plus
            // the terminal while developing.
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .max_file_size(5_000_000)
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepSome(5))
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            // A panic anywhere in the Rust side is written to the log before
            // the app goes down, so the cause can be sent and fixed.
            std::panic::set_hook(Box::new(|info| log::error!("PANIC: {info}")));
            // EVA_DATA_DIR points a copy of the app at another folder (tests,
            // or trying something without touching the real data).
            let dir = match std::env::var_os("EVA_DATA_DIR") {
                Some(d) if !d.is_empty() => std::path::PathBuf::from(d),
                _ => app.path().app_data_dir().expect("no app data folder"),
            };
            std::fs::create_dir_all(&dir)?;
            app.manage(db::DbState::new(dir));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            db::db_open,
            db::db_exec,
            db::db_run,
            db::db_batch,
            db::db_values,
            db::db_query,
            db::db_integrity,
            db::backup_create,
            db::backup_list,
            db::backup_delete,
            db::backup_restore,
            db::db_import_file,
            files::file_write,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Eva");
}
