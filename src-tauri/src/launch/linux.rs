use std::{
    cmp::Ordering,
    collections::HashSet,
    path::{Path, PathBuf},
};

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
    if let Some(path) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path) {
            let candidate = dir.join(tool);
            if candidate.is_file() {
                return Some(candidate.to_string_lossy().to_string());
            }
        }
    }
    if let Some(home) = dirs::home_dir() {
        let candidate = home.join(".local/bin").join(tool);
        if candidate.is_file() {
            return Some(candidate.to_string_lossy().to_string());
        }
    }
    for dir in ["/usr/local/bin", "/usr/bin", "/app/bin"] {
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
            if parent
                .file_name()
                .map(|n| n.eq_ignore_ascii_case("Game"))
                .unwrap_or(false)
            {
                parent
                    .parent()
                    .unwrap_or(parent)
                    .to_string_lossy()
                    .to_string()
            } else {
                parent.to_string_lossy().to_string()
            }
        }
        None => ".".to_string(),
    }
}

fn proton_root_for_umu(proton: &str) -> String {
    let path = Path::new(proton);
    if path
        .file_name()
        .map(|name| name.to_string_lossy().eq_ignore_ascii_case("proton"))
        .unwrap_or(false)
    {
        if let Some(parent) = path.parent() {
            return parent.to_string_lossy().to_string();
        }
    }
    proton.to_string()
}

fn proton_compat_prefix(compat_data: &str) -> String {
    let path = Path::new(compat_data);
    if path
        .file_name()
        .map(|name| name.to_string_lossy().eq_ignore_ascii_case("pfx"))
        .unwrap_or(false)
    {
        compat_data.to_string()
    } else {
        path.join("pfx").to_string_lossy().to_string()
    }
}

fn proxy_dll_overrides(exe_path: &str) -> Option<String> {
    let dir = std::path::Path::new(exe_path).parent()?;
    const PROXIES: &[&str] = &[
        "winhttp",
        "winmm",
        "version",
        "dinput8",
        "dsound",
        "dbghelp",
        "wininet",
        "xinput1_3",
    ];
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
    pub proton_prefix: Option<String>,
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
        gamemode: state
            .settings
            .get("linuxGamemode")
            .as_bool()
            .unwrap_or(false),
        mangohud: state
            .settings
            .get("linuxMangohud")
            .as_bool()
            .unwrap_or(false),
        dll_overrides: state
            .settings
            .get_string("linuxDllOverrides")
            .filter(|s| !s.trim().is_empty()),
        proton_prefix: state
            .settings
            .get_string("linuxProtonPrefix")
            .filter(|s| !s.is_empty()),
    };
    plan_launch_with(
        &cfg,
        global_mode,
        global_proton,
        &globals,
        &state.download_root(),
        appid,
        exe_path,
    )
}

pub(crate) fn resolve_auxiliary(
    state: &AppState,
    appid: &str,
    game_exe: &str,
    auxiliary_exe: &str,
    auxiliary_args: &[String],
) -> Result<LaunchPlan, String> {
    let cfg = config_for(state, appid);
    let global_mode = state
        .settings
        .get_string("linuxLaunchMode")
        .or_else(|| state.settings.get_string("linuxDefaultLaunchMode"));
    let global_proton = state
        .settings
        .get_string("linuxProtonPath")
        .filter(|value| !value.is_empty());
    let globals = GlobalLaunchOpts {
        extra_env: state
            .settings
            .get_string("linuxExtraEnv")
            .map(|value| parse_env_lines(&value))
            .unwrap_or_default(),
        dll_overrides: state
            .settings
            .get_string("linuxDllOverrides")
            .filter(|value| !value.trim().is_empty()),
        proton_prefix: state
            .settings
            .get_string("linuxProtonPrefix")
            .filter(|value| !value.is_empty()),
        ..Default::default()
    };
    let mut plan = plan_launch_with(
        &cfg,
        global_mode,
        global_proton,
        &globals,
        &state.download_root(),
        appid,
        game_exe,
    )?;
    if plan.args.first().map(String::as_str) == Some("waitforexitandrun") {
        plan.args = vec!["run".to_string(), auxiliary_exe.to_string()];
        plan.args.extend_from_slice(auxiliary_args);
        return Ok(plan);
    }
    if Path::new(&plan.command)
        .file_name()
        .map(|name| name.to_string_lossy() == "umu-run")
        .unwrap_or(false)
    {
        plan.args = vec![auxiliary_exe.to_string()];
        plan.args.extend_from_slice(auxiliary_args);
        return Ok(plan);
    }
    Err("Wand on Linux requires this game to use Proton or umu".to_string())
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
    plan_launch_with(
        cfg,
        global_mode,
        global_proton,
        &GlobalLaunchOpts::default(),
        download_root,
        appid,
        exe_path,
    )
}

