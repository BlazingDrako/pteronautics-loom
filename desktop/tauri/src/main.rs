// Pteronautics Loom as a desktop app: the same files as the web app, in a native window.
// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("Pteronautics Loom could not start");
}
