use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, LazyLock};
use std::time::{Duration, Instant};

use base64::{
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
    Engine,
};
use futures::StreamExt;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha1::{Digest, Sha1};
use sha2::Sha256;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_opener::OpenerExt;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncSeekExt, AsyncWriteExt, BufReader};
use tokio::net::{tcp::OwnedWriteHalf, TcpListener};
use tokio::sync::{Mutex, RwLock};

use crate::error::{AppError, Result};
use crate::state::AppState;

const CATALOG_URL: &str = "https://storage-cdn.wemod.com/catalog.json";
const RELEASES_URL: &str = "https://storage-cdn.wemod.com/app/releases/stable/RELEASES";
const RELEASES_BASE_URL: &str = "https://storage-cdn.wemod.com/app/releases/stable";
const API_URL: &str = "https://api.wemod.com";
const OAUTH_URL: &str = "https://wand.com/oauth/authorize";
const OAUTH_REDIRECT: &str = "wemod://oauth";
const AUTH_USER_AGENT: &str = concat!("Union.Manifold/", env!("CARGO_PKG_VERSION"), " Wand/0.0.0");
const CATALOG_TTL: Duration = Duration::from_secs(6 * 60 * 60);

type WandCatalogCache = Option<(Instant, Arc<WandCatalog>)>;

static CATALOG: LazyLock<RwLock<WandCatalogCache>> = LazyLock::new(|| RwLock::new(None));
static RUNTIME_GATE: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));
static AUTH_GATE: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));
static OAUTH_PENDING: LazyLock<Mutex<Option<OAuthPending>>> = LazyLock::new(|| Mutex::new(None));
static SESSIONS: LazyLock<Mutex<HashMap<String, WandSession>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static NEXT_SESSION_ID: AtomicU64 = AtomicU64::new(1);

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

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WandAuth {
    access_token: String,
    refresh_token: Option<String>,
    user_id: String,
    expires_at: i64,
    client_params: Option<Value>,
}

#[derive(Deserialize)]
struct WandTokenResponse {
    access_token: String,
    refresh_token: Option<String>,
    user_id: String,
    expires_in: i64,
    client_params: Option<Value>,
}

