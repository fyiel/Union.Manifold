use std::collections::HashMap;
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use serde_json::{json, Value};

use crate::http;
use crate::settings::SettingsStore;

static SETTINGS: OnceLock<Arc<SettingsStore>> = OnceLock::new();

pub fn init(settings: Arc<SettingsStore>) {
    SETTINGS.set(settings).ok();
}

#[derive(Clone)]
pub struct Cfg {
    pub base: String,
    pub key: Option<String>,
}

pub fn cfg() -> Option<Cfg> {
    let (url, key) = match SETTINGS.get() {
        Some(s) => (s.get_string("slipgateUrl"), s.get_string("slipgateKey")),
        None => (std::env::var("SLIPGATE_URL").ok(), std::env::var("SLIPGATE_KEY").ok()),
    };
    let base = url
        .map(|s| s.trim().trim_end_matches('/').to_string())
        .filter(|s| !s.is_empty())?;
    let key = key.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    Some(Cfg { base, key })
}

pub async fn post(cfg: &Cfg, path: &str, body: Value, timeout: Duration) -> Result<Value, String> {
    let mut headers = HashMap::new();
    headers.insert("Content-Type".to_string(), "application/json".to_string());
    headers.insert("Accept".to_string(), "application/json".to_string());
    if let Some(k) = &cfg.key {
        headers.insert("X-Slipgate-Key".to_string(), k.clone());
    }
    let resp = http::fetch(
        &format!("{}{path}", cfg.base),
        &http::FetchOpts {
            method: Some("POST".to_string()),
            headers,
            body: Some(serde_json::to_vec(&body).map_err(|e| format!("slipgate encode: {e}"))?),
            timeout: Some(timeout),
            ..Default::default()
        },
    )
    .await
    .map_err(|e| format!("Slipgate unreachable: {e}"))?;
    let status = resp.status().as_u16();
    let text = resp.text().await.unwrap_or_default();
    if status == 401 {
        return Err("Slipgate rejected the request (check the key)".to_string());
    }
    if !(200..300).contains(&status) {
        return Err(format!("Slipgate HTTP {status}"));
    }
    serde_json::from_str(&text).map_err(|e| format!("Slipgate bad response: {e}"))
}

pub async fn fetch(cfg: &Cfg, url: &str, timeout: Duration) -> Result<String, String> {
    let resp = post(cfg, "/fetch", json!({ "url": url }), timeout).await?;
    if !resp.get("ok").and_then(|v| v.as_bool()).unwrap_or(false) {
        let err = resp.get("error").and_then(|v| v.as_str()).unwrap_or("unknown error");
        return Err(format!("Slipgate fetch: {err}"));
    }
    resp.get("body")
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "Slipgate fetch: empty body".to_string())
}

pub struct ResolvedLink {
    pub url: String,
    pub file_name: Option<String>,
    pub size_bytes: Option<u64>,
    pub headers: HashMap<String, String>,
}

pub async fn resolve(
    cfg: &Cfg,
    host: &str,
    page_url: &str,
    params: Value,
    cookies: Value,
) -> Result<ResolvedLink, String> {
    let body = json!({ "host": host, "page_url": page_url, "params": params, "cookies": cookies });
    let v = post(cfg, "/resolve", body, Duration::from_secs(180)).await?;
    if !v.get("ok").and_then(|x| x.as_bool()).unwrap_or(false) {
        return Err(v
            .get("error")
            .and_then(|x| x.as_str())
            .unwrap_or("Slipgate could not resolve the download")
            .to_string());
    }
    let url = v
        .get("download_url")
        .and_then(|x| x.as_str())
        .filter(|s| !s.is_empty())
        .map(String::from)
        .ok_or_else(|| "Slipgate returned no download url".to_string())?;
    let file_name = v
        .get("file_name")
        .and_then(|x| x.as_str())
        .filter(|s| !s.is_empty())
        .map(String::from);
    let size_bytes = v.get("size_bytes").and_then(|x| x.as_u64()).filter(|n| *n > 0);
    let headers = v
        .get("headers")
        .and_then(|x| x.as_object())
        .map(|m| {
            m.iter()
                .filter_map(|(k, val)| val.as_str().map(|s| (k.clone(), s.to_string())))
                .collect()
        })
        .unwrap_or_default();
    Ok(ResolvedLink { url, file_name, size_bytes, headers })
}

pub async fn health(base: &str, key: &str) -> Result<Value, String> {
    let mut headers = HashMap::new();
    headers.insert("Accept".to_string(), "application/json".to_string());
    if !key.is_empty() {
        headers.insert("X-Slipgate-Key".to_string(), key.to_string());
    }
    let resp = http::fetch(
        &format!("{base}/health"),
        &http::FetchOpts { headers, timeout: Some(Duration::from_secs(15)), ..Default::default() },
    )
    .await
    .map_err(|e| format!("unreachable: {e}"))?;
    let status = resp.status().as_u16();
    let text = resp.text().await.unwrap_or_default();
    if !(200..300).contains(&status) {
        return Err(format!("HTTP {status}"));
    }
    let v: Value = serde_json::from_str(&text).map_err(|e| format!("bad response: {e}"))?;
    Ok(json!({
        "ok": true,
        "version": v.get("version").and_then(|x| x.as_str()).unwrap_or(""),
        "flaresolverrOk": v.get("flaresolverr_ok").and_then(|x| x.as_bool()).unwrap_or(false),
        "recipes": v.get("recipes").cloned().unwrap_or_else(|| json!([])),
    }))
}

#[cfg(test)]
#[path = "../../.dev/rust/slipgate_tests.rs"]
mod dev_slipgate_tests;
