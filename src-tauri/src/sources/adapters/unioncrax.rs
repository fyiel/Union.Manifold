use std::collections::{BTreeSet, HashMap};
use std::sync::Mutex;
use std::time::Duration;

use once_cell::sync::Lazy;
use regex::Regex;
use serde_json::{json, Value};

use crate::http::{self, FetchOpts};
use crate::sources::cache::Cached;
use crate::sources::schema::{dedup_key_for, parse_size_to_bytes, to_epoch_ms, year_from, DownloadOption, SourceGame};
use crate::sources::{Capabilities, QueryParams, ResolveResult, ResolvedFile};

const ID: &str = "unioncrax";
const ORIGIN: &str = "https://union-crax.xyz";

static CATALOG: Lazy<Cached<Vec<Value>>> = Lazy::new(|| Cached::new(Duration::from_secs(60 * 30)));
static STEAM_APPID: Lazy<Mutex<HashMap<String, Option<u64>>>> = Lazy::new(|| Mutex::new(HashMap::new()));
static STORE_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"store\.steampowered\.com/app/(\d+)").unwrap());

fn urlencode(s: &str) -> String {
    percent_encoding::utf8_percent_encode(s, percent_encoding::NON_ALPHANUMERIC).to_string()
}

fn opt(s: String) -> Option<String> {
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}

fn is_truthy(v: Option<&Value>) -> bool {
    match v {
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_f64().map(|f| f != 0.0).unwrap_or(false),
        Some(Value::String(s)) => !s.is_empty(),
        Some(Value::Array(_)) | Some(Value::Object(_)) => true,
        _ => false,
    }
}

fn truthy_string(v: Option<&Value>) -> String {
    match v {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Number(n)) => {
            if n.as_f64() == Some(0.0) {
                String::new()
            } else {
                n.to_string()
            }
        }
        Some(Value::Bool(true)) => "true".to_string(),
        _ => String::new(),
    }
}

fn json_num(v: &Value) -> Option<u64> {
    match v {
        Value::Number(n) => n.as_u64().or_else(|| n.as_f64().map(|f| f as u64)),
        Value::String(s) => s.trim().parse::<f64>().ok().map(|f| f as u64),
        _ => None,
    }
}

fn epoch_from(v: Option<&Value>) -> Option<i64> {
    if !is_truthy(v) {
        return None;
    }
    match v {
        Some(Value::Number(n)) => n.as_i64().or_else(|| n.as_f64().map(|f| f as i64)),
        Some(Value::String(s)) => to_epoch_ms(s),
        _ => None,
    }
}

fn steam_app_id_from_store(store: Option<&Value>) -> Option<u64> {
    let s = store.and_then(|v| v.as_str()).unwrap_or("");
    STORE_RE
        .captures(s)
        .and_then(|c| c.get(1))
        .and_then(|m| m.as_str().parse::<u64>().ok())
}

async fn resolve_steam_app_id(internal_id: &str) -> Option<u64> {
    let key = internal_id.to_string();
    if key.is_empty() {
        return None;
    }
    if let Some(v) = STEAM_APPID.lock().unwrap().get(&key).copied() {
        return v;
    }
    let mut appid = None;
    let url = format!("{ORIGIN}/api/protondb/{}", urlencode(&key));
    let (ok, json) = request_json(&url, "GET", None).await;
    if ok {
        if let Some(j) = json {
            if let Some(sv) = j.get("steamAppId") {
                if !sv.is_null() {
                    if let Some(n) = json_num(sv) {
                        if n > 0 {
                            appid = Some(n);
                        }
                    }
                }
            }
        }
    }
    STEAM_APPID.lock().unwrap().insert(key, appid);
    appid
}

fn coerce_genres(value: Option<&Value>) -> Vec<String> {
    match value {
        Some(Value::Array(arr)) => arr.iter().filter_map(|v| v.as_str().map(String::from)).collect(),
        Some(Value::String(s)) => match serde_json::from_str::<Value>(s) {
            Ok(Value::Array(arr)) => arr.iter().filter_map(|v| v.as_str().map(String::from)).collect(),
            Ok(_) => Vec::new(),
            Err(_) => {
                if s.is_empty() {
                    Vec::new()
                } else {
                    vec![s.clone()]
                }
            }
        },
        _ => Vec::new(),
    }
}

