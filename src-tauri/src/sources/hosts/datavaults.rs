use std::collections::HashMap;
use std::time::Duration;

use std::sync::LazyLock;

use regex::Regex;

use super::not_resolvable;
use crate::http::{self, FetchOpts, Jar};
use crate::sources::ResolveResult;

static HOST_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)(^|\.)datavaults\.co$").unwrap());
static RAND_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"name="rand"\s+value="([^"]+)""#).unwrap());
static SECONDS_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"id="seconds"[^>]*>\s*(\d+)"#).unwrap());
static CAPTCHA_SPAN_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"padding-left:\s*(\d+)px;[^>]*>\s*(&#\d+;|\d)\s*</span>").unwrap()
});
static BLOCKED_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)Wrong captcha|Skip countdown|have to wait|expired").unwrap());
static DIRECT_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r#"(?i)https?://[^\s"'<>]+?/d/[^\s"'<>]+?\.(?:zip|rar|7z|exe|bin|iso)(?:\?[^\s"'<>]*)?"#,
    )
    .unwrap()
});

const MIN_WAIT: u64 = 3;
const MAX_WAIT: u64 = 60;

pub fn matches(url: &str) -> bool {
    super::host_matches(url, &HOST_RE)
}

fn absolute_redirect(base: &str, value: &str) -> Option<String> {
    let url = url::Url::parse(base).ok()?.join(value).ok()?;
    matches!(url.scheme(), "http" | "https").then(|| url.to_string())
}

fn form(pairs: &[(&str, &str)]) -> Vec<u8> {
    pairs
        .iter()
        .map(|(k, v)| format!("{k}={}", crate::mods::urlenc(v)))
        .collect::<Vec<_>>()
        .join("&")
        .into_bytes()
}

fn post_opts(
    jar: &Jar,
    referer: &str,
    body: Vec<u8>,
    manual_redirect: bool,
    extra: &HashMap<String, String>,
) -> FetchOpts {
    let mut headers = std::collections::HashMap::new();
    headers.insert(
        "Content-Type".to_string(),
        "application/x-www-form-urlencoded".to_string(),
    );
    headers.insert("Referer".to_string(), referer.to_string());
    for (key, value) in extra {
        if !key.eq_ignore_ascii_case("referer") && !key.eq_ignore_ascii_case("content-type") {
            headers.insert(key.clone(), value.clone());
        }
    }
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
        .filter_map(|c| {
            Some((
                c.get(1)?.as_str().parse().ok()?,
                c.get(2)?.as_str().to_string(),
            ))
        })
        .collect();
    spans.sort_by_key(|(px, _)| *px);
    spans
        .iter()
        .map(|(_, g)| http::decode_entities(g))
        .collect()
}

fn wait_secs(html: &str) -> u64 {
    let parsed = SECONDS_RE
        .captures(html)
        .and_then(|c| c.get(1)?.as_str().parse::<u64>().ok())
        .unwrap_or(0);
    parsed.clamp(MIN_WAIT, MAX_WAIT)
}

fn needs_interactive_captcha(html: &str) -> bool {
    html.contains("g-recaptcha") || html.contains("cf-turnstile")
}

pub async fn resolve(url: &str) -> ResolveResult {
    resolve_with(url, &HashMap::new()).await
}

