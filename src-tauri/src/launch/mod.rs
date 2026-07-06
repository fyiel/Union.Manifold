pub mod linux;

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use once_cell::sync::Lazy;
use parking_lot::Mutex;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, State};

use crate::downloads::now_ms;
use crate::state::AppState;

#[derive(Clone)]
struct RunHandle {
    pid: u32,
    scope: Option<String>,
}

static RUNNING: Lazy<Mutex<HashMap<String, RunHandle>>> = Lazy::new(|| Mutex::new(HashMap::new()));

#[cfg(target_os = "linux")]
fn systemd_run_available() -> bool {
    std::env::var("PATH")
        .ok()
        .map(|path| path.split(':').any(|d| Path::new(d).join("systemd-run").is_file()))
        .unwrap_or(false)
}

fn install_dir_for(state: &AppState, appid: &str) -> Option<PathBuf> {
    // Scan the primary install dir AND any legacy roots so old UnionCrax.Direct
    // installs resolve their folder and launch. Imported entries resolve to the
    // real game dir (manifest installPath), not their manifest stub.
    crate::library::game_files_dir(&crate::library::scan_roots(state), appid)
}

fn is_executable_candidate(path: &Path) -> bool {
    let name = path.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
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
                return !has_ext || name.ends_with(".sh") || name.ends_with(".x86_64") || name.ends_with(".bin");
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
    for entry in walkdir::WalkDir::new(&dir).max_depth(6).into_iter().flatten() {
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
            a.get("name").and_then(|v| v.as_str()).unwrap_or("").cmp(b.get("name").and_then(|v| v.as_str()).unwrap_or(""))
        })
    });
    json!({ "ok": true, "folder": dir.to_string_lossy(), "exes": exes })
}

#[tauri::command(async)]
pub fn game_subfolder_find(folder: String) -> Value {
    let path = Path::new(&folder);
    let entries: Vec<PathBuf> = std::fs::read_dir(path)
        .map(|rd| rd.flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect())
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
        checks.push(json!({ "level": "error", "code": "exe-not-found", "message": "executable not found" }));
    }
    let resolved = linux::build_launch_command(&state, &appid, &exe_path);
    json!({
        "ok": true,
        "canLaunch": exists,
        "checks": checks,
        "resolved": resolved,
    })
}

