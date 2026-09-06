use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock};
use std::time::Duration;

use futures::StreamExt;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};

use crate::paths::AppPaths;
use crate::settings::SettingsStore;
use crate::state::AppState;

const MANIFEST_URL: &str =
    "https://github.com/fyiel/Union.Manifold/releases/latest/download/resolver-runtime.json";
const RELEASE_PUBLIC_KEY: &str = "RWRgRGdVWEiVisxXTe7o3Dj/os4YlpkNqFReNJ5AM0c0KG6ViwSdYFfD";
const INSTALL_TIMEOUT: Duration = Duration::from_secs(15 * 60);
const STATUS_TIMEOUT: Duration = Duration::from_secs(15);
const ENABLED_SETTING: &str = "builtInSlipgateEnabled";

static OPERATION: LazyLock<tokio::sync::Mutex<()>> = LazyLock::new(|| tokio::sync::Mutex::new(()));
static PROCESSES: LazyLock<tokio::sync::Mutex<Option<RuntimeProcesses>>> =
    LazyLock::new(|| tokio::sync::Mutex::new(None));
static SUPERVISOR_STARTED: AtomicBool = AtomicBool::new(false);
static ACTIVE_PIDS: LazyLock<parking_lot::Mutex<Vec<u32>>> =
    LazyLock::new(|| parking_lot::Mutex::new(Vec::new()));
static LAST_BACKGROUND_ERROR: LazyLock<parking_lot::RwLock<Option<String>>> =
    LazyLock::new(|| parking_lot::RwLock::new(None));

struct RuntimeProcesses {
    slipgate: Child,
    slipgate_pid: u32,
    flaresolverr: Child,
    flaresolverr_pid: u32,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ManagedConfig {
    key: String,
    #[serde(default = "enabled_by_default")]
    enabled: bool,
    #[serde(default)]
    runtime_version: String,
    #[serde(default)]
    slipgate_port: u16,
    #[serde(default)]
    flaresolverr_port: u16,
}

fn enabled_by_default() -> bool {
    true
}

impl ManagedConfig {
    fn new(runtime_version: String) -> Self {
        Self {
            key: random_key(),
            enabled: true,
            runtime_version,
            slipgate_port: 0,
            flaresolverr_port: 0,
        }
    }

    fn url(&self) -> Option<String> {
        (self.slipgate_port > 0).then(|| format!("http://127.0.0.1:{}", self.slipgate_port))
    }
}

fn random_key() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    hex::encode(bytes)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeManifest {
    version: String,
    slipgate_version: String,
    flaresolverr_version: String,
    platforms: HashMap<String, RuntimeArtifact>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeArtifact {
    url: String,
    sha256: String,
    size: u64,
}

fn platform_key() -> Option<&'static str> {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("linux", "x86_64") => Some("linux-x86_64"),
        ("windows", "x86_64") => Some("windows-x86_64"),
        _ => None,
    }
}

fn managed_dir(paths: &AppPaths) -> PathBuf {
    paths.data_dir.join("slipgate")
}

fn config_path(paths: &AppPaths) -> PathBuf {
    managed_dir(paths).join("managed.json")
}

fn runtime_dir(paths: &AppPaths, version: &str) -> PathBuf {
    managed_dir(paths).join("runtime").join(version)
}

fn safe_version(version: &str) -> bool {
    !version.is_empty()
        && version.len() <= 80
        && version
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'_'))
}

fn slipgate_executable(root: &Path) -> PathBuf {
    root.join("slipgate").join(if cfg!(windows) {
        "slipgate.exe"
    } else {
        "slipgate"
    })
}

fn flaresolverr_executable(root: &Path) -> PathBuf {
    root.join("flaresolverr").join(if cfg!(windows) {
        "flaresolverr.exe"
    } else {
        "flaresolverr"
    })
}

fn write_private(path: &Path, contents: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("create resolver directory: {e}"))?;
    }
    let tmp = crate::downloads::unique_tmp_path(path);
    std::fs::write(&tmp, contents).map_err(|e| format!("write {}: {e}", path.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600))
            .map_err(|e| format!("secure {}: {e}", path.display()))?;
    }
    #[cfg(unix)]
    return std::fs::rename(&tmp, path).map_err(|e| format!("replace {}: {e}", path.display()));
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::{
            MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
        };
        let source = tmp
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect::<Vec<_>>();
        let destination = path
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect::<Vec<_>>();
        let moved = unsafe {
            MoveFileExW(
                source.as_ptr(),
                destination.as_ptr(),
                MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
            )
        };
        if moved == 0 {
            return Err(format!(
                "replace {}: {}",
                path.display(),
                std::io::Error::last_os_error()
            ));
        }
        Ok(())
    }
}

