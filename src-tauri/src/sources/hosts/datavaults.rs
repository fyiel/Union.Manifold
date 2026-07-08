//! DataVaults (XFileSharing) native resolver.
//!
//! DataVaults' free flow is a two-step form POST against the file page:
//! `op=download1` returns the download2 page (a `rand` token, a short countdown
//! and an XFS positional-digit captcha); `op=download2` submits the token plus
//! the solved captcha and, once the countdown elapses, 302-redirects to the
//! direct CDN link (`d<N>.datavaults.co/d/<token>/<name>`).
//!
//! This MUST run client-side: the direct link carries an `fp` fingerprint bound
//! to the resolving IP, so a link minted on a remote resolver (Slipgate) returns
//! HTML when the app downloads it. There is no Cloudflare gate, so a plain HTTP
//! flow with the cookie jar is enough; we solve the deterministic captcha and
//! read the 302 `Location` with redirects off.

use std::time::Duration;

use std::sync::LazyLock;

use regex::Regex;

use crate::http::{self, FetchOpts, Jar};
use crate::sources::ResolveResult;

static HOST_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)(^|\.)datavaults\.co$").unwrap());
static RAND_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"name="rand"\s+value="([^"]+)""#).unwrap());
static SECONDS_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"id="seconds"[^>]*>\s*(\d+)"#).unwrap());
static CAPTCHA_SPAN_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"padding-left:\s*(\d+)px;[^>]*>\s*(&#\d+;|\d)\s*</span>").unwrap());
static BLOCKED_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)Wrong captcha|Skip countdown|have to wait|expired").unwrap());
static DIRECT_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?i)https?://[^\s"'<>]+?/d/[^\s"'<>]+?\.(?:zip|rar|7z|exe|bin|iso)(?:\?[^\s"'<>]*)?"#)
        .unwrap()
});

const MIN_WAIT: u64 = 3;
const MAX_WAIT: u64 = 60;

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

fn enc(s: &str) -> String {
    percent_encoding::utf8_percent_encode(s, percent_encoding::NON_ALPHANUMERIC).to_string()
}

fn form(pairs: &[(&str, &str)]) -> Vec<u8> {
    pairs
        .iter()
        .map(|(k, v)| format!("{k}={}", enc(v)))
        .collect::<Vec<_>>()
        .join("&")
        .into_bytes()
}

fn post_opts(jar: &Jar, referer: &str, body: Vec<u8>, manual_redirect: bool) -> FetchOpts {
    let mut headers = std::collections::HashMap::new();
    headers.insert("Content-Type".to_string(), "application/x-www-form-urlencoded".to_string());
    headers.insert("Referer".to_string(), referer.to_string());
    FetchOpts {
        method: Some("POST".to_string()),
        headers,
        body: Some(body),
        jar: Some(jar.clone()),
        manual_redirect,
        timeout: Some(Duration::from_secs(45)),
        ..Default::default()
    }
}

fn solve_captcha(html: &str) -> String {
    let mut spans: Vec<(u32, String)> = CAPTCHA_SPAN_RE
        .captures_iter(html)
        .filter_map(|c| Some((c.get(1)?.as_str().parse().ok()?, c.get(2)?.as_str().to_string())))
        .collect();
    spans.sort_by_key(|(px, _)| *px);
    spans.iter().map(|(_, g)| http::decode_entities(g)).collect()
}

fn wait_secs(html: &str) -> u64 {
    let parsed = SECONDS_RE
        .captures(html)
        .and_then(|c| c.get(1)?.as_str().parse::<u64>().ok())
        .unwrap_or(0);
    parsed.clamp(MIN_WAIT, MAX_WAIT)
}