#[derive(Debug)]
struct OAuthPending {
    state: String,
    verifier: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct WandControl {
    uuid: String,
    target: String,
    name: String,
    category: String,
    kind: String,
}

#[derive(Clone)]
struct WandSession {
    id: u64,
    writer: Arc<Mutex<OwnedWriteHalf>>,
}

#[derive(Debug)]
struct WandLoader {
    trainer_id: String,
    binary_url: String,
    binary_hash: String,
    flags: u32,
    variables: Vec<String>,
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

fn trainerlib_dir(runtime: &Path) -> Option<PathBuf> {
    [
        runtime.join("trainerlib"),
        runtime.join("lib/net45/resources/app.asar.unpacked/static/unpacked/trainerlib"),
        runtime.join("lib/net45/resources/wand.asar.unpacked/static/unpacked/trainerlib"),
    ]
    .into_iter()
    .find(|path| {
        path.join("TrainerLib_x64.dll").is_file()
            && path.join("TrainerLib_x86.dll").is_file()
            && path.join("CELib_x64.dll").is_file()
            && path.join("CELib_x86.dll").is_file()
    })
}

async fn ensure_runtime(data_dir: &Path) -> Result<PathBuf> {
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
    let wand_root = data_dir.join("wand");
    let runtime = wand_root.join("runtime").join(version);
    if let Some(assets) = trainerlib_dir(&runtime) {
        return Ok(assets);
    }
    if let Some(assets) = trainerlib_dir(&wand_root.join(version)) {
        return Ok(assets);
    }

    tokio::fs::create_dir_all(runtime.parent().unwrap_or(&wand_root))
        .await
        .map_err(|error| AppError::msg(format!("create Wand runtime cache: {error}")))?;
    let archive = wand_root.join(format!("{}.download", release.filename));
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

    let staging = wand_root.join(format!(".{version}-extracting"));
    let _ = tokio::fs::remove_dir_all(&staging).await;
    if let Err(error) = crate::install::run_7z(&archive, &staging, |_| {}).await {
        let _ = tokio::fs::remove_file(&archive).await;
        let _ = tokio::fs::remove_dir_all(&staging).await;
        return Err(error);
    }
    let staged_assets = trainerlib_dir(&staging)
        .ok_or_else(|| AppError::msg("Wand package does not contain TrainerLib"))?;
    let _ = tokio::fs::remove_dir_all(&runtime).await;
    tokio::fs::rename(&staged_assets, &runtime)
        .await
        .map_err(|error| AppError::msg(format!("install Wand trainer runtime: {error}")))?;
    let _ = tokio::fs::remove_file(&archive).await;
    let _ = tokio::fs::remove_dir_all(&staging).await;
    Ok(runtime)
}

fn installation_id(state: &AppState) -> String {
    if let Some(id) = state
        .settings
        .get("wandInstallationId")
        .as_str()
        .filter(|id| id.len() == 36)
    {
        return id.to_string();
    }
    let mut bytes = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    let value = hex::encode(bytes);
    let id = format!(
        "{}-{}-{}-{}-{}",
        &value[..8],
        &value[8..12],
        &value[12..16],
        &value[16..20],
        &value[20..],
    );
    state
        .settings
        .set("wandInstallationId", Value::String(id.clone()));
    id
}

fn oauth_url(challenge: &str, state: &str, installation_id: &str) -> Result<url::Url> {
    let mut url = url::Url::parse(OAUTH_URL)
        .map_err(|error| AppError::msg(format!("build Wand login URL: {error}")))?;
    url.query_pairs_mut()
        .append_pair("response_type", "code")
        .append_pair("client_id", "infinity")
        .append_pair("redirect_uri", OAUTH_REDIRECT)
        .append_pair("code_challenge", challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("state", state)
        .append_pair("provider", "google")
        .append_pair("installation_id", installation_id);
    Ok(url)
}

fn stored_auth(state: &AppState) -> Option<WandAuth> {
    serde_json::from_value(state.settings.get("wandAuth")).ok()
}

fn save_auth(state: &AppState, auth: Option<&WandAuth>) {
    state.settings.set(
        "wandAuth",
        auth.and_then(|value| serde_json::to_value(value).ok())
            .unwrap_or(Value::Null),
    );
}

async fn request_access_token(params: &[(&str, String)]) -> Result<WandAuth> {
    let body = {
        let mut form = url::form_urlencoded::Serializer::new(String::new());
        form.append_pair("client_id", "infinity");
        for (key, value) in params {
            form.append_pair(key, value);
        }
        form.finish().into_bytes()
    };
    let response = crate::http::fetch(
        &format!("{API_URL}/auth/token"),
        &crate::http::FetchOpts {
            method: Some("POST".to_string()),
            headers: HashMap::from([
                (
                    "Content-Type".to_string(),
                    "application/x-www-form-urlencoded".to_string(),
                ),
                ("User-Agent".to_string(), AUTH_USER_AGENT.to_string()),
            ]),
            body: Some(body),
            retries: Some(0),
            timeout: Some(Duration::from_secs(30)),
            ..Default::default()
        },
    )
    .await?;
    let status = response.status();
    if !status.is_success() {
        let message = response.text().await.unwrap_or_default();
        return Err(AppError::msg(format!(
            "Wand authentication failed ({status}): {message}"
        )));
    }
    let response: WandTokenResponse = response.json().await?;
    Ok(WandAuth {
        access_token: response.access_token,
        refresh_token: response.refresh_token,
        user_id: response.user_id,
        expires_at: chrono::Utc::now().timestamp() + response.expires_in,
        client_params: response.client_params,
    })
}

async fn current_auth(state: &AppState) -> Result<Option<WandAuth>> {
    let Some(auth) = stored_auth(state) else {
        return Ok(None);
    };
    if auth.expires_at == 0 || auth.expires_at > chrono::Utc::now().timestamp() + 150 {
        return Ok(Some(auth));
    }

    let _gate = AUTH_GATE.lock().await;
    let Some(auth) = stored_auth(state) else {
        return Ok(None);
    };
    if auth.expires_at == 0 || auth.expires_at > chrono::Utc::now().timestamp() + 150 {
        return Ok(Some(auth));
    }
    let Some(refresh_token) = auth.refresh_token.as_ref() else {
        save_auth(state, None);
        return Ok(None);
    };
    let refreshed = request_access_token(&[
        ("grant_type", "refresh_token".to_string()),
        ("refresh_token", refresh_token.clone()),
    ])
    .await?;
    save_auth(state, Some(&refreshed));
    Ok(Some(refreshed))
}

pub fn handle_deep_link(app: &AppHandle, uri: &str) {
    if !uri.to_ascii_lowercase().starts_with(OAUTH_REDIRECT) {
        return;
    }
    let app = app.clone();
    let uri = uri.to_string();
    tauri::async_runtime::spawn(async move {
        let parsed = match url::Url::parse(&uri) {
            Ok(value) => value,
            Err(error) => {
                app.emit(
                    "uc:wand-auth-changed",
                    json!({ "ok": false, "error": error.to_string() }),
                )
                .ok();
                return;
            }
        };
        let query: HashMap<String, String> = parsed.query_pairs().into_owned().collect();
        let pending = OAUTH_PENDING.lock().await.take();
        let result = async {
            let pending = pending.ok_or_else(|| AppError::msg("Wand login session expired"))?;
            if let Some(error) = query.get("error") {
                return Err(AppError::msg(format!("Wand login failed: {error}")));
            }
            let code = query
                .get("code")
                .filter(|value| !value.is_empty())
                .ok_or_else(|| AppError::msg("Wand login did not return an authorization code"))?;
            if query.get("state") != Some(&pending.state) {
                return Err(AppError::msg("Wand login state did not match"));
            }
            let auth = request_access_token(&[
                ("grant_type", "authorization_code".to_string()),
                ("code", code.clone()),
                ("redirect_uri", OAUTH_REDIRECT.to_string()),
                ("code_verifier", pending.verifier),
            ])
            .await?;
            let state = app.state::<AppState>();
            save_auth(&state, Some(&auth));
            Ok::<_, AppError>(())
        }
        .await;
        match result {
            Ok(()) => {
                app.emit("uc:wand-auth-changed", json!({ "ok": true })).ok();
            }
            Err(error) => {
                app.emit(
                    "uc:wand-auth-changed",
                    json!({ "ok": false, "error": error.to_string() }),
                )
                .ok();
            }
        }
    });
}

#[tauri::command]
pub fn wand_status(state: State<'_, AppState>) -> Value {
    json!({
        "ok": true,
        "supported": cfg!(any(target_os = "windows", target_os = "linux")),
        "authenticated": stored_auth(&state).is_some(),
    })
}

#[tauri::command]
pub async fn wand_auth_begin(app: AppHandle, state: State<'_, AppState>) -> Result<Value> {
    let mut verifier_bytes = [0u8; 32];
    let mut state_bytes = [0u8; 24];
    rand::thread_rng().fill_bytes(&mut verifier_bytes);
    rand::thread_rng().fill_bytes(&mut state_bytes);
    let verifier = URL_SAFE_NO_PAD.encode(verifier_bytes);
    let oauth_state = URL_SAFE_NO_PAD.encode(state_bytes);
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let url = oauth_url(&challenge, &oauth_state, &installation_id(&state))?;
    *OAUTH_PENDING.lock().await = Some(OAuthPending {
        state: oauth_state,
        verifier,
    });
    if let Err(error) = app.opener().open_url(url.as_str(), None::<&str>) {
        OAUTH_PENDING.lock().await.take();
        return Err(AppError::msg(format!("open Wand login: {error}")));
    }
    Ok(json!({ "ok": true }))
}

#[tauri::command]
pub fn wand_disconnect(state: State<'_, AppState>) -> Value {
    save_auth(&state, None);
    json!({ "ok": true })
}

#[tauri::command]
pub async fn wand_lookup(title: String, steam_appid: Option<u64>) -> Result<Value> {
    let matched = match_for(catalog().await?.as_ref(), &title, steam_appid);
    Ok(json!({
        "ok": true,
        "supported": matched.is_some(),
        "game": matched,
    }))
}

fn trainer_node(response: &Value) -> &Value {
    response
        .pointer("/data/trainer")
        .or_else(|| response.get("trainer"))
        .unwrap_or(response)
}

fn parse_controls(response: &Value) -> Vec<WandControl> {
    trainer_node(response)
        .pointer("/blueprint/cheats")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|cheat| {
            let target = cheat.get("target").and_then(Value::as_str)?.to_string();
            if target.is_empty() || target.len() > 31 {
                return None;
            }
            Some(WandControl {
                uuid: cheat
                    .get("uuid")
                    .and_then(Value::as_str)
                    .unwrap_or(&target)
                    .to_string(),
                target: target.clone(),
                name: cheat
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or(&target)
                    .to_string(),
                category: cheat
                    .get("category")
                    .and_then(Value::as_str)
                    .unwrap_or("General")
                    .to_string(),
                kind: cheat
                    .get("type")
                    .and_then(Value::as_str)
                    .unwrap_or("toggle")
                    .to_string(),
            })
        })
        .collect()
}

fn parse_loader(response: &Value) -> Result<WandLoader> {
    let trainer = trainer_node(response);
    if trainer.get("loader").and_then(Value::as_str) != Some("trainerlib") {
        return Err(AppError::msg("This Wand trainer does not use TrainerLib"));
    }
    let args = trainer
        .get("loaderArgs")
        .ok_or_else(|| AppError::msg("Wand trainer has no loader metadata"))?;
    let trainer_id = args
        .get("trainerId")
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::msg("Wand trainer has no trainer ID"))?
        .to_string();
    let binary_url = args
        .get("binaryUrl")
        .and_then(Value::as_str)
        .filter(|url| url.starts_with("https://"))
        .ok_or_else(|| AppError::msg("Wand trainer has no secure binary URL"))?
        .to_string();
    let binary_hash = args
        .get("binaryHash")
        .and_then(Value::as_str)
        .filter(|hash| hash.len() == 64 && hash.bytes().all(|byte| byte.is_ascii_hexdigit()))
        .ok_or_else(|| AppError::msg("Wand trainer has an invalid binary hash"))?
        .to_ascii_lowercase();
    let flags = trainer
        .pointer("/blueprint/config/activate/flags")
        .and_then(Value::as_u64)
        .and_then(|value| u32::try_from(value).ok())
        .unwrap_or_default();
    let mut variables = Vec::new();
    if let Some(cheats) = trainer
        .pointer("/blueprint/cheats")
        .and_then(Value::as_array)
    {
        for target in cheats
            .iter()
            .filter_map(|cheat| cheat.get("target").and_then(Value::as_str))
            .filter(|target| !target.is_empty() && target.len() <= 31)
        {
            if !variables.iter().any(|value| value == target) {
                variables.push(target.to_string());
            }
        }
    }
    if let Some(events) = trainer.get("gameEvents").and_then(Value::as_array) {
        for key in events
            .iter()
            .filter_map(|event| event.get("key").and_then(Value::as_str))
        {
            let variable = format!("wm_event_{}", key.chars().take(22).collect::<String>());
            if !variables.contains(&variable) {
                variables.push(variable);
            }
        }
    }
    Ok(WandLoader {
        trainer_id,
        binary_url,
        binary_hash,
        flags,
        variables,
    })
}

async fn fetch_trainer(matched: &WandMatch, auth: &WandAuth) -> Result<Value> {
    let url = format!(
        "{API_URL}/v3/games/{}/trainer?gameVersions=&locale=en-US&v=3",
        matched.game_id
    );
    let response = crate::http::fetch(
        &url,
        &crate::http::FetchOpts {
            headers: HashMap::from([
                ("Accept".to_string(), "application/json".to_string()),
                (
                    "Authorization".to_string(),
                    format!("Bearer {}", auth.access_token),
                ),
                ("X-Super-Properties".to_string(), STANDARD.encode("{}")),
            ]),
            retries: Some(0),
            timeout: Some(Duration::from_secs(30)),
            ..Default::default()
        },
    )
    .await?;
    let status = response.status();
    if status.is_success() {
        Ok(response.json().await?)
    } else {
        let message = response.text().await.unwrap_or_default();
        Err(AppError::msg(format!(
            "Wand trainer request failed ({status}): {message}"
        )))
    }
}

#[tauri::command]
pub async fn wand_trainer(
    state: State<'_, AppState>,
    title: String,
    steam_appid: Option<u64>,
) -> Result<Value> {
    let Some(matched) = match_for(catalog().await?.as_ref(), &title, steam_appid) else {
        return Ok(json!({ "ok": false, "error": "This game is not supported by Wand" }));
    };
    let Some(auth) = current_auth(&state).await? else {
        return Ok(json!({
            "ok": false,
            "needsAuth": true,
            "game": matched,
            "error": "Connect a Wand account to load trainer controls"
        }));
    };
    let response = fetch_trainer(&matched, &auth).await?;
    let controls = parse_controls(&response);
    Ok(json!({
        "ok": true,
        "authenticated": true,
        "game": matched,
        "controls": controls,
    }))
}

async fn download_trainer(data_dir: &Path, loader: &WandLoader) -> Result<PathBuf> {
    let cache = data_dir.join("wand").join("trainers");
    tokio::fs::create_dir_all(&cache)
        .await
        .map_err(|error| AppError::msg(format!("create Wand trainer cache: {error}")))?;
    let trainer_id: String = loader
        .trainer_id
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '-' {
                character
            } else {
                '_'
            }
        })
        .collect();
    let path = cache.join(format!(
        "Trainer_{}_{}.dll",
        trainer_id,
        &loader.binary_hash[..10]
    ));
    if path.is_file() {
        return Ok(path);
    }
    let temporary = cache.join(format!(".{trainer_id}.download"));
    let response = crate::http::fetch(
        &loader.binary_url,
        &crate::http::FetchOpts {
            retries: Some(0),
            timeout: Some(Duration::from_secs(5 * 60)),
            ..Default::default()
        },
    )
    .await?
    .error_for_status()?;
    let mut stream = response.bytes_stream();
    let mut file = tokio::fs::File::create(&temporary)
        .await
        .map_err(|error| AppError::msg(format!("create Wand trainer download: {error}")))?;
    let mut hasher = Sha256::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        hasher.update(&chunk);
        file.write_all(&chunk)
            .await
            .map_err(|error| AppError::msg(format!("write Wand trainer download: {error}")))?;
    }
    file.flush()
        .await
        .map_err(|error| AppError::msg(format!("flush Wand trainer download: {error}")))?;
    drop(file);
    if hex::encode(hasher.finalize()) != loader.binary_hash {
        let _ = tokio::fs::remove_file(&temporary).await;
        return Err(AppError::msg(
            "Downloaded Wand trainer failed integrity verification",
        ));
    }
    tokio::fs::rename(&temporary, &path)
        .await
        .map_err(|error| AppError::msg(format!("cache Wand trainer: {error}")))?;
    Ok(path)
}

