use crate::http::{self, FetchOpts};
use crate::sources::ResolveResult;
use base64::Engine;
use once_cell::sync::Lazy;
use regex::Regex;

static HOST_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)(^|\.)mediafire\.com$").unwrap());
static DIRECT_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r#"https://download\d+\.mediafire\.com/[^"'\s<>\\]+"#).unwrap());
static SCRAMBLED_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r#"data-scrambled-url="([^"]+)""#).unwrap());

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

fn unscramble(cap: &str) -> Option<String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(cap.as_bytes())
        .ok()?;
    let s = String::from_utf8(bytes).ok()?;
    if s.starts_with("http") {
        Some(s)
    } else if s.starts_with("//") {
        Some(format!("https:{s}"))
    } else {
        None
    }
}

fn file_name_of(direct: &str) -> Option<String> {
    let u = url::Url::parse(direct).ok()?;
    u.path_segments()?
        .rfind(|s| !s.is_empty())
        .map(|s| s.to_string())
}

pub async fn resolve(url: &str) -> ResolveResult {
    let resp = match http::fetch(url, &FetchOpts::default()).await {
        Ok(r) => r,
        Err(_) => return not_resolvable(url, "mediafire request failed"),
    };
    if !resp.status().is_success() {
        return not_resolvable(
            url,
            &format!("mediafire returned {}", resp.status().as_u16()),
        );
    }
    let text = resp.text().await.unwrap_or_default();

    let direct = DIRECT_RE
        .find(&text)
        .map(|m| m.as_str().to_string())
        .or_else(|| {
            SCRAMBLED_RE
                .captures(&text)
                .and_then(|c| c.get(1))
                .and_then(|m| unscramble(m.as_str()))
        });

    match direct {
        Some(direct) => {
            let file_name = file_name_of(&direct);
            ResolveResult {
                resolvable: true,
                url: Some(direct),
                file_name,
                ..Default::default()
            }
        }
        None => not_resolvable(url, "no mediafire download link"),
    }
}
