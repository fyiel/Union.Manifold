//! Mocha (mocha.my) native resolver.
//!
//! Mocha is an S3/CDN-backed "secure file hosting" service used by AstralGames
//! mirrors. A share page (`mocha.my/share/<token>`) is a client app, but its
//! public API resolves the file server-side: `GET
//! api.mocha.my/api/shares/<token>/download` 307-redirects to a signed,
//! short-lived node url (`node<N>.mocha.my/...?token=&expires=`). We read that
//! `Location` without following it, and lift the file name + size from the
//! sibling `api.mocha.my/api/shares/<token>` metadata endpoint. The signed url
//! expires, so it's ephemeral — re-resolve on a later retry.

use std::sync::LazyLock;
use std::time::Duration;

use regex::Regex;
use serde_json::Value;

use crate::http::{self, FetchOpts};
use crate::sources::ResolveResult;

const API: &str = "https://api.mocha.my/api/shares";

static HOST_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)(^|\.)mocha\.my$").unwrap());

fn host_matches(url: &str) -> bool {
    url::Url::parse(url)
        .ok()
        .and_then(|u| u.host_str().map(|h| HOST_RE.is_match(h)))
        .unwrap_or(false)
}

pub fn matches(url: &str) -> bool {
    host_matches(url) && token_of(url).is_some()
}

fn token_of(url: &str) -> Option<String> {
    let u = url::Url::parse(url).ok()?;
    if !HOST_RE.is_match(u.host_str()?) {
        return None;
    }
    u.path()
        .strip_prefix("/share/")
        .map(|s| s.trim_end_matches('/').to_string())
        .filter(|s| !s.is_empty() && !s.contains('/'))
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
    let Some(token) = token_of(url) else {
        return not_resolvable(url, "mocha: no share token in url");
    };

    // File name + size from the public metadata endpoint (best-effort).
    let (file_name, size_bytes) = match http::get_json::<Value>(&format!("{API}/{token}")).await {
        Ok(v) => {
            let share = v.get("share");
            let name = share
                .and_then(|s| s.get("originalName"))
                .and_then(|v| v.as_str())
                .map(str::to_string);
            let size = share
                .and_then(|s| s.get("fileSize"))
                .and_then(|v| v.as_str())
                .and_then(|s| s.parse::<u64>().ok());
            (name, size)
        }
        Err(_) => (None, None),
    };

    // The download endpoint 307s to a signed node url; read Location, don't follow.
    let resp = match http::fetch(
        &format!("{API}/{token}/download"),
        &FetchOpts {
            manual_redirect: true,
            timeout: Some(Duration::from_secs(30)),
            ..Default::default()
        },
    )
    .await
    {
        Ok(r) => r,
        Err(_) => return not_resolvable(url, "mocha request failed"),
    };

    let direct = resp
        .headers()
        .get("location")
        .and_then(|v| v.to_str().ok())
        .map(str::to_string)
        .filter(|s| s.starts_with("http"));

    match direct {
        Some(direct) => ResolveResult {
            resolvable: true,
            url: Some(direct),
            file_name,
            size_bytes,
            // Signed url carries token+expires; re-resolve on a later retry.
            ephemeral: true,
            ..Default::default()
        },
        None => not_resolvable(
            url,
            &format!("mocha: no redirect (status {})", resp.status().as_u16()),
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_share_urls() {
        assert!(matches("https://mocha.my/share/J7VYY9CyEu9NRnSf2l8TAaRgnAKUBbsI"));
        assert!(!matches("https://mocha.my/dashboard"));
        assert!(!matches("https://notmocha.my.evil.com/share/x"));
        assert!(!matches("https://notmocha.my/share/x"));
    }

    #[test]
    fn extracts_token() {
        assert_eq!(
            token_of("https://mocha.my/share/abc-123_XYZ").as_deref(),
            Some("abc-123_XYZ")
        );
    }
}
