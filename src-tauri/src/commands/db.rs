// ============================================================
// TONDE DESKTOP — Command : db.rs
// Cache SQLite embarqué (offline-first) + outbox de synchro
// Toute la logique de requête est isolée dans des fonctions
// libres prenant &Connection, testables sur base en mémoire.
// ============================================================

use std::path::Path;
use std::sync::{Mutex, MutexGuard};
use std::time::Duration;

use rusqlite::{params, params_from_iter, Connection, OptionalExtension};
use serde_json::Value;
use tauri::State;

pub struct Db(pub Mutex<Connection>);

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS tickets (
    id          TEXT PRIMARY KEY,
    branch_id   TEXT NOT NULL DEFAULT '',
    service_id  TEXT NOT NULL DEFAULT '',
    status      TEXT NOT NULL DEFAULT 'WAITING',
    priority    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT '',
    data        TEXT NOT NULL,
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_tickets_branch_status ON tickets(branch_id, status);
CREATE INDEX IF NOT EXISTS idx_tickets_service_status ON tickets(service_id, status);

CREATE TABLE IF NOT EXISTS counters (
    id          TEXT PRIMARY KEY,
    branch_id   TEXT NOT NULL DEFAULT '',
    number      INTEGER NOT NULL DEFAULT 0,
    status      TEXT NOT NULL DEFAULT 'CLOSED',
    data        TEXT NOT NULL,
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_counters_branch ON counters(branch_id);

CREATE TABLE IF NOT EXISTS employees (
    id          TEXT PRIMARY KEY,
    email       TEXT NOT NULL DEFAULT '',
    branch_id   TEXT NOT NULL DEFAULT '',
    data        TEXT NOT NULL,
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_employees_email ON employees(email COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS queues (
    branch_id   TEXT NOT NULL,
    service_id  TEXT NOT NULL,
    data        TEXT NOT NULL,
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY (branch_id, service_id)
);

CREATE TABLE IF NOT EXISTS services (
    branch_id   TEXT NOT NULL,
    service_id  TEXT NOT NULL,
    data        TEXT NOT NULL,
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY (branch_id, service_id)
);

CREATE TABLE IF NOT EXISTS sync_queue (
    id          TEXT PRIMARY KEY,
    action      TEXT NOT NULL,
    payload     TEXT NOT NULL DEFAULT '{}',
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    synced_at   TEXT,
    status      TEXT NOT NULL DEFAULT 'PENDING',
    retry_count INTEGER NOT NULL DEFAULT 0,
    error       TEXT
);
CREATE INDEX IF NOT EXISTS idx_sync_status ON sync_queue(status, created_at);
"#;

// ------------------------------------------------------------
// Ouverture / migrations
// ------------------------------------------------------------

pub fn open(path: &Path) -> Result<Connection, String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Création du dossier de cache impossible : {e}"))?;
    }
    let conn = Connection::open(path).map_err(db_err)?;
    configure(&conn)?;
    migrate(&conn)?;
    Ok(conn)
}

pub fn open_memory() -> Result<Connection, String> {
    let conn = Connection::open_in_memory().map_err(db_err)?;
    configure(&conn)?;
    migrate(&conn)?;
    Ok(conn)
}

fn configure(conn: &Connection) -> Result<(), String> {
    conn.busy_timeout(Duration::from_secs(5)).map_err(db_err)?;
    conn.pragma_update(None, "journal_mode", "WAL")
        .map_err(db_err)?;
    conn.pragma_update(None, "synchronous", "NORMAL")
        .map_err(db_err)?;
    conn.pragma_update(None, "foreign_keys", "ON")
        .map_err(db_err)?;
    Ok(())
}

fn migrate(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(SCHEMA)
        .map_err(|e| format!("Migration SQLite impossible : {e}"))
}

fn db_err(e: rusqlite::Error) -> String {
    format!("SQLite : {e}")
}

fn lock<'a>(state: &'a State<'_, Db>) -> Result<MutexGuard<'a, Connection>, String> {
    state
        .0
        .lock()
        .map_err(|_| "Cache SQLite verrouillé par une autre opération".to_string())
}

// ------------------------------------------------------------
// Helpers JSON
// ------------------------------------------------------------

fn text_field(value: &Value, key: &str) -> Result<String, String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| format!("Champ « {key} » manquant dans le payload"))
}

fn text_or(value: &Value, key: &str, default: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or(default)
        .to_owned()
}

