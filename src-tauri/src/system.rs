use std::collections::HashMap;
use std::path::Path;
use std::sync::LazyLock;
use std::time::Duration;

use parking_lot::Mutex;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_opener::OpenerExt;

use crate::error::{AppError, Result};
use crate::state::AppState;

static STEAM_RUNNING: LazyLock<Mutex<HashMap<String, bool>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

pub(crate) fn steam_running_appids() -> Vec<String> {
    STEAM_RUNNING
        .lock()
        .iter()
        .filter(|(_, running)| **running)
        .map(|(appid, _)| appid.clone())
        .collect()
}

pub(crate) fn steam_tracking() -> bool {
    !STEAM_RUNNING.lock().is_empty()
}

#[cfg(target_os = "linux")]
fn process_running_in(install_path: &Path) -> bool {
    let Ok(processes) = std::fs::read_dir("/proc") else {
        return false;
    };
    processes.flatten().any(|entry| {
        if !entry
            .file_name()
            .to_str()
            .is_some_and(|pid| pid.bytes().all(|byte| byte.is_ascii_digit()))
        {
            return false;
        }
        std::fs::read_link(entry.path().join("exe")).is_ok_and(|exe| exe.starts_with(install_path))
            || std::fs::read(entry.path().join("cmdline")).is_ok_and(|command| {
                String::from_utf8_lossy(&command)
                    .split('\0')
                    .any(|arg| Path::new(arg.trim_matches('"')).starts_with(install_path))
            })
    })
}

#[cfg(windows)]
fn process_running_in(install_path: &Path) -> bool {
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    };
    use windows_sys::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
    };

    let mut root = install_path
        .to_string_lossy()
        .replace('/', "\\")
        .to_ascii_lowercase();
    if !root.ends_with('\\') {
        root.push('\\');
    }
    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snapshot == INVALID_HANDLE_VALUE {
            return false;
        }
        let mut entry: PROCESSENTRY32W = std::mem::zeroed();
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        let mut found = false;
        let mut has_entry = Process32FirstW(snapshot, &mut entry) != 0;
        while has_entry {
            let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, entry.th32ProcessID);
            if !process.is_null() {
                let mut path = [0u16; 32_768];
                let mut size = path.len() as u32;
                if QueryFullProcessImageNameW(process, 0, path.as_mut_ptr(), &mut size) != 0 {
                    let executable = String::from_utf16_lossy(&path[..size as usize]);
                    found = executable.to_ascii_lowercase().starts_with(&root);
                }
                CloseHandle(process);
                if found {
                    break;
                }
            }
            has_entry = Process32NextW(snapshot, &mut entry) != 0;
        }
        CloseHandle(snapshot);
        found
    }
}

#[cfg(target_os = "macos")]
fn process_running_in(install_path: &Path) -> bool {
    let Ok(output) = std::process::Command::new("ps")
        .args(["-axo", "command="])
        .output()
    else {
        return false;
    };
    let root = install_path.to_string_lossy();
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .any(|command| command.trim_start_matches('"').starts_with(root.as_ref()))
}

fn track_steam_game(app: AppHandle, appid: String, install_path: String) {
    {
        let mut running = STEAM_RUNNING.lock();
        if running.contains_key(&appid) {
            return;
        }
        running.insert(appid.clone(), false);
    }
    let pending_appid = appid.clone();
    let failure_app = app.clone();
    let spawned = std::thread::Builder::new()
        .name(format!("steam-game-{appid}"))
        .spawn(move || {
            let install_path = Path::new(&install_path);
            let appeared = (0..480).any(|_| {
                if process_running_in(install_path) {
                    true
                } else {
                    std::thread::sleep(Duration::from_millis(250));
                    false
                }
            });
            if !appeared {
                STEAM_RUNNING.lock().remove(&appid);
                crate::launch::exit_after_game_if_requested(app);
                return;
            }
            let started_at = crate::downloads::now_ms();
            STEAM_RUNNING.lock().insert(appid.clone(), true);
            app.emit(
                "uc:presence-changed",
                json!({ "reason": "game-started", "appid": appid, "startedAt": started_at, "activityRecorded": true }),
            )
            .ok();

            let mut absent_checks = 0;
            let mut ended_at = started_at;
            while absent_checks < 10 {
                std::thread::sleep(Duration::from_millis(500));
                if process_running_in(install_path) {
                    absent_checks = 0;
                } else {
                    if absent_checks == 0 {
                        ended_at = crate::downloads::now_ms();
                    }
                    absent_checks += 1;
                }
            }
            crate::settings::merge_library_game_meta(
                &app,
                &appid,
                serde_json::Map::new(),
                (ended_at - started_at).max(0) as u64,
            );
            STEAM_RUNNING.lock().remove(&appid);
            app.emit(
                "uc:presence-changed",
                json!({ "reason": "game-exited", "appid": appid, "activityRecorded": true }),
            )
            .ok();
            crate::launch::exit_after_game_if_requested(app);
        });
    if spawned.is_err() {
        STEAM_RUNNING.lock().remove(&pending_appid);
        crate::launch::exit_after_game_if_requested(failure_app);
    }
}

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

