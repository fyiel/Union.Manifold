use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

use parking_lot::Mutex;

use rand::Rng;
use serde_json::{json, Value};
use tokio::process::Child;

pub struct Aria2Manager {
    binary: Option<PathBuf>,
    ca_cert: Option<PathBuf>,
    port: AtomicU64,
    secret: String,
    proxy: Mutex<Option<String>>,
    child: Mutex<Option<Child>>,
    proxy_conf: Mutex<Option<PathBuf>>,
    ready: AtomicBool,
    starting: tokio::sync::Mutex<()>,
    rpc_id: AtomicU64,
    http: reqwest::Client,
}

fn limit_arg(kbps: u64) -> String {
    if kbps > 0 {
        format!("{kbps}K")
    } else {
        "0".to_string()
    }
}

fn free_port() -> u16 {
    std::net::TcpListener::bind("127.0.0.1:0")
        .ok()
        .and_then(|l| l.local_addr().ok())
        .map(|a| a.port())
        .unwrap_or_else(|| rand::thread_rng().gen_range(20000..60000))
}

pub fn resolve_ca_cert(resource_dir: Option<PathBuf>) -> Option<PathBuf> {
    crate::bins::resolve_resource_file(&resource_dir?, "cacert.pem")
}



impl Aria2Manager {
    pub fn new(ca_cert: Option<PathBuf>, proxy: Option<String>) -> Self {
        let secret: String = {
            let bytes: [u8; 16] = rand::thread_rng().gen();
            hex::encode(bytes)
        };
        Aria2Manager {
            binary: crate::bins::resolve_sidecar("aria2c"),
            ca_cert,
            port: AtomicU64::new(0),
            secret,
            proxy: Mutex::new(
                proxy
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty()),
            ),
            child: Mutex::new(None),
            proxy_conf: Mutex::new(None),
            ready: AtomicBool::new(false),
            starting: tokio::sync::Mutex::new(()),
            rpc_id: AtomicU64::new(0),
            http: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(8))
                .build()
                .expect("build aria2 rpc http client"),
        }
    }

    pub fn is_ready(&self) -> bool {
        self.ready.load(Ordering::SeqCst)
    }

    async fn ping(&self) -> bool {
        self.rpc("aria2.getVersion", vec![]).await.is_ok()
    }

    pub async fn ensure_started(&self, limit_kbps: u64) -> bool {
        if self.is_ready() {
            if self.ping().await {
                return true;
            }
            self.teardown_daemon();
            crate::logging::write_line("warn", "aria2 daemon unresponsive, relaunching");
        }
        let _g = self.starting.lock().await;
        if self.is_ready() {
            return true;
        }
        let binary = match &self.binary {
            Some(b) => b.clone(),
            None => {
                crate::logging::write_line("warn", "aria2c binary not found");
                return false;
            }
        };
        for _ in 0..3 {
            if self.spawn_and_probe(&binary, limit_kbps).await {
                return true;
            }
        }
        crate::logging::write_line("warn", "aria2 daemon failed to start after retries");
        false
    }

    async fn spawn_and_probe(&self, binary: &Path, limit_kbps: u64) -> bool {
        let port = free_port();
        self.port.store(port as u64, Ordering::SeqCst);
        let mut args = vec![
            "--enable-rpc".to_string(),
            "--rpc-listen-all=false".to_string(),
            format!("--rpc-listen-port={port}"),
            "--continue=true".to_string(),
            "--auto-file-renaming=false".to_string(),
            "--allow-overwrite=true".to_string(),
            "--file-allocation=none".to_string(),
            "--max-connection-per-server=8".to_string(),
            "--split=8".to_string(),
            "--min-split-size=8M".to_string(),
            "--summary-interval=0".to_string(),
            "--console-log-level=warn".to_string(),
            "--quiet=true".to_string(),
            "--max-tries=10".to_string(),
            "--retry-wait=5".to_string(),
            "--connect-timeout=30".to_string(),
            "--timeout=60".to_string(),
            "--disable-ipv6=true".to_string(),
            format!("--stop-with-process={}", std::process::id()),
            format!("--max-overall-download-limit={}", limit_arg(limit_kbps)),
        ];
        let proxy = self.proxy.lock().clone();
        let conf_path;
        {
            let conf = std::env::temp_dir().join(format!(
                "union-manifold-aria2-{}-{}.conf",
                std::process::id(),
                port
            ));
            let mut conf_body = format!("rpc-secret={}\n", self.secret);
            if let Some(p) = &proxy {
                conf_body.push_str(&format!("all-proxy={p}\n"));
            }
            if std::fs::write(&conf, conf_body).is_err() {
                crate::logging::write_line(
                    "warn",
                    "aria2 config could not be written; refusing to start with secrets on argv",
                );
                return false;
            }
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(&conf, std::fs::Permissions::from_mode(0o600)).ok();
            }
            args.push(format!("--conf-path={}", conf.display()));
            conf_path = Some(conf);
        }
        if let Some(ca) = &self.ca_cert {
            if ca.is_file() {
                args.push("--check-certificate=true".to_string());
                args.push(format!("--ca-certificate={}", ca.display()));
            }
        }
        let mut cmd = tokio::process::Command::new(binary);
        cmd.args(&args)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null());
        #[cfg(windows)]
        {
            cmd.creation_flags(windows_sys::Win32::System::Threading::CREATE_NO_WINDOW);
        }
        let child = match cmd.spawn() {
            Ok(c) => c,
            Err(e) => {
                if let Some(conf) = &conf_path {
                    std::fs::remove_file(conf).ok();
                }
                crate::logging::write_line("warn", &format!("aria2 spawn failed: {e}"));
                return false;
            }
        };
        if let Some(conf) = conf_path {
            *self.proxy_conf.lock() = Some(conf);
        }
        *self.child.lock() = Some(child);

        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(6);
        while std::time::Instant::now() < deadline {
            if self.ping().await {
                self.ready.store(true, Ordering::SeqCst);
                crate::logging::write_line("info", "aria2 daemon ready");
                return true;
            }
            tokio::time::sleep(std::time::Duration::from_millis(150)).await;
        }
        crate::logging::write_line(
            "warn",
            &format!("aria2 daemon did not become ready on port {port}"),
        );
        self.teardown_daemon();
        false
    }

    pub async fn set_bandwidth_limit(&self, kbps: u64) {
        if !self.is_ready() {
            return;
        }
        self.rpc(
            "aria2.changeGlobalOption",
            vec![json!({ "max-overall-download-limit": limit_arg(kbps) })],
        )
        .await
        .ok();
    }

    // Route downloads through the configured proxy. Applied on the next daemon
    // launch (spawn reads self.proxy) and pushed live to a running daemon so a
    // setting change takes effect without a restart.
    pub async fn set_proxy(&self, url: Option<String>) {
        let url = url.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
        *self.proxy.lock() = url.clone();
        if self.is_ready() {
            self.rpc(
                "aria2.changeGlobalOption",
                vec![json!({ "all-proxy": url.unwrap_or_default() })],
            )
            .await
            .ok();
        }
    }

    fn teardown_daemon(&self) {
        self.ready.store(false, Ordering::SeqCst);
        if let Some(mut child) = self.child.lock().take() {
            child.start_kill().ok();
        }
        if let Some(conf) = self.proxy_conf.lock().take() {
            std::fs::remove_file(conf).ok();
        }
    }

    pub fn stop(&self) {
        self.teardown_daemon();
    }

    async fn rpc(&self, method: &str, params: Vec<Value>) -> crate::error::Result<Value> {
        let port = self.port.load(Ordering::SeqCst);
        if port == 0 {
            return Err(crate::error::AppError::msg("aria2 not started"));
        }
        let id = self.rpc_id.fetch_add(1, Ordering::SeqCst);
        let mut full = vec![json!(format!("token:{}", self.secret))];
        full.extend(params);
        let body =
            json!({ "jsonrpc": "2.0", "id": format!("uc-{id}"), "method": method, "params": full });
        let resp = self
            .http
            .post(format!("http://127.0.0.1:{port}/jsonrpc"))
            .json(&body)
            .send()
            .await
            .map_err(|e| crate::error::AppError::msg(format!("aria2 rpc: {e}")))?;
        let parsed: Value = resp
            .json()
            .await
            .map_err(|e| crate::error::AppError::msg(format!("aria2 rpc parse: {e}")))?;
        if let Some(err) = parsed.get("error") {
            return Err(crate::error::AppError::msg(
                err.get("message")
                    .and_then(|m| m.as_str())
                    .unwrap_or("aria2 rpc error")
                    .to_string(),
            ));
        }
        Ok(parsed.get("result").cloned().unwrap_or(Value::Null))
    }

    pub async fn add_uri(&self, uri: &str, options: Value) -> crate::error::Result<String> {
        let result = self
            .rpc("aria2.addUri", vec![json!([uri]), options])
            .await?;
        result
            .as_str()
            .map(|s| s.to_string())
            .ok_or_else(|| crate::error::AppError::msg("aria2 addUri returned no gid"))
    }

    async fn rpc_gid(&self, method: &str, gid: &str) {
        self.rpc(method, vec![json!(gid)]).await.ok();
    }

    pub async fn pause(&self, gid: &str) {
        self.rpc_gid("aria2.pause", gid).await;
    }

    pub async fn unpause(&self, gid: &str) {
        self.rpc_gid("aria2.unpause", gid).await;
    }

    pub async fn remove_download_result(&self, gid: &str) {
        self.rpc_gid("aria2.removeDownloadResult", gid).await;
    }

    /// Abort a transfer and purge its result so the gid is gone for good.
    pub async fn discard(&self, gid: &str) {
        self.rpc_gid("aria2.forceRemove", gid).await;
        self.rpc_gid("aria2.removeDownloadResult", gid).await;
    }

    pub async fn tell_status(&self, gid: &str) -> crate::error::Result<Value> {
        self.rpc(
            "aria2.tellStatus",
            vec![
                json!(gid),
                json!([
                    "status",
                    "totalLength",
                    "completedLength",
                    "downloadSpeed",
                    "errorMessage"
                ]),
            ],
        )
        .await
    }
}

#[cfg(test)]
mod tests {
    use super::resolve_ca_cert;

    #[test]
    fn resolves_ca_bundle_from_packaged_resources_directory() {
        let root = tempfile::tempdir().unwrap();
        let resources = root.path().join("resources");
        std::fs::create_dir(&resources).unwrap();
        let expected = resources.join("cacert.pem");
        std::fs::write(&expected, "certificate").unwrap();

        assert_eq!(
            resolve_ca_cert(Some(root.path().to_path_buf())),
            Some(expected)
        );
    }

    #[test]
    fn prefers_flat_ca_bundle_and_ignores_missing_layouts() {
        assert_eq!(resolve_ca_cert(None), None);

        let root = tempfile::tempdir().unwrap();
        assert_eq!(resolve_ca_cert(Some(root.path().to_path_buf())), None);

        let nested = root.path().join("resources");
        std::fs::create_dir(&nested).unwrap();
        std::fs::write(nested.join("cacert.pem"), "nested").unwrap();
        let direct = root.path().join("cacert.pem");
        std::fs::write(&direct, "direct").unwrap();

        assert_eq!(
            resolve_ca_cert(Some(root.path().to_path_buf())),
            Some(direct)
        );
    }
}
