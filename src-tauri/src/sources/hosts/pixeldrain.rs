use crate::http::{self, FetchOpts};
use crate::sources::{ResolveResult, ResolvedFile};
use once_cell::sync::Lazy;
use regex::Regex;
use serde_json::Value;

static ID_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^[A-Za-z0-9_-]{4,40}$").unwrap());
static PATH_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"/(u|l|api/file|api/list)/([A-Za-z0-9_-]+)").unwrap());
static HOST_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)(^|\.)pixeldrain\.com$").unwrap());

pub fn matches(url: &str) -> bool {
    url::Url::parse(url)
        .ok()
        .and_then(|u| u.host_str().map(|s| s.to_string()))
        .map(|h| HOST_RE.is_match(&h))
        .unwrap_or(false)
}

fn parse(url: &str) -> Option<(bool, String)> {
    let u = url::Url::parse(url).ok()?;
    let caps = PATH_RE.captures(u.path())?;
    let seg = caps.get(1)?.as_str();
    let id = caps.get(2)?.as_str().to_string();
    let is_list = seg.contains("list") || seg == "l";
    Some((is_list, id))
}

fn direct_url(id: &str) -> String {
    format!("https://pixeldrain.com/api/file/{id}?download")
}

fn num(v: Option<&Value>) -> Option<u64> {
    let v = v?;
    let n = v
        .as_u64()
        .or_else(|| v.as_f64().map(|f| f as u64))
        .or_else(|| v.as_str().and_then(|s| s.parse::<f64>().ok()).map(|f| f as u64))?;
    if n == 0 {
        None
    } else {
        Some(n)
    }
}

async fn fetch_json(url: &str) -> Option<Value> {
    let resp = http::fetch(url, &FetchOpts::default()).await.ok()?;
    if !resp.status().is_success() {
        return None;
    }
    resp.json::<Value>().await.ok()
}

async fn file_info(id: &str) -> (Option<String>, Option<u64>) {
    let info_url = format!("https://pixeldrain.com/api/file/{id}/info");
    match fetch_json(&info_url).await {
        Some(json) => {
            let name = json
                .get("name")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            (name, num(json.get("size")))
        }
        None => (None, None),
    }
}

pub async fn resolve(url: &str) -> ResolveResult {
    let (is_list, id) = match parse(url) {
        Some((is_list, id)) if ID_RE.is_match(&id) => (is_list, id),
        _ => {
            return ResolveResult {
                resolvable: false,
                open_url: Some(url.to_string()),
                ..Default::default()
            };
        }
    };

    if is_list {
        let list_url = format!("https://pixeldrain.com/api/list/{id}");
        let files: Vec<ResolvedFile> = match fetch_json(&list_url).await {
            Some(json) => json
                .get("files")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|f| {
                            let fid = f.get("id").and_then(|v| v.as_str())?;
                            Some(ResolvedFile {
                                url: direct_url(fid),
                                file_name: f
                                    .get("name")
                                    .and_then(|v| v.as_str())
                                    .map(|s| s.to_string()),
                                size_bytes: num(f.get("size")),
                            })
                        })
                        .collect()
                })
                .unwrap_or_default(),
            None => Vec::new(),
        };

        if files.is_empty() {
            return ResolveResult {
                resolvable: false,
                open_url: Some(url.to_string()),
                ..Default::default()
            };
        }

        return ResolveResult {
            resolvable: true,
            files: Some(files),
            ..Default::default()
        };
    }

    let (file_name, size_bytes) = file_info(&id).await;
    ResolveResult {
        resolvable: true,
        url: Some(direct_url(&id)),
        file_name,
        size_bytes,
        ..Default::default()
    }
}
