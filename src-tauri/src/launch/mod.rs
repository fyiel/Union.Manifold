pub mod linux;
mod steam_api;

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use once_cell::sync::Lazy;
use parking_lot::Mutex;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::downloads::now_ms;
use crate::state::AppState;

#[derive(Clone)]
struct RunHandle {
    pid: u32,
    scope: Option<String>,
}

static RUNNING: Lazy<Mutex<HashMap<String, RunHandle>>> = Lazy::new(|| Mutex::new(HashMap::new()));

fn close_on_launch_enabled(settings: &crate::settings::SettingsStore) -> bool {
    settings.get("closeOnGameLaunch").as_bool().unwrap_or(false)
}

#[cfg(target_os = "linux")]
fn systemd_run_available() -> bool {
    std::env::var("PATH")
        .ok()
        .map(|path| {
            path.split(':')
                .any(|d| Path::new(d).join("systemd-run").is_file())
        })
        .unwrap_or(false)
}

fn install_dir_for(state: &AppState, appid: &str) -> Option<PathBuf> {
    crate::library::game_files_dir(&crate::library::scan_roots(state), appid)
}

fn executable_on_path(name: &str) -> Option<String> {
    if let Some(path) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path) {
            let candidate = dir.join(name);
            if candidate.is_file() {
                return Some(candidate.to_string_lossy().to_string());
            }
        }
    }
    if let Some(home) = dirs::home_dir() {
        let candidate = home.join(".local/bin").join(name);
        if candidate.is_file() {
            return Some(candidate.to_string_lossy().to_string());
        }
    }
    None
}

fn mod_engine_executable() -> Option<String> {
    if cfg!(windows) {
        executable_on_path("me3.exe").or_else(|| executable_on_path("me3"))
    } else {
        executable_on_path("me3")
    }
}

fn mod_engine_launch_args(profile: &Path, exe_path: &str) -> Vec<String> {
    vec![
        "launch".to_string(),
        "-p".to_string(),
        profile.to_string_lossy().to_string(),
        "--exe-path".to_string(),
        exe_path.to_string(),
    ]
}

fn mewgenics_launch_args(exe_path: &str, mod_paths: Vec<PathBuf>) -> Vec<String> {
    if mod_paths.is_empty() {
        return Vec::new();
    }
    let windows_paths = !cfg!(windows) && exe_path.to_ascii_lowercase().ends_with(".exe");
    let mut args = Vec::with_capacity(mod_paths.len() + 1);
    args.push("-modpaths".to_string());
    args.extend(mod_paths.into_iter().map(|path| {
        let path = path.to_string_lossy();
        if windows_paths {
            format!("Z:{}", path.replace('\\', "/"))
        } else {
            path.into_owned()
        }
    }));
    args
}

fn is_executable_candidate(path: &Path) -> bool {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if cfg!(windows) {
        return name.ends_with(".exe");
    }
    if name.ends_with(".exe") {
        return true;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = std::fs::metadata(path) {
            if meta.is_file() && meta.permissions().mode() & 0o111 != 0 {
                let has_ext = name.rsplit_once('.').is_some();
                return !has_ext
                    || name.ends_with(".sh")
                    || name.ends_with(".x86_64")
                    || name.ends_with(".bin");
            }
        }
    }
    false
}

#[tauri::command(async)]
pub fn game_exe_list(state: State<'_, AppState>, appid: String) -> Value {
    let dir = match install_dir_for(&state, &appid) {
        Some(d) => d,
        None => return json!({ "ok": false, "exes": [], "error": "not installed" }),
    };
    let mut exes = Vec::new();
    for entry in walkdir::WalkDir::new(&dir)
        .max_depth(6)
        .into_iter()
        .flatten()
    {
        let path = entry.path();
        if is_executable_candidate(path) {
            let depth = entry.depth();
            let size = entry.metadata().ok().map(|m| m.len()).unwrap_or(0);
            exes.push(json!({
                "name": path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
                "path": path.to_string_lossy(),
                "size": size,
                "depth": depth,
            }));
        }
    }
    exes.sort_by(|a, b| {
        let da = a.get("depth").and_then(|v| v.as_u64()).unwrap_or(0);
        let db = b.get("depth").and_then(|v| v.as_u64()).unwrap_or(0);
        da.cmp(&db).then_with(|| {
            a.get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .cmp(b.get("name").and_then(|v| v.as_str()).unwrap_or(""))
        })
    });
    json!({ "ok": true, "folder": dir.to_string_lossy(), "exes": exes })
}

