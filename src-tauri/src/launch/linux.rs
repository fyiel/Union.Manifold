use std::{
    cmp::Ordering,
    collections::HashSet,
    path::{Path, PathBuf},
};

#[cfg(target_os = "linux")]
use std::collections::VecDeque;

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

pub(crate) fn which(tool: &str) -> Option<String> {
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
        .and_then(Value::as_str)
        .map(parse_env_lines)
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

fn umu_game_id(cfg: &Value, appid: &str) -> Option<String> {
    cfg.get("umuGameId")
        .and_then(|value| value.as_str())
        .filter(|value| !value.is_empty())
        .map(String::from)
        .or_else(|| steam_appid(appid).map(|id| format!("umu-{id}")))
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
    // Loader proxy names. Wine prefers its own builtin for these DLLs, so the
    // copy the loader dropped beside the game executable is ignored and the
    // loader never injects until the name is overridden to native first.
    // `dwmapi` is UE4SS's default proxy, the name its packages ship, and
    // `xinput1_3` is the other proxy UE4SS supports.
    const PROXIES: &[&str] = &[
        "winhttp",
        "winmm",
        "version",
        "dinput8",
        "dsound",
        "dbghelp",
        "wininet",
        "dwmapi",
        "xinput1_3",
    ];
    let entries: HashSet<String> = std::fs::read_dir(dir)
        .ok()?
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.file_name().to_string_lossy().to_ascii_lowercase())
        .collect();
    let found: Vec<String> = PROXIES
        .iter()
        .filter(|proxy| entries.contains(&format!("{proxy}.dll")))
        .map(|proxy| format!("{proxy}=n,b"))
        .collect();
    if found.is_empty() {
        None
    } else {
        Some(found.join(";"))
    }
}

#[cfg(target_os = "linux")]
fn launch_env<'a>(plan: &'a LaunchPlan, key: &str) -> Option<&'a str> {
    plan.envs
        .iter()
        .rev()
        .find(|(name, _)| name == key)
        .map(|(_, value)| value.as_str())
}

#[cfg(target_os = "linux")]
fn set_launch_env(plan: &mut LaunchPlan, key: &str, value: String) {
    if let Some((_, current)) = plan.envs.iter_mut().rev().find(|(name, _)| name == key) {
        *current = value;
    } else {
        plan.envs.push((key.to_string(), value));
    }
}

#[cfg(target_os = "linux")]
fn active_wine_prefix(plan: &LaunchPlan) -> Option<PathBuf> {
    launch_env(plan, "WINEPREFIX")
        .map(PathBuf::from)
        .or_else(|| {
            launch_env(plan, "STEAM_COMPAT_DATA_PATH").map(|path| Path::new(path).join("pfx"))
        })
        .or_else(|| dirs::home_dir().map(|home| home.join(".wine")))
}

#[cfg(target_os = "linux")]
fn usable_file(path: &Path) -> bool {
    path.metadata()
        .map(|metadata| metadata.len() > 0)
        .unwrap_or(false)
}

#[cfg(target_os = "linux")]
fn link_runtime_file(source: &Path, destination: &Path) -> Result<(), String> {
    if destination.is_file() {
        return Ok(());
    }
    if let Ok(metadata) = std::fs::symlink_metadata(destination) {
        if metadata.file_type().is_symlink() {
            std::fs::remove_file(destination).map_err(|error| {
                format!(
                    "could not replace broken Steam client link {}: {error}",
                    destination.display()
                )
            })?;
        } else {
            return Err(format!(
                "the Steam client runtime needs {}, but that path is occupied",
                destination.display()
            ));
        }
    }
    std::os::unix::fs::symlink(source, destination).map_err(|error| {
        format!(
            "could not link {} to {}: {error}",
            source.display(),
            destination.display()
        )
    })
}

/// Where Steam emulators look for the client: inside the prefix, under
/// `C:\Program Files (x86)\Steam`. OnlineFix builds and SOVEREIGN both load
/// the DLLs from there to reach the Steam client on the host.
#[cfg(target_os = "linux")]
const PREFIX_STEAM_DIR: &str = "drive_c/Program Files (x86)/Steam";

#[cfg(target_os = "linux")]
fn steam_client_root<'a>(steam_roots: &'a [PathBuf], files: [&str; 2]) -> Option<&'a PathBuf> {
    steam_roots
        .iter()
        .find(|root| files.iter().all(|name| usable_file(&root.join(name))))
}

