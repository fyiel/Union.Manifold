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
pub async fn get_update_status(app: AppHandle) -> Value {
    check_for_updates(app).await
}

#[tauri::command]
pub async fn update_retry(app: AppHandle) -> Value {
    check_for_updates(app).await
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

#[tauri::command]
pub fn get_changelog() -> Value {
    json!({ "ok": true, "markdown": "" })
}
