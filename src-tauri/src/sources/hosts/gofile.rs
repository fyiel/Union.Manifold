use crate::http::{self, FetchOpts};
use crate::sources::cache::Cached;
use crate::sources::{ResolveResult, ResolvedFile};
use once_cell::sync::Lazy;
use regex::Regex;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::time::Duration;

static HOST_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)(^|\.)gofile\.io$").unwrap());
static ID_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?:/d/|/)([A-Za-z0-9]{4,})").unwrap());

const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const BROWSER_LANG: &str = "en-US";
const WT_SALT: &str = "9844d94d963d30";
const WT_WINDOW_SECS: u64 = 14400;

static GUEST_TOKEN: Lazy<Cached<String>> =
    Lazy::new(|| Cached::new(Duration::from_secs(12 * 60 * 60)));

pub fn matches(url: &str) -> bool {
    url::Url::parse(url)
        .ok()
        .and_then(|u| u.host_str().map(|s| s.to_string()))
        .map(|h| HOST_RE.is_match(&h))
        .unwrap_or(false)
}

fn content_id(url: &str) -> Option<String> {
    let u = url::Url::parse(url).ok()?;
    if let Some(caps) = ID_RE.captures(u.path()) {
        return Some(caps.get(1)?.as_str().to_string());
    }
    u.query_pairs()
        .find(|(k, _)| k == "c" || k == "id")
        .map(|(_, v)| v.to_string())
        .filter(|v| v.len() >= 4)
}

fn not_resolvable(url: &str, reason: &str) -> ResolveResult {
    ResolveResult {
        resolvable: false,
        open_url: Some(url.to_string()),
        reason: Some(reason.to_string()),
        ..Default::default()
    }
}

fn wt_window() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() / WT_WINDOW_SECS)
        .unwrap_or(0)
}

fn wt_hash(ua: &str, lang: &str, token: &str, window: u64) -> String {
    let input = format!("{ua}::{lang}::{token}::{window}::{WT_SALT}");
    hex::encode(Sha256::digest(input.as_bytes()))
}

fn website_token(token: &str, window: u64) -> String {
    wt_hash(UA, BROWSER_LANG, token, window)
}

async fn request_guest_token() -> Option<String> {
    let opts = FetchOpts {
        method: Some("POST".to_string()),
        headers: HashMap::from([("User-Agent".to_string(), UA.to_string())]),
        ..Default::default()
    };
    let resp = http::fetch("https://api.gofile.io/accounts", &opts)
        .await
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let json = resp.json::<serde_json::Value>().await.ok()?;
    json.get("data")?.get("token")?.as_str().map(str::to_string)
}

async fn guest_token() -> Option<String> {
    GUEST_TOKEN.get_or(request_guest_token).await
}

fn resolved_file(node: &serde_json::Value) -> Option<ResolvedFile> {
    if node.get("type").and_then(|v| v.as_str()) != Some("file") {
        return None;
    }
    let link = node.get("link").and_then(|v| v.as_str())?;
    Some(ResolvedFile {
        url: link.to_string(),
        file_name: node
            .get("name")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        size_bytes: node.get("size").and_then(|v| v.as_u64()),
    })
}

fn collect_files(json: &serde_json::Value) -> Vec<ResolvedFile> {
    let Some(data) = json.get("data") else {
        return Vec::new();
    };
    if let Some(file) = resolved_file(data) {
        return vec![file];
    }
    let Some(children) = data.get("children").and_then(|v| v.as_object()) else {
        return Vec::new();
    };
    let mut files: Vec<ResolvedFile> = children.values().filter_map(resolved_file).collect();
    files.sort_by(|a, b| a.file_name.cmp(&b.file_name));
    files
}

pub async fn resolve(url: &str) -> ResolveResult {
    let id = match content_id(url) {
        Some(id) => id,
        None => return not_resolvable(url, "gofile link has no content id"),
    };

    let token = match guest_token().await {
        Some(t) => t,
        None => return not_resolvable(url, "gofile guest session unavailable, opening the page"),
    };
    let wt = website_token(&token, wt_window());
    let api = format!(
        "https://api.gofile.io/contents/{id}?page=1&pageSize=1000&sortField=createTime&sortDirection=-1"
    );
    let headers = HashMap::from([
        ("Authorization".to_string(), format!("Bearer {token}")),
        ("User-Agent".to_string(), UA.to_string()),
        ("X-Website-Token".to_string(), wt),
        ("X-BL".to_string(), BROWSER_LANG.to_string()),
    ]);
    let opts = FetchOpts {
        headers,
        ..Default::default()
    };

    let json = match http::fetch(&api, &opts).await {
        Ok(resp) if resp.status().is_success() => match resp.json::<serde_json::Value>().await {
            Ok(json) => json,
            Err(_) => return not_resolvable(url, "gofile response unreadable, opening the page"),
        },
        _ => return not_resolvable(url, "gofile did not respond, opening the page"),
    };
    if json.get("status").and_then(|v| v.as_str()) != Some("ok") {
        return not_resolvable(url, "gofile needs a browser session, opening the page");
    }

    let files = collect_files(&json);
    if files.is_empty() {
        return not_resolvable(
            url,
            "gofile link has no downloadable files, opening the page",
        );
    }
    let dl_headers = HashMap::from([
        ("Cookie".to_string(), format!("accountToken={token}")),
        ("User-Agent".to_string(), UA.to_string()),
    ]);

    if files.len() == 1 {
        let file = files.into_iter().next().unwrap();
        return ResolveResult {
            resolvable: true,
            url: Some(file.url),
            file_name: file.file_name,
            size_bytes: file.size_bytes,
            headers: Some(dl_headers),
            ..Default::default()
        };
    }
    ResolveResult {
        resolvable: true,
        files: Some(files),
        headers: Some(dl_headers),
        ..Default::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wt_hash_matches_reference() {
        assert_eq!(
            wt_hash("test-ua", "en-US", "TOKEN123", 100000),
            "6bf97fa87e76a4b9d8b9965bca1483888f57a76bd72a319909e9bb4d0c4ba61f"
        );
    }

    #[test]
    fn content_id_parses_folder_and_file_links() {
        assert_eq!(
            content_id("https://gofile.io/d/dc1V9W").as_deref(),
            Some("dc1V9W")
        );
        assert_eq!(
            content_id("https://gofile.io/dc1V9W").as_deref(),
            Some("dc1V9W")
        );
        assert_eq!(content_id("https://gofile.io/").as_deref(), None);
    }

    #[test]
    fn collect_files_reads_children_sorted() {
        let folder = serde_json::json!({
            "status": "ok",
            "data": { "type": "folder", "children": {
                "a": { "type": "file", "name": "part2.rar", "link": "https://x/2", "size": 20 },
                "b": { "type": "file", "name": "part1.rar", "link": "https://x/1", "size": 10 },
                "c": { "type": "folder" }
            }}
        });
        let files = collect_files(&folder);
        assert_eq!(files.len(), 2);
        assert_eq!(files[0].file_name.as_deref(), Some("part1.rar"));
        assert_eq!(files[1].file_name.as_deref(), Some("part2.rar"));
    }

    #[test]
    fn collect_files_reads_single_file_root() {
        let single = serde_json::json!({
            "status": "ok",
            "data": { "type": "file", "name": "game.zip", "link": "https://x/g", "size": 99 }
        });
        let files = collect_files(&single);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].url, "https://x/g");
        assert_eq!(files[0].size_bytes, Some(99));
    }
}