/// Resolve with extra headers from a solved webview session (Cookie/UA
/// handoff). The solved cookies ride along on every request so the gate
/// stays open for the whole timer + captcha flow.
pub async fn resolve_with(url: &str, extra: &HashMap<String, String>) -> ResolveResult {
    let parsed = match url::Url::parse(url) {
        Ok(u) => u,
        Err(_) => return not_resolvable(url, Some("bad datavaults url")),
    };
    let segs: Vec<&str> = parsed
        .path_segments()
        .map(|s| s.collect())
        .unwrap_or_default();
    let segs: Vec<&str> = segs.into_iter().filter(|s| !s.is_empty()).collect();
    if segs.len() < 2 {
        return not_resolvable(url, Some("datavaults link has no file id"));
    }
    let file_id = segs[0];
    let fname = *segs.last().unwrap();

    let jar = Jar::default();
    let _ = http::fetch(
        url,
        &FetchOpts {
            jar: Some(jar.clone()),
            headers: extra
                .iter()
                .filter(|(k, _)| {
                    k.eq_ignore_ascii_case("cookie") || k.eq_ignore_ascii_case("user-agent")
                })
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect(),
            timeout: Some(Duration::from_secs(30)),
            ..Default::default()
        },
    )
    .await;

    let dl1 = form(&[
        ("op", "download1"),
        ("usr_login", ""),
        ("id", file_id),
        ("fname", fname),
        ("referer", ""),
        ("method_free", "Free Download"),
    ]);
    let page2 = match http::fetch(url, &post_opts(&jar, url, dl1, false, extra)).await {
        Ok(r) => r.text().await.unwrap_or_default(),
        Err(_) => return not_resolvable(url, Some("datavaults download1 failed")),
    };
    if needs_interactive_captcha(&page2) {
        return not_resolvable(url, Some("datavaults requires interactive verification"));
    }

    let rand = match RAND_RE.captures(&page2).and_then(|c| c.get(1)) {
        Some(m) => m.as_str().to_string(),
        None => {
            if let Some(m) = DIRECT_RE.find(&http::decode_entities(&page2)) {
                return ok(m.as_str(), fname);
            }
            return not_resolvable(url, Some(&reason(&page2)));
        }
    };
    let code = solve_captcha(&page2);
    tokio::time::sleep(Duration::from_secs(wait_secs(&page2))).await;

    let dl2 = form(&[
        ("op", "download2"),
        ("id", file_id),
        ("rand", &rand),
        ("referer", url),
        ("method_free", "Free Download"),
        ("method_premium", ""),
        ("code", &code),
    ]);
    let resp = match http::fetch(url, &post_opts(&jar, url, dl2, true, extra)).await {
        Ok(r) => r,
        Err(_) => return not_resolvable(url, Some("datavaults download2 failed")),
    };
    if resp.status().is_redirection() {
        if let Some(loc) = resp
            .headers()
            .get(reqwest::header::LOCATION)
            .and_then(|v| v.to_str().ok())
            .filter(|s| !s.is_empty())
        {
            if let Some(direct) = absolute_redirect(url, loc) {
                return ok(&direct, fname);
            }
        }
    }
    let body = resp.text().await.unwrap_or_default();
    match DIRECT_RE.find(&http::decode_entities(&body)) {
        Some(m) => ok(m.as_str(), fname),
        None => not_resolvable(url, Some(&reason(&body))),
    }
}

/// Feed a webview-solver outcome back into the native flow. Returns `Some`
/// only when it produced a downloadable result; otherwise the caller keeps
/// its original failure and continues down the fallback chain.
pub async fn with_solved(url: &str, solved: crate::resolver::Solved) -> Option<ResolveResult> {
    if let Some(direct) = solved.url {
        return Some(ResolveResult {
            resolvable: true,
            url: Some(direct),
            file_name: solved.file_name,
            ephemeral: true,
            ..Default::default()
        });
    }
    let extra = solved.headers(Some(url));
    let retried = resolve_with(url, &extra).await;
    retried.resolvable.then_some(retried)
}

fn ok(direct: &str, fname: &str) -> ResolveResult {
    ResolveResult {
        resolvable: true,
        url: Some(direct.to_string()),
        file_name: Some(fname.to_string()),
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
    fn detects_interactive_captcha() {
        assert!(needs_interactive_captcha(
            r#"<div class="g-recaptcha"></div>"#
        ));
        assert!(needs_interactive_captcha(
            r#"<div class="cf-turnstile"></div>"#
        ));
        assert!(!needs_interactive_captcha(
            r#"<span style="padding-left:10px">1</span>"#
        ));
    }

    #[test]
    fn wait_is_clamped() {
        assert_eq!(wait_secs(r#"<div id="seconds">20</div>"#), 20);
        assert_eq!(wait_secs(r#"<div id="seconds">999</div>"#), MAX_WAIT);
        assert_eq!(wait_secs("no countdown"), MIN_WAIT);
    }

    #[test]
    fn joins_relative_redirects_and_rejects_non_http() {
        assert_eq!(
            absolute_redirect("https://datavaults.co/file/game.zip", "/d/token/game.zip")
                .as_deref(),
            Some("https://datavaults.co/d/token/game.zip")
        );
        assert!(
            absolute_redirect("https://datavaults.co/file/game.zip", "javascript:alert(1)")
                .is_none()
        );
    }
}
