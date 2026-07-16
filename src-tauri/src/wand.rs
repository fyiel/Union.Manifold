use std::collections::HashMap;
use std::path::Path;
#[cfg(target_os = "linux")]
use std::path::PathBuf;
#[cfg(target_os = "linux")]
use std::process::Stdio;
use std::sync::{Arc, LazyLock};
use std::time::{Duration, Instant};

#[cfg(target_os = "linux")]
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
#[cfg(target_os = "linux")]
use sha1::{Digest, Sha1};
use tauri::{AppHandle, State};
#[cfg(target_os = "windows")]
use tauri_plugin_opener::OpenerExt;
#[cfg(target_os = "linux")]
use tokio::io::AsyncWriteExt;
use tokio::sync::{Mutex, RwLock};

use crate::error::{AppError, Result};
use crate::state::AppState;

const CATALOG_URL: &str = "https://storage-cdn.wemod.com/catalog.json";
const DOWNLOAD_URL: &str = "https://wand.com/download/direct";
const RELEASES_URL: &str = "https://storage-cdn.wemod.com/app/releases/stable/RELEASES";
const RELEASES_BASE_URL: &str = "https://storage-cdn.wemod.com/app/releases/stable";
const CATALOG_TTL: Duration = Duration::from_secs(6 * 60 * 60);

type WandCatalogCache = Option<(Instant, Arc<WandCatalog>)>;

static CATALOG: LazyLock<RwLock<WandCatalogCache>> = LazyLock::new(|| RwLock::new(None));
static RUNTIME_GATE: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

