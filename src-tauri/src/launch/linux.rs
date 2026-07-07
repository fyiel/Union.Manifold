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

// Mod loaders and repack cracks ship a proxy DLL beside the game exe that Wine
// would otherwise satisfy with its own builtin, so the shipped loader never runs
// and the game boots unmodded. For BepInEx repacks (GTFO and other IL2CPP
// titles) that is fatal rather than cosmetic: the offline-server crack is itself
// a BepInEx plugin, so a loader that never initializes leaves the game hanging
// forever on the loading screen waiting for a server it can no longer reach.
// Force every known proxy/injector DLL physically present next to the exe to
// load native first. `n,b` still falls back to Wine's builtin when the shipped
// file fails, and games do not ship their own copy of these system DLLs beside
// the exe, so applying this whenever such a file exists is safe.
fn proxy_dll_overrides(exe_path: &str) -> Option<String> {
    let dir = std::path::Path::new(exe_path).parent()?;
    // winhttp is BepInEx 6's Doorstop; winmm/version/dinput8 are the Ultimate
    // ASI Loader and Online-Fix proxies; the rest are common injector stems.
    const PROXIES: &[&str] =
        &["winhttp", "winmm", "version", "dinput8", "dsound", "dbghelp", "wininet", "xinput1_3"];
    let found: Vec<String> = PROXIES
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

#[derive(Default)]
pub(crate) struct GlobalLaunchOpts {
    pub extra_env: Vec<(String, String)>,
    pub gamemode: bool,
    pub mangohud: bool,
    pub dll_overrides: Option<String>,
}

fn parse_env_lines(s: &str) -> Vec<(String, String)> {
    s.lines()
        .filter_map(|line| line.split_once('='))
        .map(|(k, v)| (k.trim().to_string(), v.trim().to_string()))
        .collect()
}

pub fn resolve_launch(state: &AppState, appid: &str, exe_path: &str) -> Result<LaunchPlan, String> {
    let cfg = config_for(state, appid);
    let global_mode = state
        .settings
        .get_string("linuxLaunchMode")
        .or_else(|| state.settings.get_string("linuxDefaultLaunchMode"));
    let global_proton = state
        .settings
        .get_string("linuxProtonPath")
        .filter(|s| !s.is_empty());
    let globals = GlobalLaunchOpts {
        extra_env: state
            .settings
            .get_string("linuxExtraEnv")
            .map(|s| parse_env_lines(&s))
            .unwrap_or_default(),
        gamemode: state.settings.get("linuxGamemode").as_bool().unwrap_or(false),
        mangohud: state.settings.get("linuxMangohud").as_bool().unwrap_or(false),
        dll_overrides: state
            .settings
            .get_string("linuxDllOverrides")
            .filter(|s| !s.trim().is_empty()),
    };
    plan_launch_with(&cfg, global_mode, global_proton, &globals, &state.download_root(), appid, exe_path)
}

#[allow(dead_code)]
pub(crate) fn plan_launch(
    cfg: &Value,
    global_mode: Option<String>,
    global_proton: Option<String>,
    download_root: &Path,
    appid: &str,
    exe_path: &str,
) -> Result<LaunchPlan, String> {
    plan_launch_with(cfg, global_mode, global_proton, &GlobalLaunchOpts::default(), download_root, appid, exe_path)
}

// Wrap the planned command in gamemoderun / mangohud when enabled and installed,
// innermost mangohud so the pattern matches the usual "gamemoderun mangohud %command%".
fn apply_wrappers(mut plan: LaunchPlan, globals: &GlobalLaunchOpts) -> LaunchPlan {
    for tool in ["mangohud", "gamemoderun"] {
        let wanted = (tool == "mangohud" && globals.mangohud) || (tool == "gamemoderun" && globals.gamemode);
        if !wanted {
            continue;
        }
        if let Some(path) = which(tool) {
            let mut args = vec![plan.command.clone()];
            args.append(&mut plan.args);
            plan.command = path;
            plan.args = args;
        }
    }
    plan
}

fn merge_global_env(envs: &mut Vec<(String, String)>, globals: &GlobalLaunchOpts) {
    // Per-game env wins; the global list only fills the gaps.
    for (k, v) in &globals.extra_env {
        if !envs.iter().any(|(ek, _)| ek == k) {
            envs.push((k.clone(), v.clone()));
        }
    }
    if let Some(overrides) = &globals.dll_overrides {
        if !envs.iter().any(|(k, _)| k == "WINEDLLOVERRIDES") {
            envs.push(("WINEDLLOVERRIDES".to_string(), overrides.clone()));
        }
    }
}

pub(crate) fn plan_launch_with(
    cfg: &Value,
    global_mode: Option<String>,
    global_proton: Option<String>,
    globals: &GlobalLaunchOpts,
    download_root: &Path,
    appid: &str,
    exe_path: &str,
) -> Result<LaunchPlan, String> {
    if cfg!(windows) || !is_windows_exe(exe_path) {
        let mut envs = parse_extra_env(cfg);
        merge_global_env(&mut envs, globals);
        return Ok(apply_wrappers(
            LaunchPlan {
                command: exe_path.to_string(),
                args: vec![],
                envs,
            },
            globals,
        ));
    }
    let mode = cfg
        .get("launchMode")
        .and_then(|v| v.as_str())
        .filter(|m| *m != "auto" && *m != "inherit")
        .map(String::from)
        .or(global_mode)
        .filter(|m| m != "auto" && m != "inherit")
        .unwrap_or_else(|| "auto".to_string());
    let mut envs = parse_extra_env(cfg);
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
        if let Some(overrides) = proxy_dll_overrides(exe_path) {
            envs.push(("WINEDLLOVERRIDES".to_string(), overrides));
        }
    }
    merge_global_env(&mut envs, globals);

    let umu = which("umu-run");
    let use_umu = mode == "umu" || (mode == "auto" && umu.is_some());
    if use_umu {
        let umu = match umu {
            Some(u) => u,
            // Only reachable when mode == "umu" (auto requires umu.is_some());
            // fail loudly instead of silently dropping to bare wine.
            None => return Err("launch mode is 'umu' but umu-run is not installed".to_string()),
        };
        let gameid = cfg.get("umuGameId").and_then(|v| v.as_str()).unwrap_or("0").to_string();
        envs.push(("GAMEID".to_string(), gameid));
        if let Some(proton) = cfg.get("protonPath").and_then(|v| v.as_str()).filter(|s| !s.is_empty()) {
            envs.push(("PROTONPATH".to_string(), proton.to_string()));
        }
        return Ok(apply_wrappers(
            LaunchPlan {
                command: umu,
                args: vec![exe_path.to_string()],
                envs,
            },
            globals,
        ));
    }

    let proton_path = cfg
        .get("protonPath")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(String::from)
        .or(global_proton);
    if mode == "proton" || (mode == "auto" && proton_path.is_some()) {
        let proton = match &proton_path {
            Some(p) => p,
            // Only reachable when mode == "proton" (auto requires a path); fail
            // loudly instead of silently dropping to bare wine with no compat env.
            None => return Err("launch mode is 'proton' but no Proton path is configured".to_string()),
        };
        if let Some(steam) = steam_root() {
            envs.push(("STEAM_COMPAT_CLIENT_INSTALL_PATH".to_string(), steam));
        }
        envs.push(("STEAM_COMPAT_INSTALL_PATH".to_string(), install_path_for(exe_path)));
        if proton_prefix.is_none() {
            let compat = download_root.join("compatdata").join(appid);
            std::fs::create_dir_all(&compat).ok();
            envs.push(("STEAM_COMPAT_DATA_PATH".to_string(), compat.to_string_lossy().to_string()));
        }
        return Ok(apply_wrappers(
            LaunchPlan {
                command: proton.clone(),
                args: vec!["waitforexitandrun".to_string(), exe_path.to_string()],
                envs,
            },
            globals,
        ));
    }
    let wine = cfg
        .get("winePath")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(String::from)
        .or_else(|| which("wine"))
        .unwrap_or_else(|| "wine".to_string());
    Ok(apply_wrappers(
        LaunchPlan {
            command: wine,
            args: vec![exe_path.to_string()],
            envs,
        },
        globals,
    ))
}

