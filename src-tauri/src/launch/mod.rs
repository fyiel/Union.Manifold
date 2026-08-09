pub mod linux;
mod steam_api;

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use std::sync::LazyLock;
use parking_lot::Mutex;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::downloads::now_ms;
use crate::state::AppState;

#[derive(Clone)]
struct RunHandle {
    pid: u32,
    scope: Option<String>,
    #[cfg(windows)]
    process_handle: Option<std::sync::Arc<std::os::windows::io::OwnedHandle>>,
}

static RUNNING: LazyLock<Mutex<HashMap<String, RunHandle>>> = LazyLock::new(|| Mutex::new(HashMap::new()));

fn close_on_launch_enabled(settings: &crate::settings::SettingsStore) -> bool {
    settings.get("closeOnGameLaunch").as_bool().unwrap_or(false)
}

fn steam_compatibility_fixes_enabled(settings: &crate::settings::SettingsStore) -> bool {
    settings
        .get("linuxSteamCompatibilityFixes")
        .as_bool()
        .unwrap_or(true)
}

#[cfg(any(windows, all(test, target_os = "linux")))]
fn split_windows_launch_args(raw: &str) -> Vec<String> {
    let mut args = Vec::new();
    let mut chars = raw.chars().peekable();

    loop {
        while matches!(chars.peek(), Some(' ' | '\t')) {
            chars.next();
        }
        if chars.peek().is_none() {
            break;
        }

        let mut arg = String::new();
        let mut in_quotes = false;
        while let Some(&ch) = chars.peek() {
            if !in_quotes && matches!(ch, ' ' | '\t') {
                break;
            }
            if ch != '\\' && ch != '"' {
                arg.push(ch);
                chars.next();
                continue;
            }

            let mut backslashes = 0;
            while chars.peek() == Some(&'\\') {
                chars.next();
                backslashes += 1;
            }
            if chars.peek() != Some(&'"') {
                arg.extend(std::iter::repeat('\\').take(backslashes));
                continue;
            }

            arg.extend(std::iter::repeat('\\').take(backslashes / 2));
            chars.next();
            if backslashes % 2 == 1 {
                arg.push('"');
            } else if in_quotes && chars.peek() == Some(&'"') {
                chars.next();
                arg.push('"');
            } else {
                in_quotes = !in_quotes;
            }
        }
        args.push(arg);
    }

    args
}