#[cfg(target_os = "linux")]
fn searched_steam_roots(steam_roots: &[PathBuf]) -> String {
    if steam_roots.is_empty() {
        "no Steam installation was found".to_string()
    } else {
        steam_roots
            .iter()
            .map(|root| root.display().to_string())
            .collect::<Vec<_>>()
            .join(", ")
    }
}

/// Links the Steam client runtime into the active Wine/Proton prefix and
/// points `STEAM_COMPAT_CLIENT_INSTALL_PATH` at the Steam install. That is
/// what the client DLLs inside the prefix follow to find the Steam process on
/// the host.
#[cfg(target_os = "linux")]
fn link_steam_client_runtime(
    plan: &mut LaunchPlan,
    steam_root: &Path,
    files: [&str; 2],
) -> Result<(), String> {
    let prefix = active_wine_prefix(plan)
        .ok_or_else(|| "could not determine the active Wine/Proton prefix".to_string())?;
    let destination = prefix.join(PREFIX_STEAM_DIR);
    std::fs::create_dir_all(&destination).map_err(|error| {
        format!(
            "could not prepare the active prefix at {}: {error}",
            destination.display()
        )
    })?;
    for name in files {
        link_runtime_file(&steam_root.join(name), &destination.join(name))?;
    }
    set_launch_env(
        plan,
        "STEAM_COMPAT_CLIENT_INSTALL_PATH",
        steam_root.to_string_lossy().to_string(),
    );
    Ok(())
}

#[cfg(target_os = "linux")]
fn prepare_onlinefix_runtime_from(
    plan: &mut LaunchPlan,
    exe_path: &Path,
    steam_roots: &[PathBuf],
) -> Result<(), String> {
    let game_dir = match exe_path.parent() {
        Some(path) => path,
        None => return Ok(()),
    };
    let marker = ["OnlineFix.ini", "OnlineFix64.dll", "OnlineFix32.dll"]
        .iter()
        .any(|name| game_dir.join(name).is_file());
    if !marker {
        return Ok(());
    }

    let runtime = if game_dir.join("SteamOverlay64.dll").is_file() {
        Some(("steamclient64.dll", "GameOverlayRenderer64.dll"))
    } else if game_dir.join("SteamOverlay.dll").is_file() {
        Some(("steamclient.dll", "GameOverlayRenderer.dll"))
    } else {
        None
    };
    let Some((client_name, renderer_name)) = runtime else {
        return Ok(());
    };
    let steam_root = steam_client_root(steam_roots, [client_name, renderer_name]).ok_or_else(|| {
        format!(
            "OnlineFix needs {client_name} and {renderer_name} from one local Steam installation. Searched: {}. Install or repair Steam, then launch again.",
            searched_steam_roots(steam_roots)
        )
    })?;
    link_steam_client_runtime(plan, steam_root, [client_name, renderer_name])?;
    Ok(())
}

#[cfg(target_os = "linux")]
pub(crate) fn prepare_onlinefix_runtime(
    plan: &mut LaunchPlan,
    exe_path: &Path,
) -> Result<(), String> {
    prepare_onlinefix_runtime_from(plan, exe_path, &crate::import::steam_roots())
}

/// A Steam API library in the game tells us it talks to Steam. Cracked builds
/// wrap the same file, so repacks land here too, while GOG and offline builds
/// have nothing to stage and are skipped. Each entry carries the client pair
/// for its architecture.
#[cfg(target_os = "linux")]
const STEAM_API_LIBRARIES: [(&str, [&str; 2]); 2] = [
    (
        "steam_api64.dll",
        ["steamclient64.dll", "GameOverlayRenderer64.dll"],
    ),
    ("steam_api.dll", ["steamclient.dll", "GameOverlayRenderer.dll"]),
];
#[cfg(target_os = "linux")]
const STEAM_API_SCAN_DEPTH: usize = 4;
#[cfg(target_os = "linux")]
const STEAM_API_SCAN_DIRS: usize = 1024;

/// SOVEREIGN releases keep the emulator next to the Steam API library and
/// read their settings from the sibling `SOVEREIGN.ini`.
#[cfg(target_os = "linux")]
const SOVEREIGN_EMULATOR: &str = "SOVEREIGN64.dll";
#[cfg(target_os = "linux")]
const SOVEREIGN_CONFIG: &str = "SOVEREIGN.ini";

