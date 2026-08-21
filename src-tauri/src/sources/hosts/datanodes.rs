use super::not_resolvable;
use crate::http::{self, FetchOpts};
use crate::sources::ResolveResult;
use regex::Regex;
use std::collections::HashMap;
use std::sync::LazyLock;

static HOST_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)(^|\.)datanodes\.to$").unwrap());

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

/// Resolve with extra headers from a solved webview session (Cookie/UA
/// handoff). Solved cookies replace the built-in ones; `lang=english` is
/// kept because the download endpoint depends on it.
pub async fn resolve_with(url: &str, extra: &HashMap<String, String>) -> ResolveResult {
    let code = match file_code(url) {
        Some(c) => c,
        None => return not_resolvable(url, Some("datanodes link has no file code")),
    };

    let fields = [
        ("op", "download2"),
        ("id", code.as_str()),
        ("rand", ""),
        ("referer", "https://datanodes.to/download"),
        ("method_free", "Free Download >>"),
        ("method_premium", ""),
        ("__dl", "1"),
        ("g_captch__a", "1"),
    ];
    let body = multipart(&fields, BOUNDARY);

    let mut headers = HashMap::new();
    headers.insert(
        "Content-Type".to_string(),
        format!("multipart/form-data; boundary={BOUNDARY}"),
    );
    headers.insert("Cookie".to_string(), "lang=english".to_string());
    headers.insert(
        "Referer".to_string(),
        "https://datanodes.to/download".to_string(),
    );
    headers.insert("Origin".to_string(), "https://datanodes.to".to_string());
    for (key, value) in extra {
        if key.eq_ignore_ascii_case("cookie") {
            let merged = match headers.get("Cookie") {
                Some(existing) => format!("{existing}; {value}"),
                None => value.clone(),
            };
            headers.insert("Cookie".to_string(), merged);
        } else if !key.eq_ignore_ascii_case("referer") && !key.eq_ignore_ascii_case("origin") {
            headers.insert(key.clone(), value.clone());
        }
    }

    let opts = FetchOpts {
        method: Some("POST".to_string()),
        headers,
        body: Some(body),
        ..Default::default()
    };

    let resp = match http::fetch("https://datanodes.to/download", &opts).await {
        Ok(r) => r,
        Err(_) => return not_resolvable(url, Some("datanodes request failed")),
    };
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
    let extra = solved.headers(Some("https://datanodes.to/download"));
    let retried = resolve_with(url, &extra).await;
    retried.resolvable.then_some(retried)
}
