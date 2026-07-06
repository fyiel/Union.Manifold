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
    // Reached from detached game-reaper threads, which can race app teardown.
    // state() panics when the state is gone, and with panic = "abort" that
    // takes the whole process down — skip the notification instead.
    let Some(state) = app.try_state::<crate::state::AppState>() else {
        return;
    };
    let on = state.settings.get(setting).as_bool().unwrap_or(default_on);
    if on {
        send(app, title, body);
    }
}