/// Finds the folder holding the game's Steam API library and returns it with
/// the client pair to stage. Searched breadth first, so plugin folders like
/// `<Game>_Data/Plugins/x86_64` or `Binaries/Win64` come up before deep asset
/// trees, and capped so a strange layout cannot hang a launch.
#[cfg(target_os = "linux")]
fn steam_api_dir(game_dir: &Path) -> Option<(PathBuf, [&'static str; 2])> {
    let mut queue = VecDeque::from([(game_dir.to_path_buf(), 0usize)]);
    let mut visited = 0usize;
    while let Some((dir, depth)) = queue.pop_front() {
        visited += 1;
        if visited > STEAM_API_SCAN_DIRS {
            return None;
        }
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        let mut files: Vec<String> = Vec::new();
        for entry in entries.flatten() {
            if entry.path().is_dir() {
                if depth < STEAM_API_SCAN_DEPTH {
                    queue.push_back((entry.path(), depth + 1));
                }
            } else {
                files.push(entry.file_name().to_string_lossy().to_ascii_lowercase());
            }
        }
        for (api, client_files) in STEAM_API_LIBRARIES {
            if files.iter().any(|name| name == api) {
                return Some((dir, client_files));
            }
        }
    }
    None
}

/// `[Steamworks] Online` from `SOVEREIGN.ini`, or `None` when the file or the
/// key is missing. Missing counts as on, because those releases ship with
/// online mode enabled, and that is the case that needs the client staged.
#[cfg(target_os = "linux")]
fn sovereign_online_mode(emulator_dir: &Path) -> Option<bool> {
    let text = std::fs::read_to_string(emulator_dir.join(SOVEREIGN_CONFIG)).ok()?;
    let mut in_steamworks = false;
    for line in text.lines() {
        let line = line.trim();
        if let Some(section) = line.strip_prefix('[').and_then(|rest| rest.strip_suffix(']')) {
            in_steamworks = section.trim().eq_ignore_ascii_case("steamworks");
            continue;
        }
        if !in_steamworks {
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        if !key.trim().eq_ignore_ascii_case("online") {
            continue;
        }
        return Some(matches!(
            value.trim().to_ascii_lowercase().as_str(),
            "1" | "true" | "yes" | "on"
        ));
    }
    None
}

/// Hands a Steamworks game the client runtime Steam would have put in its
/// prefix, so the game, or the crack that replaced its Steam API, can reach
/// the client running on the host. Games without a Steam install keep the
/// offline behaviour they have today instead of failing to launch.
#[cfg(target_os = "linux")]
fn prepare_steam_runtime_from(
    plan: &mut LaunchPlan,
    exe_path: &Path,
    steam_roots: &[PathBuf],
) -> Result<(), String> {
    let Some(game_dir) = exe_path.parent() else {
        return Ok(());
    };
    let Some((api_dir, client_files)) = steam_api_dir(game_dir) else {
        return Ok(());
    };
    // A SOVEREIGN release set to offline never touches the Steam client.
    let emulator = api_dir.join(SOVEREIGN_EMULATOR).is_file();
    if emulator && sovereign_online_mode(&api_dir) == Some(false) {
        return Ok(());
    }
    let Some(steam_root) = steam_client_root(steam_roots, client_files) else {
        // Best effort for everything else: a game without a usable Steam
        // client looks like a Steam-less machine, which Steam games survive.
        // The emulator families cannot, so they report what is missing.
        if !emulator {
            return Ok(());
        }
        return Err(format!(
            "SOVEREIGN online mode ([Steamworks] Online=1 in {}) needs {} and {} from one local Steam installation. Searched: {}. Install or repair Steam, then launch again, or set [Steamworks] Online=0 in that file to play offline.",
            api_dir.join(SOVEREIGN_CONFIG).display(),
            client_files[0],
            client_files[1],
            searched_steam_roots(steam_roots)
        ));
    };
    link_steam_client_runtime(plan, steam_root, client_files)
}

#[cfg(target_os = "linux")]
pub(crate) fn prepare_steam_runtime(plan: &mut LaunchPlan, exe_path: &Path) -> Result<(), String> {
    prepare_steam_runtime_from(plan, exe_path, &crate::import::steam_roots())
}

#[derive(Default)]
pub(crate) struct GlobalLaunchOpts {
    pub extra_env: Vec<(String, String)>,
    pub gamemode: bool,
    pub mangohud: bool,
    pub dll_overrides: Option<String>,
    pub proton_prefix: Option<String>,
    pub gamescope: bool,
    pub gamescope_fsr: bool,
    pub gamescope_game_width: Option<String>,
    pub gamescope_game_height: Option<String>,
    pub gamescope_output_width: Option<String>,
    pub gamescope_output_height: Option<String>,
    pub gamescope_fps_limit: Option<String>,
    pub gamescope_refresh_rate: Option<String>,
    pub gamescope_sharpness: Option<String>,
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
        gamescope: state
            .settings
            .get("linuxGamescope")
            .as_bool()
            .unwrap_or(false),
        gamescope_fsr: state
            .settings
            .get("linuxGamescopeFsr")
            .as_bool()
            .unwrap_or(false),
        gamescope_game_width: state
            .settings
            .get_string("linuxGamescopeGameWidth")
            .filter(|s| !s.trim().is_empty()),
        gamescope_game_height: state
            .settings
            .get_string("linuxGamescopeGameHeight")
            .filter(|s| !s.trim().is_empty()),
        gamescope_output_width: state
            .settings
            .get_string("linuxGamescopeOutputWidth")
            .filter(|s| !s.trim().is_empty()),
        gamescope_output_height: state
            .settings
            .get_string("linuxGamescopeOutputHeight")
            .filter(|s| !s.trim().is_empty()),
        gamescope_fps_limit: state
            .settings
            .get_string("linuxGamescopeFpsLimit")
            .filter(|s| !s.trim().is_empty()),
        gamescope_refresh_rate: state
            .settings
            .get_string("linuxGamescopeRefreshRate")
            .filter(|s| !s.trim().is_empty()),
        gamescope_sharpness: state
            .settings
            .get_string("linuxGamescopeSharpness")
            .filter(|s| !s.trim().is_empty()),
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

#[cfg(target_os = "linux")]
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
    retarget_auxiliary(
        plan_launch_with(
            &cfg,
            global_mode,
            global_proton,
            &globals,
            &state.download_root(),
            appid,
            game_exe,
        )?,
        auxiliary_exe,
        auxiliary_args,
    )
}

#[cfg(target_os = "linux")]
fn retarget_auxiliary(
    mut plan: LaunchPlan,
    auxiliary_exe: &str,
    auxiliary_args: &[String],
) -> Result<LaunchPlan, String> {
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
        plan.envs
            .push(("PROTON_VERB".to_string(), "run".to_string()));
        plan.envs
            .push(("UMU_CONTAINER_NSENTER".to_string(), "1".to_string()));
        return Ok(plan);
    }
    Err("Wand on Linux requires this game to use Proton or umu".to_string())
}

#[cfg(all(test, target_os = "linux"))]
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

fn gamescope_args(globals: &GlobalLaunchOpts) -> Vec<String> {
    let mut args = Vec::new();
    if globals.gamescope_fsr {
        args.push("-F".to_string());
        args.push("fsr".to_string());
    }
    for (flag, value) in [
        ("-w", &globals.gamescope_game_width),
        ("-h", &globals.gamescope_game_height),
        ("-W", &globals.gamescope_output_width),
        ("-H", &globals.gamescope_output_height),
    ] {
        if let Some(value) = value.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
            args.push(flag.to_string());
            args.push(value.to_string());
        }
    }
    if let Some(sharpness) = globals
        .gamescope_sharpness
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        args.push("--sharpness".to_string());
        args.push(sharpness.to_string());
    }
    if let Some(limit) = globals
        .gamescope_fps_limit
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        args.push("--framerate-limit".to_string());
        args.push(limit.to_string());
    }
    if let Some(rate) = globals
        .gamescope_refresh_rate
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        args.push("--nested-refresh".to_string());
        args.push(rate.to_string());
    }
    args
}

