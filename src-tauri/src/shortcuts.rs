use serde_json::{json, Value};

fn desktop_dir() -> Option<std::path::PathBuf> {
    dirs::desktop_dir()
}

#[tauri::command]
pub fn create_desktop_shortcut(game_name: String, _appid: String, exe_path: Option<String>) -> Value {
    let desktop = match desktop_dir() {
        Some(d) => d,
        None => return json!({ "ok": false, "error": "no desktop dir" }),
    };
    let exe = match exe_path {
        Some(e) if !e.is_empty() => e,
        _ => return json!({ "ok": false, "error": "no executable set" }),
    };
    let safe = crate::downloads::safe_folder_name(&game_name);

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let file = desktop.join(format!("{safe}.desktop"));
        if file.exists() {
            return json!({ "ok": true, "existed": true });
        }
        let cwd = std::path::Path::new(&exe).parent().map(|p| p.to_string_lossy().to_string()).unwrap_or_default();
        let content = format!(
            "[Desktop Entry]\nType=Application\nName={game_name}\nExec=\"{exe}\"\nPath={cwd}\nTerminal=false\nCategories=Game;\n"
        );
        match std::fs::write(&file, content) {
            Ok(_) => {
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o755)).ok();
                }
                json!({ "ok": true })
            }
            Err(e) => json!({ "ok": false, "error": e.to_string() }),
        }
    }

    #[cfg(target_os = "windows")]
    {
        let lnk = desktop.join(format!("{safe}.lnk"));
        if lnk.exists() {
            return json!({ "ok": true, "existed": true });
        }
        let script = format!(
            "$s=(New-Object -ComObject WScript.Shell).CreateShortcut('{}');$s.TargetPath='{}';$s.WorkingDirectory='{}';$s.Save()",
            lnk.display(),
            exe,
            std::path::Path::new(&exe).parent().map(|p| p.to_string_lossy().to_string()).unwrap_or_default()
        );
        match std::process::Command::new("powershell").args(["-NoProfile", "-Command", &script]).output() {
            Ok(o) if o.status.success() => json!({ "ok": true }),
            Ok(o) => json!({ "ok": false, "error": String::from_utf8_lossy(&o.stderr).to_string() }),
            Err(e) => json!({ "ok": false, "error": e.to_string() }),
        }
    }

    #[cfg(target_os = "macos")]
    {
        let _ = (desktop, exe, safe);
        json!({ "ok": false, "error": "shortcuts not supported on macos" })
    }
}

#[tauri::command]
pub fn delete_desktop_shortcut(game_name: String) -> Value {
    let desktop = match desktop_dir() {
        Some(d) => d,
        None => return json!({ "ok": false, "error": "no desktop dir" }),
    };
    let safe = crate::downloads::safe_folder_name(&game_name);
    let ext = if cfg!(windows) { "lnk" } else { "desktop" };
    let file = desktop.join(format!("{safe}.{ext}"));
    std::fs::remove_file(&file).ok();
    json!({ "ok": true })
}
