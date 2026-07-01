use std::path::Path;

use serde_json::{json, Value};
use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;

use crate::error::{AppError, Result};
use crate::state::AppState;

pub fn open_path_os(path: &Path) -> Result<()> {
    #[cfg(target_os = "windows")]
    let program = "explorer";
    #[cfg(target_os = "macos")]
    let program = "open";
    #[cfg(all(unix, not(target_os = "macos")))]
    let program = "xdg-open";

    std::process::Command::new(program)
        .arg(path)
        .spawn()
        .map_err(|e| AppError::msg(format!("open path: {e}")))?;
    Ok(())
}

pub fn reveal_in_folder(path: &Path) -> Result<()> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg("/select,")
            .arg(path)
            .spawn()
            .map_err(|e| AppError::msg(format!("reveal: {e}")))?;
        return Ok(());
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-R")
            .arg(path)
            .spawn()
            .map_err(|e| AppError::msg(format!("reveal: {e}")))?;
        return Ok(());
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let parent = path.parent().unwrap_or(path);
        open_path_os(parent)
    }
}

#[tauri::command]
pub fn system_open_external(app: AppHandle, target: String) -> Value {
    match app.opener().open_url(&target, None::<&str>) {
        Ok(_) => json!({ "ok": true }),
        Err(e) => json!({ "ok": false, "error": e.to_string() }),
    }
}

#[tauri::command]
pub fn system_launch_steam(app: AppHandle) -> Value {
    match app.opener().open_url("steam://open/main", None::<&str>) {
        Ok(_) => json!({ "ok": true, "method": "uri" }),
        Err(e) => json!({ "ok": false, "error": e.to_string() }),
    }
}

#[tauri::command]
pub fn download_open(_state: State<'_, AppState>, path: String) -> Value {
    match open_path_os(Path::new(&path)) {
        Ok(_) => json!({ "ok": true }),
        Err(e) => json!({ "ok": false, "error": e.to_string() }),
    }
}

#[tauri::command]
pub fn download_show(_state: State<'_, AppState>, path: String) -> Value {
    match reveal_in_folder(Path::new(&path)) {
        Ok(_) => json!({ "ok": true }),
        Err(e) => json!({ "ok": false, "error": e.to_string() }),
    }
}