fn int_or(value: &Value, key: &str, default: i64) -> i64 {
    value.get(key).and_then(Value::as_i64).unwrap_or(default)
}

fn parse_row(raw: String) -> Result<Value, String> {
    serde_json::from_str(&raw).map_err(|e| format!("Entrée de cache corrompue : {e}"))
}

fn collect_json(
    rows: rusqlite::MappedRows<'_, impl FnMut(&rusqlite::Row) -> rusqlite::Result<String>>,
) -> Result<Vec<Value>, String> {
    let mut out = Vec::new();
    for row in rows {
        out.push(parse_row(row.map_err(db_err)?)?);
    }
    Ok(out)
}

// ------------------------------------------------------------
// Tickets
// ------------------------------------------------------------

pub fn upsert_ticket(conn: &Connection, ticket: &Value) -> Result<(), String> {
    let id = text_field(ticket, "id")?;
    conn.execute(
        "INSERT INTO tickets (id, branch_id, service_id, status, priority, created_at, data, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
         ON CONFLICT(id) DO UPDATE SET
            branch_id = excluded.branch_id,
            service_id = excluded.service_id,
            status = excluded.status,
            priority = excluded.priority,
            created_at = excluded.created_at,
            data = excluded.data,
            updated_at = excluded.updated_at",
        params![
            id,
            text_or(ticket, "branch_id", ""),
            text_or(ticket, "service_id", ""),
            text_or(ticket, "status", "WAITING"),
            int_or(ticket, "priority", 0),
            text_or(ticket, "created_at", ""),
            ticket.to_string(),
        ],
    )
    .map_err(db_err)?;
    Ok(())
}

pub fn get_ticket_by_id(conn: &Connection, id: &str) -> Result<Option<Value>, String> {
    let raw: Option<String> = conn
        .query_row("SELECT data FROM tickets WHERE id = ?1", [id], |row| {
            row.get(0)
        })
        .optional()
        .map_err(db_err)?;
    raw.map(parse_row).transpose()
}

pub fn get_next_waiting_ticket(
    conn: &Connection,
    service_ids: &[String],
) -> Result<Option<Value>, String> {
    if service_ids.is_empty() {
        return Ok(None);
    }
    let placeholders = vec!["?"; service_ids.len()].join(",");
    let sql = format!(
        "SELECT data FROM tickets
         WHERE status = 'WAITING' AND service_id IN ({placeholders})
         ORDER BY priority DESC, created_at ASC
         LIMIT 1"
    );
    let mut stmt = conn.prepare(&sql).map_err(db_err)?;
    let raw: Option<String> = stmt
        .query_row(params_from_iter(service_ids.iter()), |row| row.get(0))
        .optional()
        .map_err(db_err)?;
    raw.map(parse_row).transpose()
}

pub fn get_tickets_by_status(
    conn: &Connection,
    branch_id: &str,
    status: &str,
) -> Result<Vec<Value>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT data FROM tickets
             WHERE branch_id = ?1 AND status = ?2
             ORDER BY priority DESC, created_at ASC",
        )
        .map_err(db_err)?;
    let rows = stmt
        .query_map(params![branch_id, status], |row| row.get::<_, String>(0))
        .map_err(db_err)?;
    collect_json(rows)
}

#[tauri::command]
pub fn db_upsert_ticket(state: State<'_, Db>, ticket: Value) -> Result<(), String> {
    upsert_ticket(&*lock(&state)?, &ticket)
}

#[tauri::command]
pub fn db_get_ticket(state: State<'_, Db>, id: String) -> Result<Option<Value>, String> {
    get_ticket_by_id(&*lock(&state)?, &id)
}

#[tauri::command]
pub fn db_get_next_waiting_ticket(
    state: State<'_, Db>,
    service_ids: Vec<String>,
) -> Result<Option<Value>, String> {
    get_next_waiting_ticket(&*lock(&state)?, &service_ids)
}

#[tauri::command]
pub fn db_get_tickets_by_status(
    state: State<'_, Db>,
    branch_id: String,
    status: String,
) -> Result<Vec<Value>, String> {
    get_tickets_by_status(&*lock(&state)?, &branch_id, &status)
}

// ------------------------------------------------------------
// Guichets
// ------------------------------------------------------------

