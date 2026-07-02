pub mod linux;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use once_cell::sync::Lazy;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, State};

use crate::downloads::now_ms;
use crate::state::AppState;

struct Running {
    pid: u32,
    exe_path: String,
}

static RUNNING: Lazy<Mutex<HashMap<String, Running>>> = Lazy::new(|| Mutex::new(HashMap::new()));

fn install_dir_for(state: &AppState, appid: &str) -> Option<PathBuf> {
    crate::install::find_installing(&state.download_root(), appid).map(|(dir, manifest)| {
        manifest
            .get("installPath")
            .and_then(|v| v.as_str())
            .map(PathBuf::from)
            .unwrap_or(dir)
    })
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

#[tauri::command]
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

#[tauri::command]
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

#[tauri::command]
pub fn game_exe_preflight(state: State<'_, AppState>, appid: String, exe_path: String) -> Value {
    let mut checks = Vec::new();
    let exists = Path::new(&exe_path).is_file();
    if !exists {
        checks.push(json!({ "level": "error", "code": "missing", "message": "executable not found" }));
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
    let mut cmd = std::process::Command::new(command);
    cmd.args(args).current_dir(cwd);
    for (k, v) in envs {
        cmd.env(k, v);
    }
    let child = cmd.spawn().map_err(|e| e.to_string())?;
    let pid = child.id();
    let started_at = now_ms();
    RUNNING.lock().unwrap().insert(
        appid.to_string(),
        Running {
            pid,
            exe_path: exe_path.to_string(),
        },
    );
    app.emit(
        "uc:presence-changed",
        json!({ "reason": "started", "appid": appid, "gameName": game_name }),
    )
    .ok();
    let app2 = app.clone();
    let appid2 = appid.to_string();
    let exe2 = exe_path.to_string();
    std::thread::spawn(move || {
        let mut child = child;
        let _ = child.wait();
        let elapsed = now_ms() - started_at;
        RUNNING.lock().unwrap().remove(&appid2);
        app2.emit(
            "uc:presence-changed",
            json!({ "reason": "stopped", "appid": appid2 }),
        )
        .ok();
        if elapsed < 10_000 {
            app2.emit(
                "uc:game-quick-exit",
                json!({ "appid": appid2, "exePath": exe2, "elapsed": elapsed }),
            )
            .ok();
        }
    });
    Ok(pid)
}

#[tauri::command]
pub fn game_exe_launch(state: State<'_, AppState>, app: AppHandle, appid: String, exe_path: String, game_name: Option<String>, _show_game_name: Option<bool>) -> Value {
    if !Path::new(&exe_path).is_file() {
        return json!({ "ok": false, "error": "executable not found" });
    }
    if RUNNING.lock().unwrap().contains_key(&appid) {
        return json!({ "ok": false, "error": "already running" });
    }
    let cwd = Path::new(&exe_path).parent().map(PathBuf::from).unwrap_or_else(|| state.download_root());
    let plan = linux::resolve_launch(&state, &appid, &exe_path);
    match spawn_and_track(&app, &appid, &plan.command, &plan.args, &cwd, &plan.envs, &exe_path, game_name) {
        Ok(pid) => json!({ "ok": true, "pid": pid }),
        Err(e) => json!({ "ok": false, "error": e }),
    }
}

#[tauri::command]
pub fn game_exe_running(appid: String) -> Value {
    let running = RUNNING.lock().unwrap();
    match running.get(&appid) {
        Some(r) => json!({ "ok": true, "running": true, "pid": r.pid, "exePath": r.exe_path }),
        None => json!({ "ok": true, "running": false }),
    }
}

#[tauri::command]
pub fn game_exe_running_list() -> Value {
    let running = RUNNING.lock().unwrap();
    let appids: Vec<String> = running.keys().cloned().collect();
    json!({ "ok": true, "appids": appids })
}

#[tauri::command]
pub fn game_exe_quit(appid: String) -> Value {
    let pid = RUNNING.lock().unwrap().get(&appid).map(|r| r.pid);
    if let Some(pid) = pid {
        kill_pid(pid);
        RUNNING.lock().unwrap().remove(&appid);
        return json!({ "ok": true, "stopped": true });
    }
    json!({ "ok": true, "stopped": false })
}

fn kill_pid(pid: u32) {
    #[cfg(windows)]
    {
        std::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .spawn()
            .ok();
    }
    #[cfg(unix)]
    {
        std::process::Command::new("kill")
            .args(["-TERM", &pid.to_string()])
            .spawn()
            .ok();
    }
}