fn spawn_and_track(app: &AppHandle, appid: &str, command: &str, args: &[String], cwd: &Path, envs: &[(String, String)], exe_path: &str, game_name: Option<String>) -> Result<u32, String> {
    // Proton's pressure-vessel reparents the game away from our child, so a
    // plain pid kill leaves the game alive. On Linux wrap the launch in a
    // transient systemd user scope; stopping the scope reaps the whole tree.
    #[cfg_attr(not(target_os = "linux"), allow(unused_mut))]
    let mut scope: Option<String> = None;
    #[cfg(target_os = "linux")]
    let mut cmd = if systemd_run_available() {
        let unit = format!(
            "uc-game-{}-{}",
            std::process::id(),
            appid.chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect::<String>()
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
        // We are a GUI-subsystem process with no console, so CreateProcess would
        // allocate and show a fresh console window for any console-subsystem game
        // or launcher stub it starts. CREATE_NO_WINDOW suppresses that and is
        // documented as ignored for GUI applications, so real games are unaffected
        // (unlike SW_HIDE-style hiding, which GUI games honor — the old Electron
        // "game starts hidden with audio only" bug).
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
        // Don't hand the game our stdio either: a console child writing into an
        // inherited handle nobody drains can stall on a full pipe buffer.
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
    // Reserve the slot BEFORE spawning, atomically with the spawn, so two
    // concurrent launches for the same appid can't both spawn and orphan the
    // first process handle. This `entry` is the single gate.
    use std::collections::hash_map::Entry;
    let child = {
        let mut running = RUNNING.lock();
        match running.entry(appid.to_string()) {
            Entry::Occupied(_) => return Err("already running".to_string()),
            Entry::Vacant(slot) => {
                let child = cmd.spawn().map_err(|e| e.to_string())?;
                slot.insert(RunHandle { pid: child.id(), scope });
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
    let app2 = app.clone();
    let appid2 = appid.to_string();
    let exe2 = exe_path.to_string();
    let name2 = game_name.clone();
    let reaper = std::thread::Builder::new().name(format!("game-reaper-{appid}")).spawn(move || {
        let mut child = child;
        let _ = child.wait();
        let elapsed = now_ms() - started_at;
        RUNNING.lock().remove(&appid2);
        app2.emit(
            "uc:presence-changed",
            json!({ "reason": "game-exited", "appid": appid2 }),
        )
        .ok();
        if elapsed >= 10_000 {
            let name = name2.unwrap_or_else(|| appid2.clone());
            crate::notify::send_if(&app2, "notifyGameExit", false, "Game exited", &format!("{name} closed"));
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
        // Thread creation only fails under resource exhaustion. The game is
        // already running; free the slot (nothing will ever reap it) and log
        // instead of panicking — with panic=abort that would kill the app.
        RUNNING.lock().remove(appid);
        crate::logging::write_line("error", &format!("game reaper thread spawn failed for {appid}: {e}"));
    }
    Ok(pid)
}

#[tauri::command(async)]
pub fn game_exe_launch(state: State<'_, AppState>, app: AppHandle, appid: String, exe_path: String, game_name: Option<String>, _show_game_name: Option<bool>) -> Value {
    if !Path::new(&exe_path).is_file() {
        return json!({ "ok": false, "error": "executable not found" });
    }
    let cwd = Path::new(&exe_path).parent().map(PathBuf::from).unwrap_or_else(|| state.download_root());
    let plan = match linux::resolve_launch(&state, &appid, &exe_path) {
        Ok(p) => p,
        Err(e) => return json!({ "ok": false, "error": e }),
    };
    match spawn_and_track(&app, &appid, &plan.command, &plan.args, &cwd, &plan.envs, &exe_path, game_name) {
        Ok(pid) => json!({ "ok": true, "pid": pid }),
        Err(e) => json!({ "ok": false, "error": e }),
    }
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
        // The reaper thread in spawn_and_track owns removal from RUNNING and
        // the presence-changed emit, so state only flips once the tree is
        // actually gone.
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
        // Builder::spawn instead of thread::spawn: the latter panics on thread
        // creation failure, and with panic=abort that would kill the whole app
        // just to skip an escalation-to-SIGKILL nicety.
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
        // CREATE_NO_WINDOW: taskkill is a console app; without the flag a
        // console window flashes over the launcher every time a game is quit.
        use std::os::windows::process::CommandExt;
        std::process::Command::new("taskkill")
            .args(["/PID", &handle.pid.to_string(), "/T", "/F"])
            .creation_flags(0x08000000)
            .spawn()
            .ok();
    }
    #[cfg(unix)]
    {
        // Spawned with process_group(0), so signal the whole group.
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

    // Spawn a survivor the way spawn_and_track does (scope on systemd, process
    // group otherwise) and prove kill_handle reaps it even though the direct
    // child double-forked away, which is the pressure-vessel reparent shape.
    #[test]
    fn kill_handle_reaps_detached_tree() {
        if !systemd_run_available() {
            eprintln!("skipping, no systemd-run");
            return;
        }
        let unit = format!("uc-game-test-{}", std::process::id());
        let scope = format!("{unit}.scope");
        let mut child = std::process::Command::new("systemd-run")
            .args(["--user", "--scope", "--collect", "--quiet", &format!("--unit={unit}"), "--", "sh", "-c", "sleep 300 & sleep 300"])
            .spawn()
            .expect("spawn scope");
        std::thread::sleep(std::time::Duration::from_millis(600));
        kill_handle(&RunHandle { pid: child.id(), scope: Some(scope.clone()) });
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
            assert!(std::time::Instant::now() < deadline, "scope survived kill_handle");
            std::thread::sleep(std::time::Duration::from_millis(300));
        }
        let _ = child.wait();
    }
}
