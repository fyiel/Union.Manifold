use crate::http::{self, FetchOpts};
use crate::sources::ResolveResult;
use once_cell::sync::Lazy;
use regex::Regex;
use serde_json::Value;
use std::collections::HashMap;
use super::not_resolvable;

static HOST_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)(^|\.)rootz\.so$").unwrap());
static ID_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"/d/([A-Za-z0-9_-]+)").unwrap());
static TOKEN_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r#""pageToken"\s*:\s*"([^"\\]+)""#).unwrap());

pub fn matches(url: &str) -> bool {
    super::host_matches(url, &HOST_RE)
}

fn id_from(url: &str) -> Option<String> {
    let u = url::Url::parse(url).ok()?;
    let caps = ID_RE.captures(u.path())?;
    Some(caps.get(1)?.as_str().to_string())
}

fn num(v: Option<&Value>) -> Option<u64> {
    super::num(v)
}

pub async fn resolve(url: &str) -> ResolveResult {
    let id = match id_from(url) {
        Some(id) => id,
        None => return not_resolvable(url, Some("rootz link has no file id")),
    };
    let page_url = format!("https://www.rootz.so/d/{id}");

    let page = match http::fetch(&page_url, &FetchOpts::default()).await {
        Ok(r) if r.status().is_success() => r.text().await.unwrap_or_default(),
        _ => return not_resolvable(url, Some("rootz page failed")),
    };

    let token = match TOKEN_RE.captures(&page).and_then(|c| c.get(1)) {
        Some(m) => m.as_str().to_string(),
        None => return not_resolvable(url, Some("no rootz page token")),
    };

    let api = format!("https://www.rootz.so/api/files/download-by-short?shortId={id}");
    let mut headers = HashMap::new();
    headers.insert("X-Page-Token".to_string(), token);
    headers.insert("Referer".to_string(), page_url.clone());
    headers.insert("Accept".to_string(), "application/json".to_string());
    let opts = FetchOpts {
        headers,
        ..Default::default()
    };

    let resp = match http::fetch(&api, &opts).await {
        Ok(r) => r,
        Err(_) => return not_resolvable(url, Some("rootz api request failed")),
    };
    if !resp.status().is_success() {
        return not_resolvable(url, Some(&format!("rootz api {}", resp.status().as_u16())));
    }
    let json = match resp.json::<Value>().await {
        Ok(j) => j,
        Err(_) => return not_resolvable(url, Some("rootz api returned no json")),
    };

    if json.get("success").and_then(|v| v.as_bool()) != Some(true) {
        return not_resolvable(url, Some("rootz api said no"));
    }
    let data = match json.get("data").filter(|v| v.is_object()) {
        Some(d) => d,
        None => return not_resolvable(url, Some("rootz api returned no data")),
    };
    if data.get("status").and_then(|v| v.as_str()) != Some("active") {
        return not_resolvable(url, Some("rootz file is not active"));
    }
    if !data
        .get("downloadAllowed")
        .map(|v| v.as_bool().unwrap_or(v.as_u64().unwrap_or(0) != 0))
        .unwrap_or(false)
    {
        return not_resolvable(url, Some("rootz download not allowed"));
    }
    if data.get("passwordProtected").and_then(|v| v.as_bool()) == Some(true) {
        return not_resolvable(url, Some("rootz file is password protected"));
    }

    let file_id = match data.get("fileId").and_then(|v| v.as_str()) {
        Some(f) => f.to_string(),
        None => return not_resolvable(url, Some("rootz api returned no file id")),
    };

    let file_name = data
        .get("fileName")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let size_bytes = num(data.get("fileSize")).or_else(|| num(data.get("size")));

    let mut dl_headers = HashMap::new();
    dl_headers.insert("Referer".to_string(), page_url);

    ResolveResult {
        resolvable: true,
        url: Some(format!(
            "https://www.rootz.so/api/files/proxy-download/{file_id}"
        )),
        file_name,
        size_bytes,
        headers: Some(dl_headers),
        ..Default::default()
    }
}