#[tauri::command(async)]
pub fn game_subfolder_find(folder: String) -> Value {
    let path = Path::new(&folder);
    let entries: Vec<PathBuf> = std::fs::read_dir(path)
        .map(|rd| {
            rd.flatten()
                .map(|e| e.path())
                .filter(|p| p.is_dir())
                .collect()
        })
        .unwrap_or_default();
    if entries.len() == 1 {
        return json!(entries[0].to_string_lossy());
    }
    Value::Null
}

#[tauri::command(async)]
pub fn game_exe_preflight(state: State<'_, AppState>, appid: String, exe_path: String) -> Value {
    let mut checks = Vec::new();
    let exists = Path::new(&exe_path).is_file();
    if !exists {
        checks.push(
            json!({ "level": "error", "code": "exe-not-found", "message": "executable not found" }),
        );
    }
    let profile = crate::mods::active_mod_engine_profile(&state, &appid);
    let (loader_ready, resolved) = if let Some(profile) = profile {
        if let Some(command) = mod_engine_executable() {
            (
                true,
                json!({
                    "command": command,
                    "args": mod_engine_launch_args(&profile, &exe_path),
                    "loader": "mod-engine-3",
                }),
            )
        } else {
            checks.push(json!({
                "level": "error",
                "code": "mod-engine-3-not-found",
                "message": "Mod Engine 3 mods are enabled, but the me3 executable is not on PATH",
            }));
            (
                false,
                linux::build_launch_command(&state, &appid, &exe_path),
            )
        }
    } else {
        (true, linux::build_launch_command(&state, &appid, &exe_path))
    };
    json!({
        "ok": true,
        "canLaunch": exists && loader_ready,
        "checks": checks,
        "resolved": resolved,
    })
}

fn spawn_and_track(
    app: &AppHandle,
    appid: &str,
    command: &str,
    args: &[String],
    cwd: &Path,
    envs: &[(String, String)],
    exe_path: &str,
    game_name: Option<String>,
    achievement_context: crate::achievements::GameContext,
) -> Result<u32, String> {
    #[cfg_attr(not(target_os = "linux"), allow(unused_mut))]
    let mut scope: Option<String> = None;
    #[cfg(target_os = "linux")]
    let mut cmd = if systemd_run_available() {
        let unit = format!(
            "uc-game-{}-{}",
            std::process::id(),
            appid
                .chars()
                .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
                .collect::<String>()
        );
        let mut c = std::process::Command::new("systemd-run");
        c.arg("--user")
            .arg("--scope")
            .arg("--collect")
            .arg("--quiet")
            .arg(format!("--unit={unit}"))
            .arg("--")
            .arg(command)
            .args(args);
        scope = Some(format!("{unit}.scope"));
        c
    } else {
        let mut c = std::process::Command::new(command);
        c.args(args);
        c
    };
    #[cfg(not(target_os = "linux"))]
    let mut cmd = {
        let mut c = std::process::Command::new(command);
        c.args(args);
        c
    };
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
        cmd.stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null());
    }
    #[cfg(unix)]
    if scope.is_none() {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }
    cmd.current_dir(cwd);
    for (k, v) in envs {
        cmd.env(k, v);
    }
    use std::collections::hash_map::Entry;
    let child = {
        let mut running = RUNNING.lock();
        match running.entry(appid.to_string()) {
            Entry::Occupied(_) => return Err("already running".to_string()),
            Entry::Vacant(slot) => {
                let child = cmd.spawn().map_err(|e| e.to_string())?;
                slot.insert(RunHandle {
                    pid: child.id(),
                    scope,
                });
                child
            }
        }
    };
    let pid = child.id();
    let started_at = now_ms();
    app.emit(
        "uc:presence-changed",
        json!({ "reason": "game-started", "appid": appid, "gameName": game_name }),
    )
    .ok();
    app.state::<AppState>()
        .achievements
        .start_watch(app.clone(), achievement_context);
    let app2 = app.clone();
    let appid2 = appid.to_string();
    let exe2 = exe_path.to_string();
    let name2 = game_name.clone();
    let reaper = std::thread::Builder::new()
        .name(format!("game-reaper-{appid}"))
        .spawn(move || {
            let mut child = child;
            let _ = child.wait();
            app2.state::<AppState>()
                .achievements
                .finish_watch(&app2, &appid2);
            let elapsed = now_ms() - started_at;
            RUNNING.lock().remove(&appid2);
            app2.emit(
                "uc:presence-changed",
                json!({ "reason": "game-exited", "appid": appid2 }),
            )
            .ok();
            if elapsed >= 10_000 {
                let name = name2.unwrap_or_else(|| appid2.clone());
                crate::notify::send_if(
                    &app2,
                    "notifyGameExit",
                    false,
                    "Game exited",
                    &format!("{name} closed"),
                );
            }
            if elapsed < 10_000 {
                app2.emit(
                    "uc:game-quick-exit",
                    json!({ "appid": appid2, "exePath": exe2, "elapsed": elapsed }),
                )
                .ok();
            }
        });
    if let Err(e) = reaper {
        RUNNING.lock().remove(appid);
        crate::logging::write_line(
            "error",
            &format!("game reaper thread spawn failed for {appid}: {e}"),
        );
    }
    Ok(pid)
}

