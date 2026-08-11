use serde::Serialize;

/// Application metadata surfaced to the renderer. Mirrored by the `AppInfo`
/// interface in `src/tauri.ts`.
#[derive(Serialize)]
pub struct AppInfo {
    name: String,
    version: String,
    tagline: String,
}

/// Minimal command proving the Tauri <-> React bridge works. Real project
/// commands (filesystem access, agent invocation, …) are added in later slices.
#[tauri::command]
fn app_info() -> AppInfo {
    AppInfo {
        name: "JellyTind".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        tagline: "AI-native fiction development environment".to_string(),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![app_info])
        .run(tauri::generate_context!())
        .expect("error while running JellyTind desktop application");
}