pub async fn resolve(url: &str) -> ResolveResult {
    let parsed = match url::Url::parse(url) {
        Ok(u) => u,
        Err(_) => return not_resolvable(url, "bad datavaults url"),
    };
    let segs: Vec<&str> = parsed.path_segments().map(|s| s.collect()).unwrap_or_default();
    let segs: Vec<&str> = segs.into_iter().filter(|s| !s.is_empty()).collect();
    if segs.len() < 2 {
        return not_resolvable(url, "datavaults link has no file id");
    }
    let file_id = segs[0];
    let fname = *segs.last().unwrap();

    let jar = Jar::new();
    // Seed the XFS session cookies.
    let _ = http::fetch(
        url,
        &FetchOpts { jar: Some(jar.clone()), timeout: Some(Duration::from_secs(30)), ..Default::default() },
    )
    .await;

    // Step 1: op=download1 -> the download2 page (rand + captcha + countdown).
    let dl1 = form(&[
        ("op", "download1"),
        ("usr_login", ""),
        ("id", file_id),
        ("fname", fname),
        ("referer", ""),
        ("method_free", "Free Download"),
    ]);
    let page2 = match http::fetch(url, &post_opts(&jar, url, dl1, false)).await {
        Ok(r) => r.text().await.unwrap_or_default(),
        Err(_) => return not_resolvable(url, "datavaults download1 failed"),
    };
    let rand = match RAND_RE.captures(&page2).and_then(|c| c.get(1)) {
        Some(m) => m.as_str().to_string(),
        None => {
            // Maybe already the final page; otherwise gated.
            if let Some(m) = DIRECT_RE.find(&http::decode_entities(&page2)) {
                return ok(m.as_str(), fname);
            }
            return not_resolvable(url, &reason(&page2));
        }
    };
    let code = solve_captcha(&page2);
    tokio::time::sleep(Duration::from_secs(wait_secs(&page2))).await;

    // Step 2: op=download2 -> 302 to the direct CDN link.
    let dl2 = form(&[
        ("op", "download2"),
        ("id", file_id),
        ("rand", &rand),
        ("referer", url),
        ("method_free", "Free Download"),
        ("method_premium", ""),
        ("code", &code),
    ]);
    let resp = match http::fetch(url, &post_opts(&jar, url, dl2, true)).await {
        Ok(r) => r,
        Err(_) => return not_resolvable(url, "datavaults download2 failed"),
    };
    if resp.status().is_redirection() {
        if let Some(loc) = resp
            .headers()
            .get(reqwest::header::LOCATION)
            .and_then(|v| v.to_str().ok())
            .filter(|s| !s.is_empty())
        {
            return ok(loc, fname);
        }
    }
    let body = resp.text().await.unwrap_or_default();
    match DIRECT_RE.find(&http::decode_entities(&body)) {
        Some(m) => ok(m.as_str(), fname),
        None => not_resolvable(url, &reason(&body)),
    }
}

fn ok(direct: &str, fname: &str) -> ResolveResult {
    ResolveResult {
        resolvable: true,
        url: Some(direct.to_string()),
        file_name: Some(fname.to_string()),
        // The /d/ link is IP/session-fingerprinted; re-resolve on a later retry.
        ephemeral: true,
        ..Default::default()
    }
}

fn reason(html: &str) -> String {
    BLOCKED_RE
        .find(html)
        .map(|m| m.as_str().to_string())
        .unwrap_or_else(|| "datavaults returned no direct link".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_host_and_subdomain() {
        assert!(matches("https://datavaults.co/abc/x.zip"));
        assert!(matches("https://dn165.datavaults.co/d/tok/x.zip"));
        assert!(!matches("https://notdatavaults.co.evil.com/x"));
        assert!(!matches("https://datavaults.net/x"));
    }

    #[test]
    fn solves_positional_captcha() {
        let html = concat!(
            r#"<span style="padding-left:50px;">&#51;</span>"#,
            r#"<span style="padding-left:10px;">&#49;</span>"#,
            r#"<span style="padding-left:70px;">4</span>"#,
            r#"<span style="padding-left:30px;">&#50;</span>"#,
        );
        assert_eq!(solve_captcha(html), "1234");
    }

    #[test]
    fn wait_is_clamped() {
        assert_eq!(wait_secs(r#"<div id="seconds">20</div>"#), 20);
        assert_eq!(wait_secs(r#"<div id="seconds">999</div>"#), MAX_WAIT);
        assert_eq!(wait_secs("no countdown"), MIN_WAIT);
    }
}