fn configured_launch_args(
    settings: &crate::settings::SettingsStore,
    appid: &str,
) -> Result<Vec<String>, String> {
    let launch_args = settings.get("gameLaunchArgs");
    let raw = launch_args
        .get(appid)
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    if raw.is_empty() {
        return Ok(Vec::new());
    }
    #[cfg(windows)]
    return Ok(split_windows_launch_args(raw));
    #[cfg(not(windows))]
    shlex::split(raw).ok_or_else(|| "launch options contain an unclosed quote".to_string())
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

fn already_running() -> std::io::Error {
    std::io::Error::new(std::io::ErrorKind::AlreadyExists, "already running")
}

fn install_dir_for(state: &AppState, appid: &str) -> Option<PathBuf> {
    crate::library::game_files_dir(&crate::library::scan_roots(state), appid)
}

fn mod_engine_executable() -> Option<String> {
    crate::launch::linux::which("me3.exe").or_else(|| crate::launch::linux::which("me3"))
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

fn is_elevation_required(error: &std::io::Error) -> bool {
    error.raw_os_error() == Some(740)
}

fn is_elevation_cancelled(error: &std::io::Error) -> bool {
    error.raw_os_error() == Some(1223)
}

#[cfg(any(windows, test))]
fn quote_windows_arg(arg: &str) -> String {
    let mut quoted = String::from("\"");
    let mut backslashes = 0;
    for ch in arg.chars() {
        if ch == '\\' {
            backslashes += 1;
            continue;
        }
        if ch == '"' {
            for _ in 0..(backslashes * 2 + 1) {
                quoted.push('\\');
            }
            quoted.push('"');
        } else {
            for _ in 0..backslashes {
                quoted.push('\\');
            }
            quoted.push(ch);
        }
        backslashes = 0;
    }
    for _ in 0..(backslashes * 2) {
        quoted.push('\\');
    }
    quoted.push('"');
    quoted
}

#[cfg(any(windows, test))]
fn windows_parameters(args: &[String]) -> String {
    args.iter()
        .map(|arg| quote_windows_arg(arg))
        .collect::<Vec<_>>()
        .join(" ")
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

pub(crate) fn exit_after_game_if_requested(app: AppHandle) {
    if !close_on_launch_enabled(&app.state::<AppState>().settings) {
        return;
    }
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        if RUNNING.lock().is_empty() && !crate::system::steam_tracking() {
            app.exit(0);
        }
    });
}

fn finish_tracked_game(
    app: &AppHandle,
    appid: &str,
    exe_path: &str,
    game_name: Option<&str>,
    started_at: i64,
) {
    app.state::<AppState>()
        .achievements
        .finish_watch(app, appid);
    let elapsed = now_ms() - started_at;
    crate::settings::merge_library_game_meta(
        app,
        appid,
        serde_json::Map::new(),
        elapsed.max(0) as u64,
    );
    RUNNING.lock().remove(appid);
    app.emit(
        "uc:presence-changed",
        json!({ "reason": "game-exited", "appid": appid, "activityRecorded": true }),
    )
    .ok();
    if elapsed >= 10_000 {
        crate::notify::send_if(
            app,
            "notifyGameExit",
            false,
            "Game exited",
            &format!("{} closed", game_name.unwrap_or(appid)),
        );
    }
    if elapsed < 10_000 {
        app.emit(
            "uc:game-quick-exit",
            json!({ "appid": appid, "exePath": exe_path, "elapsed": elapsed }),
        )
        .ok();
    }
    exit_after_game_if_requested(app.clone());
}

// Flat argv mirrors the Tauri command surface this helper feeds; bundling
// into a struct would add ceremony for a single internal call site.
#[allow(clippy::too_many_arguments)]
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
) -> std::io::Result<u32> {
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
        cmd.creation_flags(windows_sys::Win32::System::Threading::CREATE_NO_WINDOW);
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
            Entry::Occupied(_) => {
                return Err(already_running())
            }
            Entry::Vacant(slot) => {
                let child = cmd.spawn()?;
                slot.insert(RunHandle {
                    pid: child.id(),
                    scope,
                    #[cfg(windows)]
                    process_handle: None,
                });
                child
            }
        }
    };
    let pid = child.id();
    let started_at = now_ms();
    crate::settings::merge_library_game_meta(
        app,
        appid,
        serde_json::Map::from_iter([("lastPlayedAt".to_string(), json!(started_at))]),
        0,
    );
    app.emit(
        "uc:presence-changed",
        json!({ "reason": "game-started", "appid": appid, "gameName": game_name, "startedAt": started_at, "activityRecorded": true }),
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
            finish_tracked_game(&app2, &appid2, &exe2, name2.as_deref(), started_at);
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

#[cfg(windows)]
fn spawn_elevated_and_track(
    app: &AppHandle,
    appid: &str,
    command: &str,
    args: &[String],
    cwd: &Path,
    exe_path: &str,
    game_name: Option<String>,
    achievement_context: crate::achievements::GameContext,
) -> std::io::Result<u32> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle, RawHandle};
    use windows_sys::Win32::System::Threading::{GetProcessId, WaitForSingleObject, INFINITE};
    use windows_sys::Win32::UI::Shell::{
        ShellExecuteExW, SEE_MASK_NOASYNC, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW,
    };

    fn wide(value: &OsStr) -> std::io::Result<Vec<u16>> {
        let encoded: Vec<u16> = value.encode_wide().collect();
        if encoded.contains(&0) {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "launch value contains a null character",
            ));
        }
        Ok(encoded.into_iter().chain(std::iter::once(0)).collect())
    }

    let verb = wide(OsStr::new("runas"))?;
    let file = wide(OsStr::new(command))?;
    let parameters_text = windows_parameters(args);
    let parameters = wide(OsStr::new(&parameters_text))?;
    let directory = wide(cwd.as_os_str())?;
    let mut info: SHELLEXECUTEINFOW = unsafe { std::mem::zeroed() };
    info.cbSize = std::mem::size_of::<SHELLEXECUTEINFOW>() as u32;
    info.fMask = SEE_MASK_NOCLOSEPROCESS | SEE_MASK_NOASYNC;
    info.lpVerb = verb.as_ptr();
    info.lpFile = file.as_ptr();
    info.lpParameters = parameters.as_ptr();
    info.lpDirectory = directory.as_ptr();
    info.nShow = 1;

    let mut running = RUNNING.lock();
    if running.contains_key(appid) {
        return Err(already_running());
    }
    if unsafe { ShellExecuteExW(&mut info) } == 0 {
        return Err(std::io::Error::last_os_error());
    }
    if info.hProcess.is_null() {
        return Err(std::io::Error::other(
            "Windows started the game without returning a process handle",
        ));
    }
    let process_handle =
        std::sync::Arc::new(unsafe { OwnedHandle::from_raw_handle(info.hProcess as RawHandle) });
    let pid = unsafe {
        GetProcessId(process_handle.as_raw_handle() as windows_sys::Win32::Foundation::HANDLE)
    };
    if pid == 0 {
        return Err(std::io::Error::last_os_error());
    }
    running.insert(
        appid.to_string(),
        RunHandle {
            pid,
            scope: None,
            process_handle: Some(process_handle.clone()),
        },
    );
    drop(running);

    let started_at = now_ms();
    crate::settings::merge_library_game_meta(
        app,
        appid,
        serde_json::Map::from_iter([("lastPlayedAt".to_string(), json!(started_at))]),
        0,
    );
    app.emit(
        "uc:presence-changed",
        json!({ "reason": "game-started", "appid": appid, "gameName": game_name, "startedAt": started_at, "activityRecorded": true }),
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
            let handle = process_handle.as_raw_handle() as windows_sys::Win32::Foundation::HANDLE;
            unsafe {
                WaitForSingleObject(handle, INFINITE);
            }
            finish_tracked_game(&app2, &appid2, &exe2, name2.as_deref(), started_at);
        });
    if let Err(error) = reaper {
        RUNNING.lock().remove(appid);
        crate::logging::write_line(
            "error",
            &format!("elevated game reaper thread spawn failed for {appid}: {error}"),
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
    run_as_admin: Option<bool>,
) -> Result<Value, String> {
    if !Path::new(&exe_path).is_file() {
        return Ok(json!({ "ok": false, "error": "executable not found" }));
    }
    let state = app.state::<AppState>();
    if steam_compatibility_fixes_enabled(&state.settings) {
        if let Err(error) =
            steam_api::repair_if_needed(&state.paths.data_dir, &appid, Path::new(&exe_path)).await
        {
            return Ok(json!({ "ok": false, "error": error }));
        }
    }
    let cwd = Path::new(&exe_path)
        .parent()
        .map(PathBuf::from)
        .unwrap_or_else(|| state.download_root());
    let mut plan = match linux::resolve_launch(&state, &appid, &exe_path) {
        Ok(p) => p,
        Err(e) => return Ok(json!({ "ok": false, "error": e })),
    };
    match configured_launch_args(&state.settings, &appid) {
        Ok(args) => plan.args.extend(args),
        Err(error) => return Ok(json!({ "ok": false, "error": error })),
    }
    #[cfg(target_os = "linux")]
    if let Err(error) = linux::prepare_onlinefix_runtime(&mut plan, Path::new(&exe_path)) {
        return Ok(json!({ "ok": false, "error": error }));
    }
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
    let elevated = run_as_admin.unwrap_or(false);
    let started = if elevated {
        #[cfg(windows)]
        {
            spawn_elevated_and_track(
                &app,
                &appid,
                &command,
                &args,
                &cwd,
                &exe_path,
                game_name,
                achievement_context,
            )
        }
        #[cfg(not(windows))]
        {
            Err(std::io::Error::new(
                std::io::ErrorKind::Unsupported,
                "administrator launch is only available on Windows",
            ))
        }
    } else {
        spawn_and_track(
            &app,
            &appid,
            &command,
            &args,
            &cwd,
            &envs,
            &exe_path,
            game_name,
            achievement_context,
        )
    };
    Ok(match started {
        Ok(pid) => {
            if close_on_launch_enabled(&state.settings) {
                let app2 = app.clone();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(std::time::Duration::from_secs(3)).await;
                    crate::hide_app_ui(&app2);
                });
            }
            json!({ "ok": true, "pid": pid, "launchMode": launch_mode, "elevated": elevated })
        }
        Err(error) if !elevated && is_elevation_required(&error) => {
            json!({
                "ok": false,
                "requiresElevation": true,
                "error": "This executable requests administrator access",
            })
        }
        Err(error) if elevated && is_elevation_cancelled(&error) => {
            json!({
                "ok": false,
                "elevationCancelled": true,
                "error": "Administrator permission was declined",
            })
        }
        Err(error) => json!({ "ok": false, "error": error.to_string() }),
    })
}

