use crate::http::{self, FetchOpts};
use crate::sources::ResolveResult;
use std::sync::LazyLock;
use regex::Regex;
use serde_json::Value;
use std::collections::HashMap;
use super::not_resolvable;

static HOST_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)(^|\.)rootz\.so$").unwrap());
static ID_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"/d/([A-Za-z0-9_-]+)").unwrap());
static TOKEN_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"\\?"pageToken\\?"\s*:\s*\\?"([^"\\]+)"#).unwrap());

pub fn matches(url: &str) -> bool {
    super::host_matches(url, &HOST_RE)
}

fn id_from(url: &str) -> Option<String> {
    let u = url::Url::parse(url).ok()?;
    let caps = ID_RE.captures(u.path())?;
    Some(caps.get(1)?.as_str().to_string())
}

fn page_token(page: &str) -> Option<String> {
    TOKEN_RE
        .captures(page)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string())
}

fn num(v: Option<&Value>) -> Option<u64> {
    super::num(v)
}

async fn file_data(url: &str) -> Result<(String, Value), String> {
    let id = id_from(url).ok_or_else(|| "rootz link has no file id".to_string())?;
    let page_url = format!("https://www.rootz.so/d/{id}");

    let page = match http::fetch(&page_url, &FetchOpts::default()).await {
        Ok(r) if r.status().is_success() => r.text().await.unwrap_or_default(),
        _ => return Err("rootz page failed".to_string()),
    };

    let token = page_token(&page).ok_or_else(|| "no rootz page token".to_string())?;

    let api = format!("https://www.rootz.so/api/files/download-by-short?shortId={id}");
    let mut headers = HashMap::new();
    headers.insert("X-Page-Token".to_string(), token);
    headers.insert("Referer".to_string(), page_url.clone());
    headers.insert("Accept".to_string(), "application/json".to_string());
    let opts = FetchOpts {
        headers,
        ..Default::default()
    };

    let resp = http::fetch(&api, &opts)
        .await
        .map_err(|_| "rootz api request failed".to_string())?;
    if !resp.status().is_success() {
        return Err(format!("rootz api {}", resp.status().as_u16()));
    }
    let json = resp
        .json::<Value>()
        .await
        .map_err(|_| "rootz api returned no json".to_string())?;
    if json.get("success").and_then(|v| v.as_bool()) != Some(true) {
        return Err("rootz api said no".to_string());
    }
    let data = json
        .get("data")
        .filter(|v| v.is_object())
        .cloned()
        .ok_or_else(|| "rootz api returned no data".to_string())?;
    Ok((page_url, data))
}

pub async fn is_dead(url: &str) -> bool {
    match file_data(url).await {
        Ok((_, data)) => matches!(
            data.get("status").and_then(|v| v.as_str()),
            Some(status) if status != "active"
        ),
        Err(_) => false,
    }
}

pub async fn resolve(url: &str) -> ResolveResult {
    let (page_url, data) = match file_data(url).await {
        Ok(v) => v,
        Err(e) => return not_resolvable(url, Some(&e)),
    };

    if data.get("status").and_then(|v| v.as_str()) != Some("active") {
        return not_resolvable(url, Some("rootz file is not active"));
    }
    if !data
        .get("downloadAllowed")
        .map(|v| v.as_bool().unwrap_or(v.as_u64().unwrap_or(0) != 0))
        .unwrap_or(false)
    {
        return not_resolvable(url, Some("rootz download not allowed"));
    }
    if data.get("passwordProtected").and_then(|v| v.as_bool()) == Some(true) {
        return not_resolvable(url, Some("rootz file is password protected"));
    }

    let file_id = match data.get("fileId").and_then(|v| v.as_str()) {
        Some(f) => f.to_string(),
        None => return not_resolvable(url, Some("rootz api returned no file id")),
    };

    let file_name = data
        .get("fileName")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let size_bytes = num(data.get("fileSize")).or_else(|| num(data.get("size")));

    let mut dl_headers = HashMap::new();
    dl_headers.insert("Referer".to_string(), page_url);

    ResolveResult {
        resolvable: true,
        url: Some(format!(
            "https://www.rootz.so/api/files/proxy-download/{file_id}"
        )),
        file_name,
        size_bytes,
        headers: Some(dl_headers),
        ..Default::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn page_token_from_escaped_rsc_payload() {
        let page = r#"{\"shortId\":\"LRRs8\",\"pageToken\":\"TFJSczg6NTk1NjUxMQ.abc123_-XYZ\"}]"#;
        assert_eq!(
            page_token(page).as_deref(),
            Some("TFJSczg6NTk1NjUxMQ.abc123_-XYZ")
        );
    }

    #[test]
    fn page_token_from_plain_json() {
        let page = r#"{"shortId":"LRRs8","pageToken":"plain.token_1-2"}"#;
        assert_eq!(page_token(page).as_deref(), Some("plain.token_1-2"));
    }

    #[test]
    fn page_token_missing_is_none() {
        assert!(page_token("<html>no token here</html>").is_none());
    }
}
