use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

#[tauri::command]
pub async fn theme_editor_open(app: AppHandle, seed: Value) -> bool {
    if let Some(existing) = app.get_webview_window("theme-editor") {
        existing.set_focus().ok();
        existing.emit("uc:theme-editor-seed", seed.clone()).ok();
        return true;
    }
    let built = WebviewWindowBuilder::new(
        &app,
        "theme-editor",
        WebviewUrl::App("index.html#/theme-editor".into()),
    )
    .title("Theme Editor")
    .inner_size(1100.0, 780.0)
    .min_inner_size(900.0, 640.0)
    .decorations(false)
    .build();
    match built {
        Ok(window) => {
            let seed = seed.clone();
            tauri::async_runtime::spawn(async move {
                for _ in 0..6 {
                    tokio::time::sleep(std::time::Duration::from_millis(250)).await;
                    window.emit("uc:theme-editor-seed", seed.clone()).ok();
                }
            });
            true
        }
        Err(_) => false,
    }
}

#[tauri::command]
pub fn theme_editor_close(app: AppHandle) {
    if let Some(window) = app.get_webview_window("theme-editor") {
        window.close().ok();
    }
}

#[tauri::command]
pub fn theme_preview(app: AppHandle, theme: Value) {
    if let Some(main) = app.get_webview_window("main") {
        main.emit("uc:theme-preview", theme).ok();
    }
}

#[tauri::command]
pub fn theme_preview_end(app: AppHandle) {
    if let Some(main) = app.get_webview_window("main") {
        main.emit("uc:theme-preview-end", json!({})).ok();
    }
}

#[tauri::command]
pub fn autostart_get(app: AppHandle) -> Value {
    use tauri_plugin_autostart::ManagerExt;
    let enabled = app.autolaunch().is_enabled().unwrap_or(false);
    json!({ "ok": true, "enabled": enabled })
}

#[tauri::command]
pub fn autostart_set(app: AppHandle, enabled: bool) -> Value {
    use tauri_plugin_autostart::ManagerExt;
    let result = if enabled {
        app.autolaunch().enable()
    } else {
        app.autolaunch().disable()
    };
    match result {
        Ok(_) => json!({ "ok": true, "enabled": enabled }),
        Err(e) => json!({ "ok": false, "error": e.to_string() }),
    }
}