fn normalize(uc: &Value) -> SourceGame {
    let internal_id = truthy_string(uc.get("appid"));

    let steam_app_id = steam_app_id_from_store(uc.get("store"))
        .or_else(|| STEAM_APPID.lock().unwrap().get(&internal_id).copied().flatten());

    let name = uc.get("name").and_then(|v| v.as_str()).unwrap_or("");
    let title = if name.is_empty() { internal_id.clone() } else { name.to_string() };
    let title = title.trim().to_string();

    let image = uc.get("image").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let hero_image = {
        let a = uc.get("hero_image").and_then(|v| v.as_str()).unwrap_or("");
        if !a.is_empty() {
            a.to_string()
        } else {
            uc.get("hero_image_override").and_then(|v| v.as_str()).unwrap_or("").to_string()
        }
    };

    let description = match uc.get("description") {
        Some(Value::String(s)) => s.clone(),
        _ => String::new(),
    };

    let developer = uc.get("developer").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let release_date = uc.get("release_date").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let version = uc.get("version").and_then(|v| v.as_str()).unwrap_or("").to_string();

    let size_text = match uc.get("size") {
        Some(Value::String(s)) => s.clone(),
        _ => String::new(),
    };
    let size_bytes = match uc.get("size") {
        Some(Value::String(s)) => parse_size_to_bytes(s),
        Some(Value::Number(n)) => n.as_u64().or_else(|| n.as_f64().map(|f| f as u64)),
        _ => None,
    };

    let genres: Vec<String> = coerce_genres(uc.get("genres"))
        .into_iter()
        .filter(|g| !g.is_empty())
        .collect();

    let updated_src = if is_truthy(uc.get("update_time")) {
        uc.get("update_time")
    } else if is_truthy(uc.get("edited_time")) {
        uc.get("edited_time")
    } else {
        None
    };

    SourceGame {
        source_id: ID.to_string(),
        source_slug: internal_id.clone(),
        source_url: format!("{ORIGIN}/game/{internal_id}"),
        steam_app_id,
        dedup_key: dedup_key_for(steam_app_id, &title),
        title,
        description: opt(description),
        image: opt(image),
        hero_image: opt(hero_image),
        genres,
        developer: opt(developer),
        release_year: year_from(&release_date),
        release_date: opt(release_date),
        added_at: epoch_from(uc.get("posted_time")),
        updated_at: epoch_from(updated_src),
        popularity: None,
        version: opt(version),
        size_bytes,
        size_text: opt(size_text),
        nsfw: is_truthy(uc.get("nsfw")) || is_truthy(uc.get("hasHv")),
        download_options: vec![DownloadOption {
            label: "UC.Files".to_string(),
            host_type: "ucfiles".to_string(),
            url: Some(internal_id),
            resolvable: true,
            ..Default::default()
        }],
    }
}

async fn request_json(url: &str, method: &str, body: Option<Vec<u8>>) -> (bool, Option<Value>) {
    let mut headers = HashMap::new();
    headers.insert("X-UC-Client".to_string(), "unioncrax-direct".to_string());
    if body.is_some() {
        headers.insert("Content-Type".to_string(), "application/json".to_string());
    }
    let opts = FetchOpts {
        method: Some(method.to_string()),
        headers,
        body,
        ..Default::default()
    };
    match http::fetch(url, &opts).await {
        Ok(resp) => {
            let ok = resp.status().is_success();
            let json = resp.json::<Value>().await.ok();
            (ok, json)
        }
        Err(_) => (false, None),
    }
}

async fn fetch_catalog() -> Vec<Value> {
    CATALOG
        .get_or(|| async {
            let (ok, json) = request_json(&format!("{ORIGIN}/api/games"), "GET", None).await;
            if ok {
                if let Some(Value::Array(arr)) = json {
                    return Some(arr);
                }
            }
            None
        })
        .await
        .unwrap_or_default()
}

pub fn capabilities() -> Capabilities {
    Capabilities {
        search: true,
        catalog: true,
        appid: true,
        bulk_browse: true,
        tags: true,
        release_date: true,
        size: true,
        sort: vec!["latest".to_string(), "updated".to_string(), "title".to_string()],
    }
}

pub async fn query(params: &QueryParams) -> Vec<SourceGame> {
    let catalog = fetch_catalog().await;
    let games: Vec<SourceGame> = catalog.iter().map(normalize).collect();
    let lowered = params.text.as_deref().unwrap_or("").to_lowercase();
    let q = lowered.trim();
    if q.is_empty() {
        return games;
    }
    let terms: Vec<&str> = q.split_whitespace().collect();
    games
        .into_iter()
        .filter(|g| {
            let hay = g.title.to_lowercase();
            terms.iter().all(|t| hay.contains(t))
        })
        .collect()
}

pub async fn search(q: &str, limit: usize) -> Vec<SourceGame> {
    let q = q.trim();
    if q.is_empty() {
        return Vec::new();
    }

    let url = format!(
        "{ORIGIN}/api/games/suggestions?q={}&limit={}&nsfw=true",
        urlencode(q),
        limit
    );
    let (ok, json) = request_json(&url, "GET", None).await;
    if ok {
        if let Some(j) = json {
            let items = j
                .get("items")
                .and_then(|v| v.as_array())
                .or_else(|| j.as_array())
                .or_else(|| j.get("results").and_then(|v| v.as_array()));
            if let Some(items) = items {
                if !items.is_empty() {
                    return items.iter().take(limit).map(normalize).collect();
                }
            }
        }
    }

    let terms: Vec<String> = q.to_lowercase().split_whitespace().map(String::from).collect();
    let catalog = fetch_catalog().await;
    catalog
        .iter()
        .filter(|g| {
            let hay = g.get("name").and_then(|v| v.as_str()).unwrap_or("").to_lowercase();
            terms.iter().all(|t| hay.contains(t))
        })
        .take(limit)
        .map(normalize)
        .collect()
}