pub fn upsert_counter(conn: &Connection, counter: &Value) -> Result<(), String> {
    let id = text_field(counter, "id")?;
    conn.execute(
        "INSERT INTO counters (id, branch_id, number, status, data, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
         ON CONFLICT(id) DO UPDATE SET
            branch_id = excluded.branch_id,
            number = excluded.number,
            status = excluded.status,
            data = excluded.data,
            updated_at = excluded.updated_at",
        params![
            id,
            text_or(counter, "branch_id", ""),
            int_or(counter, "number", 0),
            text_or(counter, "status", "CLOSED"),
            counter.to_string(),
        ],
    )
    .map_err(db_err)?;
    Ok(())
}

pub fn get_counter_by_id(conn: &Connection, id: &str) -> Result<Option<Value>, String> {
    let raw: Option<String> = conn
        .query_row("SELECT data FROM counters WHERE id = ?1", [id], |row| {
            row.get(0)
        })
        .optional()
        .map_err(db_err)?;
    raw.map(parse_row).transpose()
}

pub fn get_cached_counters(conn: &Connection, branch_id: &str) -> Result<Vec<Value>, String> {
    let mut stmt = conn
        .prepare("SELECT data FROM counters WHERE branch_id = ?1 ORDER BY number ASC")
        .map_err(db_err)?;
    let rows = stmt
        .query_map([branch_id], |row| row.get::<_, String>(0))
        .map_err(db_err)?;
    collect_json(rows)
}

#[tauri::command]
pub fn db_upsert_counter(state: State<'_, Db>, counter: Value) -> Result<(), String> {
    upsert_counter(&*lock(&state)?, &counter)
}

#[tauri::command]
pub fn db_get_counter(state: State<'_, Db>, id: String) -> Result<Option<Value>, String> {
    get_counter_by_id(&*lock(&state)?, &id)
}

#[tauri::command]
pub fn db_cache_counters(state: State<'_, Db>, counters: Vec<Value>) -> Result<(), String> {
    let mut guard = lock(&state)?;
    let tx = guard.transaction().map_err(db_err)?;
    for counter in &counters {
        upsert_counter(&tx, counter)?;
    }
    tx.commit().map_err(db_err)
}

#[tauri::command]
pub fn db_get_cached_counters(
    state: State<'_, Db>,
    branch_id: String,
) -> Result<Vec<Value>, String> {
    get_cached_counters(&*lock(&state)?, &branch_id)
}

// ------------------------------------------------------------
// Employés (cache de reconnexion)
// ------------------------------------------------------------

