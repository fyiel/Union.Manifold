use super::not_resolvable;
use crate::http::{self, FetchOpts, Jar};
use crate::sources::ResolveResult;
use regex::Regex;
use std::collections::HashMap;
use std::sync::LazyLock;

static HOST_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)(^|\.)datanodes\.to$").unwrap());
static RAND_ATTR_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"rand="([^"]+)""#).unwrap());
static DL_TOKEN_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"dl-token="([^"]+)""#).unwrap());

const BOUNDARY: &str = "----UnionManifoldBoundary7kJ2xQ9vRt3mWp";

pub fn matches(url: &str) -> bool {
    super::host_matches(url, &HOST_RE)
}

fn file_code(url: &str) -> Option<String> {
    let u = url::Url::parse(url).ok()?;
    u.path_segments()?
        .find(|s| !s.is_empty())
        .map(|s| s.to_string())
}

fn multipart(fields: &[(&str, &str)], boundary: &str) -> Vec<u8> {
    let mut body = Vec::new();
    for (k, v) in fields {
        body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
        body.extend_from_slice(
            format!("Content-Disposition: form-data; name=\"{k}\"\r\n\r\n").as_bytes(),
        );
        body.extend_from_slice(v.as_bytes());
        body.extend_from_slice(b"\r\n");
    }
    body.extend_from_slice(format!("--{boundary}--\r\n").as_bytes());
    body
}
fn direct_url(encoded: &str) -> Option<String> {
    let decoded = percent_encoding::percent_decode_str(encoded)
        .decode_utf8()
        .ok()?;
    let parsed = url::Url::parse(&decoded).ok()?;
    matches!(parsed.scheme(), "http" | "https").then(|| parsed.to_string())
}

pub async fn resolve(url: &str) -> ResolveResult {
    resolve_with(url, &HashMap::new()).await
}

pub async fn resolve_with(url: &str, extra: &HashMap<String, String>) -> ResolveResult {
    let code = match file_code(url) {
        Some(c) => c,
        None => return not_resolvable(url, Some("datanodes link has no file code")),
    };

    let host = "datanodes.to";
    let jar = Jar::default();
    for (key, value) in extra {
        if key.eq_ignore_ascii_case("cookie") {
            for pair in value.split(';') {
                if let Some((name, val)) = pair.split_once('=') {
                    jar.set(host, name.trim(), val.trim());
                }
            }
        }
    }
    jar.set(host, "lang", "english");
    let mut page_headers = HashMap::new();
    for (key, value) in extra {
        if key.eq_ignore_ascii_case("user-agent") {
            page_headers.insert(key.clone(), value.clone());
        }
    }
    let page = match http::fetch(
        url,
        &FetchOpts {
            headers: page_headers,
            jar: Some(jar.clone()),
            timeout: Some(std::time::Duration::from_secs(30)),
            ..Default::default()
        },
    )
    .await
    {
        Ok(r) => r.text().await.unwrap_or_default(),
        Err(_) => String::new(),
    };
    let rand = RAND_ATTR_RE
        .captures(&page)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string());
    let dl_token = DL_TOKEN_RE
        .captures(&page)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string());
    if std::env::var("UNION_SOLVER_TRACE").is_ok() {
        eprintln!(
            "DATANODES_DEBUG page_len={} has_rand={} has_dl_token={} header_keys={:?}",
            page.len(),
            rand.is_some(),
            dl_token.is_some(),
            extra.keys().collect::<Vec<_>>()
        );
    }
    let (rand, dl_token) = match (rand, dl_token) {
        (Some(rand), Some(dl_token)) => (rand, dl_token),
        _ => return not_resolvable(url, Some("datanodes page did not expose download tokens")),
    };

    let fields: Vec<(&str, &str)> = vec![
        ("op", "download2"),
        ("id", code.as_str()),
        ("rand", rand.as_str()),
        ("referer", ""),
        ("method_free", ""),
        ("method_premium", ""),
        ("g_captch__a", "1"),
        ("dl_token", dl_token.as_str()),
    ];
    let body = multipart(&fields, BOUNDARY);

    let mut headers = HashMap::new();
    headers.insert(
        "Content-Type".to_string(),
        format!("multipart/form-data; boundary={BOUNDARY}"),
    );
    headers.insert(
        "Referer".to_string(),
        "https://datanodes.to/download".to_string(),
    );
    headers.insert("Origin".to_string(), "https://datanodes.to".to_string());
    for (key, value) in extra {
        if !key.eq_ignore_ascii_case("cookie")
            && !key.eq_ignore_ascii_case("referer")
            && !key.eq_ignore_ascii_case("origin")
        {
            headers.insert(key.clone(), value.clone());
        }
    }

    let opts = FetchOpts {
        method: Some("POST".to_string()),
        headers,
        body: Some(body),
        jar: Some(jar),
        ..Default::default()
    };

    let resp = match http::fetch("https://datanodes.to/download", &opts).await {
        Ok(r) => r,
        Err(_) => return not_resolvable(url, Some("datanodes request failed")),
    };
    if std::env::var("UNION_SOLVER_TRACE").is_ok() {
        let status = resp.status().as_u16();
        let ct = resp
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string();
        let body = resp.text().await.unwrap_or_default();
        eprintln!(
            "DATANODES_DEBUG post status={} ct={} body_head={:?}",
            status,
            ct,
            body.chars().take(200).collect::<String>()
        );
        let direct = serde_json::from_str::<serde_json::Value>(&body)
            .ok()
            .and_then(|j| j.get("url").and_then(|v| v.as_str()).and_then(direct_url));
        return match direct {
            Some(direct) => ResolveResult {
                resolvable: true,
                url: Some(direct),
                ..Default::default()
            },
            None => not_resolvable(url, Some("no datanodes download url")),
        };
    }
    if !resp.status().is_success() {
        return not_resolvable(
            url,
            Some(&format!("datanodes returned {}", resp.status().as_u16())),
        );
    }
    let json = match resp.json::<serde_json::Value>().await {
        Ok(j) => j,
        Err(_) => return not_resolvable(url, Some("datanodes returned no json")),
    };

    let direct = json
        .get("url")
        .and_then(|v| v.as_str())
        .and_then(direct_url);

    match direct {
        Some(direct) => ResolveResult {
            resolvable: true,
            url: Some(direct),
            ..Default::default()
        },
        None => not_resolvable(url, Some("no datanodes download url")),
    }
}

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
    let extra = solved.headers(Some("https://datanodes.to/download"));
    let retried = resolve_with(url, &extra).await;
    retried.resolvable.then_some(retried)
}