fn save_config(paths: &AppPaths, config: &ManagedConfig) -> Result<(), String> {
    let text =
        serde_json::to_string_pretty(config).map_err(|e| format!("encode resolver config: {e}"))?;
    write_private(&config_path(paths), &text)
}

fn load_config(paths: &AppPaths) -> Option<ManagedConfig> {
    let text = std::fs::read_to_string(config_path(paths)).ok()?;
    serde_json::from_str(&text)
        .ok()
        .filter(|config: &ManagedConfig| {
            config.runtime_version.is_empty() || safe_version(&config.runtime_version)
        })
}

fn legacy_managed_url(paths: &AppPaths) -> Option<String> {
    if !managed_dir(paths).join("compose.yml").is_file() {
        return None;
    }
    let text = std::fs::read_to_string(config_path(paths)).ok()?;
    let config = serde_json::from_str::<Value>(&text).ok()?;
    let port = config.get("port").and_then(Value::as_u64)?;
    Some(format!("http://127.0.0.1:{port}"))
}

async fn finish_legacy_migration(
    app: &AppHandle,
    paths: &AppPaths,
    settings: &SettingsStore,
    legacy_url: &str,
) {
    if settings.get_string("slipgateUrl").as_deref() == Some(legacy_url) {
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
    let compose = managed_dir(paths).join("compose.yml");
    let mut command = Command::new("docker");
    command
        .args([
            "compose",
            "--project-name",
            "union-manifold-slipgate",
            "--file",
        ])
        .arg(&compose)
        .args(["down", "--remove-orphans"]);
    #[cfg(windows)]
    command.creation_flags(windows_sys::Win32::System::Threading::CREATE_NO_WINDOW);
    let result = tokio::time::timeout(Duration::from_secs(60), command.status()).await;
    if matches!(result, Ok(Ok(status)) if status.success()) {
        let _ = tokio::fs::remove_file(compose).await;
    } else {
        crate::logging::write_line(
            "warn",
            "built-in resolver started, but the legacy Docker resolver could not be stopped",
        );
    }
}

fn validate_manifest(manifest: &RuntimeManifest) -> Result<&RuntimeArtifact, String> {
    if !safe_version(&manifest.version)
        || manifest.slipgate_version.trim().is_empty()
        || manifest.flaresolverr_version.trim().is_empty()
    {
        return Err("Resolver runtime manifest has no version".to_string());
    }
    let key = platform_key().ok_or_else(|| {
        "The built-in resolver currently supports Windows and Linux x64".to_string()
    })?;
    let artifact = manifest
        .platforms
        .get(key)
        .ok_or_else(|| format!("Resolver runtime has no {key} package"))?;
    let url = url::Url::parse(&artifact.url)
        .map_err(|_| "Resolver runtime URL is invalid".to_string())?;
    if url.scheme() != "https"
        || url.host_str() != Some("github.com")
        || !url
            .path()
            .starts_with("/fyiel/Union.Manifold/releases/download/")
        || !artifact.url.ends_with(".zip")
    {
        return Err("Resolver runtime URL is not an approved release asset".to_string());
    }
    if artifact.sha256.len() != 64
        || !artifact.sha256.bytes().all(|b| b.is_ascii_hexdigit())
        || artifact.size == 0
    {
        return Err("Resolver runtime integrity metadata is invalid".to_string());
    }
    Ok(artifact)
}

async fn fetch_manifest() -> Result<RuntimeManifest, String> {
    async fn fetch_file(url: &str, label: &str, limit: usize) -> Result<Vec<u8>, String> {
        let response = crate::http::fetch(
            url,
            &crate::http::FetchOpts {
                retries: Some(1),
                timeout: Some(Duration::from_secs(30)),
                ..Default::default()
            },
        )
        .await
        .map_err(|e| format!("download resolver {label}: {e}"))?
        .error_for_status()
        .map_err(|e| format!("download resolver {label}: {e}"))?;
        let bytes = response
            .bytes()
            .await
            .map_err(|e| format!("read resolver {label}: {e}"))?;
        if bytes.len() > limit {
            return Err(format!("Resolver {label} is unexpectedly large"));
        }
        Ok(bytes.to_vec())
    }

    let signature_url = format!("{MANIFEST_URL}.sig");
    let (manifest, signature) = tokio::join!(
        fetch_file(MANIFEST_URL, "manifest", 64 * 1024),
        fetch_file(&signature_url, "manifest signature", 16 * 1024),
    );
    let manifest = manifest?;
    let signature = String::from_utf8(signature?)
        .map_err(|_| "Resolver manifest signature is not text".to_string())?;
    let public_key = minisign_verify::PublicKey::from_base64(RELEASE_PUBLIC_KEY)
        .map_err(|e| format!("load resolver signing key: {e}"))?;
    let signature = minisign_verify::Signature::decode(&signature)
        .map_err(|e| format!("decode resolver manifest signature: {e}"))?;
    public_key
        .verify(&manifest, &signature, false)
        .map_err(|e| format!("verify resolver manifest signature: {e}"))?;
    serde_json::from_slice(&manifest).map_err(|e| format!("decode resolver manifest: {e}"))
}

async fn download_verified(artifact: &RuntimeArtifact, destination: &Path) -> Result<(), String> {
    let response = crate::http::fetch(
        &artifact.url,
        &crate::http::FetchOpts {
            retries: Some(0),
            timeout: Some(INSTALL_TIMEOUT),
            ..Default::default()
        },
    )
    .await
    .map_err(|e| format!("download resolver runtime: {e}"))?
    .error_for_status()
    .map_err(|e| format!("download resolver runtime: {e}"))?;
    let mut stream = response.bytes_stream();
    let mut file = tokio::fs::File::create(destination)
        .await
        .map_err(|e| format!("create resolver download: {e}"))?;
    let mut received = 0u64;
    let mut hasher = Sha256::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("read resolver download: {e}"))?;
        received += chunk.len() as u64;
        if received > artifact.size {
            drop(file);
            let _ = tokio::fs::remove_file(destination).await;
            return Err("Downloaded resolver runtime exceeds its signed size".to_string());
        }
        hasher.update(&chunk);
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("write resolver download: {e}"))?;
    }
    file.flush()
        .await
        .map_err(|e| format!("flush resolver download: {e}"))?;
    drop(file);
    let actual = hex::encode(hasher.finalize());
    if received != artifact.size || !actual.eq_ignore_ascii_case(&artifact.sha256) {
        let _ = tokio::fs::remove_file(destination).await;
        return Err("Downloaded resolver runtime failed integrity verification".to_string());
    }
    Ok(())
}

