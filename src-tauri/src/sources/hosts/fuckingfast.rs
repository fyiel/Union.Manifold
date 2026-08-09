use crate::http::{self, FetchOpts};
use crate::sources::ResolveResult;
use std::sync::LazyLock;
use regex::Regex;
use std::time::Duration;
use super::not_resolvable;

static HOST_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)(^|\.)fuckingfast\.co$").unwrap());
static LINK_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"window\.open\("(https://fuckingfast\.co/dl/[^"]*)"\)"#).unwrap());

pub fn matches(url: &str) -> bool {
    super::host_matches(url, &HOST_RE)
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
    super::last_segment(direct)
}

pub async fn resolve(url: &str) -> ResolveResult {
    let opts = FetchOpts {
        timeout: Some(Duration::from_secs(30)),
        ..Default::default()
    };
    let resp = match http::fetch(url, &opts).await {
        Ok(r) => r,
        Err(_) => return not_resolvable(url, Some("fuckingfast request failed")),
    };
    if !resp.status().is_success() {
        return not_resolvable(
            url, Some(&format!("fuckingfast returned {}", resp.status().as_u16())),
        );
    }
    let text = resp.text().await.unwrap_or_default();

    if text.contains("File Not Found Or Deleted") {
        return not_resolvable(url, Some("file not found or deleted"));
    }
    if text.to_lowercase().contains("rate limit") {
        return not_resolvable(url, Some("fuckingfast rate limited, opening in browser"));
    }

    let direct = match LINK_RE.captures(&text).and_then(|c| c.get(1)) {
        Some(m) => m.as_str().to_string(),
        None => return not_resolvable(url, Some("no fuckingfast download link")),
    };

    let file_name = file_name_of(&direct);
    ResolveResult {
        resolvable: true,
        url: Some(direct),
        file_name,
        ..Default::default()
    }
}