pub async fn get_detail(slug: &str) -> Option<SourceGame> {
    let internal_id = slug.to_string();
    let url = format!("{ORIGIN}/api/games/{}", urlencode(&internal_id));
    let (ok, json) = request_json(&url, "GET", None).await;

    let mut uc: Option<Value> = None;
    if ok {
        if let Some(j) = json {
            if is_truthy(j.get("appid")) || is_truthy(j.get("name")) {
                uc = Some(j);
            }
        }
    }

    if uc.is_none() {
        let catalog = fetch_catalog().await;
        uc = catalog.into_iter().find(|g| match g.get("appid") {
            Some(Value::Number(n)) => n.to_string() == internal_id,
            Some(Value::String(s)) => *s == internal_id,
            _ => false,
        });
    }

    let uc = uc?;

    if steam_app_id_from_store(uc.get("store")).is_none() {
        resolve_steam_app_id(&internal_id).await;
    }
    Some(normalize(&uc))
}

pub async fn list_tags() -> Vec<String> {
    let mut set: BTreeSet<String> = BTreeSet::new();
    for uc in fetch_catalog().await.iter() {
        for g in coerce_genres(uc.get("genres")) {
            let t = g.trim().to_string();
            if !t.is_empty() {
                set.insert(t);
            }
        }
    }
    set.into_iter().collect()
}

pub async fn resolve_download(option: &DownloadOption) -> ResolveResult {
    let appid = option.url.clone().unwrap_or_default().trim().to_string();
    if appid.is_empty() {
        return ResolveResult {
            resolvable: false,
            reason: Some("missing appid".to_string()),
            ..Default::default()
        };
    }
    let page_url = format!("{ORIGIN}/game/{appid}");

    let tok_url = format!("{ORIGIN}/api/downloads/{}", urlencode(&appid));
    let (tok_ok, tok_json) = request_json(&tok_url, "POST", Some(b"{}".to_vec())).await;
    let token = tok_json
        .as_ref()
        .and_then(|j| j.get("downloadToken"))
        .and_then(|v| v.as_str())
        .map(String::from);
    if !tok_ok || token.is_none() {
        let reason = tok_json
            .as_ref()
            .and_then(|j| j.get("error"))
            .and_then(|v| v.as_str())
            .map(String::from)
            .unwrap_or_else(|| "no download token".to_string());
        return ResolveResult {
            resolvable: false,
            open_url: Some(page_url),
            reason: Some(reason),
            ..Default::default()
        };
    }
    let token = token.unwrap();

    let link_url = format!(
        "{ORIGIN}/api/downloads/{}?fetchLinks=true&downloadToken={}",
        urlencode(&appid),
        urlencode(&token)
    );
    let (link_ok, link_json) = request_json(&link_url, "GET", None).await;
    let ucfiles: Vec<Value> = link_json
        .as_ref()
        .and_then(|j| j.get("hosts"))
        .and_then(|h| h.get("ucfiles"))
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    if !link_ok || ucfiles.is_empty() {
        return ResolveResult {
            resolvable: false,
            open_url: Some(page_url),
            reason: Some("no UC.Files links".to_string()),
            ..Default::default()
        };
    }

    let mut ordered = ucfiles;
    ordered.sort_by_key(|e| {
        e.get("part")
            .and_then(|v| v.as_i64().or_else(|| v.as_f64().map(|f| f as i64)))
            .unwrap_or(0)
    });

    let files = http::map_limit(ordered, 4, |entry| async move {
        let url = match &entry {
            Value::String(s) => Some(s.clone()),
            _ => entry.get("url").and_then(|v| v.as_str()).map(String::from),
        };
        let url = url?;
        if url.is_empty() {
            return None;
        }
        let body = serde_json::to_vec(&json!({ "downloadUrl": url })).unwrap_or_default();
        let (ok, json) = request_json(&format!("{ORIGIN}/api/ucfiles/resolve"), "POST", Some(body)).await;
        let success = json
            .as_ref()
            .and_then(|j| j.get("success"))
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let data = json.as_ref().and_then(|j| j.get("data"));
        let data_url = data.and_then(|d| d.get("url")).and_then(|v| v.as_str()).map(String::from);
        if !ok || !success || data_url.is_none() {
            return None;
        }
        let data = data.unwrap();
        Some(ResolvedFile {
            url: data_url.unwrap(),
            file_name: data.get("filename").and_then(|v| v.as_str()).map(String::from),
            size_bytes: data.get("size").and_then(json_num).filter(|n| *n != 0),
        })
    })
    .await;

    if files.is_empty() {
        return ResolveResult {
            resolvable: false,
            open_url: Some(page_url),
            reason: Some("UC.Files resolve failed".to_string()),
            ..Default::default()
        };
    }
    if files.len() == 1 {
        let f = files.into_iter().next().unwrap();
        return ResolveResult {
            resolvable: true,
            url: Some(f.url),
            file_name: f.file_name,
            size_bytes: f.size_bytes,
            ..Default::default()
        };
    }
    ResolveResult {
        resolvable: true,
        files: Some(files),
        ..Default::default()
    }
}
