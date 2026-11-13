// ============================================================
// TONDE DESKTOP — lib.rs
// Configuration Tauri + enregistrement des Commands
// ============================================================

mod commands;

use std::sync::Mutex;

use tauri::Manager;

use commands::{db, storage};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // ── Plugins ──
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        // ── Cache SQLite (offline-first) ──
        .setup(|app| {
            let connection = match app.path().app_data_dir() {
                Ok(dir) => match db::open(&dir.join("tonde-cache.db")) {
                    Ok(conn) => conn,
                    Err(e) => {
                        eprintln!(
                            "[TONDE] Cache SQLite indisponible ({e}) — repli en mémoire"
                        );
                        db::open_memory().map_err(std::io::Error::other)?
                    }
                },
                Err(e) => {
                    eprintln!(
                        "[TONDE] Dossier de données introuvable ({e}) — repli en mémoire"
                    );
                    db::open_memory().map_err(std::io::Error::other)?
                }
            };
            app.manage(db::Db(Mutex::new(connection)));
            Ok(())
        })
        // ── Commands ──
        .invoke_handler(tauri::generate_handler![
            // Coffre-fort JWT
            storage::secure_set_token,
            storage::secure_get_token,
            storage::secure_clear_token,
            // Cache tickets
            db::db_upsert_ticket,
            db::db_get_ticket,
            db::db_get_next_waiting_ticket,
            db::db_get_tickets_by_status,
            // Cache guichets
            db::db_upsert_counter,
            db::db_get_counter,
            db::db_cache_counters,
            db::db_get_cached_counters,
            // Cache employés
            db::db_upsert_employee,
            db::db_get_employee_by_email,
            db::db_get_employees_by_branch,
            // Cache files & services
            db::db_cache_queues,
            db::db_get_cached_queues,
            db::db_cache_services,
            db::db_get_cached_services,
            // Outbox de synchronisation
            db::db_insert_sync_item,
            db::db_get_sync_queue,
            db::db_update_sync_item_status,
            db::db_clear_done_sync_items,
            // Maintenance
            db::db_run_migrations,
            db::db_vacuum,
            // Health check
            ping,
        ])
        .run(tauri::generate_context!())
        .expect("Erreur au démarrage de l'application TONDE");
}

/// Health check simple
#[tauri::command]
fn ping() -> &'static str {
    "pong"
}
