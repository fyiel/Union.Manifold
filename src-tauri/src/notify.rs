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

pub fn send_if(app: &AppHandle, setting: &str, default_on: bool, title: &str, body: &str) {
    let Some(state) = app.try_state::<crate::state::AppState>() else {
        return;
    };
    let on = state.settings.get(setting).as_bool().unwrap_or(default_on);
    if on {
        send(app, title, body);
    }
}
