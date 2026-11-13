// ============================================================
// TONDE DESKTOP — Command : storage.rs
// Coffre-fort d'identifiants du système (Windows Credential
// Manager via keyring), repli sur le store Tauri hors Windows.
// Le token n'est JAMAIS écrit dans le localStorage web.
// ============================================================

use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

const SERVICE_NAME: &str = "app.tonde.desktop";
const ACCOUNT_NAME: &str = "access_token";
const STORE_PATH: &str = "tonde-secure.json";
const STORE_TOKEN_KEY: &str = "access_token";

// ------------------------------------------------------------
// Implémentation native Windows
// ------------------------------------------------------------

#[cfg(target_os = "windows")]
fn keyring_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE_NAME, ACCOUNT_NAME).map_err(|e| format!("Keyring : {e}"))
}

#[cfg(target_os = "windows")]
fn keyring_set(token: &str) -> Result<(), String> {
    keyring_entry()?
        .set_password(token)
        .map_err(|e| format!("Keyring : {e}"))
}

#[cfg(target_os = "windows")]
fn keyring_get() -> Result<Option<String>, String> {
    match keyring_entry()?.get_password() {
        Ok(token) => Ok(Some(token)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("Keyring : {e}")),
    }
}

#[cfg(target_os = "windows")]
fn keyring_clear() -> Result<(), String> {
    match keyring_entry()?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Keyring : {e}")),
    }
}

// ------------------------------------------------------------
// Repli : store Tauri (fichier local du profil applicatif)
// ------------------------------------------------------------

fn store_set(app: &AppHandle, token: &str) -> Result<(), String> {
    let store = app
        .store(STORE_PATH)
        .map_err(|e| format!("Store : {e}"))?;
    store.set(STORE_TOKEN_KEY, serde_json::Value::String(token.to_owned()));
    store.save().map_err(|e| format!("Store : {e}"))
}

fn store_get(app: &AppHandle) -> Result<Option<String>, String> {
    let store = app
        .store(STORE_PATH)
        .map_err(|e| format!("Store : {e}"))?;
    Ok(store
        .get(STORE_TOKEN_KEY)
        .and_then(|v| v.as_str().map(str::to_owned)))
}

fn store_clear(app: &AppHandle) -> Result<(), String> {
    let store = app
        .store(STORE_PATH)
        .map_err(|e| format!("Store : {e}"))?;
    store.delete(STORE_TOKEN_KEY);
    store.save().map_err(|e| format!("Store : {e}"))
}

// ------------------------------------------------------------
// Commands
// ------------------------------------------------------------

/// Sauvegarde le JWT dans le coffre-fort du système.
#[tauri::command]
pub async fn secure_set_token(app: AppHandle, token: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let _ = &app;
        match keyring_set(&token) {
            Ok(()) => Ok(()),
            Err(e) => {
                // Certains postes sans coffre utilisable : on ne bloque
                // jamais la connexion, on retombe sur le store local.
                eprintln!("[TONDE] Keyring indisponible ({e}) — repli sur le store");
                store_set(&app, &token)
            }
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        store_set(&app, &token)
    }
}

/// Récupère le JWT depuis le coffre-fort du système.
#[tauri::command]
pub async fn secure_get_token(app: AppHandle) -> Result<Option<String>, String> {
    #[cfg(target_os = "windows")]
    {
        match keyring_get() {
            Ok(Some(token)) => return Ok(Some(token)),
            Ok(None) => {}
            Err(e) => {
                eprintln!("[TONDE] Keyring illisible ({e}) — repli sur le store");
            }
        }
        store_get(&app)
    }
    #[cfg(not(target_os = "windows"))]
    {
        store_get(&app)
    }
}

/// Supprime le JWT du coffre-fort et du store de repli (logout).
#[tauri::command]
pub async fn secure_clear_token(app: AppHandle) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let keyring_result = keyring_clear();
        let store_result = store_clear(&app);
        // Le logout ne doit jamais échouer à cause d'un coffre absent.
        if let Err(e) = &keyring_result {
            eprintln!("[TONDE] Keyring : {e}");
        }
        store_result
    }
    #[cfg(not(target_os = "windows"))]
    {
        store_clear(&app)
    }
}
