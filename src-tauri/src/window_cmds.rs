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
pub fn app_close_response(app: tauri::AppHandle, should_proceed: bool) -> Value {
    if should_proceed {
        app.exit(0);
    }
    json!({ "ok": true, "proceeded": should_proceed })
}
