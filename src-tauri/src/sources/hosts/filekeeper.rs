use std::collections::HashMap;
use std::sync::LazyLock;
use std::time::Duration;

use regex::Regex;

use crate::http::{self, FetchOpts, Jar};
use crate::sources::ResolveResult;

static HOST_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)(^|\.)filekeeper\.net$").unwrap());
static CODE_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"data-code="([^"]*)""#).unwrap());
static RAND_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"data-rand="([^"]*)""#).unwrap());
static COUNTDOWN_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"data-countdown="(\d+)""#).unwrap());
static CAPTCHA_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"data-has-captcha="true""#).unwrap());

const MIN_WAIT: u64 = 3;
const MAX_WAIT: u64 = 30;

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

fn form_post(jar: &Jar, referer: &str, pairs: &[(&str, &str)], manual_redirect: bool) -> FetchOpts {
    let mut headers = HashMap::new();
    headers.insert(
        "Content-Type".to_string(),
        "application/x-www-form-urlencoded".to_string(),
    );
    headers.insert("Referer".to_string(), referer.to_string());
    let body = pairs
        .iter()
        .map(|(k, v)| format!("{k}={}", enc(v)))
        .collect::<Vec<_>>()
        .join("&")
        .into_bytes();
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

pub async fn resolve(url: &str) -> ResolveResult {
    let jar = Jar::new();

    let first = match http::fetch(
        url,
        &FetchOpts {
            jar: Some(jar.clone()),
            manual_redirect: true,
            timeout: Some(Duration::from_secs(30)),
            ..Default::default()
        },
    )
    .await
    {
        Ok(r) => r,
        Err(_) => return not_resolvable(url, "filekeeper request failed"),
    };
    let dl_url = first
        .headers()
        .get(reqwest::header::LOCATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|loc| url::Url::parse(url).ok()?.join(loc).ok())
        .map(|u| u.to_string())
        .unwrap_or_else(|| url.to_string());

    let page = match http::fetch(
        &dl_url,
        &FetchOpts {
            jar: Some(jar.clone()),
            headers: HashMap::from([("Referer".to_string(), url.to_string())]),
            timeout: Some(Duration::from_secs(30)),
            ..Default::default()
        },
    )
    .await
    {
        Ok(r) => r.text().await.unwrap_or_default(),
        Err(_) => return not_resolvable(url, "filekeeper download page failed"),
    };
    if CAPTCHA_RE.is_match(&page) {
        return not_resolvable(
            url,
            "filekeeper item requires a captcha \u{2014} browser only",
        );
    }
    let code = match CODE_RE
        .captures(&page)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string())
    {
        Some(c) if !c.is_empty() => c,
        _ => return not_resolvable(url, "filekeeper file code not found"),
    };
    let wait = COUNTDOWN_RE
        .captures(&page)
        .and_then(|c| c.get(1)?.as_str().parse::<u64>().ok())
        .unwrap_or(MIN_WAIT)
        .clamp(MIN_WAIT, MAX_WAIT);

    let _ = http::fetch(
        &dl_url,
        &form_post(
            &jar,
            &dl_url,
            &[
                ("op", "download1"),
                ("id", &code),
                ("method_free", "Free download"),
                ("down_direct", "1"),
            ],
            false,
        ),
    )
    .await;
    let rand = RAND_RE
        .captures(&page)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string())
        .unwrap_or_default();
    tokio::time::sleep(Duration::from_secs(wait)).await;

    let resp = match http::fetch(
        &dl_url,
        &form_post(
            &jar,
            &dl_url,
            &[
                ("op", "download2"),
                ("id", &code),
                ("rand", &rand),
                ("referer", url),
                ("method_free", "Free download"),
                ("down_direct", "1"),
            ],
            true,
        ),
    )
    .await
    {
        Ok(r) => r,
        Err(_) => return not_resolvable(url, "filekeeper download2 failed"),
    };
    if resp.status().is_redirection() {
        if let Some(loc) = resp
            .headers()
            .get(reqwest::header::LOCATION)
            .and_then(|v| v.to_str().ok())
            .filter(|s| s.starts_with("http"))
        {
            let file_name = url
                .rsplit('/')
                .next()
                .filter(|s| !s.is_empty())
                .map(str::to_string);
            return ResolveResult {
                resolvable: true,
                url: Some(loc.to_string()),
                file_name,
                ephemeral: true,
                ..Default::default()
            };
        }
    }
    not_resolvable(url, "filekeeper returned no direct link")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_host() {
        assert!(matches("https://filekeeper.net/5bhrgi7pwnpl/game.zip"));
        assert!(!matches("https://filekeeper.net.evil.com/x"));
        assert!(!matches("https://notfilekeeper.net/x"));
    }

    #[test]
    fn parses_download_page_attrs() {
        let page = r#"<div id="download-countdown" data-countdown="5" data-code="5bhrgi7pwnpl" data-rand="" data-has-captcha="false"></div>"#;
        assert_eq!(
            CODE_RE.captures(page).unwrap().get(1).unwrap().as_str(),
            "5bhrgi7pwnpl"
        );
        assert_eq!(
            COUNTDOWN_RE
                .captures(page)
                .unwrap()
                .get(1)
                .unwrap()
                .as_str(),
            "5"
        );
        assert!(!CAPTCHA_RE.is_match(page));
    }
}
