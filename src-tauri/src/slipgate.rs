use std::collections::HashMap;
use std::sync::{Arc, LazyLock, OnceLock};
use std::time::Duration;

use serde_json::{json, Value};

use crate::http;
use crate::settings::SettingsStore;

static SETTINGS: OnceLock<Arc<SettingsStore>> = OnceLock::new();
static MANAGED: LazyLock<parking_lot::RwLock<Option<Cfg>>> =
    LazyLock::new(|| parking_lot::RwLock::new(None));

pub fn init(settings: Arc<SettingsStore>) {
    SETTINGS.set(settings).ok();
}

#[derive(Clone, PartialEq, Eq)]
pub struct Cfg {
    pub base: String,
    pub key: Option<String>,
}

pub fn set_managed(cfg: Option<Cfg>) {
    *MANAGED.write() = cfg;
}

pub fn cfgs() -> Vec<Cfg> {
    let mut configs = MANAGED.read().clone().into_iter().collect::<Vec<_>>();
    if let Some(external) = external_cfg() {
        if !configs.iter().any(|cfg| cfg == &external) {
            configs.push(external);
        }
    }
    configs
}

pub fn cfg() -> Option<Cfg> {
    cfgs().into_iter().next()
}

fn external_cfg() -> Option<Cfg> {
    let (url, key) = match SETTINGS.get() {
        Some(s) => (s.get_string("slipgateUrl"), s.get_string("slipgateKey")),
        None => (
            std::env::var("SLIPGATE_URL").ok(),
            std::env::var("SLIPGATE_KEY").ok(),
        ),
    };
    let base = url
        .map(|s| s.trim().trim_end_matches('/').to_string())
        .filter(|s| !s.is_empty())?;
    let key = key.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    Some(Cfg { base, key })
}

async fn post(cfg: &Cfg, path: &str, body: Value, timeout: Duration) -> Result<Value, String> {
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
        let err = resp
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown error");
        return Err(format!("Slipgate fetch: {err}"));
    }
    resp.get("body")
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "Slipgate fetch: empty body".to_string())
}

pub async fn fetch_configured(url: &str, timeout: Duration) -> Result<String, String> {
    let configs = cfgs();
    if configs.is_empty() {
        return Err("Slipgate is not configured".to_string());
    }
    let mut errors = Vec::new();
    let has_fallback = configs.len() > 1;
    for (index, cfg) in configs.into_iter().enumerate() {
        if index == 0 && has_fallback {
            let key = cfg.key.as_deref().unwrap_or("");
            match health(&cfg.base, key).await {
                Ok(status) if fetch_usable(&status) => {}
                Ok(_) => {
                    errors.push("Built-in Slipgate is unhealthy".to_string());
                    continue;
                }
                Err(error) => {
                    errors.push(format!("Built-in Slipgate: {error}"));
                    continue;
                }
            }
        }
        match fetch(&cfg, url, timeout).await {
            Ok(body) => return Ok(body),
            Err(error) => errors.push(error),
        }
    }
    Err(errors.join("; "))
}

pub struct ResolvedLink {
    pub url: String,
    pub file_name: Option<String>,
    pub size_bytes: Option<u64>,
    pub headers: HashMap<String, String>,
}

fn resolved_headers(value: &Value) -> HashMap<String, String> {
    let mut headers: HashMap<String, String> = value
        .get("headers")
        .and_then(Value::as_object)
        .map(|entries| {
            entries
                .iter()
                .filter_map(|(key, value)| {
                    value.as_str().map(|value| (key.clone(), value.to_string()))
                })
                .collect()
        })
        .unwrap_or_default();
    if !headers
        .keys()
        .any(|key| key.eq_ignore_ascii_case("user-agent"))
    {
        if let Some(user_agent) = value
            .get("user_agent")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
        {
            headers.insert("User-Agent".to_string(), user_agent.to_string());
        }
    }
    if !headers.keys().any(|key| key.eq_ignore_ascii_case("cookie")) {
        let cookies = value
            .get("cookies")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|cookie| {
                Some(format!(
                    "{}={}",
                    cookie.get("name")?.as_str()?,
                    cookie.get("value")?.as_str()?
                ))
            })
            .collect::<Vec<_>>()
            .join("; ");
        if !cookies.is_empty() {
            headers.insert("Cookie".to_string(), cookies);
        }
    }
    headers
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
    let size_bytes = v
        .get("size_bytes")
        .and_then(|x| x.as_u64())
        .filter(|n| *n > 0);
    let headers = resolved_headers(&v);
    Ok(ResolvedLink {
        url,
        file_name,
        size_bytes,
        headers,
    })
}

pub async fn resolve_configured(
    host: &str,
    page_url: &str,
    params: Value,
    cookies: Value,
) -> Result<ResolvedLink, String> {
    let configs = cfgs();
    if configs.is_empty() {
        return Err("Slipgate is not configured".to_string());
    }
    let mut errors = Vec::new();
    let has_fallback = configs.len() > 1;
    for (index, cfg) in configs.into_iter().enumerate() {
        if index == 0 && has_fallback {
            let key = cfg.key.as_deref().unwrap_or("");
            match health(&cfg.base, key).await {
                Ok(status) if fetch_usable(&status) => {}
                Ok(_) => {
                    errors.push("Built-in Slipgate is unhealthy".to_string());
                    continue;
                }
                Err(error) => {
                    errors.push(format!("Built-in Slipgate: {error}"));
                    continue;
                }
            }
        }
        match resolve(&cfg, host, page_url, params.clone(), cookies.clone()).await {
            Ok(link) => return Ok(link),
            Err(error) => errors.push(error),
        }
    }
    Err(errors.join("; "))
}

pub async fn health(base: &str, key: &str) -> Result<Value, String> {
    let mut headers = HashMap::new();
    headers.insert("Accept".to_string(), "application/json".to_string());
    if !key.is_empty() {
        headers.insert("X-Slipgate-Key".to_string(), key.to_string());
    }
    let resp = http::fetch(
        &format!("{base}/health"),
        &http::FetchOpts {
            headers,
            timeout: Some(Duration::from_secs(15)),
            ..Default::default()
        },
    )
    .await
    .map_err(|e| format!("unreachable: {e}"))?;
    let status = resp.status().as_u16();
    let text = resp.text().await.unwrap_or_default();
    if !(200..300).contains(&status) {
        return Err(format!("HTTP {status}"));
    }
    let v: Value = serde_json::from_str(&text).map_err(|e| format!("bad response: {e}"))?;
    if !v.get("ok").and_then(Value::as_bool).unwrap_or(false) {
        return Err("unhealthy".to_string());
    }
    Ok(json!({
        "ok": true,
        "version": v.get("version").and_then(|x| x.as_str()).unwrap_or(""),
        "flaresolverrOk": v.get("flaresolverr_ok").and_then(|x| x.as_bool()).unwrap_or(false),
        "recipes": v.get("recipes").cloned().unwrap_or_else(|| json!([])),
    }))
}

pub fn fetch_usable(status: &Value) -> bool {
    status.get("ok").and_then(Value::as_bool).unwrap_or(false)
        && status
            .get("flaresolverrOk")
            .and_then(Value::as_bool)
            .unwrap_or(false)
}