async fn trainer_arch(path: &Path) -> Result<&'static str> {
    let mut file = tokio::fs::File::open(path)
        .await
        .map_err(|error| AppError::msg(format!("open Wand trainer: {error}")))?;
    file.seek(std::io::SeekFrom::Start(0x3c)).await?;
    let mut offset = [0u8; 4];
    file.read_exact(&mut offset).await?;
    file.seek(std::io::SeekFrom::Start(u32::from_le_bytes(offset) as u64))
        .await?;
    let mut header = [0u8; 6];
    file.read_exact(&mut header).await?;
    if &header[..4] != b"PE\0\0" {
        return Err(AppError::msg("Wand trainer is not a Windows DLL"));
    }
    match u16::from_le_bytes([header[4], header[5]]) {
        0x8664 => Ok("x64"),
        0x014c => Ok("x86"),
        _ => Err(AppError::msg(
            "Wand trainer uses an unsupported architecture",
        )),
    }
}

async fn game_version(path: &Path) -> Result<u32> {
    let mut file = tokio::fs::File::open(path)
        .await
        .map_err(|error| AppError::msg(format!("open game executable: {error}")))?;
    file.seek(std::io::SeekFrom::Start(0x3c)).await?;
    let mut offset = [0u8; 4];
    file.read_exact(&mut offset).await?;
    file.seek(std::io::SeekFrom::Start(u32::from_le_bytes(offset) as u64))
        .await?;
    let mut header = [0u8; 12];
    file.read_exact(&mut header).await?;
    if &header[..4] != b"PE\0\0" {
        return Err(AppError::msg("Game executable is not a Windows PE file"));
    }
    Ok(u32::from_le_bytes([
        header[8], header[9], header[10], header[11],
    ]))
}