#[tauri::command(async)]
pub async fn game_exe_launch(
    app: AppHandle,
    appid: String,
    exe_path: String,
    game_name: Option<String>,
    _show_game_name: Option<bool>,
) -> Result<Value, String> {
    if !Path::new(&exe_path).is_file() {
        return Ok(json!({ "ok": false, "error": "executable not found" }));
    }
    let cache_root = app.state::<AppState>().paths.data_dir.clone();
    if let Err(error) = steam_api::repair_if_needed(&cache_root, &appid, Path::new(&exe_path)).await
    {
        return Ok(json!({ "ok": false, "error": error }));
    }
    let state = app.state::<AppState>();
    let cwd = Path::new(&exe_path)
        .parent()
        .map(PathBuf::from)
        .unwrap_or_else(|| state.download_root());
    let mut plan = match linux::resolve_launch(&state, &appid, &exe_path) {
        Ok(p) => p,
        Err(e) => return Ok(json!({ "ok": false, "error": e })),
    };
    plan.args.extend(mewgenics_launch_args(
        &exe_path,
        crate::mods::active_mewgenics_mod_paths(&state, &appid),
    ));
    let achievement_context = crate::achievements::launch_context(
        &state,
        &appid,
        &exe_path,
        game_name.as_deref(),
        &plan.envs,
    );
    let (command, args, envs, launch_mode) =
        if let Some(profile) = crate::mods::active_mod_engine_profile(&state, &appid) {
            let Some(command) = mod_engine_executable() else {
                return Ok(json!({
                    "ok": false,
                    "error": "Mod Engine 3 mods are enabled, but the me3 executable is not on PATH",
                }));
            };
            (
                command,
                mod_engine_launch_args(&profile, &exe_path),
                Vec::new(),
                "mod-engine-3",
            )
        } else {
            (plan.command, plan.args, plan.envs, "direct")
        };
    Ok(
        match spawn_and_track(
            &app,
            &appid,
            &command,
            &args,
            &cwd,
            &envs,
            &exe_path,
            game_name,
            achievement_context,
        ) {
            Ok(pid) => {
                if close_on_launch_enabled(&state.settings) {
                    let app2 = app.clone();
                    tauri::async_runtime::spawn(async move {
                        tokio::time::sleep(std::time::Duration::from_secs(3)).await;
                        app2.exit(0);
                    });
                }
                json!({ "ok": true, "pid": pid, "launchMode": launch_mode })
            }
            Err(e) => json!({ "ok": false, "error": e }),
        },
    )
}

#[tauri::command(async)]
pub fn game_exe_running_list() -> Value {
    let running = RUNNING.lock();
    let appids: Vec<String> = running.keys().cloned().collect();
    json!({ "ok": true, "appids": appids })
}