#[derive(Deserialize)]
struct WandCatalog {
    titles: HashMap<String, WandTitle>,
    games: HashMap<String, WandGame>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WandTitle {
    id: String,
    slug: String,
    name: String,
    #[serde(default)]
    terms: Vec<String>,
    #[serde(default)]
    game_ids: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WandGame {
    id: String,
    title_id: String,
    platform_id: String,
    #[serde(default)]
    correlation_ids: Vec<String>,
    trainer: Option<WandTrainer>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WandTrainer {
    #[serde(default)]
    cheat_count: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct WandMatch {
    title_id: String,
    game_id: String,
    name: String,
    slug: String,
    platform_id: String,
    cheat_count: u32,
    page_url: String,
}

async fn catalog() -> Result<Arc<WandCatalog>> {
    if let Some((loaded, catalog)) = CATALOG.read().await.as_ref() {
        if loaded.elapsed() < CATALOG_TTL {
            return Ok(catalog.clone());
        }
    }

    let loaded = Arc::new(crate::http::get_json::<WandCatalog>(CATALOG_URL).await?);
    *CATALOG.write().await = Some((Instant::now(), loaded.clone()));
    Ok(loaded)
}

fn normalized(value: &str) -> String {
    value
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

fn match_for(catalog: &WandCatalog, title: &str, steam_appid: Option<u64>) -> Option<WandMatch> {
    let steam_id = steam_appid.map(|id| format!("steam:{id}"));
    let exact_game = steam_id.as_ref().and_then(|id| {
        catalog.games.values().find(|game| {
            game.trainer.is_some() && game.correlation_ids.iter().any(|value| value == id)
        })
    });

    let matched_title = exact_game
        .and_then(|game| catalog.titles.get(&game.title_id))
        .or_else(|| {
            let needle = normalized(title);
            if needle.is_empty() {
                return None;
            }
            catalog.titles.values().find(|candidate| {
                normalized(&candidate.name) == needle
                    || normalized(&candidate.slug) == needle
                    || candidate
                        .terms
                        .iter()
                        .any(|term| normalized(term) == needle)
            })
        })?;

    let game = exact_game.or_else(|| {
        let games = matched_title
            .game_ids
            .iter()
            .filter_map(|id| catalog.games.get(id))
            .filter(|game| game.trainer.is_some());
        games
            .clone()
            .find(|game| game.platform_id == "steam")
            .or_else(|| games.into_iter().next())
    })?;
    let trainer = game.trainer.as_ref()?;

    Some(WandMatch {
        title_id: matched_title.id.clone(),
        game_id: game.id.clone(),
        name: matched_title.name.clone(),
        slug: matched_title.slug.clone(),
        platform_id: game.platform_id.clone(),
        cheat_count: trainer.cheat_count,
        page_url: format!("https://wand.com/games/{}", matched_title.slug),
    })
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct WandRelease {
    sha1: String,
    filename: String,
    size: u64,
}

fn latest_runtime_release(releases: &str) -> Option<WandRelease> {
    releases
        .lines()
        .filter_map(|line| {
            let mut fields = line.split_whitespace();
            let sha1 = fields.next()?;
            let filename = fields.next()?;
            let size = fields.next()?.parse().ok()?;
            if fields.next().is_some()
                || !filename.starts_with("Wand-")
                || !filename.ends_with("-full.nupkg")
                || Path::new(filename).file_name()?.to_str()? != filename
            {
                return None;
            }
            Some(WandRelease {
                sha1: sha1.to_ascii_lowercase(),
                filename: filename.to_string(),
                size,
            })
        })
        .next_back()
}

#[cfg(target_os = "linux")]
async fn ensure_linux_runtime(state: &AppState) -> Result<PathBuf> {
    let _gate = RUNTIME_GATE.lock().await;
    let releases = crate::http::fetch(
        RELEASES_URL,
        &crate::http::FetchOpts {
            timeout: Some(Duration::from_secs(60)),
            ..Default::default()
        },
    )
    .await?
    .error_for_status()?
    .text()
    .await?;
    let release = latest_runtime_release(&releases)
        .ok_or_else(|| AppError::msg("Wand release manifest has no full package"))?;
    let version = release
        .filename
        .strip_suffix("-full.nupkg")
        .unwrap_or("Wand");
    let root = state.paths.data_dir.join("wand");
    let runtime = root.join(version);
    let executable = runtime.join("lib").join("net45").join("Wand.exe");
    if executable.is_file() {
        return Ok(executable);
    }

    tokio::fs::create_dir_all(&root)
        .await
        .map_err(|error| AppError::msg(format!("create Wand cache: {error}")))?;
    let archive = root.join(format!("{}.download", release.filename));
    let url = format!("{RELEASES_BASE_URL}/{}", release.filename);
    let response = crate::http::fetch(
        &url,
        &crate::http::FetchOpts {
            timeout: Some(Duration::from_secs(20 * 60)),
            ..Default::default()
        },
    )
    .await?
    .error_for_status()?;
    let mut stream = response.bytes_stream();
    let mut file = tokio::fs::File::create(&archive)
        .await
        .map_err(|error| AppError::msg(format!("create Wand package: {error}")))?;
    let mut received = 0u64;
    let mut hasher = Sha1::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        received += chunk.len() as u64;
        hasher.update(&chunk);
        file.write_all(&chunk)
            .await
            .map_err(|error| AppError::msg(format!("write Wand package: {error}")))?;
    }
    file.flush()
        .await
        .map_err(|error| AppError::msg(format!("flush Wand package: {error}")))?;
    drop(file);
    if received != release.size || hex::encode(hasher.finalize()) != release.sha1 {
        let _ = tokio::fs::remove_file(&archive).await;
        return Err(AppError::msg("Wand package failed integrity verification"));
    }

    let staging = root.join(format!(".{version}-extracting"));
    let _ = tokio::fs::remove_dir_all(&staging).await;
    if let Err(error) = crate::install::run_7z(&archive, &staging, |_| {}).await {
        let _ = tokio::fs::remove_file(&archive).await;
        let _ = tokio::fs::remove_dir_all(&staging).await;
        return Err(error);
    }
    let staged_executable = staging.join("lib").join("net45").join("Wand.exe");
    if !staged_executable.is_file() {
        let _ = tokio::fs::remove_file(&archive).await;
        let _ = tokio::fs::remove_dir_all(&staging).await;
        return Err(AppError::msg("Wand package does not contain Wand.exe"));
    }
    let _ = tokio::fs::remove_dir_all(&runtime).await;
    tokio::fs::rename(&staging, &runtime)
        .await
        .map_err(|error| AppError::msg(format!("install Wand runtime: {error}")))?;
    let _ = tokio::fs::remove_file(&archive).await;
    Ok(executable)
}

#[cfg(target_os = "windows")]
fn installed() -> bool {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    if RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey(r"Software\Classes\wand\shell\open\command")
        .is_ok()
    {
        return true;
    }
    std::env::var_os("LOCALAPPDATA")
        .map(|dir| {
            std::path::PathBuf::from(dir)
                .join("Wand")
                .join("Update.exe")
                .is_file()
        })
        .unwrap_or(false)
}

#[cfg(not(target_os = "windows"))]
fn installed() -> bool {
    false
}

#[tauri::command]
pub fn wand_status() -> Value {
    json!({
        "ok": true,
        "windows": cfg!(target_os = "windows"),
        "installed": installed(),
        "downloadUrl": DOWNLOAD_URL,
    })
}

#[tauri::command]
pub async fn wand_lookup(title: String, steam_appid: Option<u64>) -> Result<Value> {
    let matched = match_for(catalog().await?.as_ref(), &title, steam_appid);
    Ok(json!({
        "ok": true,
        "windows": cfg!(target_os = "windows"),
        "installed": installed(),
        "supported": matched.is_some(),
        "game": matched,
        "downloadUrl": DOWNLOAD_URL,
    }))
}

#[cfg(target_os = "windows")]
async fn launch_matched(
    app: &AppHandle,
    _state: &AppState,
    _appid: &str,
    matched: &WandMatch,
) -> Result<Value> {
    if !installed() {
        return Ok(
            json!({ "ok": false, "needsInstall": true, "downloadUrl": DOWNLOAD_URL, "error": "Wand is not installed" }),
        );
    }
    let uri = format!(
        "wand://play?titleId={}&gameId={}",
        matched.title_id, matched.game_id
    );
    match app.opener().open_url(&uri, None::<&str>) {
        Ok(()) => Ok(json!({ "ok": true, "game": matched })),
        Err(error) => Ok(json!({ "ok": false, "error": error.to_string() })),
    }
}

#[cfg(target_os = "linux")]
async fn launch_matched(
    _app: &AppHandle,
    state: &AppState,
    appid: &str,
    matched: &WandMatch,
) -> Result<Value> {
    let game_executable = state
        .settings
        .get_string(&format!("gameExe:{appid}"))
        .filter(|path| Path::new(path).is_file());
    let Some(game_executable) = game_executable else {
        return Ok(json!({
            "ok": false,
            "error": "Launch this game once or set its executable before starting Wand"
        }));
    };
    let wand_executable = ensure_linux_runtime(state).await?;
    let uri = format!(
        "wand://play?titleId={}&gameId={}",
        matched.title_id, matched.game_id
    );
    let auxiliary_args = vec!["--no-sandbox".to_string(), uri];
    let plan = match crate::launch::linux::resolve_auxiliary(
        state,
        appid,
        &game_executable,
        &wand_executable.to_string_lossy(),
        &auxiliary_args,
    ) {
        Ok(plan) => plan,
        Err(error) => return Ok(json!({ "ok": false, "error": error })),
    };
    let mut command = tokio::process::Command::new(&plan.command);
    command
        .args(&plan.args)
        .envs(plan.envs)
        .current_dir(wand_executable.parent().unwrap_or(Path::new(".")))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    match command.spawn() {
        Ok(_) => Ok(json!({
            "ok": true,
            "game": matched,
            "launchGame": true,
            "runtime": "proton",
            "experimental": true
        })),
        Err(error) => {
            Ok(json!({ "ok": false, "error": format!("start Wand through Proton: {error}") }))
        }
    }
}

#[cfg(not(any(target_os = "windows", target_os = "linux")))]
async fn launch_matched(
    _app: &AppHandle,
    _state: &AppState,
    _appid: &str,
    _matched: &WandMatch,
) -> Result<Value> {
    Ok(json!({ "ok": false, "error": "Wand is not supported on this platform" }))
}

#[tauri::command]
pub async fn wand_launch(
    app: AppHandle,
    state: State<'_, AppState>,
    appid: String,
    title: String,
    steam_appid: Option<u64>,
) -> Result<Value> {
    let Some(matched) = match_for(catalog().await?.as_ref(), &title, steam_appid) else {
        return Ok(json!({ "ok": false, "error": "This game is not supported by Wand" }));
    };
    launch_matched(&app, &state, &appid, &matched).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> WandCatalog {
        WandCatalog {
            titles: HashMap::from([
                (
                    "10".into(),
                    WandTitle {
                        id: "10".into(),
                        slug: "example-game".into(),
                        name: "Example Game".into(),
                        terms: vec!["Example".into()],
                        game_ids: vec!["101".into(), "102".into()],
                    },
                ),
                (
                    "20".into(),
                    WandTitle {
                        id: "20".into(),
                        slug: "unsupported".into(),
                        name: "Unsupported".into(),
                        terms: vec![],
                        game_ids: vec!["201".into()],
                    },
                ),
            ]),
            games: HashMap::from([
                (
                    "101".into(),
                    WandGame {
                        id: "101".into(),
                        title_id: "10".into(),
                        platform_id: "epic".into(),
                        correlation_ids: vec!["epic:example".into()],
                        trainer: Some(WandTrainer { cheat_count: 7 }),
                    },
                ),
                (
                    "102".into(),
                    WandGame {
                        id: "102".into(),
                        title_id: "10".into(),
                        platform_id: "steam".into(),
                        correlation_ids: vec!["steam:42".into()],
                        trainer: Some(WandTrainer { cheat_count: 9 }),
                    },
                ),
                (
                    "201".into(),
                    WandGame {
                        id: "201".into(),
                        title_id: "20".into(),
                        platform_id: "steam".into(),
                        correlation_ids: vec!["steam:99".into()],
                        trainer: None,
                    },
                ),
            ]),
        }
    }

    #[test]
    fn steam_appid_selects_the_exact_game() {
        let matched = match_for(&fixture(), "Wrong title", Some(42)).unwrap();
        assert_eq!(matched.game_id, "102");
        assert_eq!(matched.cheat_count, 9);
    }

    #[test]
    fn title_match_prefers_the_steam_game() {
        let matched = match_for(&fixture(), "Example Game", None).unwrap();
        assert_eq!(matched.game_id, "102");
    }

    #[test]
    fn games_without_a_trainer_are_not_launchable() {
        assert!(match_for(&fixture(), "Unsupported", Some(99)).is_none());
    }

    #[test]
    fn latest_full_wand_release_is_selected() {
        let releases = "\
AAAA Wand-12.38.0-full.nupkg 20
BBBB Wand-12.39.0-delta.nupkg 2
CCCC Wand-12.39.0-full.nupkg 30
";
        assert_eq!(
            latest_runtime_release(releases),
            Some(WandRelease {
                sha1: "cccc".into(),
                filename: "Wand-12.39.0-full.nupkg".into(),
                size: 30,
            })
        );
    }
}