#[cfg(unix)]
fn make_executable(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    let mut permissions = std::fs::metadata(path)
        .map_err(|e| format!("inspect {}: {e}", path.display()))?
        .permissions();
    permissions.set_mode(0o700);
    std::fs::set_permissions(path, permissions)
        .map_err(|e| format!("make {} executable: {e}", path.display()))
}

#[cfg(windows)]
fn make_executable(_path: &Path) -> Result<(), String> {
    Ok(())
}

async fn install_runtime(paths: &AppPaths, manifest: &RuntimeManifest) -> Result<(), String> {
    let artifact = validate_manifest(manifest)?;
    let final_dir = runtime_dir(paths, &manifest.version);
    if slipgate_executable(&final_dir).is_file() && flaresolverr_executable(&final_dir).is_file() {
        return Ok(());
    }
    tokio::fs::create_dir_all(managed_dir(paths))
        .await
        .map_err(|e| format!("create resolver directory: {e}"))?;
    let archive = crate::downloads::unique_tmp_path(&managed_dir(paths).join("runtime.zip"));
    let staging = crate::downloads::unique_tmp_path(&managed_dir(paths).join("runtime-staging"));
    let result = async {
        download_verified(artifact, &archive).await?;
        tokio::fs::create_dir_all(&staging)
            .await
            .map_err(|e| format!("create resolver staging directory: {e}"))?;
        crate::install::run_7z(&archive, &staging, |_| {})
            .await
            .map_err(|e| format!("extract resolver runtime: {e}"))?;
        let slipgate = slipgate_executable(&staging);
        let flaresolverr = flaresolverr_executable(&staging);
        if !slipgate.is_file() || !flaresolverr.is_file() {
            return Err("Resolver package is missing an executable".to_string());
        }
        make_executable(&slipgate)?;
        make_executable(&flaresolverr)?;
        if let Some(parent) = final_dir.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| format!("create resolver runtime directory: {e}"))?;
        }
        if final_dir.exists() {
            tokio::fs::remove_dir_all(&final_dir)
                .await
                .map_err(|e| format!("replace resolver runtime: {e}"))?;
        }
        tokio::fs::rename(&staging, &final_dir)
            .await
            .map_err(|e| format!("install resolver runtime: {e}"))?;
        Ok(())
    }
    .await;
    let _ = tokio::fs::remove_file(&archive).await;
    if result.is_err() {
        let _ = tokio::fs::remove_dir_all(&staging).await;
    }
    result
}