fn resolve_trainer_host(resource_dir: Option<PathBuf>, source: PathBuf) -> Option<PathBuf> {
    let name = source.file_name()?.to_owned();
    resource_dir
        .into_iter()
        .flat_map(|directory| {
            [
                directory.join(&name),
                directory.join("resources").join(&name),
            ]
        })
        .chain([source])
        .find(|path| path.is_file())
}

fn trainer_host_path(app: &AppHandle, arch: &str) -> Result<PathBuf> {
    let name = format!("trainer-host-{arch}.exe");
    let source = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join(&name);
    resolve_trainer_host(app.path().resource_dir().ok(), source)
        .ok_or_else(|| AppError::msg(format!("{name} is missing; run pnpm build:trainer-host")))
}

fn decode_host_text(value: &str) -> String {
    hex::decode(value)
        .ok()
        .and_then(|bytes| String::from_utf8(bytes).ok())
        .unwrap_or_else(|| "Invalid trainer host message".to_string())
}

async fn stop_session(appid: &str) {
    let session = SESSIONS.lock().await.remove(appid);
    if let Some(session) = session {
        let _ = session.writer.lock().await.write_all(b"STOP\n").await;
    }
}

#[cfg(target_os = "windows")]
fn trainer_host_command(
    _state: &AppState,
    _appid: &str,
    _game_executable: &str,
    host: &Path,
    host_args: &[String],
) -> Result<tokio::process::Command> {
    let mut command = tokio::process::Command::new(host);
    command.args(host_args);
    Ok(command)
}