fn apply_wrappers(mut plan: LaunchPlan, globals: &GlobalLaunchOpts) -> LaunchPlan {
    for tool in ["mangohud", "gamemoderun"] {
        let wanted =
            (tool == "mangohud" && globals.mangohud) || (tool == "gamemoderun" && globals.gamemode);
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
    let wine_prefix = cfg
        .get("winePrefix")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(String::from);
    let proton_prefix = cfg
        .get("protonPrefix")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(String::from)
        .or_else(|| globals.proton_prefix.clone());

    if !envs.iter().any(|(k, _)| k == "WINEDLLOVERRIDES") {
        if let Some(overrides) = proxy_dll_overrides(exe_path) {
            envs.push(("WINEDLLOVERRIDES".to_string(), overrides));
        }
    }
    merge_global_env(&mut envs, globals);

    let proton_path = cfg
        .get("protonPath")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(String::from)
        .or(global_proton);
    let umu = which("umu-run");
    let use_umu = mode == "umu" || (mode == "auto" && umu.is_some());
    if use_umu {
        let umu = match umu {
            Some(u) => u,
            None => return Err("launch mode is 'umu' but umu-run is not installed".to_string()),
        };
        if let Some(gameid) = cfg
            .get("umuGameId")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
        {
            envs.push(("GAMEID".to_string(), gameid.to_string()));
        }
        if let Some(proton) = &proton_path {
            envs.push(("PROTONPATH".to_string(), proton_root_for_umu(proton)));
        }
        let prefix = if let Some(prefix) = wine_prefix {
            prefix
        } else if let Some(prefix) = proton_prefix {
            proton_compat_prefix(&prefix)
        } else {
            let compat = download_root.join("compatdata").join(appid);
            std::fs::create_dir_all(&compat).ok();
            compat.join("pfx").to_string_lossy().to_string()
        };
        envs.push(("WINEPREFIX".to_string(), prefix));
        return Ok(apply_wrappers(
            LaunchPlan {
                command: umu,
                args: vec![exe_path.to_string()],
                envs,
            },
            globals,
        ));
    }

    if mode == "proton" || (mode == "auto" && proton_path.is_some()) {
        let proton = match &proton_path {
            Some(p) => p,
            None => {
                return Err("launch mode is 'proton' but no Proton path is configured".to_string())
            }
        };
        if let Some(steam) = steam_root() {
            envs.push(("STEAM_COMPAT_CLIENT_INSTALL_PATH".to_string(), steam));
        }
        envs.push((
            "STEAM_COMPAT_INSTALL_PATH".to_string(),
            install_path_for(exe_path),
        ));
        if let Some(prefix) = proton_prefix {
            envs.push(("STEAM_COMPAT_DATA_PATH".to_string(), prefix));
        } else {
            let compat = download_root.join("compatdata").join(appid);
            std::fs::create_dir_all(&compat).ok();
            envs.push((
                "STEAM_COMPAT_DATA_PATH".to_string(),
                compat.to_string_lossy().to_string(),
            ));
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
    if let Some(prefix) = wine_prefix {
        envs.push(("WINEPREFIX".to_string(), prefix));
    }
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
    let cwd = Path::new(exe_path)
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();
    match resolve_launch(state, appid, exe_path) {
        Ok(plan) => json!({ "command": plan.command, "args": plan.args, "cwd": cwd }),
        Err(e) => json!({ "error": e, "cwd": cwd }),
    }
}

fn unique_existing_dirs(candidates: impl IntoIterator<Item = PathBuf>) -> Vec<PathBuf> {
    let mut seen = HashSet::new();
    candidates
        .into_iter()
        .filter(|path| path.is_dir())
        .filter(|path| seen.insert(std::fs::canonicalize(path).unwrap_or_else(|_| path.clone())))
        .collect()
}

fn steam_roots_for(home: &Path, xdg_data: &Path) -> Vec<PathBuf> {
    unique_existing_dirs([
        xdg_data.join("Steam"),
        home.join(".local/share/Steam"),
        home.join(".steam/steam"),
        home.join(".steam/root"),
        home.join(".steam/debian-installation"),
        home.join(".var/app/com.valvesoftware.Steam/data/Steam"),
        home.join("snap/steam/common/.steam/root"),
    ])
}

fn steam_roots() -> Vec<PathBuf> {
    let Some(home) = dirs::home_dir() else {
        return Vec::new();
    };
    let xdg_data = std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(".local/share"));
    steam_roots_for(&home, &xdg_data)
}

fn steam_root() -> Option<String> {
    steam_roots()
        .into_iter()
        .next()
        .map(|path| path.to_string_lossy().to_string())
}

fn steam_library_dirs(steam_root: &Path) -> Vec<PathBuf> {
    let mut dirs = vec![steam_root.to_path_buf()];
    for rel in ["steamapps/libraryfolders.vdf", "config/libraryfolders.vdf"] {
        let vdf = steam_root.join(rel);
        let text = match std::fs::read_to_string(&vdf) {
            Ok(t) => t,
            Err(_) => continue,
        };
        for line in text.lines() {
            if let Some(rest) = line.trim().strip_prefix("\"path\"") {
                let path = PathBuf::from(rest.trim().trim_matches('"').replace("\\\\", "/"));
                if !path.as_os_str().is_empty() && !dirs.contains(&path) {
                    dirs.push(path);
                }
            }
        }
        break;
    }
    dirs
}

fn protonplus_runner_dirs_for(
    home: &Path,
    xdg_data: &Path,
    xdg_config: &Path,
    steam: &[PathBuf],
) -> Vec<PathBuf> {
    let mut candidates: Vec<PathBuf> = steam
        .iter()
        .map(|root| root.join("compatibilitytools.d"))
        .collect();
    candidates.extend([
        xdg_config.join("heroic/tools/proton"),
        home.join(".config/heroic/tools/proton"),
        home.join(".var/app/com.heroicgameslauncher.hgl/config/heroic/tools/proton"),
        xdg_data.join("lutris/runners/wine"),
        xdg_data.join("lutris/runners/proton"),
        home.join(".local/share/lutris/runners/wine"),
        home.join(".local/share/lutris/runners/proton"),
        home.join(".var/app/net.lutris.Lutris/data/lutris/runners/wine"),
        home.join(".var/app/net.lutris.Lutris/data/lutris/runners/proton"),
        xdg_data.join("bottles/runners/wine"),
        home.join(".local/share/bottles/runners/wine"),
        home.join(".var/app/com.usebottles.bottles/data/bottles/runners/wine"),
    ]);
    unique_existing_dirs(candidates)
}

fn protonplus_runner_dirs(steam: &[PathBuf]) -> Vec<PathBuf> {
    let Some(home) = dirs::home_dir() else {
        return Vec::new();
    };
    let xdg_data = std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(".local/share"));
    let xdg_config = std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(".config"));
    protonplus_runner_dirs_for(&home, &xdg_data, &xdg_config, steam)
}