fn reserve_port() -> Result<(u16, std::net::TcpListener), String> {
    let listener = std::net::TcpListener::bind(("127.0.0.1", 0))
        .map_err(|e| format!("reserve resolver port: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("read resolver port: {e}"))?
        .port();
    Ok((port, listener))
}

fn drain_logs(name: &'static str, pipe: impl tokio::io::AsyncRead + Unpin + Send + 'static) {
    tauri::async_runtime::spawn(async move {
        let mut lines = BufReader::new(pipe).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            crate::logging::write_line("info", &format!("{name}: {line}"));
        }
    });
}

fn spawn_service(
    executable: &Path,
    current_dir: &Path,
    env: &[(&str, String)],
    name: &'static str,
) -> Result<Child, String> {
    let mut command = Command::new(executable);
    command
        .current_dir(current_dir)
        .envs(env.iter().cloned())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.as_std_mut().process_group(0);
    }
    #[cfg(windows)]
    command.creation_flags(windows_sys::Win32::System::Threading::CREATE_NO_WINDOW);
    let mut child = command.spawn().map_err(|e| format!("start {name}: {e}"))?;
    if let Some(pid) = child.id() {
        ACTIVE_PIDS.lock().push(pid);
    }
    if let Some(stdout) = child.stdout.take() {
        drain_logs(name, stdout);
    }
    if let Some(stderr) = child.stderr.take() {
        drain_logs(name, stderr);
    }
    Ok(child)
}

async fn stop_processes() {
    crate::slipgate::set_managed(None);
    let processes = { PROCESSES.lock().await.take() };
    if let Some(processes) = processes {
        terminate_processes(processes).await;
    }
}

async fn terminate_processes(mut processes: RuntimeProcesses) {
    terminate_process_tree(&mut processes.slipgate, processes.slipgate_pid).await;
    terminate_process_tree(&mut processes.flaresolverr, processes.flaresolverr_pid).await;
    let _ = tokio::time::timeout(Duration::from_secs(5), async {
        let _ = tokio::join!(processes.slipgate.wait(), processes.flaresolverr.wait());
    })
    .await;
}

async fn terminate_process_tree(child: &mut Child, pid: u32) {
    if matches!(child.try_wait(), Ok(Some(_))) {
        ACTIVE_PIDS.lock().retain(|active| *active != pid);
        return;
    }
    #[cfg(unix)]
    let terminated = tokio::time::timeout(
        Duration::from_secs(5),
        Command::new("kill")
            .args(["-KILL", "--", &format!("-{pid}")])
            .status(),
    )
    .await
    .ok()
    .and_then(Result::ok)
    .map(|status| status.success())
    .unwrap_or(false);
    #[cfg(windows)]
    let terminated = {
        let mut command = Command::new("taskkill");
        command
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .creation_flags(windows_sys::Win32::System::Threading::CREATE_NO_WINDOW);
        tokio::time::timeout(Duration::from_secs(5), command.status())
            .await
            .ok()
            .and_then(Result::ok)
            .map(|status| status.success())
            .unwrap_or(false)
    };
    #[cfg(not(any(unix, windows)))]
    let terminated = false;
    if !terminated {
        let _ = child.start_kill();
    }
    ACTIVE_PIDS.lock().retain(|active| *active != pid);
}

fn terminate_pid_now(pid: u32) {
    #[cfg(unix)]
    {
        std::process::Command::new("kill")
            .args(["-KILL", "--", &format!("-{pid}")])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .ok();
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .creation_flags(windows_sys::Win32::System::Threading::CREATE_NO_WINDOW)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .ok();
    }
}

pub fn shutdown() {
    for pid in ACTIVE_PIDS.lock().clone() {
        terminate_pid_now(pid);
    }
    if let Ok(mut guard) = PROCESSES.try_lock() {
        if let Some(processes) = guard.as_mut() {
            let _ = processes.slipgate.start_kill();
            let _ = processes.flaresolverr.start_kill();
        }
    }
}