pub fn build_launch_command(state: &AppState, appid: &str, exe_path: &str) -> Value {
    let cwd = Path::new(exe_path).parent().map(|p| p.to_string_lossy().to_string()).unwrap_or_default();
    match resolve_launch(state, appid, exe_path) {
        Ok(plan) => json!({ "command": plan.command, "args": plan.args, "cwd": cwd }),
        Err(e) => json!({ "error": e, "cwd": cwd }),
    }
}

fn steam_root() -> Option<String> {
    let home = dirs::home_dir()?;
    for rel in [
        ".steam/steam",
        ".local/share/Steam",
        ".steam/root",
        // Flatpak Steam keeps its data under the sandbox home.
        ".var/app/com.valvesoftware.Steam/data/Steam",
    ] {
        let candidate = home.join(rel);
        if candidate.is_dir() {
            return Some(candidate.to_string_lossy().to_string());
        }
    }
    None
}

// Steam libraries can live on secondary drives; libraryfolders.vdf lists them
// all. Returns the main root plus every library path it declares.
fn steam_library_dirs(steam_root: &str) -> Vec<String> {
    let mut dirs = vec![steam_root.to_string()];
    for rel in ["steamapps/libraryfolders.vdf", "config/libraryfolders.vdf"] {
        let vdf = Path::new(steam_root).join(rel);
        let text = match std::fs::read_to_string(&vdf) {
            Ok(t) => t,
            Err(_) => continue,
        };
        for line in text.lines() {
            if let Some(rest) = line.trim().strip_prefix("\"path\"") {
                let path = rest.trim().trim_matches('"').replace("\\\\", "/");
                if !path.is_empty() && !dirs.contains(&path) {
                    dirs.push(path);
                }
            }
        }
        break;
    }
    dirs
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
        let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
        // Official Proton builds live under steamapps/common of EVERY library
        // folder, including secondary drives from libraryfolders.vdf.
        for lib in steam_library_dirs(&steam) {
            if let Ok(entries) = std::fs::read_dir(Path::new(&lib).join("steamapps/common")) {
                for entry in entries.flatten() {
                    let name = entry.file_name().to_string_lossy().to_string();
                    if name.to_lowercase().contains("proton") {
                        let script = entry.path().join("proton");
                        if script.is_file() {
                            let path = script.to_string_lossy().to_string();
                            if seen.insert(path.clone()) {
                                versions.push(json!({ "label": name, "path": path, "source": "steam" }));
                            }
                        }
                    }
                }
            }
        }
        // Community builds live only under the main root's compatibilitytools.d.
        if let Ok(entries) = std::fs::read_dir(Path::new(&steam).join("compatibilitytools.d")) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                let script = entry.path().join("proton");
                if script.is_file() {
                    let path = script.to_string_lossy().to_string();
                    if seen.insert(path.clone()) {
                        versions.push(json!({ "label": name, "path": path, "source": "community" }));
                    }
                }
            }
        }
    }
    json!({ "ok": true, "versions": versions })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn touch(dir: &std::path::Path, name: &str) {
        std::fs::write(dir.join(name), []).unwrap();
    }

    // GTFO's AnkerGames/SteamRiP repack ships BepInEx (winhttp Doorstop) and the
    // Ultimate ASI Loader (winmm) beside the exe with no OnlineFix marker file.
    // Both must be forced native or BepInEx never loads, its local DropServer
    // plugin never loads, and the game hangs on the loading screen.
    #[test]
    fn bepinex_asi_repack_forces_winhttp_and_winmm_native() {
        let tmp = tempfile::tempdir().unwrap();
        touch(tmp.path(), "GTFO.exe");
        touch(tmp.path(), "winhttp.dll");
        touch(tmp.path(), "winmm.dll");
        let exe = tmp.path().join("GTFO.exe");
        let ov = proxy_dll_overrides(exe.to_str().unwrap()).expect("expected overrides");
        assert!(ov.split(';').any(|e| e == "winhttp=n,b"), "winhttp missing: {ov}");
        assert!(ov.split(';').any(|e| e == "winmm=n,b"), "winmm missing: {ov}");
    }

    #[test]
    fn no_proxy_dll_beside_exe_yields_no_override() {
        let tmp = tempfile::tempdir().unwrap();
        touch(tmp.path(), "Game.exe");
        let exe = tmp.path().join("Game.exe");
        assert!(proxy_dll_overrides(exe.to_str().unwrap()).is_none());
    }

    // Only the proxy DLLs that actually exist are listed, so an unmodded game
    // that happens to ship one loader gets exactly that one override.
    #[test]
    fn override_lists_only_present_dlls() {
        let tmp = tempfile::tempdir().unwrap();
        touch(tmp.path(), "g.exe");
        touch(tmp.path(), "version.dll");
        let exe = tmp.path().join("g.exe");
        assert_eq!(proxy_dll_overrides(exe.to_str().unwrap()).unwrap(), "version=n,b");
    }
}
