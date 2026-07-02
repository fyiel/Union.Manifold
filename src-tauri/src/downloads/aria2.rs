use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;

use rand::Rng;
use serde_json::{json, Value};
use tokio::process::Child;

pub struct Aria2Manager {
    binary: Option<PathBuf>,
    ca_cert: Option<PathBuf>,
    port: AtomicU64,
    secret: String,
    child: Mutex<Option<Child>>,
    ready: AtomicBool,
    starting: tokio::sync::Mutex<()>,
    rpc_id: AtomicU64,
}

fn free_port() -> u16 {
    std::net::TcpListener::bind("127.0.0.1:0")
        .ok()
        .and_then(|l| l.local_addr().ok())
        .map(|a| a.port())
        .unwrap_or(6810)
}

impl Aria2Manager {
    pub fn new(ca_cert: Option<PathBuf>) -> Self {
        let secret: String = {
            let bytes: [u8; 16] = rand::thread_rng().gen();
            hex::encode(bytes)
        };
        Aria2Manager {
            binary: crate::bins::resolve_sidecar("aria2c"),
            ca_cert,
            port: AtomicU64::new(0),
            secret,
            child: Mutex::new(None),
            ready: AtomicBool::new(false),
            starting: tokio::sync::Mutex::new(()),
            rpc_id: AtomicU64::new(0),
        }
    }

    pub fn is_ready(&self) -> bool {
        self.ready.load(Ordering::SeqCst)
    }

    pub async fn ensure_started(&self) -> bool {
        if self.is_ready() {
            return true;
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
        let port = free_port();
        self.port.store(port as u64, Ordering::SeqCst);
        let mut args = vec![
            "--enable-rpc".to_string(),
            "--rpc-listen-all=false".to_string(),
            format!("--rpc-listen-port={port}"),
            format!("--rpc-secret={}", self.secret),
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
        ];
        if let Some(ca) = &self.ca_cert {
            if ca.is_file() {
                args.push("--check-certificate=true".to_string());
                args.push(format!("--ca-certificate={}", ca.display()));
            }
        }
        let mut cmd = tokio::process::Command::new(&binary);
        cmd.args(&args)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000);
        }
        let child = match cmd.spawn() {
            Ok(c) => c,
            Err(e) => {
                crate::logging::write_line("warn", &format!("aria2 spawn failed: {e}"));
                return false;
            }
        };
        *self.child.lock().unwrap() = Some(child);

        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(6);
        while std::time::Instant::now() < deadline {
            if self.rpc("aria2.getVersion", vec![]).await.is_ok() {
                self.ready.store(true, Ordering::SeqCst);
                crate::logging::write_line("info", "aria2 daemon ready");
                return true;
            }
            tokio::time::sleep(std::time::Duration::from_millis(150)).await;
        }
        crate::logging::write_line("warn", "aria2 daemon did not become ready");
        false
    }

    pub fn stop(&self) {
        self.ready.store(false, Ordering::SeqCst);
        if let Some(mut child) = self.child.lock().unwrap().take() {
            child.start_kill().ok();
        }
    }

    async fn rpc(&self, method: &str, params: Vec<Value>) -> crate::error::Result<Value> {
        let port = self.port.load(Ordering::SeqCst);
        if port == 0 {
            return Err(crate::error::AppError::msg("aria2 not started"));
        }
        let id = self.rpc_id.fetch_add(1, Ordering::SeqCst);
        let mut full = vec![json!(format!("token:{}", self.secret))];
        full.extend(params);
        let body = json!({ "jsonrpc": "2.0", "id": format!("uc-{id}"), "method": method, "params": full });
        let client = reqwest::Client::new();
        let resp = client
            .post(format!("http://127.0.0.1:{port}/jsonrpc"))
            .json(&body)
            .timeout(std::time::Duration::from_secs(8))
            .send()
            .await
            .map_err(|e| crate::error::AppError::msg(format!("aria2 rpc: {e}")))?;
        let parsed: Value = resp
            .json()
            .await
            .map_err(|e| crate::error::AppError::msg(format!("aria2 rpc parse: {e}")))?;
        if let Some(err) = parsed.get("error") {
            return Err(crate::error::AppError::msg(
                err.get("message").and_then(|m| m.as_str()).unwrap_or("aria2 rpc error").to_string(),
            ));
        }
        Ok(parsed.get("result").cloned().unwrap_or(Value::Null))
    }

    pub async fn add_uri(&self, uri: &str, options: Value) -> crate::error::Result<String> {
        let result = self.rpc("aria2.addUri", vec![json!([uri]), options]).await?;
        result
            .as_str()
            .map(|s| s.to_string())
            .ok_or_else(|| crate::error::AppError::msg("aria2 addUri returned no gid"))
    }

    pub async fn pause(&self, gid: &str) {
        self.rpc("aria2.pause", vec![json!(gid)]).await.ok();
    }

    pub async fn unpause(&self, gid: &str) {
        self.rpc("aria2.unpause", vec![json!(gid)]).await.ok();
    }

    pub async fn force_remove(&self, gid: &str) {
        self.rpc("aria2.forceRemove", vec![json!(gid)]).await.ok();
    }

    pub async fn remove_download_result(&self, gid: &str) {
        self.rpc("aria2.removeDownloadResult", vec![json!(gid)]).await.ok();
    }

    pub async fn set_max_overall_download_limit(&self, bps: u64) {
        let v = if bps > 0 { bps.to_string() } else { "0".to_string() };
        self.rpc(
            "aria2.changeGlobalOption",
            vec![json!({ "max-overall-download-limit": v })],
        )
        .await
        .ok();
    }

    pub async fn tell_status(&self, gid: &str) -> crate::error::Result<Value> {
        self.rpc(
            "aria2.tellStatus",
            vec![
                json!(gid),
                json!([
                    "gid",
                    "status",
                    "totalLength",
                    "completedLength",
                    "downloadSpeed",
                    "errorCode",
                    "errorMessage",
                    "files"
                ]),
            ],
        )
        .await
    }
}