pub fn upsert_employee(conn: &Connection, employee: &Value) -> Result<(), String> {
    let id = text_field(employee, "id")?;
    conn.execute(
        "INSERT INTO employees (id, email, branch_id, data, updated_at)
         VALUES (?1, ?2, ?3, ?4, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
         ON CONFLICT(id) DO UPDATE SET
            email = excluded.email,
            branch_id = excluded.branch_id,
            data = excluded.data,
            updated_at = excluded.updated_at",
        params![
            id,
            text_or(employee, "email", ""),
            text_or(employee, "branch_id", ""),
            employee.to_string(),
        ],
    )
    .map_err(db_err)?;
    Ok(())
}

pub fn get_employee_by_email(conn: &Connection, email: &str) -> Result<Option<Value>, String> {
    let raw: Option<String> = conn
        .query_row(
            "SELECT data FROM employees WHERE email = ?1 COLLATE NOCASE LIMIT 1",
            [email],
            |row| row.get(0),
        )
        .optional()
        .map_err(db_err)?;
    raw.map(parse_row).transpose()
}

pub fn get_employees_by_branch(
    conn: &Connection,
    branch_id: &str,
) -> Result<Vec<Value>, String> {
    let mut stmt = conn
        .prepare("SELECT data FROM employees WHERE branch_id = ?1 ORDER BY email ASC")
        .map_err(db_err)?;
    let rows = stmt
        .query_map([branch_id], |row| row.get::<_, String>(0))
        .map_err(db_err)?;
    collect_json(rows)
}

#[tauri::command]
pub fn db_upsert_employee(state: State<'_, Db>, employee: Value) -> Result<(), String> {
    upsert_employee(&*lock(&state)?, &employee)
}

#[tauri::command]
pub fn db_get_employee_by_email(
    state: State<'_, Db>,
    email: String,
) -> Result<Option<Value>, String> {
    get_employee_by_email(&*lock(&state)?, &email)
}

#[tauri::command]
pub fn db_get_employees_by_branch(
    state: State<'_, Db>,
    branch_id: String,
) -> Result<Vec<Value>, String> {
    get_employees_by_branch(&*lock(&state)?, &branch_id)
}

// ------------------------------------------------------------
// Files d'attente & services (snapshot offline)
// ------------------------------------------------------------

pub fn cache_queues(
    conn: &Connection,
    branch_id: &str,
    queues: &[Value],
) -> Result<(), String> {
    let tx = conn.unchecked_transaction().map_err(db_err)?;
    for queue in queues {
        let service_id = text_or(queue, "service_id", "");
        tx.execute(
            "INSERT INTO queues (branch_id, service_id, data, updated_at)
             VALUES (?1, ?2, ?3, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
             ON CONFLICT(branch_id, service_id) DO UPDATE SET
                data = excluded.data,
                updated_at = excluded.updated_at",
            params![branch_id, service_id, queue.to_string()],
        )
        .map_err(db_err)?;

        // Le snapshot remplace les tickets en attente du service ;
        // les tickets déjà appelés/traités restent en cache.
        tx.execute(
            "DELETE FROM tickets WHERE service_id = ?1 AND status = 'WAITING'",
            [&service_id],
        )
        .map_err(db_err)?;

        if let Some(tickets) = queue.get("tickets").and_then(Value::as_array) {
            for ticket in tickets {
                upsert_ticket(&tx, ticket)?;
            }
        }
    }
    tx.commit().map_err(db_err)
}

pub fn get_cached_queues(conn: &Connection, branch_id: &str) -> Result<Vec<Value>, String> {
    let mut stmt = conn
        .prepare("SELECT data FROM queues WHERE branch_id = ?1 ORDER BY service_id ASC")
        .map_err(db_err)?;
    let rows = stmt
        .query_map([branch_id], |row| row.get::<_, String>(0))
        .map_err(db_err)?;
    collect_json(rows)
}

pub fn cache_services(
    conn: &Connection,
    branch_id: &str,
    services: &[Value],
) -> Result<(), String> {
    let tx = conn.unchecked_transaction().map_err(db_err)?;
    tx.execute("DELETE FROM services WHERE branch_id = ?1", [branch_id])
        .map_err(db_err)?;
    for service in services {
        let service_id = text_or(service, "id", "");
        tx.execute(
            "INSERT INTO services (branch_id, service_id, data, updated_at)
             VALUES (?1, ?2, ?3, strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
            params![branch_id, service_id, service.to_string()],
        )
        .map_err(db_err)?;
    }
    tx.commit().map_err(db_err)
}

pub fn get_cached_services(conn: &Connection, branch_id: &str) -> Result<Vec<Value>, String> {
    let mut stmt = conn
        .prepare("SELECT data FROM services WHERE branch_id = ?1 ORDER BY service_id ASC")
        .map_err(db_err)?;
    let rows = stmt
        .query_map([branch_id], |row| row.get::<_, String>(0))
        .map_err(db_err)?;
    collect_json(rows)
}

#[tauri::command]
pub fn db_cache_queues(
    state: State<'_, Db>,
    queues: Vec<Value>,
    branch_id: String,
) -> Result<(), String> {
    cache_queues(&*lock(&state)?, &branch_id, &queues)
}

#[tauri::command]
pub fn db_get_cached_queues(
    state: State<'_, Db>,
    branch_id: String,
) -> Result<Vec<Value>, String> {
    get_cached_queues(&*lock(&state)?, &branch_id)
}

#[tauri::command]
pub fn db_cache_services(
    state: State<'_, Db>,
    services: Vec<Value>,
    branch_id: String,
) -> Result<(), String> {
    cache_services(&*lock(&state)?, &branch_id, &services)
}

#[tauri::command]
pub fn db_get_cached_services(
    state: State<'_, Db>,
    branch_id: String,
) -> Result<Vec<Value>, String> {
    get_cached_services(&*lock(&state)?, &branch_id)
}

// ------------------------------------------------------------
// Outbox de synchronisation
// ------------------------------------------------------------

pub fn insert_sync_item(conn: &Connection, item: &Value) -> Result<(), String> {
    let id = text_field(item, "id")?;
    let payload = item
        .get("payload")
        .map(Value::to_string)
        .unwrap_or_else(|| "{}".to_string());
    conn.execute(
        "INSERT INTO sync_queue (id, action, payload, created_at, synced_at, status, retry_count, error)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(id) DO UPDATE SET
            action = excluded.action,
            payload = excluded.payload,
            status = excluded.status,
            retry_count = excluded.retry_count,
            error = excluded.error,
            synced_at = excluded.synced_at",
        params![
            id,
            text_field(item, "action")?,
            payload,
            text_or(item, "created_at", ""),
            item.get("synced_at").and_then(Value::as_str),
            text_or(item, "status", "PENDING"),
            int_or(item, "retry_count", 0),
            item.get("error").and_then(Value::as_str),
        ],
    )
    .map_err(db_err)?;
    Ok(())
}

pub fn get_sync_queue(conn: &Connection) -> Result<Vec<Value>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, action, payload, created_at, synced_at, status, retry_count, error
             FROM sync_queue ORDER BY created_at ASC",
        )
        .map_err(db_err)?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, i64>(6)?,
                row.get::<_, Option<String>>(7)?,
            ))
        })
        .map_err(db_err)?;

    let mut out = Vec::new();
    for row in rows {
        let (id, action, payload, created_at, synced_at, status, retry_count, error) =
            row.map_err(db_err)?;
        out.push(serde_json::json!({
            "id": id,
            "action": action,
            "payload": parse_row(payload)?,
            "created_at": created_at,
            "synced_at": synced_at,
            "status": status,
            "retry_count": retry_count,
            "error": error,
        }));
    }
    Ok(out)
}

