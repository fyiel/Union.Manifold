use super::not_resolvable;
use crate::http::{self, FetchOpts, Jar};
use crate::sources::schema::parse_size_to_bytes;
use crate::sources::{ResolveResult, ResolvedFile};
use regex::Regex;
use std::collections::HashMap;
use std::sync::LazyLock;
use std::time::Duration;

static HOSTS_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)(^|\.)(buzzheavier\.com|bzzhr\.(?:to|co))$").unwrap());
static TS_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)^ts\.").unwrap());
static ID_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^/([A-Za-z0-9]{4,})").unwrap());
static TITLE_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)<title>([^<]+)</title>").unwrap());
static SIZE_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)[\d.]+\s*(?:TB|GB|MB|KB)\b").unwrap());
static HXGET_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"hx-get="(/[A-Za-z0-9]+/download\?t=[^"]+)""#).unwrap());
static ALT_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[?&]alt=true").unwrap());

pub fn matches(url: &str) -> bool {
    super::host_matches(url, &HOSTS_RE) && !super::host_matches(url, &TS_RE)
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

fn browser_headers() -> HashMap<String, String> {
    [
        ("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8"),
        ("Accept-Language", "en-US,en;q=0.9"),
        ("sec-ch-ua", "\"Chromium\";v=\"124\", \"Not:A-Brand\";v=\"24\", \"Google Chrome\";v=\"124\""),
        ("sec-ch-ua-mobile", "?0"),
        ("sec-ch-ua-platform", "\"Windows\""),
        ("Sec-Fetch-Dest", "document"),
        ("Sec-Fetch-Mode", "navigate"),
        ("Sec-Fetch-Site", "none"),
        ("Sec-Fetch-User", "?1"),
        ("Upgrade-Insecure-Requests", "1"),
    ]
    .iter()
    .map(|(k, v)| (k.to_string(), v.to_string()))
    .collect()
}

fn absolute_redirect(base: &str, value: &str) -> Option<String> {
    let url = url::Url::parse(base).ok()?.join(value).ok()?;
    matches!(url.scheme(), "http" | "https").then(|| url.to_string())
}

fn replay_headers(page_url: &str, jar: &Jar) -> HashMap<String, String> {
    let mut headers = HashMap::new();
    headers.insert("Referer".to_string(), page_url.to_string());
    headers.insert("User-Agent".to_string(), http::UA.to_string());
    if let Some(host) = url::Url::parse(page_url)
        .ok()
        .and_then(|u| u.host_str().map(str::to_owned))
    {
        if let Some(cookie) = jar.header_for(&host) {
            headers.insert("Cookie".to_string(), cookie);
        }
    }
    headers
}

fn is_challenge_status(status: reqwest::StatusCode) -> bool {
    matches!(
        status,
        reqwest::StatusCode::FORBIDDEN
            | reqwest::StatusCode::TOO_MANY_REQUESTS
            | reqwest::StatusCode::SERVICE_UNAVAILABLE
    )
}

async fn resolve_tokened_path(
    origin: &str,
    path: &str,
    referer: &str,
    jar: &Jar,
) -> Option<String> {
    let mut headers = HashMap::new();
    headers.insert("Referer".to_string(), referer.to_string());
    headers.insert("hx-request".to_string(), "true".to_string());
    headers.insert("hx-current-url".to_string(), referer.to_string());
    let opts = FetchOpts {
        headers,
        jar: Some(jar.clone()),
        manual_redirect: true,
        retries: Some(1),
        ..Default::default()
    };
    let full = format!("{origin}{path}");
    let resp = http::fetch(&full, &opts).await.ok()?;
    let h = resp.headers();
    if let Some(v) = h.get("hx-redirect").and_then(|v| v.to_str().ok()) {
        if !v.is_empty() {
            return absolute_redirect(&full, v);
        }
    }
    if let Some(v) = h.get("location").and_then(|v| v.to_str().ok()) {
        if !v.is_empty() {
            return absolute_redirect(&full, v);
        }
    }
    None
}

pub async fn resolve(url: &str) -> ResolveResult {
    if id_from(url).is_none() {
        return not_resolvable(url, None);
    }
    let mut file_name: Option<String> = None;
    let mut size_bytes: Option<u64> = None;
    let mut paths: Vec<String> = Vec::new();
    let mut challenged = false;
    let mut page_url = url.to_string();
    let jar = Jar::default();

    for attempt in 0..2 {
        if attempt > 0 {
            tokio::time::sleep(Duration::from_millis(500)).await;
        }
        let opts = FetchOpts {
            headers: browser_headers(),
            jar: Some(jar.clone()),
            ..Default::default()
        };
        let resp = match http::fetch(url, &opts).await {
            Ok(r) => r,
            Err(_) => {
                if attempt > 0 {
                    return not_resolvable(url, Some("no buzzheavier download token"));
                }
                continue;
            }
        };
        let status = resp.status();
        if !status.is_success() {
            challenged |= is_challenge_status(status);
            if attempt > 0 {
                let reason = if challenged {
                    "buzzheavier is behind a cloudflare check, opening in browser".to_string()
                } else {
                    format!("buzzheavier page {}", status.as_u16())
                };
                return not_resolvable(url, Some(&reason));
            }
            continue;
        }
        page_url = resp.url().to_string();
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
        challenged = text.contains("Just a moment")
            || text.contains("cf-browser-verification")
            || text.contains("cf_chl_opt");
    }

    if paths.is_empty() {
        let reason = if challenged {
            "buzzheavier is behind a cloudflare check, opening in browser"
        } else {
            "no buzzheavier download token"
        };
        return not_resolvable(url, Some(reason));
    }

    let origin = match origin_of(&page_url) {
        Some(origin) => origin,
        None => return not_resolvable(url, Some("bad buzzheavier page url")),
    };
    let headers = replay_headers(&page_url, &jar);

    if paths.len() == 1 {
        return match resolve_tokened_path(&origin, &paths[0], &page_url, &jar).await {
            Some(direct) => ResolveResult {
                resolvable: true,
                url: Some(direct),
                file_name,
                size_bytes,
                headers: Some(headers),
                ..Default::default()
            },
            None => not_resolvable(url, Some("no buzzheavier redirect")),
        };
    }

    let mut files: Vec<ResolvedFile> = Vec::new();
    for p in &paths {
        if let Some(direct) = resolve_tokened_path(&origin, p, &page_url, &jar).await {
            files.push(ResolvedFile {
                url: direct,
                ..Default::default()
            });
        }
    }

    if files.is_empty() {
        return not_resolvable(url, Some("no buzzheavier redirects"));
    }

    ResolveResult {
        resolvable: true,
        files: Some(files),
        headers: Some(headers),
        ..Default::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_both_short_domains() {
        assert!(matches("https://bzzhr.to/AbCd1234"));
        assert!(matches("https://bzzhr.co/EfGh5678"));
    }

    #[test]
    fn joins_relative_redirects_and_rejects_non_http() {
        assert_eq!(
            absolute_redirect("https://bzzhr.co/AbCd/download?t=1", "/d/file.zip").as_deref(),
            Some("https://bzzhr.co/d/file.zip")
        );
        assert!(
            absolute_redirect("https://bzzhr.co/AbCd/download?t=1", "javascript:alert(1)")
                .is_none()
        );
    }

    #[test]
    fn replays_page_session_material() {
        let jar = Jar::default();
        jar.set("buzzheavier.com", "cf_clearance", "fresh");
        let headers = replay_headers("https://buzzheavier.com/AbCd1234", &jar);
        assert_eq!(
            headers.get("Cookie").map(String::as_str),
            Some("cf_clearance=fresh")
        );
        assert_eq!(
            headers.get("User-Agent").map(String::as_str),
            Some(http::UA)
        );
    }

    #[test]
    fn challenge_statuses_are_classified() {
        assert!(is_challenge_status(reqwest::StatusCode::FORBIDDEN));
        assert!(is_challenge_status(reqwest::StatusCode::TOO_MANY_REQUESTS));
        assert!(is_challenge_status(
            reqwest::StatusCode::SERVICE_UNAVAILABLE
        ));
        assert!(!is_challenge_status(reqwest::StatusCode::NOT_FOUND));
    }
}