#[tauri::command(async)]
pub fn game_exe_quit(appid: String) -> Value {
    let handle = RUNNING.lock().get(&appid).cloned();
    if let Some(handle) = handle {
        kill_handle(&handle);
        return json!({ "ok": true, "stopped": true });
    }
    json!({ "ok": true, "stopped": false })
}

fn kill_handle(handle: &RunHandle) {
    if let Some(scope) = &handle.scope {
        let scope = scope.clone();
        std::process::Command::new("systemctl")
            .args(["--user", "kill", "--signal=SIGTERM", &scope])
            .status()
            .ok();
        std::thread::Builder::new()
            .name("game-kill-escalate".into())
            .spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(4));
                std::process::Command::new("systemctl")
                    .args(["--user", "kill", "--signal=SIGKILL", &scope])
                    .status()
                    .ok();
            })
            .ok();
        return;
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("taskkill")
            .args(["/PID", &handle.pid.to_string(), "/T", "/F"])
            .creation_flags(0x08000000)
            .spawn()
            .ok();
    }
    #[cfg(unix)]
    {
        let group = format!("-{}", handle.pid);
        std::process::Command::new("kill")
            .args(["-TERM", "--", &group])
            .status()
            .ok();
        std::thread::Builder::new()
            .name("game-kill-escalate".into())
            .spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(4));
                std::process::Command::new("kill")
                    .args(["-KILL", "--", &group])
                    .status()
                    .ok();
            })
            .ok();
    }
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::*;

    #[test]
    fn close_on_launch_exits_even_with_achievement_popups() {
        let tmp = tempfile::tempdir().unwrap();
        let settings = crate::settings::SettingsStore::load(tmp.path().join("settings.json"));
        settings.set("closeOnGameLaunch", json!(true));
        settings.set("achievementNotifications", json!(true));
        assert!(close_on_launch_enabled(&settings));
        settings.set("achievementNotifications", json!(false));
        assert!(close_on_launch_enabled(&settings));
    }

    #[test]
    fn kill_handle_reaps_detached_tree() {
        if !systemd_run_available() {
            eprintln!("skipping, no systemd-run");
            return;
        }
        let unit = format!("uc-game-test-{}", std::process::id());
        let scope = format!("{unit}.scope");
        let mut child = std::process::Command::new("systemd-run")
            .args([
                "--user",
                "--scope",
                "--collect",
                "--quiet",
                &format!("--unit={unit}"),
                "--",
                "sh",
                "-c",
                "sleep 300 & sleep 300",
            ])
            .spawn()
            .expect("spawn scope");
        std::thread::sleep(std::time::Duration::from_millis(600));
        kill_handle(&RunHandle {
            pid: child.id(),
            scope: Some(scope.clone()),
        });
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(8);
        loop {
            let alive = std::process::Command::new("systemctl")
                .args(["--user", "is-active", "--quiet", &scope])
                .status()
                .map(|s| s.success())
                .unwrap_or(false);
            if !alive {
                break;
            }
            assert!(
                std::time::Instant::now() < deadline,
                "scope survived kill_handle"
            );
            std::thread::sleep(std::time::Duration::from_millis(300));
        }
        let _ = child.wait();
    }

    #[test]
    fn mod_engine_launch_uses_profile_and_game_executable() {
        let args = mod_engine_launch_args(
            Path::new("/tmp/profile with spaces.me3"),
            "/games/Elden Ring/Game/eldenring.exe",
        );
        assert_eq!(
            args,
            vec![
                "launch",
                "-p",
                "/tmp/profile with spaces.me3",
                "--exe-path",
                "/games/Elden Ring/Game/eldenring.exe",
            ]
        );
    }

    #[test]
    fn mewgenics_launch_uses_proton_paths_in_mod_order() {
        let args = mewgenics_launch_args(
            "/games/Mewgenics/Mewgenics.exe",
            vec![
                PathBuf::from("/data/mods/nexus-2"),
                PathBuf::from("/data/mods/nexus-1"),
            ],
        );
        assert_eq!(
            args,
            vec!["-modpaths", "Z:/data/mods/nexus-2", "Z:/data/mods/nexus-1",]
        );
    }
}