fn wrap_gamescope(mut plan: LaunchPlan, globals: &GlobalLaunchOpts, gamescope: &str) -> LaunchPlan {
    let mut args = gamescope_args(globals);
    args.push("--".to_string());
    args.push(plan.command.clone());
    args.append(&mut plan.args);
    plan.command = gamescope.to_string();
    plan.args = args;
    plan
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
    if globals.gamescope {
        if let Some(path) = which("gamescope") {
            plan = wrap_gamescope(plan, globals, &path);
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
        if let Some(gameid) = umu_game_id(cfg, appid) {
            envs.push(("GAMEID".to_string(), gameid));
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
    if let Some(text) = ["steamapps/libraryfolders.vdf", "config/libraryfolders.vdf"]
        .into_iter()
        .find_map(|rel| std::fs::read_to_string(steam_root.join(rel)).ok())
    {
        for line in text.lines() {
            if let Some(rest) = line.trim().strip_prefix("\"path\"") {
                let path = PathBuf::from(rest.trim().trim_matches('"').replace("\\\\", "/"));
                if !path.as_os_str().is_empty() && !dirs.contains(&path) {
                    dirs.push(path);
                }
            }
        }
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
    fn ue4ss_install_forces_its_dwmapi_proxy_native() {
        let tmp = tempfile::tempdir().unwrap();
        touch(tmp.path(), "Dawnwalker.exe");
        touch(tmp.path(), "dwmapi.dll");
        touch(tmp.path(), "version.dll");
        let exe = tmp.path().join("Dawnwalker.exe");
        let ov = proxy_dll_overrides(exe.to_str().unwrap()).expect("expected overrides");
        assert!(
            ov.split(';').any(|e| e == "dwmapi=n,b"),
            "dwmapi missing: {ov}"
        );
        assert!(
            ov.split(';').any(|e| e == "version=n,b"),
            "version missing: {ov}"
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
    fn proxy_dll_detection_is_case_insensitive_like_wine() {
        let tmp = tempfile::tempdir().unwrap();
        touch(tmp.path(), "Game.exe");
        touch(tmp.path(), "WINMM.DLL");
        let exe = tmp.path().join("Game.exe");
        assert_eq!(
            proxy_dll_overrides(exe.to_str().unwrap()).as_deref(),
            Some("winmm=n,b")
        );
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn onlinefix_stages_the_local_steam_runtime_into_the_active_prefix() {
        let tmp = tempfile::tempdir().unwrap();
        let game = tmp.path().join("game");
        let steam = tmp.path().join("steam");
        let prefix = tmp.path().join("prefix");
        std::fs::create_dir_all(&game).unwrap();
        std::fs::create_dir_all(&steam).unwrap();
        std::fs::write(game.join("Game.exe"), b"exe").unwrap();
        std::fs::write(game.join("OnlineFix.ini"), b"marker").unwrap();
        std::fs::write(game.join("SteamOverlay64.dll"), b"loader").unwrap();
        std::fs::write(steam.join("steamclient64.dll"), b"client").unwrap();
        std::fs::write(steam.join("GameOverlayRenderer64.dll"), b"renderer").unwrap();
        let mut plan = LaunchPlan {
            command: "umu-run".into(),
            args: vec![],
            envs: vec![("WINEPREFIX".into(), prefix.to_string_lossy().to_string())],
        };

        prepare_onlinefix_runtime_from(&mut plan, &game.join("Game.exe"), std::slice::from_ref(&steam))
            .unwrap();

        let destination = prefix.join("drive_c/Program Files (x86)/Steam");
        assert_eq!(
            std::fs::read_link(destination.join("steamclient64.dll")).unwrap(),
            steam.join("steamclient64.dll")
        );
        assert_eq!(
            std::fs::read_link(destination.join("GameOverlayRenderer64.dll")).unwrap(),
            steam.join("GameOverlayRenderer64.dll")
        );
        assert_eq!(
            launch_env(&plan, "STEAM_COMPAT_CLIENT_INSTALL_PATH"),
            steam.to_str()
        );
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn onlinefix_reports_the_exact_missing_local_runtime() {
        let tmp = tempfile::tempdir().unwrap();
        let game = tmp.path().join("game");
        let steam = tmp.path().join("steam");
        std::fs::create_dir_all(&game).unwrap();
        std::fs::create_dir_all(&steam).unwrap();
        std::fs::write(game.join("Game.exe"), b"exe").unwrap();
        std::fs::write(game.join("OnlineFix64.dll"), b"marker").unwrap();
        std::fs::write(game.join("SteamOverlay64.dll"), b"loader").unwrap();
        let mut plan = LaunchPlan {
            command: "wine".into(),
            args: vec![],
            envs: vec![],
        };

        let error =
            prepare_onlinefix_runtime_from(&mut plan, &game.join("Game.exe"), std::slice::from_ref(&steam))
                .unwrap_err();

        assert!(error.contains("steamclient64.dll"), "{error}");
        assert!(error.contains("GameOverlayRenderer64.dll"), "{error}");
        assert!(error.contains(&steam.display().to_string()), "{error}");
    }

    #[cfg(target_os = "linux")]
    fn sovereign_fixture(tmp: &Path, online: Option<&str>) -> (PathBuf, PathBuf) {
        let game = tmp.join("game");
        let plugins = game.join("Game_Data/Plugins/x86_64");
        std::fs::create_dir_all(&plugins).unwrap();
        let steam = tmp.join("steam");
        std::fs::create_dir_all(&steam).unwrap();
        std::fs::write(game.join("Game.exe"), b"exe").unwrap();
        std::fs::write(plugins.join("SOVEREIGN64.dll"), b"emulator").unwrap();
        std::fs::write(plugins.join("steam_api64.dll"), b"wrapper").unwrap();
        std::fs::write(steam.join("steamclient64.dll"), b"client").unwrap();
        std::fs::write(steam.join("GameOverlayRenderer64.dll"), b"renderer").unwrap();
        if let Some(online) = online {
            std::fs::write(
                plugins.join("SOVEREIGN.ini"),
                format!("[Game]\nAppID=1913120\n\n[Steamworks]\nOnline={online}\n"),
            )
            .unwrap();
        }
        (game.join("Game.exe"), steam)
    }

    #[cfg(target_os = "linux")]
    fn sovereign_plan(prefix: &Path) -> LaunchPlan {
        LaunchPlan {
            command: "umu-run".into(),
            args: vec![],
            envs: vec![("WINEPREFIX".into(), prefix.to_string_lossy().to_string())],
        }
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn sovereign_online_mode_stages_the_local_steam_runtime() {
        let tmp = tempfile::tempdir().unwrap();
        let (exe, steam) = sovereign_fixture(tmp.path(), Some("1"));
        let prefix = tmp.path().join("prefix");
        let mut plan = sovereign_plan(&prefix);

        prepare_steam_runtime_from(&mut plan, &exe, std::slice::from_ref(&steam)).unwrap();

        let destination = prefix.join(PREFIX_STEAM_DIR);
        assert_eq!(
            std::fs::read_link(destination.join("steamclient64.dll")).unwrap(),
            steam.join("steamclient64.dll")
        );
        assert_eq!(
            std::fs::read_link(destination.join("GameOverlayRenderer64.dll")).unwrap(),
            steam.join("GameOverlayRenderer64.dll")
        );
        assert_eq!(
            launch_env(&plan, "STEAM_COMPAT_CLIENT_INSTALL_PATH"),
            steam.to_str()
        );
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn sovereign_offline_mode_leaves_the_prefix_alone() {
        let tmp = tempfile::tempdir().unwrap();
        let (exe, steam) = sovereign_fixture(
            tmp.path(),
            Some("0"),
        );
        // A decoy Online key outside [Steamworks] must not re-enable staging.
        let plugins = exe.parent().unwrap().join("Game_Data/Plugins/x86_64");
        std::fs::write(
            plugins.join("SOVEREIGN.ini"),
            "[Diagnostics]\nOnline=1\n\n[Steamworks]\nOnline=0\n",
        )
        .unwrap();
        let prefix = tmp.path().join("prefix");
        let mut plan = sovereign_plan(&prefix);

        prepare_steam_runtime_from(&mut plan, &exe, std::slice::from_ref(&steam)).unwrap();

        assert!(!prefix.join(PREFIX_STEAM_DIR).exists());
        assert!(launch_env(&plan, "STEAM_COMPAT_CLIENT_INSTALL_PATH").is_none());
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn sovereign_without_config_stages_the_runtime() {
        let tmp = tempfile::tempdir().unwrap();
        let (exe, steam) = sovereign_fixture(tmp.path(), None);
        let prefix = tmp.path().join("prefix");
        let mut plan = sovereign_plan(&prefix);

        prepare_steam_runtime_from(&mut plan, &exe, std::slice::from_ref(&steam)).unwrap();

        assert!(prefix
            .join(PREFIX_STEAM_DIR)
            .join("steamclient64.dll")
            .is_file());
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn games_without_a_steam_api_are_untouched() {
        let tmp = tempfile::tempdir().unwrap();
        let game = tmp.path().join("game");
        std::fs::create_dir_all(game.join("Game_Data/Plugins/x86_64")).unwrap();
        std::fs::write(game.join("Game.exe"), b"exe").unwrap();
        let steam = tmp.path().join("steam");
        std::fs::create_dir_all(&steam).unwrap();
        std::fs::write(steam.join("steamclient64.dll"), b"client").unwrap();
        std::fs::write(steam.join("GameOverlayRenderer64.dll"), b"renderer").unwrap();
        let prefix = tmp.path().join("prefix");
        let mut plan = sovereign_plan(&prefix);

        prepare_steam_runtime_from(&mut plan, &game.join("Game.exe"), std::slice::from_ref(&steam))
            .unwrap();

        assert!(!prefix.join(PREFIX_STEAM_DIR).exists());
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn a_steamworks_game_gets_the_runtime_a_steam_launch_provides() {
        let tmp = tempfile::tempdir().unwrap();
        let game = tmp.path().join("game");
        let plugins = game.join("Game_Data/Plugins/x86_64");
        std::fs::create_dir_all(&plugins).unwrap();
        std::fs::write(game.join("Game.exe"), b"exe").unwrap();
        std::fs::write(plugins.join("steam_api64.dll"), b"valve api").unwrap();
        let steam = tmp.path().join("steam");
        std::fs::create_dir_all(&steam).unwrap();
        std::fs::write(steam.join("steamclient64.dll"), b"client").unwrap();
        std::fs::write(steam.join("GameOverlayRenderer64.dll"), b"renderer").unwrap();
        let prefix = tmp.path().join("prefix");
        let mut plan = sovereign_plan(&prefix);

        prepare_steam_runtime_from(&mut plan, &game.join("Game.exe"), std::slice::from_ref(&steam))
            .unwrap();

        let destination = prefix.join(PREFIX_STEAM_DIR);
        assert_eq!(
            std::fs::read_link(destination.join("steamclient64.dll")).unwrap(),
            steam.join("steamclient64.dll")
        );
        assert_eq!(
            launch_env(&plan, "STEAM_COMPAT_CLIENT_INSTALL_PATH"),
            steam.to_str()
        );
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn a_32bit_steam_api_gets_the_32bit_runtime() {
        let tmp = tempfile::tempdir().unwrap();
        let game = tmp.path().join("game");
        std::fs::create_dir_all(game.join("Plugins/x86")).unwrap();
        std::fs::write(game.join("Game.exe"), b"exe").unwrap();
        std::fs::write(game.join("Plugins/x86/steam_api.dll"), b"valve api").unwrap();
        let steam = tmp.path().join("steam");
        std::fs::create_dir_all(&steam).unwrap();
        std::fs::write(steam.join("steamclient.dll"), b"client32").unwrap();
        std::fs::write(steam.join("GameOverlayRenderer.dll"), b"renderer32").unwrap();
        let prefix = tmp.path().join("prefix");
        let mut plan = sovereign_plan(&prefix);

        prepare_steam_runtime_from(&mut plan, &game.join("Game.exe"), std::slice::from_ref(&steam))
            .unwrap();

        let destination = prefix.join(PREFIX_STEAM_DIR);
        assert_eq!(
            std::fs::read_link(destination.join("steamclient.dll")).unwrap(),
            steam.join("steamclient.dll")
        );
        assert!(!destination.join("steamclient64.dll").exists());
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn a_steamworks_game_without_a_local_steam_install_still_launches() {
        let tmp = tempfile::tempdir().unwrap();
        let game = tmp.path().join("game");
        std::fs::create_dir_all(&game).unwrap();
        std::fs::write(game.join("Game.exe"), b"exe").unwrap();
        std::fs::write(game.join("steam_api64.dll"), b"valve api").unwrap();
        let prefix = tmp.path().join("prefix");
        let mut plan = sovereign_plan(&prefix);

        prepare_steam_runtime_from(&mut plan, &game.join("Game.exe"), &[]).unwrap();

        assert!(!prefix.join(PREFIX_STEAM_DIR).exists());
        assert!(launch_env(&plan, "STEAM_COMPAT_CLIENT_INSTALL_PATH").is_none());
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn sovereign_online_mode_reports_the_missing_local_runtime() {
        let tmp = tempfile::tempdir().unwrap();
        let (exe, _) = sovereign_fixture(tmp.path(), Some("1"));
        let steam = tmp.path().join("empty-steam");
        std::fs::create_dir_all(&steam).unwrap();
        let mut plan = sovereign_plan(&tmp.path().join("prefix"));

        let error = prepare_steam_runtime_from(&mut plan, &exe, std::slice::from_ref(&steam))
            .unwrap_err();

        assert!(error.contains("SOVEREIGN.ini"), "{error}");
        assert!(error.contains("steamclient64.dll"), "{error}");
        assert!(error.contains(&steam.display().to_string()), "{error}");
        assert!(error.contains("Online=0"), "{error}");
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
    #[cfg(target_os = "linux")]
    #[test]
    fn auxiliary_umu_launch_joins_a_running_prefix() {
        let plan = retarget_auxiliary(
            LaunchPlan {
                command: "/usr/bin/umu-run".into(),
                args: vec!["game.exe".into()],
                envs: vec![],
            },
            "trainer-host.exe",
            &["--target".into(), "game.exe".into()],
        )
        .unwrap();

        assert_eq!(plan.args, ["trainer-host.exe", "--target", "game.exe"]);
        assert!(plan.envs.contains(&("PROTON_VERB".into(), "run".into())));
        assert!(plan
            .envs
            .contains(&("UMU_CONTAINER_NSENTER".into(), "1".into())));
    }

    #[test]
    fn umu_uses_the_steam_id_when_no_game_id_is_configured() {
        assert_eq!(
            umu_game_id(&serde_json::json!({}), "steam-686060").as_deref(),
            Some("umu-686060")
        );
        assert_eq!(
            umu_game_id(
                &serde_json::json!({ "umuGameId": "umu-custom" }),
                "steam-686060"
            )
            .as_deref(),
            Some("umu-custom")
        );
    }

    #[cfg(target_os = "linux")]
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

    #[test]
    fn gamescope_args_map_options_to_flags() {
        let globals = GlobalLaunchOpts {
            gamescope: true,
            gamescope_fsr: true,
            gamescope_game_width: Some("1280".into()),
            gamescope_game_height: Some("720".into()),
            gamescope_output_width: Some("1920".into()),
            gamescope_output_height: Some("1080".into()),
            gamescope_fps_limit: Some("144".into()),
            gamescope_refresh_rate: Some("144".into()),
            gamescope_sharpness: Some("5".into()),
            ..Default::default()
        };
        assert_eq!(
            gamescope_args(&globals),
            [
                "-F",
                "fsr",
                "-w",
                "1280",
                "-h",
                "720",
                "-W",
                "1920",
                "-H",
                "1080",
                "--sharpness",
                "5",
                "--framerate-limit",
                "144",
                "--nested-refresh",
                "144",
            ]
        );
    }

    #[test]
    fn gamescope_args_omit_blank_options() {
        let globals = GlobalLaunchOpts {
            gamescope: true,
            gamescope_fsr: false,
            gamescope_fps_limit: Some("  ".into()),
            gamescope_refresh_rate: None,
            gamescope_sharpness: Some("".into()),
            ..Default::default()
        };
        assert!(gamescope_args(&globals).is_empty());
    }

    #[test]
    fn gamescope_wraps_outermost_and_keeps_wrapped_command() {
        let globals = GlobalLaunchOpts {
            gamescope: true,
            gamescope_fsr: true,
            gamescope_fps_limit: Some("144".into()),
            ..Default::default()
        };
        let plan = wrap_gamescope(
            LaunchPlan {
                command: "gamemoderun".into(),
                args: vec!["game.exe".into()],
                envs: vec![("GAMEID".into(), "umu-1".into())],
            },
            &globals,
            "/usr/bin/gamescope",
        );
        assert_eq!(
            plan.command,
            "/usr/bin/gamescope",
            "gamescope must be the outermost wrapper"
        );
        assert_eq!(
            plan.args,
            [
                "-F",
                "fsr",
                "--framerate-limit",
                "144",
                "--",
                "gamemoderun",
                "game.exe"
            ]
        );
        assert_eq!(plan.envs, [("GAMEID".into(), "umu-1".into())]);
    }
}