#[cfg(target_os = "linux")]
fn trainer_host_command(
    state: &AppState,
    appid: &str,
    game_executable: &str,
    host: &Path,
    host_args: &[String],
) -> Result<tokio::process::Command> {
    let plan = crate::launch::linux::resolve_auxiliary(
        state,
        appid,
        game_executable,
        &host.to_string_lossy(),
        host_args,
    )
    .map_err(AppError::msg)?;
    let mut command = tokio::process::Command::new(plan.command);
    command.args(plan.args).envs(plan.envs);
    Ok(command)
}

#[cfg(not(any(target_os = "windows", target_os = "linux")))]
fn trainer_host_command(
    _state: &AppState,
    _appid: &str,
    _game_executable: &str,
    _host: &Path,
    _host_args: &[String],
) -> Result<tokio::process::Command> {
    Err(AppError::msg(
        "Wand trainers are not supported on this platform",
    ))
}

async fn start_host(
    app: &AppHandle,
    state: &AppState,
    appid: &str,
    game_executable: &str,
    trainer: &Path,
    trainerlib: &Path,
    loader: &WandLoader,
    arch: &str,
    version: u32,
) -> Result<()> {
    let target = Path::new(game_executable)
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .ok_or_else(|| AppError::msg("Game executable has no filename"))?;
    let host = trainer_host_path(app, arch)?;
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .await
        .map_err(|error| AppError::msg(format!("open trainer host channel: {error}")))?;
    let port = listener
        .local_addr()
        .map_err(|error| AppError::msg(format!("read trainer host channel: {error}")))?
        .port();
    let mut token_bytes = [0u8; 24];
    rand::thread_rng().fill_bytes(&mut token_bytes);
    let token = hex::encode(token_bytes);
    let mut host_args = vec![
        "--target".to_string(),
        target.to_string(),
        "--trainer".to_string(),
        trainer.to_string_lossy().into_owned(),
        "--trainerlib".to_string(),
        trainerlib.to_string_lossy().into_owned(),
        "--game-version".to_string(),
        version.to_string(),
        "--flags".to_string(),
        loader.flags.to_string(),
        "--connect".to_string(),
        port.to_string(),
        "--token".to_string(),
        token.clone(),
    ];
    for variable in &loader.variables {
        host_args.push("--variable".to_string());
        host_args.push(variable.clone());
    }

    let mut command = trainer_host_command(state, appid, game_executable, &host, &host_args)?;

    command
        .current_dir(trainerlib.parent().unwrap_or(Path::new(".")))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(false);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let child = command
        .spawn()
        .map_err(|error| AppError::msg(format!("start trainer host: {error}")))?;
    let (stream, _) = tokio::time::timeout(Duration::from_secs(60), listener.accept())
        .await
        .map_err(|_| AppError::msg("Trainer host did not connect"))?
        .map_err(|error| AppError::msg(format!("accept trainer host connection: {error}")))?;
    let (reader, writer) = stream.into_split();
    let mut lines = BufReader::new(reader).lines();
    let hello = tokio::time::timeout(Duration::from_secs(5), lines.next_line())
        .await
        .map_err(|_| AppError::msg("Trainer host handshake timed out"))?
        .map_err(|error| AppError::msg(format!("read trainer host handshake: {error}")))?;
    if hello.as_deref() != Some(&format!("HELLO\t{token}")) {
        return Err(AppError::msg("Trainer host handshake was invalid"));
    }
    drop(child);
    let writer = Arc::new(Mutex::new(writer));
    let id = NEXT_SESSION_ID.fetch_add(1, Ordering::Relaxed);
    stop_session(appid).await;
    SESSIONS.lock().await.insert(
        appid.to_string(),
        WandSession {
            id,
            writer: writer.clone(),
        },
    );

    let app_handle = app.clone();
    let session_appid = appid.to_string();
    tauri::async_runtime::spawn(async move {
        let mut failed = false;
        let mut active = false;
        while let Ok(Some(line)) = lines.next_line().await {
            let mut fields = line.split('\t');
            match fields.next() {
                Some("READY") => {
                    active = true;
                    app_handle
                        .emit(
                            "uc:wand-runtime",
                            json!({ "appid": session_appid, "status": "active" }),
                        )
                        .ok();
                }
                Some("VALUE") => {
                    if let (Some(name), Some(value)) = (fields.next(), fields.next()) {
                        if let Ok(value) = value.parse::<f64>() {
                            app_handle
                                .emit(
                                    "uc:wand-runtime",
                                    json!({
                                        "appid": session_appid,
                                        "status": "value",
                                        "name": decode_host_text(name),
                                        "value": value,
                                    }),
                                )
                                .ok();
                        }
                    }
                }
                Some("ERROR") => {
                    let message = decode_host_text(fields.next().unwrap_or_default());
                    failed = true;
                    active = false;
                    app_handle
                        .emit(
                            "uc:wand-runtime",
                            json!({
                                "appid": session_appid,
                                "status": "error",
                                "message": message,
                            }),
                        )
                        .ok();
                }
                _ => {}
            }
        }
        if !failed && !active {
            failed = true;
            app_handle
                .emit(
                    "uc:wand-runtime",
                    json!({
                        "appid": session_appid,
                        "status": "error",
                        "message": "Trainer host disconnected before becoming ready",
                    }),
                )
                .ok();
        }
        let mut sessions = SESSIONS.lock().await;
        if sessions
            .get(&session_appid)
            .is_some_and(|session| session.id == id)
        {
            sessions.remove(&session_appid);
        }
        drop(sessions);
        if !failed {
            app_handle
                .emit(
                    "uc:wand-runtime",
                    json!({ "appid": session_appid, "status": "stopped" }),
                )
                .ok();
        }
    });

    Ok(())
}