#[derive(Debug, PartialEq, Eq)]
struct ProtonVersion {
    label: String,
    path: String,
    source: &'static str,
    newest: bool,
}

fn scan_proton_dir(
    parent: &Path,
    source: &'static str,
    require_proton_name: bool,
    seen: &mut HashSet<PathBuf>,
    versions: &mut Vec<ProtonVersion>,
) {
    let Ok(entries) = std::fs::read_dir(parent) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if require_proton_name && !name.to_ascii_lowercase().contains("proton") {
            continue;
        }
        let script = entry.path().join("proton");
        if !script.is_file() {
            continue;
        }
        let key = std::fs::canonicalize(&script).unwrap_or_else(|_| script.clone());
        if seen.insert(key) {
            versions.push(ProtonVersion {
                label: name,
                path: script.to_string_lossy().to_string(),
                source,
                newest: false,
            });
        }
    }
}

fn natural_cmp(left: &str, right: &str) -> Ordering {
    let (left, right) = (left.as_bytes(), right.as_bytes());
    let (mut li, mut ri) = (0, 0);
    while li < left.len() && ri < right.len() {
        if left[li].is_ascii_digit() && right[ri].is_ascii_digit() {
            let (ls, rs) = (li, ri);
            while li < left.len() && left[li].is_ascii_digit() {
                li += 1;
            }
            while ri < right.len() && right[ri].is_ascii_digit() {
                ri += 1;
            }
            let ldigits = &left[ls..li];
            let rdigits = &right[rs..ri];
            let ltrim = ldigits
                .iter()
                .position(|byte| *byte != b'0')
                .unwrap_or(ldigits.len());
            let rtrim = rdigits
                .iter()
                .position(|byte| *byte != b'0')
                .unwrap_or(rdigits.len());
            let lnum = &ldigits[ltrim..];
            let rnum = &rdigits[rtrim..];
            let order = lnum.len().cmp(&rnum.len()).then_with(|| lnum.cmp(rnum));
            if order != Ordering::Equal {
                return order;
            }
            continue;
        }
        let order = left[li]
            .to_ascii_lowercase()
            .cmp(&right[ri].to_ascii_lowercase());
        if order != Ordering::Equal {
            return order;
        }
        li += 1;
        ri += 1;
    }
    left.len().cmp(&right.len())
}

