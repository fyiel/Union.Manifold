use crate::sources::ResolveResult;
use once_cell::sync::Lazy;
use regex::Regex;
use std::collections::HashMap;

static HOST_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)(^|\.)dlproxy\.uk$").unwrap());

pub fn matches(url: &str) -> bool {
    url::Url::parse(url)
        .ok()
        .and_then(|u| u.host_str().map(|s| s.to_string()))
        .map(|h| HOST_RE.is_match(&h))
        .unwrap_or(false)
}

pub async fn resolve(url: &str) -> ResolveResult {
    let mut headers = HashMap::new();
    headers.insert("Referer".to_string(), "https://ankergames.net/".to_string());
    ResolveResult {
        resolvable: true,
        url: Some(url.to_string()),
        headers: Some(headers),
        ephemeral: true,
        ..Default::default()
    }
}
