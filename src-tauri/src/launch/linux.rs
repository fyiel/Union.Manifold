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

fn steam_appid(appid: &str) -> Option<String> {
    let id = appid.strip_prefix("steam-")?;
    if !id.is_empty() && id.chars().all(|c| c.is_ascii_digit()) {
        Some(id.to_string())
    } else {
        None
    }
}

fn install_path_for(exe_path: &str) -> String {
    let exe = std::path::Path::new(exe_path);
    match exe.parent() {
        Some(parent) => {
            if parent.file_name().map(|n| n.eq_ignore_ascii_case("Game")).unwrap_or(false) {
                parent.parent().unwrap_or(parent).to_string_lossy().to_string()
            } else {
                parent.to_string_lossy().to_string()
            }
        }
        None => ".".to_string(),
    }
}

fn onlinefix_overrides(exe_path: &str) -> Option<String> {
    let dir = std::path::Path::new(exe_path).parent()?;
    let is_onlinefix = dir.join("OnlineFix.ini").is_file()
        || dir.join("OnlineFix64.dll").is_file()
        || dir.join("dlllist.txt").is_file();
    if !is_onlinefix {
        return None;
    }
    let proxies = ["winmm", "dinput8", "dsound", "version", "dbghelp", "wininet", "xinput1_3"];
    let found: Vec<String> = proxies
        .iter()
        .filter(|p| dir.join(format!("{p}.dll")).is_file())
        .map(|p| format!("{p}=n,b"))
        .collect();
    if found.is_empty() {
        None
    } else {
        Some(found.join(";"))
    }
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
        .or_else(|| state.settings.get_string("linuxLaunchMode"))
        .or_else(|| state.settings.get_string("linuxDefaultLaunchMode"))
        .filter(|m| m != "auto" && m != "inherit")
        .unwrap_or_else(|| "auto".to_string());
    let mut envs = parse_extra_env(&cfg);
    if let Some(id) = steam_appid(appid) {
        envs.push(("STEAM_COMPAT_APP_ID".to_string(), id.clone()));
        envs.push(("SteamAppId".to_string(), id.clone()));
        envs.push(("SteamGameId".to_string(), id));
    }
    if let Some(prefix) = cfg.get("winePrefix").and_then(|v| v.as_str()).filter(|s| !s.is_empty()) {
        envs.push(("WINEPREFIX".to_string(), prefix.to_string()));
    }
    let proton_prefix = cfg
        .get("protonPrefix")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(String::from);
    if let Some(prefix) = &proton_prefix {
        envs.push(("STEAM_COMPAT_DATA_PATH".to_string(), prefix.clone()));
    }

    if !envs.iter().any(|(k, _)| k == "WINEDLLOVERRIDES") {
        if let Some(overrides) = onlinefix_overrides(exe_path) {
            envs.push(("WINEDLLOVERRIDES".to_string(), overrides));
        }
    }

    let umu = which("umu-run");
    let use_umu = mode == "umu" || (mode == "auto" && umu.is_some());
    if use_umu {
        if let Some(umu) = umu {
            let gameid = cfg.get("umuGameId").and_then(|v| v.as_str()).unwrap_or("0").to_string();
            envs.push(("GAMEID".to_string(), gameid));
            if let Some(proton) = cfg.get("protonPath").and_then(|v| v.as_str()).filter(|s| !s.is_empty()) {
                envs.push(("PROTONPATH".to_string(), proton.to_string()));
            }
            return LaunchPlan {
                command: umu,
                args: vec![exe_path.to_string()],
                envs,
            };
        }
    }

    let proton_path = cfg
        .get("protonPath")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(String::from)
        .or_else(|| state.settings.get_string("linuxProtonPath").filter(|s| !s.is_empty()));
    if mode == "proton" || (mode == "auto" && proton_path.is_some()) {
        if let Some(proton) = &proton_path {
            if let Some(steam) = steam_root() {
                envs.push(("STEAM_COMPAT_CLIENT_INSTALL_PATH".to_string(), steam));
            }
            envs.push(("STEAM_COMPAT_INSTALL_PATH".to_string(), install_path_for(exe_path)));
            if proton_prefix.is_none() {
                let compat = state.download_root().join("compatdata").join(appid);
                std::fs::create_dir_all(&compat).ok();
                envs.push(("STEAM_COMPAT_DATA_PATH".to_string(), compat.to_string_lossy().to_string()));
            }
            return LaunchPlan {
                command: proton.clone(),
                args: vec!["waitforexitandrun".to_string(), exe_path.to_string()],
                envs,
            };
        }
    }
    let wine = cfg
        .get("winePath")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
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

#[tauri::command(async)]
pub fn game_linux_config_get(state: State<'_, AppState>, appid: String) -> Value {
    let config = config_for(&state, &appid);
    json!({ "ok": true, "config": if config.is_null() { json!({}) } else { config } })
}

#[tauri::command(async)]
pub fn game_linux_config_set(state: State<'_, AppState>, appid: String, config: Value) -> Value {
    state.settings.set(&format!("gameLinux:{appid}"), config);
    json!({ "ok": true })
}

#[tauri::command(async)]
pub fn linux_detect_proton() -> Value {
    let mut versions = Vec::new();
    if let Some(steam) = steam_root() {
        for (sub, source) in [("steamapps/common", "steam"), ("compatibilitytools.d", "community")] {
            if let Ok(entries) = std::fs::read_dir(Path::new(&steam).join(sub)) {
                for entry in entries.flatten() {
                    let name = entry.file_name().to_string_lossy().to_string();
                    if source == "community" || name.to_lowercase().contains("proton") {
                        let script = entry.path().join("proton");
                        if script.is_file() {
                            versions.push(json!({ "label": name, "path": script.to_string_lossy(), "source": source }));
                        }
                    }
                }
            }
        }
    }
    json!({ "ok": true, "versions": versions })
}
