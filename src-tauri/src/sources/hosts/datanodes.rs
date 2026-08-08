use crate::http::{self, FetchOpts};
use crate::sources::ResolveResult;
use once_cell::sync::Lazy;
use regex::Regex;
use std::collections::HashMap;
use super::not_resolvable;

static HOST_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)(^|\.)datanodes\.to$").unwrap());

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
            url, Some(&format!("datanodes returned {}", resp.status().as_u16())),
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
