use serde_json::{json, Value};
use tauri::AppHandle;
use tauri_plugin_updater::UpdaterExt;

fn version(app: &AppHandle) -> String {
    app.package_info().version.to_string()
}

fn status(app: &AppHandle, state: &str, available: bool, new_version: Option<String>, error: Option<String>) -> Value {
    json!({
        "enabled": true,
        "state": state,
        "currentVersion": version(app),
        "version": new_version,
        "available": available,
        "downloaded": false,
        "progress": 0,
        "error": error,
        "checkedAt": crate::downloads::now_ms(),
    })
}

#[tauri::command]
pub async fn check_for_updates(app: AppHandle) -> Value {
    let updater = match app.updater() {
        Ok(u) => u,
        Err(e) => return status(&app, "error", false, None, Some(e.to_string())),
    };
    match updater.check().await {
        Ok(Some(update)) => status(&app, "available", true, Some(update.version.clone()), None),
        Ok(None) => status(&app, "not-available", false, None, None),
        Err(e) => status(&app, "error", false, None, Some(e.to_string())),
    }
}

#[tauri::command]
pub async fn install_update(app: AppHandle) -> Value {
    let updater = match app.updater() {
        Ok(u) => u,
        Err(e) => return json!({ "ok": false, "error": e.to_string() }),
    };
    match updater.check().await {
        Ok(Some(update)) => match update.download_and_install(|_, _| {}, || {}).await {
            Ok(_) => {
                app.restart();
            }
            Err(e) => json!({ "ok": false, "error": e.to_string() }),
        },
        Ok(None) => json!({ "ok": false, "error": "no update available" }),
        Err(e) => json!({ "ok": false, "error": e.to_string() }),
    }
}

#[tauri::command]
pub fn get_version(app: AppHandle) -> String {
    version(&app)
}

// Startup check behind the autoCheckUpdates setting. Surfaces a desktop
// notification and an event the About tab picks up, never installs on its own.
pub async fn notify_if_update_available(app: &AppHandle) {
    let updater = match app.updater() {
        Ok(u) => u,
        Err(_) => return,
    };
    if let Ok(Some(update)) = updater.check().await {
        use tauri::Emitter;
        app.emit("uc:update-available", json!({ "version": update.version })).ok();
        crate::notify::send(
            app,
            "Update available",
            &format!("Union.Manifold {} is ready to install from Settings", update.version),
        );
    }
}
