use crate::http::{self, FetchOpts};
use crate::sources::ResolveResult;
use once_cell::sync::Lazy;
use regex::Regex;
use std::collections::HashMap;

static HOST_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)(^|\.)gofile\.io$").unwrap());
static ID_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?:/d/|/)([A-Za-z0-9]{4,})").unwrap());

pub fn matches(url: &str) -> bool {
    url::Url::parse(url)
        .ok()
        .and_then(|u| u.host_str().map(|s| s.to_string()))
        .map(|h| HOST_RE.is_match(&h))
        .unwrap_or(false)
}

fn content_id(url: &str) -> Option<String> {
    let u = url::Url::parse(url).ok()?;
    if let Some(caps) = ID_RE.captures(u.path()) {
        return Some(caps.get(1)?.as_str().to_string());
    }
    u.query_pairs()
        .find(|(k, _)| k == "c" || k == "id")
        .map(|(_, v)| v.to_string())
        .filter(|v| v.len() >= 4)
}

fn not_resolvable(url: &str, reason: &str) -> ResolveResult {
    ResolveResult {
        resolvable: false,
        open_url: Some(url.to_string()),
        reason: Some(reason.to_string()),
        ..Default::default()
    }
}

pub async fn resolve(url: &str) -> ResolveResult {
    let id = match content_id(url) {
        Some(id) => id,
        None => return not_resolvable(url, "gofile link has no content id"),
    };

    if let Some(token) = std::env::var("GOFILE_TOKEN").ok().filter(|t| !t.is_empty()) {
        let api = format!(
            "https://api.gofile.io/contents/{id}?page=1&pageSize=1000&sortField=createTime&sortDirection=-1"
        );
        let mut headers = HashMap::new();
        headers.insert("Authorization".to_string(), format!("Bearer {token}"));
        let opts = FetchOpts {
            headers,
            ..Default::default()
        };
        if let Ok(resp) = http::fetch(&api, &opts).await {
            if resp.status().is_success() {
                if let Ok(json) = resp.json::<serde_json::Value>().await {
                    if let Some(link) = first_file_link(&json) {
                        let mut dl_headers = HashMap::new();
                        dl_headers.insert("Cookie".to_string(), format!("accountToken={token}"));
                        return ResolveResult {
                            resolvable: true,
                            url: Some(link),
                            headers: Some(dl_headers),
                            ..Default::default()
                        };
                    }
                }
            }
        }
    }

    not_resolvable(url, "gofile needs a browser session, opening the page")
}

fn first_file_link(json: &serde_json::Value) -> Option<String> {
    let data = json.get("data")?;
    let children = data.get("children")?.as_object()?;
    for child in children.values() {
        if child.get("type").and_then(|v| v.as_str()) == Some("file") {
            if let Some(link) = child.get("link").and_then(|v| v.as_str()) {
                return Some(link.to_string());
            }
        }
    }
    None
}
