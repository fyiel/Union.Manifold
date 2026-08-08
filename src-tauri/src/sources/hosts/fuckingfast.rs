use crate::http::{self, FetchOpts};
use crate::sources::ResolveResult;
use once_cell::sync::Lazy;
use regex::Regex;
use std::time::Duration;

static HOST_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)(^|\.)fuckingfast\.co$").unwrap());
static LINK_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r#"window\.open\("(https://fuckingfast\.co/dl/[^"]*)"\)"#).unwrap());

pub fn matches(url: &str) -> bool {
    url::Url::parse(url)
        .ok()
        .and_then(|u| u.host_str().map(|s| s.to_string()))
        .map(|h| HOST_RE.is_match(&h))
        .unwrap_or(false)
}

fn not_resolvable(url: &str, reason: &str) -> ResolveResult {
    ResolveResult {
        resolvable: false,
        open_url: Some(url.to_string()),
        reason: Some(reason.to_string()),
        ..Default::default()
    }
}

fn file_name_of(direct: &str) -> Option<String> {
    let u = url::Url::parse(direct).ok()?;
    if let Some(frag) = u.fragment().filter(|f| !f.is_empty()) {
        return Some(
            percent_encoding::percent_decode_str(frag)
                .decode_utf8_lossy()
                .to_string(),
        );
    }
    u.path_segments()?
        .rfind(|s| !s.is_empty())
        .map(|s| s.to_string())
}

pub async fn resolve(url: &str) -> ResolveResult {
    let opts = FetchOpts {
        timeout: Some(Duration::from_secs(30)),
        ..Default::default()
    };
    let resp = match http::fetch(url, &opts).await {
        Ok(r) => r,
        Err(_) => return not_resolvable(url, "fuckingfast request failed"),
    };
    if !resp.status().is_success() {
        return not_resolvable(
            url,
            &format!("fuckingfast returned {}", resp.status().as_u16()),
        );
    }
    let text = resp.text().await.unwrap_or_default();

    if text.contains("File Not Found Or Deleted") {
        return not_resolvable(url, "file not found or deleted");
    }
    if text.to_lowercase().contains("rate limit") {
        return not_resolvable(url, "fuckingfast rate limited, opening in browser");
    }

    let direct = match LINK_RE.captures(&text).and_then(|c| c.get(1)) {
        Some(m) => m.as_str().to_string(),
        None => return not_resolvable(url, "no fuckingfast download link"),
    };

    let file_name = file_name_of(&direct);
    ResolveResult {
        resolvable: true,
        url: Some(direct),
        file_name,
        ..Default::default()
    }
}