/// Whether a target is safe to hand to the OS opener: only well-known web,
/// Steam and magnet links. A compromised catalog response must not be able
/// to trigger file:// readers or custom protocol handlers.
fn openable_externally(target: &str) -> bool {
    url::Url::parse(target)
        .map(|parsed| {
            matches!(
                parsed.scheme(),
                "http" | "https" | "steam" | "magnet"
            )
        })
        .unwrap_or(false)
}

#[tauri::command(async)]
pub fn system_open_external(app: AppHandle, target: String) -> Value {
    if !openable_externally(&target) {
        return json!({ "ok": false, "error": "unsupported url scheme" });
    }
    match app.opener().open_url(&target, None::<&str>) {
        Ok(_) => json!({ "ok": true }),
        Err(e) => json!({ "ok": false, "error": e.to_string() }),
    }
}

#[tauri::command(async)]
pub fn system_launch_steam(app: AppHandle) -> Value {
    match app.opener().open_url("steam://open/main", None::<&str>) {
        Ok(_) => json!({ "ok": true, "method": "uri" }),
        Err(e) => json!({ "ok": false, "error": e.to_string() }),
    }
}

#[tauri::command(async)]
pub fn steam_game_run(
    app: AppHandle,
    appid: String,
    steam_appid: u64,
    install_path: String,
) -> Value {
    match app
        .opener()
        .open_url(format!("steam://rungameid/{steam_appid}"), None::<&str>)
    {
        Ok(_) => {
            let launched_at = crate::downloads::now_ms();
            crate::settings::merge_library_game_meta(
                &app,
                &appid,
                serde_json::Map::from_iter([("lastPlayedAt".to_string(), json!(launched_at))]),
                0,
            );
            let install_path = if install_path.trim().is_empty() {
                crate::import::steam_install_path(steam_appid)
            } else {
                Some(install_path.into())
            };
            if let Some(install_path) = install_path {
                track_steam_game(
                    app.clone(),
                    appid,
                    install_path.to_string_lossy().into_owned(),
                );
            }
            if app
                .state::<AppState>()
                .settings
                .get("closeOnGameLaunch")
                .as_bool()
                .unwrap_or(false)
            {
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(Duration::from_secs(3)).await;
                    crate::hide_app_ui(&app);
                });
            }
            json!({ "ok": true })
        }
        Err(e) => json!({ "ok": false, "error": e.to_string() }),
    }
}

#[tauri::command(async)]
pub fn download_open(_state: State<'_, AppState>, path: String) -> Value {
    match open_path_os(Path::new(&path)) {
        Ok(_) => json!({ "ok": true }),
        Err(e) => json!({ "ok": false, "error": e.to_string() }),
    }
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    #[test]
    fn steam_tracker_detects_processes_launched_from_install_path() {
        let temp = tempfile::tempdir().unwrap();
        let script = temp.path().join("game.sh");
        std::fs::write(&script, "#!/bin/sh\nsleep 5\n").unwrap();
        let mut permissions = std::fs::metadata(&script).unwrap().permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(&script, permissions).unwrap();
        let mut child = std::process::Command::new(&script).spawn().unwrap();
        let detected = (0..50).any(|_| {
            if process_running_in(temp.path()) {
                true
            } else {
                std::thread::sleep(Duration::from_millis(10));
                false
            }
        });
        child.kill().ok();
        child.wait().ok();
        assert!(detected);
    }

    #[test]
    fn open_external_allowlist_covers_known_schemes_only() {
        for target in [
            "https://online-fix.me/game",
            "http://example.com/x?y=1",
            "steam://store/620",
            "magnet:?xt=urn:btih:abc",
        ] {
            assert!(openable_externally(target), "{target}");
        }
        for target in [
            "file:///etc/passwd",
            "ms-settings:",
            "javascript:alert(1)",
            "not a url",
            "ftp://example.com/x",
            "gopher://example.com",
        ] {
            assert!(!openable_externally(target), "{target}");
        }
    }

}