#[tauri::command]
pub async fn wand_control(appid: String, name: String, value: f64) -> Result<Value> {
    if name.is_empty() || name.len() > 31 || !value.is_finite() {
        return Err(AppError::msg("Invalid Wand trainer value"));
    }
    let writer = SESSIONS
        .lock()
        .await
        .get(&appid)
        .map(|session| session.writer.clone())
        .ok_or_else(|| AppError::msg("Wand trainer is not running"))?;
    let command = format!("SET\t{}\t{value}\n", hex::encode(name));
    writer
        .lock()
        .await
        .write_all(command.as_bytes())
        .await
        .map_err(|error| AppError::msg(format!("send Wand trainer value: {error}")))?;
    Ok(json!({ "ok": true }))
}

#[tauri::command]
pub async fn wand_stop(appid: String) -> Value {
    stop_session(&appid).await;
    json!({ "ok": true })
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
    let Some(auth) = current_auth(&state).await? else {
        return Ok(json!({
            "ok": false,
            "needsAuth": true,
            "game": matched,
            "error": "Connect a Wand account before starting this trainer"
        }));
    };
    let game_executable = state
        .settings
        .get_string(&format!("gameExe:{appid}"))
        .filter(|path| Path::new(path).is_file())
        .ok_or_else(|| {
            AppError::msg("Launch this game once or set its executable before starting Wand")
        })?;
    let response = fetch_trainer(&matched, &auth).await?;
    let loader = parse_loader(&response)?;
    let trainer = download_trainer(&state.paths.data_dir, &loader).await?;
    let arch = trainer_arch(&trainer).await?;
    let version = game_version(Path::new(&game_executable)).await?;
    let runtime = ensure_runtime(&state.paths.data_dir).await?;
    let trainerlib = runtime.join(format!("TrainerLib_{arch}.dll"));
    if !trainerlib.is_file() {
        return Err(AppError::msg(format!("TrainerLib_{arch}.dll is missing")));
    }
    start_host(
        &app,
        &state,
        &appid,
        &game_executable,
        &trainer,
        &trainerlib,
        &loader,
        arch,
        version,
    )
    .await?;
    Ok(json!({
        "ok": true,
        "game": matched,
        "runtime": if cfg!(target_os = "linux") { "proton" } else { "native" },
    }))
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
    fn oauth_uses_the_official_callback_and_installation_context() {
        let url = oauth_url("challenge", "state", "installation").unwrap();
        let query: HashMap<_, _> = url.query_pairs().into_owned().collect();
        assert_eq!(
            query.get("redirect_uri").map(String::as_str),
            Some("wemod://oauth")
        );
        assert_eq!(
            query.get("installation_id").map(String::as_str),
            Some("installation")
        );
    }

    #[tokio::test]
    #[ignore]
    async fn token_exchange_is_accepted_as_a_desktop_client() {
        let error = request_access_token(&[
            ("grant_type", "authorization_code".to_string()),
            ("code", "invalid".to_string()),
            ("redirect_uri", OAUTH_REDIRECT.to_string()),
            ("code_verifier", "invalid".to_string()),
        ])
        .await
        .unwrap_err();
        assert!(error
            .to_string()
            .contains("Cannot decrypt the authorization code"));
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

    #[test]
    fn trainer_blueprint_becomes_in_app_controls() {
        let response = json!({
            "trainer": {
                "blueprint": {
                    "cheats": [{
                        "uuid": "health",
                        "target": "health",
                        "name": "Unlimited Health",
                        "category": "Player",
                        "type": "toggle",
                        "hotkeys": [[17, 112], [0]]
                    }]
                }
            }
        });
        assert_eq!(
            parse_controls(&response),
            vec![WandControl {
                uuid: "health".into(),
                target: "health".into(),
                name: "Unlimited Health".into(),
                category: "Player".into(),
                kind: "toggle".into(),
            }]
        );
    }

    #[test]
    fn trainer_loader_uses_targets_and_verified_binary_metadata() {
        let response = json!({
            "trainer": {
                "loader": "trainerlib",
                "loaderArgs": {
                    "trainerId": "fixture",
                    "binaryUrl": "https://example.test/trainer.dll",
                    "binaryHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
                },
                "blueprint": {
                    "config": {
                        "activate": { "flags": 16 }
                    },
                    "cheats": [
                        { "target": "health" },
                        { "target": "health" },
                        { "target": "coins" }
                    ]
                },
                "gameEvents": [{ "key": "player-died" }]
            }
        });
        let loader = parse_loader(&response).unwrap();
        assert_eq!(
            loader.variables,
            vec!["health", "coins", "wm_event_player-died"]
        );
        assert_eq!(loader.flags, 16);
    }

    #[tokio::test]
    async fn game_version_is_the_pe_timestamp_wand_expects() {
        let temp = tempfile::tempdir().unwrap();
        let executable = temp.path().join("game.exe");
        let mut bytes = vec![0u8; 0x8c];
        bytes[0x3c..0x40].copy_from_slice(&0x80u32.to_le_bytes());
        bytes[0x80..0x84].copy_from_slice(b"PE\0\0");
        bytes[0x88..0x8c].copy_from_slice(&1_774_983_219u32.to_le_bytes());
        std::fs::write(&executable, bytes).unwrap();

        assert_eq!(game_version(&executable).await.unwrap(), 1_774_983_219);
    }

    #[test]
    fn trainer_host_resolves_from_packaged_resources_directory() {
        let root = tempfile::tempdir().unwrap();
        let resources = root.path().join("resources");
        std::fs::create_dir(&resources).unwrap();
        let expected = resources.join("trainer-host-x64.exe");
        std::fs::write(&expected, "host").unwrap();

        assert_eq!(
            resolve_trainer_host(
                Some(root.path().to_path_buf()),
                root.path().join("missing/trainer-host-x64.exe"),
            ),
            Some(expected)
        );
    }
}
