use serde_json::{json, Value};
use tauri::{Manager, Window};

use crate::error::Result;

#[tauri::command]
pub fn window_minimize(window: Window) -> Result<()> {
    window.minimize()?;
    Ok(())
}

#[tauri::command]
pub fn window_maximize(window: Window) -> Result<()> {
    if window.is_maximized()? {
        window.unmaximize()?;
    } else {
        window.maximize()?;
    }
    Ok(())
}

#[tauri::command]
pub fn window_close(window: Window) -> Result<()> {
    if let Some(main) = window.app_handle().get_webview_window("main") {
        main.close()?;
    } else {
        window.close()?;
    }
    Ok(())
}

#[tauri::command]
pub fn window_is_maximized(window: Window) -> Result<bool> {
    Ok(window.is_maximized()?)
}

#[tauri::command]
pub fn app_close_response(_should_proceed: bool) -> Value {
    json!({ "ok": true, "proceeded": true })
}