#[tauri::command]
pub fn db_insert_sync_item(state: State<'_, Db>, item: Value) -> Result<(), String> {
    insert_sync_item(&*lock(&state)?, &item)
}

#[tauri::command]
pub fn db_get_sync_queue(state: State<'_, Db>) -> Result<Vec<Value>, String> {
    get_sync_queue(&*lock(&state)?)
}

#[tauri::command]
pub fn db_update_sync_item_status(
    state: State<'_, Db>,
    id: String,
    status: String,
    synced_at: Option<String>,
    retry_count: Option<i64>,
    error: Option<String>,
) -> Result<(), String> {
    lock(&state)?
        .execute(
            "UPDATE sync_queue
             SET status = ?2,
                 synced_at = ?3,
                 retry_count = COALESCE(?4, retry_count),
                 error = ?5
             WHERE id = ?1",
            params![id, status, synced_at, retry_count, error],
        )
        .map_err(db_err)?;
    Ok(())
}

#[tauri::command]
pub fn db_clear_done_sync_items(state: State<'_, Db>) -> Result<(), String> {
    lock(&state)?
        .execute("DELETE FROM sync_queue WHERE status = 'DONE'", [])
        .map_err(db_err)?;
    Ok(())
}

// ------------------------------------------------------------
// Maintenance
// ------------------------------------------------------------

#[tauri::command]
pub fn db_run_migrations(state: State<'_, Db>) -> Result<(), String> {
    migrate(&*lock(&state)?)
}

#[tauri::command]
pub fn db_vacuum(state: State<'_, Db>) -> Result<(), String> {
    lock(&state)?.execute_batch("VACUUM;").map_err(db_err)
}

