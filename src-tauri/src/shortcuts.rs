use serde_json::{json, Value};

fn desktop_dir() -> Option<std::path::PathBuf> {
    dirs::desktop_dir()
}

fn desktop_entry_escape(value: &str) -> String {
    // Desktop-entry spec: backslash escapes the next character, so a quote
    // or backslash in a path cannot break out of the Exec/Path quoting.
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

#[tauri::command(async)]
pub fn create_desktop_shortcut(
    game_name: String,
    _appid: String,
    exe_path: Option<String>,
) -> Value {
    let desktop = match desktop_dir() {
        Some(d) => d,
        None => return json!({ "ok": false, "error": "no desktop dir" }),
    };
    let exe = match exe_path {
        Some(e) if !e.is_empty() => e,
        _ => return json!({ "ok": false, "error": "no executable set" }),
    };
    if exe.contains(['\r', '\n']) {
        return json!({ "ok": false, "error": "executable path contains a newline" });
    }
    let safe = crate::downloads::safe_folder_name(&game_name);

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let file = desktop.join(format!("{safe}.desktop"));
        if file.exists() {
            return json!({ "ok": true, "existed": true });
        }
        let cwd = std::path::Path::new(&exe)
            .parent()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();
        // A newline in Name would inject arbitrary keys into the entry;
        // quotes in Exec/Path would break out of the quoting.
        let name = game_name.replace(['\r', '\n'], " ");
        let content = format!(
            "[Desktop Entry]\nType=Application\nName={name}\nExec=\"{}\"\nPath={}\nTerminal=false\nCategories=Game;\n",
            desktop_entry_escape(&exe),
            desktop_entry_escape(&cwd),
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
        // PowerShell single-quoted strings escape a quote by doubling it;
        // without this a game title or path containing ' would break out of
        // the script string.
        let ps_quote = |value: &str| value.replace('\'', "''");
        let script = format!(
            "$s=(New-Object -ComObject WScript.Shell).CreateShortcut('{}');$s.TargetPath='{}';$s.WorkingDirectory='{}';$s.Save()",
            ps_quote(&lnk.display().to_string()),
            ps_quote(&exe),
            ps_quote(
                &std::path::Path::new(&exe)
                    .parent()
                    .map(|p| p.to_string_lossy().to_string())
                    .unwrap_or_default()
            ),
        );
        use std::os::windows::process::CommandExt;
        match std::process::Command::new("powershell")
            .args(["-NoProfile", "-Command", &script])
            .creation_flags(0x08000000)
            .output()
        {
            Ok(o) if o.status.success() => json!({ "ok": true }),
            Ok(o) => {
                json!({ "ok": false, "error": String::from_utf8_lossy(&o.stderr).to_string() })
            }
            Err(e) => json!({ "ok": false, "error": e.to_string() }),
        }
    }

    #[cfg(target_os = "macos")]
    {
        let _ = (desktop, exe, safe);
        json!({ "ok": false, "error": "shortcuts not supported on macos" })
    }
}

#[tauri::command(async)]
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn desktop_entry_escape_neutralizes_quotes_and_backslashes() {
        assert_eq!(desktop_entry_escape(r#"a"b\c"#), r#"a\"b\\c"#);
        assert_eq!(desktop_entry_escape("plain"), "plain");
    }
}
