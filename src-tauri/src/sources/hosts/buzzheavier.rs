use crate::http::{self, FetchOpts};
use crate::sources::schema::parse_size_to_bytes;
use crate::sources::{ResolveResult, ResolvedFile};
use once_cell::sync::Lazy;
use regex::Regex;
use std::collections::HashMap;
use std::time::Duration;

static HOSTS_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)(^|\.)(buzzheavier\.com|bzzhr\.to)$").unwrap());
static TS_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)^ts\.").unwrap());
static ID_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^/([A-Za-z0-9]{4,})").unwrap());
static TITLE_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)<title>([^<]+)</title>").unwrap());
static SIZE_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)[\d.]+\s*(?:TB|GB|MB|KB)\b").unwrap());
static HXGET_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r#"hx-get="(/[A-Za-z0-9]+/download\?t=[^"]+)""#).unwrap());
static ALT_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"[?&]alt=true").unwrap());

pub fn matches(url: &str) -> bool {
    match url::Url::parse(url)
        .ok()
        .and_then(|u| u.host_str().map(|s| s.to_string()))
    {
        Some(h) => HOSTS_RE.is_match(&h) && !TS_RE.is_match(&h),
        None => false,
    }
}

fn id_from(url: &str) -> Option<String> {
    let u = url::Url::parse(url).ok()?;
    let caps = ID_RE.captures(u.path())?;
    Some(caps.get(1)?.as_str().to_string())
}

fn origin_of(url: &str) -> Option<String> {
    let u = url::Url::parse(url).ok()?;
    let scheme = u.scheme();
    let host = u.host_str()?;
    match u.port() {
        Some(p) => Some(format!("{scheme}://{host}:{p}")),
        None => Some(format!("{scheme}://{host}")),
    }
}

fn not_resolvable(url: &str, reason: Option<String>) -> ResolveResult {
    ResolveResult {
        resolvable: false,
        open_url: Some(url.to_string()),
        reason,
        ..Default::default()
    }
}

async fn resolve_tokened_path(origin: &str, path: &str, referer: &str) -> Option<String> {
    let mut headers = HashMap::new();
    headers.insert("Referer".to_string(), referer.to_string());
    headers.insert("hx-request".to_string(), "true".to_string());
    headers.insert("hx-current-url".to_string(), referer.to_string());
    let opts = FetchOpts {
        headers,
        manual_redirect: true,
        retries: Some(1),
        ..Default::default()
    };
    let full = format!("{origin}{path}");
    let resp = http::fetch(&full, &opts).await.ok()?;
    let h = resp.headers();
    if let Some(v) = h.get("hx-redirect").and_then(|v| v.to_str().ok()) {
        if !v.is_empty() {
            return Some(v.to_string());
        }
    }
    if let Some(v) = h.get("location").and_then(|v| v.to_str().ok()) {
        if !v.is_empty() {
            return Some(v.to_string());
        }
    }
    None
}

pub async fn resolve(url: &str) -> ResolveResult {
    if id_from(url).is_none() {
        return not_resolvable(url, None);
    }
    let origin = match origin_of(url) {
        Some(o) => o,
        None => return not_resolvable(url, None),
    };

    let mut file_name: Option<String> = None;
    let mut size_bytes: Option<u64> = None;
    let mut paths: Vec<String> = Vec::new();

    for attempt in 0..2 {
        if attempt > 0 {
            tokio::time::sleep(Duration::from_millis(500)).await;
        }
        let mut headers = HashMap::new();
        headers.insert("Accept".to_string(), "text/html".to_string());
        let opts = FetchOpts {
            headers,
            ..Default::default()
        };
        let resp = match http::fetch(url, &opts).await {
            Ok(r) => r,
            Err(_) => {
                if attempt > 0 {
                    return not_resolvable(url, Some("no buzzheavier download token".to_string()));
                }
                continue;
            }
        };
        let status = resp.status();
        if !status.is_success() {
            if attempt > 0 {
                return not_resolvable(url, Some(format!("buzzheavier page {}", status.as_u16())));
            }
            continue;
        }
        let text = resp.text().await.unwrap_or_default();

        file_name = TITLE_RE
            .captures(&text)
            .and_then(|c| c.get(1))
            .map(|m| m.as_str().trim().to_string())
            .filter(|s| !s.is_empty());

        let max = SIZE_RE
            .find_iter(&text)
            .map(|m| parse_size_to_bytes(m.as_str()).unwrap_or(0))
            .fold(0u64, |acc, n| acc.max(n));
        size_bytes = if max == 0 { None } else { Some(max) };

        let mut found: Vec<String> = Vec::new();
        for caps in HXGET_RE.captures_iter(&text) {
            let p = caps.get(1).unwrap().as_str().replace("&amp;", "&");
            if !ALT_RE.is_match(&p) && !found.contains(&p) {
                found.push(p);
            }
        }
        paths = found;
        if !paths.is_empty() {
            break;
        }
    }

    if paths.is_empty() {
        return not_resolvable(url, Some("no buzzheavier download token".to_string()));
    }

    let mut headers = HashMap::new();
    headers.insert("Referer".to_string(), url.to_string());

    if paths.len() == 1 {
        return match resolve_tokened_path(&origin, &paths[0], url).await {
            Some(direct) => ResolveResult {
                resolvable: true,
                url: Some(direct),
                file_name,
                size_bytes,
                headers: Some(headers),
                ..Default::default()
            },
            None => not_resolvable(url, Some("no buzzheavier redirect".to_string())),
        };
    }

    let mut files: Vec<ResolvedFile> = Vec::new();
    for p in &paths {
        if let Some(direct) = resolve_tokened_path(&origin, p, url).await {
            files.push(ResolvedFile {
                url: direct,
                ..Default::default()
            });
        }
    }

    if files.is_empty() {
        return not_resolvable(url, Some("no buzzheavier redirects".to_string()));
    }

    ResolveResult {
        resolvable: true,
        files: Some(files),
        headers: Some(headers),
        ..Default::default()
    }
}