fn detect_proton_versions(steam: &[PathBuf], protonplus: &[PathBuf]) -> Vec<ProtonVersion> {
    let mut versions = Vec::new();
    let mut seen = HashSet::new();
    for root in steam {
        for library in steam_library_dirs(root) {
            scan_proton_dir(
                &library.join("steamapps/common"),
                "steam",
                true,
                &mut seen,
                &mut versions,
            );
        }
    }
    for directory in protonplus {
        scan_proton_dir(directory, "protonplus", false, &mut seen, &mut versions);
    }
    versions.sort_by(|left, right| {
        let source_order = |source| if source == "steam" { 0 } else { 1 };
        source_order(left.source)
            .cmp(&source_order(right.source))
            .then_with(|| natural_cmp(&right.label, &left.label))
            .then_with(|| left.path.cmp(&right.path))
    });
    if let Some(version) = versions
        .iter_mut()
        .find(|version| version.source == "protonplus")
    {
        version.newest = true;
    }
    versions
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
    let steam = steam_roots();
    let protonplus = protonplus_runner_dirs(&steam);
    let versions: Vec<Value> = detect_proton_versions(&steam, &protonplus)
        .into_iter()
        .map(|version| {
            json!({
                "label": version.label,
                "path": version.path,
                "source": version.source,
                "newest": version.newest,
            })
        })
        .collect();
    json!({ "ok": true, "versions": versions })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn touch(dir: &std::path::Path, name: &str) {
        std::fs::write(dir.join(name), []).unwrap();
    }

    fn runner(parent: &Path, name: &str) -> PathBuf {
        let directory = parent.join(name);
        std::fs::create_dir_all(&directory).unwrap();
        touch(&directory, "proton");
        directory
    }

    #[test]
    fn bepinex_asi_repack_forces_winhttp_and_winmm_native() {
        let tmp = tempfile::tempdir().unwrap();
        touch(tmp.path(), "GTFO.exe");
        touch(tmp.path(), "winhttp.dll");
        touch(tmp.path(), "winmm.dll");
        let exe = tmp.path().join("GTFO.exe");
        let ov = proxy_dll_overrides(exe.to_str().unwrap()).expect("expected overrides");
        assert!(
            ov.split(';').any(|e| e == "winhttp=n,b"),
            "winhttp missing: {ov}"
        );
        assert!(
            ov.split(';').any(|e| e == "winmm=n,b"),
            "winmm missing: {ov}"
        );
    }

    #[test]
    fn no_proxy_dll_beside_exe_yields_no_override() {
        let tmp = tempfile::tempdir().unwrap();
        touch(tmp.path(), "Game.exe");
        let exe = tmp.path().join("Game.exe");
        assert!(proxy_dll_overrides(exe.to_str().unwrap()).is_none());
    }

    #[test]
    fn override_lists_only_present_dlls() {
        let tmp = tempfile::tempdir().unwrap();
        touch(tmp.path(), "g.exe");
        touch(tmp.path(), "version.dll");
        let exe = tmp.path().join("g.exe");
        assert_eq!(
            proxy_dll_overrides(exe.to_str().unwrap()).unwrap(),
            "version=n,b"
        );
    }

    #[test]
    fn detects_protonplus_runners_and_marks_only_latest_custom_version() {
        let tmp = tempfile::tempdir().unwrap();
        let home = tmp.path();
        let xdg_data = home.join("share");
        let xdg_config = home.join("config");
        let steam_root = xdg_data.join("Steam");

        runner(&steam_root.join("steamapps/common"), "Proton 9.0");
        runner(&steam_root.join("compatibilitytools.d"), "GE-Proton10-2");
        runner(&xdg_config.join("heroic/tools/proton"), "GE-Proton10-12");

        let steam = steam_roots_for(home, &xdg_data);
        let protonplus = protonplus_runner_dirs_for(home, &xdg_data, &xdg_config, &steam);
        let versions = detect_proton_versions(&steam, &protonplus);

        assert_eq!(
            versions
                .iter()
                .map(|version| version.label.as_str())
                .collect::<Vec<_>>(),
            vec!["Proton 9.0", "GE-Proton10-12", "GE-Proton10-2"]
        );
        assert_eq!(
            versions
                .iter()
                .filter(|version| version.source == "protonplus")
                .count(),
            2
        );
        assert_eq!(
            versions
                .iter()
                .filter(|version| version.newest)
                .map(|version| version.label.as_str())
                .collect::<Vec<_>>(),
            vec!["GE-Proton10-12"]
        );
    }
    #[test]
    fn umu_uses_proton_directory_and_wine_prefix() {
        assert_eq!(
            proton_root_for_umu(
                "/home/user/.local/share/Steam/compatibilitytools.d/GE-Proton10-15/proton"
            ),
            "/home/user/.local/share/Steam/compatibilitytools.d/GE-Proton10-15"
        );
        assert_eq!(
            proton_compat_prefix("/home/user/Games/compatdata/mewgenics"),
            "/home/user/Games/compatdata/mewgenics/pfx"
        );
        assert_eq!(
            proton_compat_prefix("/home/user/Games/compatdata/mewgenics/pfx"),
            "/home/user/Games/compatdata/mewgenics/pfx"
        );
    }
}
