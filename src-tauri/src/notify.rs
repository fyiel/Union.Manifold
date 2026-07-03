use tauri::{AppHandle, Manager};
use tauri_plugin_notification::NotificationExt;

pub fn send(app: &AppHandle, title: &str, body: &str) {
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .ok();
}

// Gate a notification on a boolean setting so each kind stays user-toggleable.
pub fn send_if(app: &AppHandle, setting: &str, default_on: bool, title: &str, body: &str) {
    let state: tauri::State<crate::state::AppState> = app.state();
    let on = state.settings.get(setting).as_bool().unwrap_or(default_on);
    if on {
        send(app, title, body);
    }
}
