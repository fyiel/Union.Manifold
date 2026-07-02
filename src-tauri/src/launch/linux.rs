use std::path::Path;

use serde_json::{json, Value};
use tauri::State;

use crate::state::AppState;

pub struct LaunchPlan {
    pub command: String,
    pub args: Vec<String>,
    pub envs: Vec<(String, String)>,
}

fn config_for(state: &AppState, appid: &str) -> Value {
    state.settings.get(&format!("gameLinux:{appid}"))
}

fn which(tool: &str) -> Option<String> {
    let path = std::env::var("PATH").ok()?;
    for dir in path.split(':') {
        let candidate = Path::new(dir).join(tool);
        if candidate.is_file() {
            return Some(candidate.to_string_lossy().to_string());
        }
    }
    None
}

fn is_windows_exe(exe_path: &str) -> bool {
    exe_path.to_lowercase().ends_with(".exe")
}

fn parse_extra_env(cfg: &Value) -> Vec<(String, String)> {
    cfg.get("extraEnv")
        .and_then(|v| v.as_str())
        .map(|s| {
            s.lines()
                .filter_map(|line| line.split_once('='))
                .map(|(k, v)| (k.trim().to_string(), v.trim().to_string()))
                .collect()
        })
        .unwrap_or_default()
}

pub fn resolve_launch(state: &AppState, appid: &str, exe_path: &str) -> LaunchPlan {
    if cfg!(windows) || !is_windows_exe(exe_path) {
        return LaunchPlan {
            command: exe_path.to_string(),
            args: vec![],
            envs: parse_extra_env(&config_for(state, appid)),
        };
    }
    let cfg = config_for(state, appid);
    let mode = cfg
        .get("launchMode")
        .and_then(|v| v.as_str())
        .filter(|m| *m != "auto" && *m != "inherit")
        .map(String::from)
        .or_else(|| state.settings.get_string("linuxDefaultLaunchMode"))
        .unwrap_or_else(|| "auto".to_string());
    let mut envs = parse_extra_env(&cfg);
    if let Some(prefix) = cfg.get("winePrefix").and_then(|v| v.as_str()) {
        envs.push(("WINEPREFIX".to_string(), prefix.to_string()));
    }
    if let Some(prefix) = cfg.get("protonPrefix").and_then(|v| v.as_str()) {
        envs.push(("STEAM_COMPAT_DATA_PATH".to_string(), prefix.to_string()));
    }

    let umu = which("umu-run");
    let use_umu = mode == "umu" || (mode == "auto" && umu.is_some());
    if use_umu {
        if let Some(umu) = umu {
            let gameid = cfg.get("umuGameId").and_then(|v| v.as_str()).unwrap_or("0").to_string();
            envs.push(("GAMEID".to_string(), gameid));
            if let Some(proton) = cfg.get("protonPath").and_then(|v| v.as_str()) {
                envs.push(("PROTONPATH".to_string(), proton.to_string()));
            }
            return LaunchPlan {
                command: umu,
                args: vec![exe_path.to_string()],
                envs,
            };
        }
    }
    if mode == "proton" {
        if let Some(proton) = cfg.get("protonPath").and_then(|v| v.as_str()) {
            if let Some(steam) = steam_root() {
                envs.push(("STEAM_COMPAT_CLIENT_INSTALL_PATH".to_string(), steam));
            }
            return LaunchPlan {
                command: proton.to_string(),
                args: vec!["run".to_string(), exe_path.to_string()],
                envs,
            };
        }
    }
    let wine = cfg
        .get("winePath")
        .and_then(|v| v.as_str())
        .map(String::from)
        .or_else(|| which("wine"))
        .unwrap_or_else(|| "wine".to_string());
    LaunchPlan {
        command: wine,
        args: vec![exe_path.to_string()],
        envs,
    }
}

pub fn build_launch_command(state: &AppState, appid: &str, exe_path: &str) -> Value {
    let plan = resolve_launch(state, appid, exe_path);
    let cwd = Path::new(exe_path).parent().map(|p| p.to_string_lossy().to_string()).unwrap_or_default();
    json!({ "command": plan.command, "args": plan.args, "cwd": cwd })
}

fn steam_root() -> Option<String> {
    let home = dirs::home_dir()?;
    for rel in [".steam/steam", ".local/share/Steam", ".steam/root"] {
        let candidate = home.join(rel);
        if candidate.is_dir() {
            return Some(candidate.to_string_lossy().to_string());
        }
    }
    None
}

#[tauri::command]
pub fn game_linux_config_get(state: State<'_, AppState>, appid: String) -> Value {
    let config = config_for(&state, &appid);
    json!({ "ok": true, "config": if config.is_null() { json!({}) } else { config } })
}

#[tauri::command]
pub fn game_linux_config_set(state: State<'_, AppState>, appid: String, config: Value) -> Value {
    state.settings.set(&format!("gameLinux:{appid}"), config);
    json!({ "ok": true })
}

#[tauri::command]
pub fn linux_check_tool(tool_name: String) -> Value {
    match which(&tool_name) {
        Some(path) => json!({ "ok": true, "available": true, "path": path }),
        None => json!({ "ok": true, "available": false }),
    }
}

#[tauri::command]
pub fn linux_get_steam_path() -> Value {
    match steam_root() {
        Some(path) => json!({ "ok": true, "path": path }),
        None => json!({ "ok": false, "error": "steam not found" }),
    }
}

#[tauri::command]
pub fn linux_detect_umu() -> Value {
    match which("umu-run") {
        Some(path) => json!({ "ok": true, "found": true, "path": path }),
        None => json!({ "ok": true, "found": false }),
    }
}

#[tauri::command]
pub fn linux_detect_wine() -> Value {
    let mut versions = Vec::new();
    if let Some(path) = which("wine") {
        versions.push(json!({ "label": "system wine", "path": path }));
    }
    json!({ "ok": true, "versions": versions })
}

#[tauri::command]
pub fn linux_detect_proton() -> Value {
    let mut versions = Vec::new();
    if let Some(steam) = steam_root() {
        let common = Path::new(&steam).join("steamapps/common");
        if let Ok(entries) = std::fs::read_dir(&common) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.to_lowercase().contains("proton") {
                    let script = entry.path().join("proton");
                    if script.is_file() {
                        versions.push(json!({ "label": name, "path": script.to_string_lossy() }));
                    }
                }
            }
        }
    }
    json!({ "ok": true, "versions": versions })
}
