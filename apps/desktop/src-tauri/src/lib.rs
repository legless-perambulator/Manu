mod project_fs;
mod secrets;

use serde::Serialize;

/// Application metadata surfaced to the renderer. Mirrored by the `AppInfo`
/// interface in `src/tauri.ts`.
#[derive(Serialize)]
pub struct AppInfo {
    name: String,
    version: String,
    tagline: String,
}

/// Minimal command proving the Tauri <-> React bridge works.
#[tauri::command]
fn app_info() -> AppInfo {
    AppInfo {
        name: "Manu".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        tagline: "You are the author. Manu is the hand.".to_string(),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![
            app_info,
            project_fs::project_read_text,
            project_fs::project_write_atomic,
            project_fs::project_exists,
            project_fs::project_mkdir,
            project_fs::project_remove,
            project_fs::project_list,
            secrets::secret_backend,
            secrets::secret_set,
            secrets::secret_get,
            secrets::secret_delete,
        ])
        .run(tauri::generate_context!())
        .expect("error while running the Manu desktop application");
}
