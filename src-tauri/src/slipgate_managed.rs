use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock};
use std::time::Duration;

use rand::RngCore;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, State};
use tokio::process::Command;

use crate::paths::AppPaths;
use crate::settings::SettingsStore;
use crate::state::AppState;

const PROJECT: &str = "union-manifold-slipgate";
// Slipgate is built locally from the pinned commit below, so its tag names
// a local build target rather than a registry pull; supply-chain trust
// comes from SLIPGATE_BUILD_CONTEXT, not a digest.
const SLIPGATE_IMAGE: &str = "union-manifold/slipgate:0.5.1";
const SLIPGATE_BUILD_CONTEXT: &str =
    "https://github.com/fyiel/Slipgate.git#b5eb9da6f1e45b6f2858699ad418980d416510b9";
// Pinned by digest so a republished tag cannot silently change what runs
// with the user's API key. Bump deliberately when upgrading FlareSolverr
// (source tag v3.5.0).
const FLARESOLVERR_IMAGE: &str =
    "ghcr.io/flaresolverr/flaresolverr@sha256:139dfee1c6f89249c8d665d1333a42e8ec74ec0a86bc6bb1c8461e10d3a66a47";
const COMMAND_TIMEOUT: Duration = Duration::from_secs(600);
const STATUS_TIMEOUT: Duration = Duration::from_secs(15);

static OPERATION: LazyLock<tokio::sync::Mutex<()>> = LazyLock::new(|| tokio::sync::Mutex::new(()));

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ManagedConfig {
    key: String,
    #[serde(default)]
    port: u16,
    slipgate_image: String,
    flaresolverr_image: String,
}

impl ManagedConfig {
    fn new() -> Self {
        let mut bytes = [0u8; 32];
        rand::thread_rng().fill_bytes(&mut bytes);
        Self {
            key: hex::encode(bytes),
            port: 0,
            slipgate_image: SLIPGATE_IMAGE.to_string(),
            flaresolverr_image: FLARESOLVERR_IMAGE.to_string(),
        }
    }

    fn url(&self) -> Option<String> {
        (self.port > 0).then(|| format!("http://127.0.0.1:{}", self.port))
    }
}

struct DockerInfo {
    available: bool,
    compose_available: bool,
    docker_version: String,
    compose_version: String,
    error: Option<String>,
}

fn managed_dir(paths: &AppPaths) -> PathBuf {
    paths.data_dir.join("slipgate")
}

fn compose_path(paths: &AppPaths) -> PathBuf {
    managed_dir(paths).join("compose.yml")
}

fn config_path(paths: &AppPaths) -> PathBuf {
    managed_dir(paths).join("managed.json")
}

fn compose_text(config: &ManagedConfig) -> String {
    format!(
        "services:\n  flaresolverr:\n    image: {}\n    restart: unless-stopped\n    environment:\n      LOG_LEVEL: info\n  slipgate:\n    build:\n      context: {}\n    image: {}\n    restart: unless-stopped\n    depends_on:\n      - flaresolverr\n    ports:\n      - \"127.0.0.1::8189\"\n    environment:\n      SLIPGATE_FLARESOLVERR_URL: http://flaresolverr:8191/v1\n      SLIPGATE_LOG_LEVEL: info\n      SLIPGATE_API_KEY: {}\n",
        config.flaresolverr_image, SLIPGATE_BUILD_CONTEXT, config.slipgate_image, config.key
    )
}

fn write_private(path: &Path, contents: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("create resolver directory: {e}"))?;
    }
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, contents).map_err(|e| format!("write {}: {e}", path.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600))
            .map_err(|e| format!("secure {}: {e}", path.display()))?;
    }
    #[cfg(windows)]
    if path.is_file() {
        std::fs::remove_file(path).map_err(|e| format!("replace {}: {e}", path.display()))?;
    }
    std::fs::rename(&tmp, path).map_err(|e| format!("replace {}: {e}", path.display()))
}