// ------------------------------------------------------------
// Tests
// ------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn setup() -> Connection {
        let conn = Connection::open_in_memory().expect("SQLite mémoire");
        configure(&conn).expect("configuration");
        migrate(&conn).expect("migration");
        conn
    }

    fn ticket(id: &str, status: &str, priority: i64, created_at: &str, service: &str) -> Value {
        serde_json::json!({
            "id": id,
            "number": id.to_uppercase(),
            "status": status,
            "priority": priority,
            "created_at": created_at,
            "service_id": service,
            "branch_id": "b1"
        })
    }

    #[test]
    fn upsert_ticket_met_a_jour_la_ligne_existante() {
        let conn = setup();
        let mut t = ticket("t1", "WAITING", 0, "2026-01-01T08:00:00Z", "s1");
        upsert_ticket(&conn, &t).unwrap();
        t["status"] = Value::from("CALLED");
        upsert_ticket(&conn, &t).unwrap();

        let stored = get_ticket_by_id(&conn, "t1").unwrap().unwrap();
        assert_eq!(stored["status"], "CALLED");
    }

    #[test]
    fn prochain_ticket_priorite_puis_fifo() {
        let conn = setup();
        upsert_ticket(&conn, &ticket("t2", "WAITING", 2, "2026-01-01T08:05:00Z", "s1")).unwrap();
        upsert_ticket(&conn, &ticket("t1", "WAITING", 0, "2026-01-01T08:00:00Z", "s1")).unwrap();
        upsert_ticket(&conn, &ticket("t3", "WAITING", 0, "2026-01-01T07:59:00Z", "s2")).unwrap();

        let next = get_next_waiting_ticket(&conn, &["s1".to_string()])
            .unwrap()
            .unwrap();
        assert_eq!(next["id"], "t2", "la priorité la plus haute passe d'abord");

        let next = get_next_waiting_ticket(&conn, &["s1".to_string(), "s2".to_string()])
            .unwrap()
            .unwrap();
        assert_eq!(next["id"], "t2");
    }

    #[test]
    fn prochain_ticket_ignore_les_services_non_demandes() {
        let conn = setup();
        upsert_ticket(&conn, &ticket("t1", "WAITING", 0, "2026-01-01T08:00:00Z", "s1")).unwrap();

        assert!(get_next_waiting_ticket(&conn, &[]).unwrap().is_none());
        assert!(
            get_next_waiting_ticket(&conn, &["s9".to_string()])
                .unwrap()
                .is_none()
        );
    }

    #[test]
    fn cache_queues_remplace_les_tickets_en_attente_du_service() {
        let conn = setup();
        let queue = serde_json::json!({
            "service_id": "s1",
            "service_name": "Dépôts",
            "waiting_count": 1,
            "called_count": 0,
            "tickets": [ticket("t9", "WAITING", 0, "2026-01-01T09:00:00Z", "s1")]
        });

        cache_queues(&conn, "b1", &[queue]).unwrap();
        assert!(get_ticket_by_id(&conn, "t9").unwrap().is_some());
        assert_eq!(get_cached_queues(&conn, "b1").unwrap().len(), 1);

        let empty_queue = serde_json::json!({
            "service_id": "s1",
            "service_name": "Dépôts",
            "waiting_count": 0,
            "called_count": 0,
            "tickets": []
        });
        cache_queues(&conn, "b1", &[empty_queue]).unwrap();
        assert!(
            get_ticket_by_id(&conn, "t9").unwrap().is_none(),
            "l'ancien ticket en attente doit disparaître du cache"
        );
    }

    #[test]
    fn services_et_employes_sont_filtres_par_agence() {
        let conn = setup();
        cache_services(
            &conn,
            "b1",
            &[serde_json::json!({ "id": "s1", "name": "Dépôts", "branch_id": "b1" })],
        )
        .unwrap();
        assert_eq!(get_cached_services(&conn, "b1").unwrap().len(), 1);
        assert_eq!(get_cached_services(&conn, "b2").unwrap().len(), 0);

        upsert_employee(
            &conn,
            &serde_json::json!({
                "id": "e1", "name": "Alice", "email": "Alice@Tonde.app",
                "role": "Agent", "is_active": true, "branch_id": "b1"
            }),
        )
        .unwrap();
        let found = get_employee_by_email(&conn, "alice@tonde.app")
            .unwrap()
            .unwrap();
        assert_eq!(found["id"], "e1", "recherche email insensible à la casse");
    }

    #[test]
    fn outbox_aller_retour_et_purge() {
        let conn = setup();
        insert_sync_item(
            &conn,
            &serde_json::json!({
                "id": "sync-1",
                "action": "CALL_TICKET",
                "payload": { "ticket_id": "t1", "counter_id": "c1" },
                "created_at": "2026-01-01T10:00:00Z",
                "status": "PENDING",
                "retry_count": 0
            }),
        )
        .unwrap();

        let queue = get_sync_queue(&conn).unwrap();
        assert_eq!(queue.len(), 1);
        assert_eq!(queue[0]["payload"]["ticket_id"], "t1");

        conn.execute(
            "UPDATE sync_queue SET status = 'DONE', synced_at = '2026-01-01T10:01:00Z' WHERE id = 'sync-1'",
            [],
        )
        .unwrap();
        assert_eq!(get_sync_queue(&conn).unwrap()[0]["status"], "DONE");

        conn.execute("DELETE FROM sync_queue WHERE status = 'DONE'", [])
            .unwrap();
        assert!(get_sync_queue(&conn).unwrap().is_empty());
    }

    #[test]
    fn outbox_idempotente_sur_le_meme_id() {
        let conn = setup();
        for _ in 0..2 {
            insert_sync_item(
                &conn,
                &serde_json::json!({
                    "id": "sync-1",
                    "action": "MARK_ABSENT",
                    "payload": { "ticket_id": "t1" },
                    "created_at": "2026-01-01T10:00:00Z",
                    "status": "PENDING",
                    "retry_count": 0
                }),
            )
            .unwrap();
        }
        assert_eq!(get_sync_queue(&conn).unwrap().len(), 1);
    }
}