#[tauri::command(async)]
pub fn game_exe_running_list() -> Value {
    let mut appids: Vec<String> = RUNNING.lock().keys().cloned().collect();
    appids.extend(crate::system::steam_running_appids());
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
        use std::os::windows::io::AsRawHandle;
        use std::os::windows::process::CommandExt;
        use windows_sys::Win32::System::Threading::TerminateProcess;
        if let Some(process_handle) = &handle.process_handle {
            let terminated = unsafe {
                TerminateProcess(
                    process_handle.as_raw_handle() as windows_sys::Win32::Foundation::HANDLE,
                    1,
                )
            };
            if terminated != 0 {
                return;
            }
        }
        std::process::Command::new("taskkill")
            .args(["/PID", &handle.pid.to_string(), "/T", "/F"])
            .creation_flags(windows_sys::Win32::System::Threading::CREATE_NO_WINDOW)
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

#[cfg(test)]
mod portable_tests {
    use super::{is_elevation_cancelled, is_elevation_required, windows_parameters};

    #[test]
    fn windows_launch_errors_are_classified() {
        assert!(is_elevation_required(&std::io::Error::from_raw_os_error(
            740
        )));
        assert!(is_elevation_cancelled(&std::io::Error::from_raw_os_error(
            1223
        )));
        assert!(!is_elevation_required(&std::io::Error::from_raw_os_error(
            2
        )));
    }

    #[test]
    fn elevated_parameters_preserve_spaces_quotes_and_trailing_slashes() {
        assert_eq!(
            windows_parameters(&[
                "plain".into(),
                "two words".into(),
                r#"say "hello""#.into(),
                r#"C:\Games\"#.into(),
            ]),
            r#""plain" "two words" "say \"hello\"" "C:\Games\\""#
        );
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

    #[test]
    fn steam_compatibility_fixes_default_on_and_can_be_disabled() {
        let temp = tempfile::tempdir().unwrap();
        let settings = crate::settings::SettingsStore::load(temp.path().join("settings.json"));
        assert!(steam_compatibility_fixes_enabled(&settings));
        settings.set("linuxSteamCompatibilityFixes", Value::Bool(false));
        assert!(!steam_compatibility_fixes_enabled(&settings));
    }

    #[test]
    fn windows_launch_args_preserve_backslashes_and_apostrophes() {
        assert_eq!(
            split_windows_launch_args(r#"--profile C:\Games\Saves --name "D'Angelo Saves""#),
            vec!["--profile", r"C:\Games\Saves", "--name", "D'Angelo Saves"]
        );
    }

    #[cfg(not(windows))]
    #[test]
    fn configured_launch_args_use_posix_quoting_off_windows() {
        let temp = tempfile::tempdir().unwrap();
        let settings = crate::settings::SettingsStore::load(temp.path().join("settings.json"));
        settings.set(
            "gameLaunchArgs",
            json!({ "local-game": "--profile 'My Saves' -dx11" }),
        );
        assert_eq!(
            configured_launch_args(&settings, "local-game").unwrap(),
            vec!["--profile", "My Saves", "-dx11"]
        );
        assert!(configured_launch_args(&settings, "other-game")
            .unwrap()
            .is_empty());
    }
}