fn save_config(paths: &AppPaths, config: &ManagedConfig) -> Result<(), String> {
    let text =
        serde_json::to_string_pretty(config).map_err(|e| format!("encode resolver config: {e}"))?;
    write_private(&config_path(paths), &text)
}

fn load_config(paths: &AppPaths) -> Option<ManagedConfig> {
    let text = std::fs::read_to_string(config_path(paths)).ok()?;
    serde_json::from_str(&text).ok()
}

async fn run_docker(args: &[String], timeout: Duration) -> Result<String, String> {
    let mut command = Command::new("docker");
    command.args(args).kill_on_drop(true);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let output = tokio::time::timeout(timeout, command.output())
        .await
        .map_err(|_| "Docker command timed out".to_string())?
        .map_err(|e| format!("Docker is unavailable: {e}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if output.status.success() {
        return Ok(stdout);
    }
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let detail = if stderr.is_empty() { stdout } else { stderr };
    Err(if detail.is_empty() {
        format!("Docker exited with {}", output.status)
    } else {
        detail
    })
}

fn compose_args(paths: &AppPaths, tail: &[&str]) -> Vec<String> {
    let mut args = vec![
        "compose".to_string(),
        "--project-name".to_string(),
        PROJECT.to_string(),
        "--file".to_string(),
        compose_path(paths).to_string_lossy().to_string(),
    ];
    args.extend(tail.iter().map(|arg| (*arg).to_string()));
    args
}

async fn docker_info() -> DockerInfo {
    let docker = run_docker(
        &[
            "version".to_string(),
            "--format".to_string(),
            "{{.Server.Version}}".to_string(),
        ],
        STATUS_TIMEOUT,
    )
    .await;
    let docker_version = match docker {
        Ok(version) => version,
        Err(error) => {
            return DockerInfo {
                available: false,
                compose_available: false,
                docker_version: String::new(),
                compose_version: String::new(),
                error: Some(error),
            };
        }
    };
    match run_docker(
        &[
            "compose".to_string(),
            "version".to_string(),
            "--short".to_string(),
        ],
        STATUS_TIMEOUT,
    )
    .await
    {
        Ok(compose_version) => DockerInfo {
            available: true,
            compose_available: true,
            docker_version,
            compose_version,
            error: None,
        },
        Err(error) => DockerInfo {
            available: true,
            compose_available: false,
            docker_version,
            compose_version: String::new(),
            error: Some(error),
        },
    }
}

fn sync_settings(app: &AppHandle, settings: &SettingsStore, config: &ManagedConfig) {
    let Some(url) = config.url() else { return };
    settings.set("slipgateUrl", Value::String(url.clone()));
    settings.set("slipgateKey", Value::String(config.key.clone()));
    app.emit(
        "uc:setting-changed",
        json!({ "key": "slipgateUrl", "value": url }),
    )
    .ok();
    app.emit(
        "uc:setting-changed",
        json!({ "key": "slipgateKey", "value": config.key }),
    )
    .ok();
}

fn clear_settings(app: &AppHandle, settings: &SettingsStore, config: &ManagedConfig) {
    if config.url().as_deref() != settings.get_string("slipgateUrl").as_deref() {
        return;
    }
    settings.set("slipgateUrl", Value::Null);
    settings.set("slipgateKey", Value::Null);
    app.emit(
        "uc:setting-changed",
        json!({ "key": "slipgateUrl", "value": null }),
    )
    .ok();
    app.emit(
        "uc:setting-changed",
        json!({ "key": "slipgateKey", "value": null }),
    )
    .ok();
}

async fn refresh_port(paths: &AppPaths, config: &mut ManagedConfig) -> Result<(), String> {
    let output = run_docker(
        &compose_args(paths, &["port", "slipgate", "8189"]),
        STATUS_TIMEOUT,
    )
    .await?;
    let port = output
        .lines()
        .find_map(|line| line.trim().rsplit(':').next()?.parse::<u16>().ok())
        .ok_or_else(|| "Docker did not publish the Slipgate port".to_string())?;
    config.port = port;
    save_config(paths, config)
}

async fn wait_for_health(config: &ManagedConfig) -> Result<Value, String> {
    let base = config
        .url()
        .ok_or_else(|| "Slipgate port is unavailable".to_string())?;
    let mut last_error = "Slipgate did not become ready".to_string();
    for _ in 0..30 {
        match crate::slipgate::health(&base, &config.key).await {
            Ok(status)
                if status
                    .get("flaresolverrOk")
                    .and_then(Value::as_bool)
                    .unwrap_or(false) =>
            {
                return Ok(status)
            }
            Ok(_) => last_error = "Slipgate started but FlareSolverr is not ready".to_string(),
            Err(error) => last_error = error,
        }
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
    Err(last_error)
}

async fn up(
    app: &AppHandle,
    paths: &AppPaths,
    settings: &SettingsStore,
    pull: bool,
) -> Result<Value, String> {
    crate::sources::adapters::onlinefix::invalidate();
    app.emit("uc:sources-updated", json!({})).ok();
    let mut config =
        load_config(paths).ok_or_else(|| "Managed Slipgate is not installed".to_string())?;
    if pull {
        run_docker(
            &compose_args(paths, &["pull", "--ignore-buildable"]),
            COMMAND_TIMEOUT,
        )
        .await?;
    }
    run_docker(
        &compose_args(paths, &["up", "--detach", "--remove-orphans", "--build"]),
        COMMAND_TIMEOUT,
    )
    .await?;
    refresh_port(paths, &mut config).await?;
    sync_settings(app, settings, &config);
    let status = wait_for_health(&config).await?;
    crate::sources::adapters::onlinefix::refresh().await;
    app.emit("uc:sources-updated", json!({})).ok();
    Ok(status)
}

async fn status_value(paths: &AppPaths) -> Value {
    let info = docker_info().await;
    let config = load_config(paths);
    let installed = config.is_some() && compose_path(paths).is_file();
    let mut running = false;
    let mut healthy = false;
    let mut version = String::new();
    let mut flaresolverr_ok = false;
    let mut recipes = json!([]);
    let mut error = info.error.clone();
    let url = config.as_ref().and_then(ManagedConfig::url);
    if let (Some(config), Some(base)) = (&config, &url) {
        if let Ok(value) = crate::slipgate::health(base, &config.key).await {
            running = true;
            healthy = value.get("ok").and_then(Value::as_bool).unwrap_or(false);
            version = value
                .get("version")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            flaresolverr_ok = value
                .get("flaresolverrOk")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            recipes = value.get("recipes").cloned().unwrap_or_else(|| json!([]));
            error = None;
        }
    }
    json!({
        "ok": true,
        "dockerAvailable": info.available,
        "composeAvailable": info.compose_available,
        "dockerVersion": info.docker_version,
        "composeVersion": info.compose_version,
        "installed": installed,
        "running": running,
        "healthy": healthy,
        "url": url,
        "version": version,
        "flaresolverrOk": flaresolverr_ok,
        "recipes": recipes,
        "slipgateImage": config.as_ref().map(|c| c.slipgate_image.as_str()).unwrap_or(SLIPGATE_IMAGE),
        "flaresolverrImage": config.as_ref().map(|c| c.flaresolverr_image.as_str()).unwrap_or(FLARESOLVERR_IMAGE),
        "error": error,
    })
}

#[tauri::command]
pub async fn managed_slipgate_status(state: State<'_, AppState>) -> Result<Value, String> {
    Ok(status_value(&state.paths).await)
}

#[tauri::command]
pub async fn managed_slipgate_install(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let _guard = OPERATION.lock().await;
    let info = docker_info().await;
    if !info.available {
        return Err(info
            .error
            .unwrap_or_else(|| "Docker is unavailable".to_string()));
    }
    if !info.compose_available {
        return Err(info
            .error
            .unwrap_or_else(|| "Docker Compose is unavailable".to_string()));
    }
    let mut config = load_config(&state.paths).unwrap_or_else(ManagedConfig::new);
    config.slipgate_image = SLIPGATE_IMAGE.to_string();
    config.flaresolverr_image = FLARESOLVERR_IMAGE.to_string();
    write_private(&compose_path(&state.paths), &compose_text(&config))?;
    save_config(&state.paths, &config)?;
    up(&app, &state.paths, &state.settings, true).await?;
    Ok(status_value(&state.paths).await)
}

#[tauri::command]
pub async fn managed_slipgate_start(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let _guard = OPERATION.lock().await;
    up(&app, &state.paths, &state.settings, false).await?;
    Ok(status_value(&state.paths).await)
}

#[tauri::command]
pub async fn managed_slipgate_stop(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let _guard = OPERATION.lock().await;
    let config =
        load_config(&state.paths).ok_or_else(|| "Managed Slipgate is not installed".to_string())?;
    run_docker(&compose_args(&state.paths, &["stop"]), COMMAND_TIMEOUT).await?;
    clear_settings(&app, &state.settings, &config);
    crate::sources::adapters::onlinefix::invalidate();
    app.emit("uc:sources-updated", json!({})).ok();
    Ok(status_value(&state.paths).await)
}

#[tauri::command]
pub async fn managed_slipgate_update(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let _guard = OPERATION.lock().await;
    let mut config =
        load_config(&state.paths).ok_or_else(|| "Managed Slipgate is not installed".to_string())?;
    config.slipgate_image = SLIPGATE_IMAGE.to_string();
    config.flaresolverr_image = FLARESOLVERR_IMAGE.to_string();
    write_private(&compose_path(&state.paths), &compose_text(&config))?;
    save_config(&state.paths, &config)?;
    up(&app, &state.paths, &state.settings, true).await?;
    Ok(status_value(&state.paths).await)
}

#[tauri::command]
pub async fn managed_slipgate_uninstall(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let _guard = OPERATION.lock().await;
    let config =
        load_config(&state.paths).ok_or_else(|| "Managed Slipgate is not installed".to_string())?;
    if compose_path(&state.paths).is_file() {
        run_docker(
            &compose_args(&state.paths, &["down", "--remove-orphans", "--volumes"]),
            COMMAND_TIMEOUT,
        )
        .await?;
    }
    clear_settings(&app, &state.settings, &config);
    crate::sources::adapters::onlinefix::invalidate();
    app.emit("uc:sources-updated", json!({})).ok();
    std::fs::remove_dir_all(managed_dir(&state.paths))
        .map_err(|e| format!("remove managed resolver: {e}"))?;
    Ok(status_value(&state.paths).await)
}

pub async fn autostart(app: AppHandle, paths: Arc<AppPaths>, settings: Arc<SettingsStore>) {
    tokio::time::sleep(Duration::from_secs(5)).await;
    let Some(config) = load_config(&paths) else {
        return;
    };
    if config.url().as_deref() != settings.get_string("slipgateUrl").as_deref() {
        return;
    }
    let _guard = OPERATION.lock().await;
    if let Err(error) = up(&app, &paths, &settings, false).await {
        crate::logging::write_line("warn", &format!("managed Slipgate start failed: {error}"));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compose_is_loopback_only_and_pinned() {
        let config = ManagedConfig {
            key: "abc123".to_string(),
            port: 0,
            slipgate_image: SLIPGATE_IMAGE.to_string(),
            flaresolverr_image: FLARESOLVERR_IMAGE.to_string(),
        };
        let text = compose_text(&config);
        assert!(text.contains("127.0.0.1::8189"));
        assert!(text.contains(SLIPGATE_IMAGE));
        assert!(text.contains(FLARESOLVERR_IMAGE));
        assert!(text.contains(SLIPGATE_BUILD_CONTEXT));
        assert!(!text.contains("platform: linux/amd64"));
        assert!(!text.contains("ghcr.io/fyiel/slipgate"));
        assert!(text.contains("SLIPGATE_API_KEY: abc123"));
        assert!(!text.contains(":latest"));
    }

    #[test]
    fn managed_url_requires_a_published_port() {
        let mut config = ManagedConfig::new();
        assert_eq!(config.url(), None);
        config.port = 38189;
        assert_eq!(config.url().as_deref(), Some("http://127.0.0.1:38189"));
    }
}