async fn wait_for_health(config: &ManagedConfig) -> Result<Value, String> {
    let base = config
        .url()
        .ok_or_else(|| "Slipgate port is unavailable".to_string())?;
    let mut last_error = "Built-in resolver did not become ready".to_string();
    for _ in 0..60 {
        match crate::slipgate::health(&base, &config.key).await {
            Ok(status) if crate::slipgate::fetch_usable(&status) => return Ok(status),
            Ok(_) => last_error = "Slipgate started but FlareSolverr is not ready".to_string(),
            Err(error) => last_error = error,
        }
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
    Err(last_error)
}

async fn cleanup_old_runtimes(paths: &AppPaths, active_version: &str) {
    let root = managed_dir(paths).join("runtime");
    let Ok(mut entries) = tokio::fs::read_dir(&root).await else {
        return;
    };
    while let Ok(Some(entry)) = entries.next_entry().await {
        if entry.file_name().to_string_lossy() == active_version {
            continue;
        }
        if entry
            .file_type()
            .await
            .map(|kind| kind.is_dir())
            .unwrap_or(false)
        {
            if let Err(error) = tokio::fs::remove_dir_all(entry.path()).await {
                crate::logging::write_line(
                    "warn",
                    &format!("remove old resolver runtime: {error}"),
                );
            }
        }
    }
}

async fn start_runtime(
    _app: &AppHandle,
    paths: &AppPaths,
    settings: &SettingsStore,
    mut config: ManagedConfig,
) -> Result<Value, String> {
    let root = runtime_dir(paths, &config.runtime_version);
    let slipgate_bin = slipgate_executable(&root);
    let flaresolverr_bin = flaresolverr_executable(&root);
    if !slipgate_bin.is_file() || !flaresolverr_bin.is_file() {
        return Err("Built-in resolver is not installed".to_string());
    }
    let previous_config = load_config(paths);
    let (slipgate_port, slipgate_reservation) = reserve_port()?;
    let (flaresolverr_port, flaresolverr_reservation) = reserve_port()?;
    config.slipgate_port = slipgate_port;
    config.flaresolverr_port = flaresolverr_port;
    config.key = random_key();
    config.enabled = true;
    let flaresolverr_dir = flaresolverr_bin.parent().unwrap_or(&root);
    drop(flaresolverr_reservation);
    let mut flaresolverr = spawn_service(
        &flaresolverr_bin,
        flaresolverr_dir,
        &[
            ("HOST", "127.0.0.1".to_string()),
            ("PORT", config.flaresolverr_port.to_string()),
            ("LOG_LEVEL", "info".to_string()),
        ],
        "FlareSolverr",
    )?;
    let flaresolverr_pid = flaresolverr.id().expect("newly spawned child has a pid");
    let slipgate_dir = slipgate_bin.parent().unwrap_or(&root);
    let mut slipgate_env = vec![
        ("SLIPGATE_HOST", "127.0.0.1".to_string()),
        ("SLIPGATE_PORT", config.slipgate_port.to_string()),
        ("SLIPGATE_API_KEY", config.key.clone()),
        (
            "SLIPGATE_FLARESOLVERR_URL",
            format!("http://127.0.0.1:{}/v1", config.flaresolverr_port),
        ),
        ("SLIPGATE_LOG_LEVEL", "info".to_string()),
    ];
    if let Some(proxy) = settings.get_string("proxyUrl") {
        slipgate_env.push(("SLIPGATE_PROXY_URL", proxy));
    }
    drop(slipgate_reservation);
    let slipgate = match spawn_service(&slipgate_bin, slipgate_dir, &slipgate_env, "Slipgate") {
        Ok(child) => child,
        Err(error) => {
            terminate_process_tree(&mut flaresolverr, flaresolverr_pid).await;
            let _ = flaresolverr.wait().await;
            return Err(error);
        }
    };
    let slipgate_pid = slipgate.id().expect("newly spawned child has a pid");
    let candidate = RuntimeProcesses {
        slipgate,
        slipgate_pid,
        flaresolverr,
        flaresolverr_pid,
    };
    if let Err(error) = save_config(paths, &config) {
        terminate_processes(candidate).await;
        return Err(error);
    }
    let health = match tokio::time::timeout(
        STATUS_TIMEOUT + Duration::from_secs(45),
        wait_for_health(&config),
    )
    .await
    {
        Ok(result) => result,
        Err(_) => Err("Built-in resolver startup timed out".to_string()),
    };
    let status = match health {
        Ok(status) => status,
        Err(error) => {
            terminate_processes(candidate).await;
            match previous_config {
                Some(previous) => {
                    if let Err(restore_error) = save_config(paths, &previous) {
                        crate::logging::write_line(
                            "warn",
                            &format!("restore resolver config after failed start: {restore_error}"),
                        );
                    }
                }
                None => {
                    let _ = std::fs::remove_file(config_path(paths));
                }
            }
            return Err(error);
        }
    };
    crate::slipgate::set_managed(Some(crate::slipgate::Cfg {
        base: config.url().expect("started Slipgate has a port"),
        key: Some(config.key.clone()),
    }));
    *LAST_BACKGROUND_ERROR.write() = None;
    let previous_processes = PROCESSES.lock().await.replace(candidate);
    if let Some(previous_processes) = previous_processes {
        terminate_processes(previous_processes).await;
    }
    cleanup_old_runtimes(paths, &config.runtime_version).await;
    Ok(status)
}

async fn process_running() -> bool {
    let dead = {
        let mut processes = PROCESSES.lock().await;
        let Some(active) = processes.as_mut() else {
            return false;
        };
        let running = matches!(active.slipgate.try_wait(), Ok(None))
            && matches!(active.flaresolverr.try_wait(), Ok(None));
        (!running).then(|| processes.take()).flatten()
    };
    if let Some(dead) = dead {
        terminate_processes(dead).await;
        false
    } else {
        true
    }
}

async fn status_value(paths: &AppPaths, settings: &SettingsStore) -> Value {
    let supported = platform_key().is_some();
    let enabled = settings.get(ENABLED_SETTING).as_bool() != Some(false);
    let config = load_config(paths);
    let installed = config.as_ref().is_some_and(|config| {
        !config.runtime_version.is_empty()
            && slipgate_executable(&runtime_dir(paths, &config.runtime_version)).is_file()
            && flaresolverr_executable(&runtime_dir(paths, &config.runtime_version)).is_file()
    });
    let running = process_running().await;
    let mut version = String::new();
    let mut flaresolverr_ok = false;
    let mut recipes = json!([]);
    let mut error = LAST_BACKGROUND_ERROR.read().clone();
    let url = config.as_ref().and_then(ManagedConfig::url);
    if running {
        if let (Some(config), Some(base)) = (&config, &url) {
            match crate::slipgate::health(base, &config.key).await {
                Ok(value) => {
                    version = value
                        .get("version")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_string();
                    flaresolverr_ok = crate::slipgate::fetch_usable(&value);
                    recipes = value.get("recipes").cloned().unwrap_or_else(|| json!([]));
                }
                Err(value) => error = Some(value),
            }
        }
    }
    json!({
        "ok": true,
        "supported": supported,
        "enabled": enabled,
        "installed": installed,
        "running": running,
        "healthy": running && flaresolverr_ok,
        "url": url,
        "version": version,
        "runtimeVersion": config.as_ref().map(|config| config.runtime_version.as_str()).unwrap_or(""),
        "flaresolverrOk": flaresolverr_ok,
        "recipes": recipes,
        "error": error,
    })
}

async fn install_and_start(
    app: &AppHandle,
    paths: &AppPaths,
    settings: &SettingsStore,
) -> Result<Value, String> {
    *LAST_BACKGROUND_ERROR.write() = None;
    let legacy_url = legacy_managed_url(paths);
    crate::sources::adapters::onlinefix::invalidate();
    app.emit("uc:sources-updated", json!({})).ok();
    let manifest = fetch_manifest().await?;
    install_runtime(paths, &manifest).await?;
    let config = load_config(paths)
        .filter(|config| config.runtime_version == manifest.version)
        .unwrap_or_else(|| ManagedConfig::new(manifest.version));
    let result = start_runtime(app, paths, settings, config).await?;
    if let Some(legacy_url) = legacy_url.as_deref() {
        finish_legacy_migration(app, paths, settings, legacy_url).await;
    }
    crate::sources::adapters::onlinefix::refresh().await;
    app.emit("uc:sources-updated", json!({})).ok();
    Ok(result)
}

#[tauri::command]
pub async fn managed_slipgate_status(state: State<'_, AppState>) -> Result<Value, String> {
    Ok(status_value(&state.paths, &state.settings).await)
}

#[tauri::command]
pub async fn managed_slipgate_install(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let _guard = OPERATION.lock().await;
    state.settings.set(ENABLED_SETTING, Value::Bool(true));
    install_and_start(&app, &state.paths, &state.settings).await?;
    Ok(status_value(&state.paths, &state.settings).await)
}

#[tauri::command]
pub async fn managed_slipgate_start(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let _guard = OPERATION.lock().await;
    let config = load_config(&state.paths)
        .ok_or_else(|| "Built-in resolver is not installed".to_string())?;
    start_runtime(&app, &state.paths, &state.settings, config).await?;
    crate::sources::adapters::onlinefix::refresh().await;
    app.emit("uc:sources-updated", json!({})).ok();
    Ok(status_value(&state.paths, &state.settings).await)
}

#[tauri::command]
pub async fn managed_slipgate_stop(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let _guard = OPERATION.lock().await;
    let mut config = load_config(&state.paths)
        .ok_or_else(|| "Built-in resolver is not installed".to_string())?;
    stop_processes().await;
    config.enabled = false;
    save_config(&state.paths, &config)?;
    crate::sources::adapters::onlinefix::invalidate();
    app.emit("uc:sources-updated", json!({})).ok();
    Ok(status_value(&state.paths, &state.settings).await)
}

#[tauri::command]
pub async fn managed_slipgate_update(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let _guard = OPERATION.lock().await;
    state.settings.set(ENABLED_SETTING, Value::Bool(true));
    install_and_start(&app, &state.paths, &state.settings).await?;
    Ok(status_value(&state.paths, &state.settings).await)
}

#[tauri::command]
pub async fn managed_slipgate_uninstall(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let _guard = OPERATION.lock().await;
    let mut config = load_config(&state.paths)
        .ok_or_else(|| "Built-in resolver is not installed".to_string())?;
    stop_processes().await;
    config.enabled = false;
    save_config(&state.paths, &config)?;
    state.settings.set(ENABLED_SETTING, Value::Bool(false));
    crate::sources::adapters::onlinefix::invalidate();
    app.emit("uc:sources-updated", json!({})).ok();
    if managed_dir(&state.paths).is_dir() {
        std::fs::remove_dir_all(managed_dir(&state.paths))
            .map_err(|e| format!("remove built-in resolver: {e}"))?;
    }
    Ok(status_value(&state.paths, &state.settings).await)
}

pub async fn autostart(app: AppHandle, paths: Arc<AppPaths>, settings: Arc<SettingsStore>) {
    tokio::time::sleep(Duration::from_secs(5)).await;
    if platform_key().is_none() {
        return;
    }
    let legacy_url = legacy_managed_url(&paths);
    if settings.get(ENABLED_SETTING).as_bool() == Some(false) {
        supervise(app, paths, settings).await;
        return;
    }
    let result = {
        let _guard = OPERATION.lock().await;
        let previous = load_config(&paths);
        async {
            let manifest = fetch_manifest().await?;
            install_runtime(&paths, &manifest).await?;
            let enabled = previous
                .as_ref()
                .map(|config| config.enabled)
                .unwrap_or(true);
            let mut config = previous
                .filter(|config| config.runtime_version == manifest.version)
                .unwrap_or_else(|| ManagedConfig::new(manifest.version));
            config.enabled = enabled;
            if config.enabled {
                start_runtime(&app, &paths, &settings, config).await?;
                if let Some(legacy_url) = legacy_url.as_deref() {
                    finish_legacy_migration(&app, &paths, &settings, legacy_url).await;
                }
                crate::sources::adapters::onlinefix::refresh().await;
                app.emit("uc:sources-updated", json!({})).ok();
            }
            Ok::<(), String>(())
        }
        .await
    };
    if let Err(error) = result {
        *LAST_BACKGROUND_ERROR.write() = Some(error.clone());
        crate::logging::write_line(
            "warn",
            &format!("built-in resolver background setup failed: {error}"),
        );
        app.emit("uc:sources-updated", json!({})).ok();
    }
    supervise(app, paths, settings).await;
}

async fn supervise(app: AppHandle, paths: Arc<AppPaths>, settings: Arc<SettingsStore>) {
    if SUPERVISOR_STARTED.swap(true, Ordering::AcqRel) {
        return;
    }
    let mut health_failures = 0u8;
    let mut install_retry_ticks = 0u8;
    loop {
        tokio::time::sleep(Duration::from_secs(15)).await;
        if settings.get(ENABLED_SETTING).as_bool() == Some(false) {
            health_failures = 0;
            install_retry_ticks = 0;
            continue;
        }
        let config = load_config(&paths).filter(|config| {
            config.enabled
                && !config.runtime_version.is_empty()
                && slipgate_executable(&runtime_dir(&paths, &config.runtime_version)).is_file()
                && flaresolverr_executable(&runtime_dir(&paths, &config.runtime_version)).is_file()
        });
        let Some(config) = config else {
            health_failures = 0;
            install_retry_ticks = install_retry_ticks.saturating_add(1);
            if install_retry_ticks < 20 {
                continue;
            }
            install_retry_ticks = 0;
            let _guard = OPERATION.lock().await;
            match install_and_start(&app, &paths, &settings).await {
                Ok(_) => {
                    *LAST_BACKGROUND_ERROR.write() = None;
                    app.emit("uc:sources-updated", json!({})).ok();
                }
                Err(error) => {
                    *LAST_BACKGROUND_ERROR.write() = Some(error.clone());
                    crate::logging::write_line(
                        "warn",
                        &format!("built-in resolver install retry failed: {error}"),
                    );
                    app.emit("uc:sources-updated", json!({})).ok();
                }
            }
            continue;
        };
        install_retry_ticks = 0;
        let running = process_running().await;
        let healthy = if running {
            match config.url() {
                Some(url) => crate::slipgate::health(&url, &config.key)
                    .await
                    .map(|status| crate::slipgate::fetch_usable(&status))
                    .unwrap_or(false),
                None => false,
            }
        } else {
            false
        };
        if healthy {
            health_failures = 0;
            continue;
        }
        health_failures = health_failures.saturating_add(1);
        if running && health_failures < 3 {
            continue;
        }
        let _guard = OPERATION.lock().await;
        let Some(config) = load_config(&paths).filter(|config| config.enabled) else {
            continue;
        };
        if let Err(error) = start_runtime(&app, &paths, &settings, config).await {
            crate::logging::write_line(
                "warn",
                &format!("built-in resolver restart failed: {error}"),
            );
        } else {
            crate::logging::write_line("info", "built-in resolver restarted");
            health_failures = 0;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manifest(url: &str, hash: &str, size: u64) -> RuntimeManifest {
        RuntimeManifest {
            version: "1".to_string(),
            slipgate_version: "0.5.3".to_string(),
            flaresolverr_version: "3.5.0".to_string(),
            platforms: platform_key()
                .map(|key| {
                    HashMap::from([(
                        key.to_string(),
                        RuntimeArtifact {
                            url: url.to_string(),
                            sha256: hash.to_string(),
                            size,
                        },
                    )])
                })
                .unwrap_or_default(),
        }
    }

    #[test]
    fn accepts_pinned_manifold_release_asset() {
        if platform_key().is_none() {
            return;
        }
        let value = manifest(
            "https://github.com/fyiel/Union.Manifold/releases/download/v3.8.0/resolver-runtime-linux-x86_64.zip",
            &"a".repeat(64),
            123,
        );
        assert!(validate_manifest(&value).is_ok());
    }

    #[test]
    fn release_signing_key_is_valid() {
        assert!(minisign_verify::PublicKey::from_base64(RELEASE_PUBLIC_KEY).is_ok());
    }

    #[test]
    fn rejects_untrusted_or_unverifiable_assets() {
        if platform_key().is_none() {
            return;
        }
        assert!(validate_manifest(&manifest(
            "https://example.com/runtime.zip",
            &"a".repeat(64),
            123
        ))
        .is_err());
        assert!(validate_manifest(&manifest(
            "https://github.com/fyiel/Union.Manifold/releases/download/v3.8.0/runtime.zip",
            "nope",
            123
        ))
        .is_err());
        let mut unsafe_version = manifest(
            "https://github.com/fyiel/Union.Manifold/releases/download/v3.8.0/runtime.zip",
            &"a".repeat(64),
            123,
        );
        unsafe_version.version = "../outside".to_string();
        assert!(validate_manifest(&unsafe_version).is_err());
    }

    #[test]
    fn managed_url_is_loopback_only() {
        let mut config = ManagedConfig::new("1".to_string());
        assert_eq!(config.url(), None);
        config.slipgate_port = 38189;
        assert_eq!(config.url().as_deref(), Some("http://127.0.0.1:38189"));
    }
}
