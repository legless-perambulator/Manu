//! Secure local storage for provider API keys.
//!
//! API keys are credentials, never project content: they are stored by the
//! desktop host, outside any Story Repository, and no key is ever written into a
//! project directory or committed to a project's history (AGENTS.md — "Secrets",
//! docs/MODEL_ROUTER.md).
//!
//! The preferred backend is the operating system's own credential store (macOS
//! Keychain, Windows Credential Manager, Freedesktop Secret Service) via the
//! `keyring` crate. On machines with no such service available — a headless
//! Linux box, a container, a session with no keyring daemon — we fall back to a
//! file in the OS application-config directory, created with owner-only
//! permissions. The active backend is reported to the renderer so the settings
//! UI can tell the user exactly where their key lives rather than implying a
//! guarantee the platform is not providing.

use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;

use serde::Serialize;
use tauri::Manager;

const SERVICE: &str = "com.manu.app";
const FALLBACK_FILE: &str = "credentials.json";

/// Which store actually holds the secret, surfaced to the UI.
#[derive(Serialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "snake_case")]
pub enum SecretBackend {
    /// The operating system credential store.
    Keychain,
    /// Owner-only file in the application-config directory (no OS keychain).
    File,
}

fn entry(key: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, key).map_err(|e| format!("keychain unavailable: {e}"))
}

// ── File fallback ───────────────────────────────────────────────────────────

fn fallback_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("no application config directory: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("config dir create failed: {e}"))?;
    Ok(dir.join(FALLBACK_FILE))
}

fn read_fallback(app: &tauri::AppHandle) -> Result<BTreeMap<String, String>, String> {
    let path = fallback_path(app)?;
    match fs::read_to_string(&path) {
        Ok(text) => {
            serde_json::from_str(&text).map_err(|e| format!("credential file corrupt: {e}"))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(BTreeMap::new()),
        Err(e) => Err(format!("credential file read failed: {e}")),
    }
}

fn write_fallback(app: &tauri::AppHandle, map: &BTreeMap<String, String>) -> Result<(), String> {
    let path = fallback_path(app)?;
    let text = serde_json::to_string_pretty(map).map_err(|e| format!("serialise failed: {e}"))?;
    fs::write(&path, text).map_err(|e| format!("credential file write failed: {e}"))?;
    restrict_permissions(&path)
}

#[cfg(unix)]
fn restrict_permissions(path: &PathBuf) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))
        .map_err(|e| format!("could not restrict credential file permissions: {e}"))
}

#[cfg(not(unix))]
fn restrict_permissions(_path: &PathBuf) -> Result<(), String> {
    // Windows inherits the per-user ACL of the roaming app-data directory.
    Ok(())
}

// ── Tauri commands ──────────────────────────────────────────────────────────

/// Report which backend this machine will use, without storing anything.
#[tauri::command]
pub fn secret_backend() -> SecretBackend {
    match entry("__probe__").and_then(|e| match e.get_password() {
        Ok(_) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("keychain unavailable: {e}")),
    }) {
        Ok(()) => SecretBackend::Keychain,
        Err(_) => SecretBackend::File,
    }
}

#[tauri::command]
pub fn secret_set(
    app: tauri::AppHandle,
    key: String,
    value: String,
) -> Result<SecretBackend, String> {
    if let Ok(e) = entry(&key) {
        if e.set_password(&value).is_ok() {
            return Ok(SecretBackend::Keychain);
        }
    }
    let mut map = read_fallback(&app)?;
    map.insert(key, value);
    write_fallback(&app, &map)?;
    Ok(SecretBackend::File)
}

#[tauri::command]
pub fn secret_get(app: tauri::AppHandle, key: String) -> Result<Option<String>, String> {
    if let Ok(e) = entry(&key) {
        match e.get_password() {
            Ok(secret) => return Ok(Some(secret)),
            Err(keyring::Error::NoEntry) => {}
            Err(_) => {}
        }
    }
    Ok(read_fallback(&app)?.get(&key).cloned())
}

#[tauri::command]
pub fn secret_delete(app: tauri::AppHandle, key: String) -> Result<(), String> {
    if let Ok(e) = entry(&key) {
        let _ = e.delete_credential();
    }
    let mut map = read_fallback(&app)?;
    if map.remove(&key).is_some() {
        write_fallback(&app, &map)?;
    }
    Ok(())
}
