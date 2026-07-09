use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::LazyLock;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::http;
use crate::sources::metacache;
use crate::sources::schema::normalize_title;
use crate::state::AppState;

use super::{emit_progress, fold, load_config, run_archive_install, urlenc, InstallSpec};

const API: &str = "https://api.nexusmods.com";

const WWW_HOST: &str = "www.nexusmods.com";
const GENERATE_URL: &str =
    "https://www.nexusmods.com/Core/Libs/Common/Managers/Downloads?GenerateDownloadUrl";

fn api_key(state: &AppState) -> Result<String, String> {
    state
        .settings
        .get_string("nexusApiKey")
        .map(|k| k.trim().to_string())
        .filter(|k| !k.is_empty())
        .ok_or_else(|| "NexusMods API key not set — add it in Settings".to_string())
}

async fn api_json(key: &str, url: &str) -> Result<Value, String> {
    let mut headers = HashMap::new();
    headers.insert("apikey".to_string(), key.to_string());
    headers.insert("Accept".to_string(), "application/json".to_string());
    let opts = http::FetchOpts { headers, ..Default::default() };
    let resp = http::fetch(url, &opts).await.map_err(|e| format!("nexus api: {e}"))?;
    let status = resp.status();
    match status.as_u16() {
        429 => return Err("NexusMods rate limit reached — wait a bit and try again".to_string()),
        401 | 403 => return Err("NexusMods rejected the API key — check it in Settings".to_string()),
        404 => return Err("not found on NexusMods".to_string()),
        _ if !status.is_success() => return Err(format!("nexus api: HTTP {status}")),
        _ => {}
    }
    resp.json::<Value>().await.map_err(|e| format!("nexus api parse: {e}"))
}

#[derive(Clone, Serialize, Deserialize)]
pub(crate) struct NexusGame {
    pub id: u64,
    pub name: String,
    pub domain: String,
}

static GAMES_CACHE: LazyLock<metacache::WriteBehind<Vec<NexusGame>>> =
    LazyLock::new(|| metacache::WriteBehind::load("nexus-games.json"));

async fn fetch_games(key: &str) -> Result<Vec<NexusGame>, String> {
    let v = api_json(key, &format!("{API}/v1/games.json")).await?;
    let list: Vec<NexusGame> = v
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|g| {
                    Some(NexusGame {
                        id: g.get("id")?.as_u64()?,
                        name: g.get("name")?.as_str()?.to_string(),
                        domain: g.get("domain_name")?.as_str()?.to_string(),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    if list.is_empty() {
        return Err("NexusMods games index came back empty".to_string());
    }
    GAMES_CACHE.insert("all".to_string(), list.clone());
    Ok(list)
}

async fn games_list(key: &str) -> Result<Vec<NexusGame>, String> {
    if let Some(list) = GAMES_CACHE.get("all") {
        if !list.is_empty() {
            return Ok(list);
        }
    }
    fetch_games(key).await
}

static GAMES_REFRESHED: AtomicBool = AtomicBool::new(false);

pub(crate) async fn match_domain(key: &str, title: &str) -> Result<Option<String>, String> {
    let norm = normalize_title(title);
    if norm.is_empty() {
        return Ok(None);
    }
    let matched = |list: &[NexusGame]| {
        list.iter()
            .find(|g| normalize_title(&g.name) == norm)
            .map(|g| g.domain.clone())
    };
    if let Some(domain) = matched(&games_list(key).await?) {
        return Ok(Some(domain));
    }
    if !GAMES_REFRESHED.swap(true, Ordering::AcqRel) {
        if let Ok(fresh) = fetch_games(key).await {
            return Ok(matched(&fresh));
        }
    }
    Ok(None)
}

fn mod_page_url(domain: &str, mod_id: u64) -> String {
    format!("https://www.nexusmods.com/{domain}/mods/{mod_id}")
}

fn browse_mod_from_graphql(n: &Value, fallback_domain: &str) -> Option<Value> {
    let id = n.get("modId")?.as_u64()?;
    let s = |k: &str| n.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string();
    let author = {
        let a = s("author");
        if a.is_empty() {
            n.pointer("/uploader/name")
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .to_string()
        } else {
            a
        }
    };
    let domain = n
        .pointer("/game/domainName")
        .and_then(|d| d.as_str())
        .filter(|d| !d.is_empty())
        .unwrap_or(fallback_domain);
    Some(json!({
        "remoteId": id.to_string(),
        "name": s("name"),
        "summary": s("summary"),
        "author": author,
        "picture": n.get("pictureUrl").and_then(|p| p.as_str()),
        "downloads": n.get("downloads").and_then(|d| d.as_u64()).unwrap_or(0),
        "endorsements": n.get("endorsements").and_then(|e| e.as_u64()).unwrap_or(0),
        "version": s("version"),
        "updatedAt": to_unix_secs(n.get("updatedAt")),
        "sizeBytes": n.get("fileSize").and_then(|v| v.as_u64()),
        "pageUrl": mod_page_url(domain, id),
    }))
}

const SEARCH_PAGE_SIZE: u64 = 20;

const GRAPHQL_URL: &str = "https://api.nexusmods.com/v2/graphql";
const SEARCH_QUERY: &str = "query Mods($count: Int!, $offset: Int!, $filter: ModsFilter, $sort: [ModsSort!]) { mods(count: $count, offset: $offset, filter: $filter, sort: $sort) { totalCount nodes { modId name summary version author downloads endorsements pictureUrl updatedAt game { domainName } uploader { name } } } }";

const BROWSE_COUNT: u64 = 24;
const BROWSE_QUERY: &str = "query($count:Int!,$offset:Int!,$filter:ModsFilter,$sort:[ModsSort!]){mods(count:$count,offset:$offset,filter:$filter,sort:$sort){totalCount nodes{modId name summary version author downloads endorsements fileSize pictureUrl updatedAt createdAt game{domainName} uploader{name}}}}";

fn to_unix_secs(v: Option<&Value>) -> Value {
    match v {
        Some(Value::Number(n)) => json!(n.as_u64()),
        Some(Value::String(s)) => chrono::DateTime::parse_from_rfc3339(s)
            .map(|d| json!(d.timestamp()))
            .unwrap_or(Value::Null),
        _ => Value::Null,
    }
}

fn map_graphql_search(v: &Value, fallback_domain: &str, offset: u64) -> (Vec<Value>, bool) {
    let total = v
        .pointer("/data/mods/totalCount")
        .and_then(|t| t.as_u64())
        .unwrap_or(0);
    let nodes = v
        .pointer("/data/mods/nodes")
        .and_then(|n| n.as_array())
        .cloned()
        .unwrap_or_default();
    let mods: Vec<Value> = nodes
        .iter()
        .filter_map(|n| browse_mod_from_graphql(n, fallback_domain))
        .collect();
    let has_more = !mods.is_empty() && offset + (mods.len() as u64) < total;
    (mods, has_more)
}

fn sort_field(sort: &str) -> &'static str {
    match sort {
        "updated" => "updatedAt",
        "published" => "createdAt",
        "size" => "size",
        "endorsements" => "endorsements",
        "lastComment" => "lastComment",
        _ => "downloads",
    }
}

fn period_days(period: &str) -> Option<i64> {
    match period {
        "7" => Some(7),
        "28" => Some(28),
        _ => None,
    }
}

fn browse_variables(
    domain: &str,
    sort: &str,
    order: &str,
    period: &str,
    offset: u32,
    now_secs: i64,
) -> Value {
    let direction = if order == "asc" { "ASC" } else { "DESC" };
    let mut filter = serde_json::Map::new();
    filter.insert(
        "gameDomainName".to_string(),
        json!({ "value": domain, "op": "EQUALS" }),
    );
    if let Some(days) = period_days(period) {
        let cutoff = now_secs - days * 86_400;
        filter.insert(
            "updatedAt".to_string(),
            json!({ "value": cutoff.to_string(), "op": "GT" }),
        );
    }
    let mut sort_entry = serde_json::Map::new();
    sort_entry.insert(sort_field(sort).to_string(), json!({ "direction": direction }));
    json!({
        "count": BROWSE_COUNT,
        "offset": offset,
        "filter": Value::Object(filter),
        "sort": [Value::Object(sort_entry)],
    })
}

fn first_link(v: &Value) -> Option<String> {
    v.as_array()?
        .iter()
        .find_map(|l| l.get("URI").and_then(|u| u.as_str()))
        .map(str::to_string)
}

async fn fetch_spec(
    key: &str,
    appid: &str,
    domain: &str,
    mod_id: u64,
    file_id: Option<u64>,
) -> Result<InstallSpec, String> {
    let v = api_json(key, &format!("{API}/v1/games/{domain}/mods/{mod_id}.json")).await?;
    let s = |k: &str| v.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string();
    let name = {
        let n = s("name");
        if n.is_empty() {
            format!("Nexus mod {mod_id}")
        } else {
            n
        }
    };
    Ok(InstallSpec {
        appid: appid.to_string(),
        provider: "nexus".to_string(),
        remote_id: mod_id.to_string(),
        file_id,
        name,
        version: s("version"),
        author: {
            let a = s("author");
            if a.is_empty() {
                s("uploaded_by")
            } else {
                a
            }
        },
        picture: v.get("picture_url").and_then(|x| x.as_str()).map(String::from),
        summary: v.get("summary").and_then(|x| x.as_str()).map(String::from),
        page_url: mod_page_url(domain, mod_id),
    })
}

fn session_cookie(state: &AppState) -> Option<String> {
    state
        .settings
        .get_string("nexusSessionCookie")
        .map(|c| c.trim().to_string())
        .filter(|c| !c.is_empty())
}

async fn game_id_for_domain(key: &str, domain: &str) -> Result<Option<u64>, String> {
    let list = games_list(key).await?;
    Ok(list.iter().find(|g| g.domain == domain).map(|g| g.id))
}

fn nexus_session_value(state: &AppState) -> Option<String> {
    let cookie = session_cookie(state)?;
    parse_cookie_string(&cookie).into_iter().find(|(n, _)| n == "nexusmods_session").map(|(_, v)| v)
}

async fn slipgate_resolve(
    state: &AppState,
    cfg: &crate::slipgate::Cfg,
    key: &str,
    domain: &str,
    mod_id: u64,
    file_id: u64,
) -> Result<String, String> {
    let session = nexus_session_value(state)
        .ok_or("set your nexusmods_session cookie under Settings > Mods so Slipgate can log in")?;
    let game_id = game_id_for_domain(key, domain)
        .await?
        .ok_or_else(|| format!("no numeric NexusMods game id for {domain}"))?;
    let params = json!({
        "domain": domain,
        "mod_id": mod_id.to_string(),
        "file_id": file_id.to_string(),
        "game_id": game_id.to_string(),
    });
    let cookies = json!([{ "name": "nexusmods_session", "value": session }]);
    crate::slipgate::resolve(cfg, "nexusmods", "", params, cookies).await.map(|link| link.url)
}

#[tauri::command]
pub async fn slipgate_check(url: String, key: String) -> Result<Value, String> {
    let base = url.trim().trim_end_matches('/').to_string();
    if base.is_empty() {
        return Ok(json!({ "ok": false, "error": "enter a Slipgate URL" }));
    }
    Ok(fold(crate::slipgate::health(&base, key.trim()).await))
}

fn parse_cookie_string(raw: &str) -> Vec<(String, String)> {
    raw.split(|c| c == ';' || c == '\n' || c == '\r')
        .filter_map(|part| {
            let mut part = part.trim();
            for label in ["Cookie:", "cookie:"] {
                if let Some(rest) = part.strip_prefix(label) {
                    part = rest.trim();
                }
            }
            let (name, value) = part.split_once('=')?;
            let (name, value) = (name.trim(), value.trim());
            (!name.is_empty() && !value.is_empty())
                .then(|| (name.to_string(), value.to_string()))
        })
        .collect()
}

fn build_generate_form(file_id: u64, game_id: u64) -> String {
    format!("fid={file_id}&game_id={game_id}")
}

fn parse_generate_response(body: &str) -> Option<String> {
    let v: Value = serde_json::from_str(body).ok()?;
    ["url", "URI", "src", "download_url"]
        .iter()
        .find_map(|k| v.get(*k).and_then(|u| u.as_str()))
        .map(http::decode_entities)
        .filter(|s| s.starts_with("http"))
}

fn is_cloudflare_challenge(status: u16, body: &str) -> bool {
    (status == 403 || status == 503)
        && (body.contains("Just a moment")
            || body.contains("challenge-platform")
            || body.contains("cf-chl"))
}

enum FreeDownload {
    Started,
    NeedsSession(Option<String>),
}

async fn native_free_download(
    app: &AppHandle,
    state: &AppState,
    key: &str,
    appid: &str,
    domain: &str,
    mod_id: u64,
    file_id: u64,
) -> Result<FreeDownload, String> {
    let Some(cookie) = session_cookie(state) else {
        return Ok(FreeDownload::NeedsSession(None));
    };
    let pairs = parse_cookie_string(&cookie);
    if !pairs.iter().any(|(n, _)| n == "nexusmods_session") {
        return Ok(FreeDownload::NeedsSession(Some(
            "the pasted cookie has no nexusmods_session value".to_string(),
        )));
    }
    let game_id = game_id_for_domain(key, domain)
        .await?
        .ok_or_else(|| format!("no numeric NexusMods game id for {domain}"))?;

    let jar = http::Jar::new();
    for (n, v) in &pairs {
        jar.set(WWW_HOST, n, v);
    }
    let session_ua = state
        .settings
        .get_string("nexusUserAgent")
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let with_ua = |mut h: HashMap<String, String>| {
        if let Some(ua) = &session_ua {
            h.insert("User-Agent".to_string(), ua.clone());
        }
        h
    };
    let referer = format!("{}?tab=files", mod_page_url(domain, mod_id));
    let page = http::fetch(
        &referer,
        &http::FetchOpts {
            headers: with_ua(HashMap::from([("Accept".to_string(), "text/html".to_string())])),
            jar: Some(jar.clone()),
            ..Default::default()
        },
    )
    .await
    .map_err(|e| format!("nexus session probe: {e}"))?;
    let page_status = page.status().as_u16();
    let page_body = page.text().await.unwrap_or_default();
    if is_cloudflare_challenge(page_status, &page_body) {
        return Ok(FreeDownload::NeedsSession(Some(
            "Cloudflare blocked the request. A cf_clearance cookie only works from the same browser AND the same User-Agent that made it. Copy a fresh cf_clearance and paste your browser's User-Agent under Settings > Mods too".to_string(),
        )));
    }

    let mut headers = HashMap::new();
    headers.insert(
        "Content-Type".to_string(),
        "application/x-www-form-urlencoded; charset=UTF-8".to_string(),
    );
    headers.insert("X-Requested-With".to_string(), "XMLHttpRequest".to_string());
    headers.insert(
        "Accept".to_string(),
        "application/json, text/javascript, */*; q=0.01".to_string(),
    );
    headers.insert("Referer".to_string(), referer);
    let headers = with_ua(headers);
    let resp = http::fetch(
        GENERATE_URL,
        &http::FetchOpts {
            method: Some("POST".to_string()),
            headers,
            body: Some(build_generate_form(file_id, game_id).into_bytes()),
            jar: Some(jar),
            ..Default::default()
        },
    )
    .await
    .map_err(|e| format!("nexus download generator: {e}"))?;
    let status = resp.status().as_u16();
    let body = resp.text().await.unwrap_or_default();
    if is_cloudflare_challenge(status, &body) {
        return Ok(FreeDownload::NeedsSession(Some(
            "Cloudflare blocked the request. A cf_clearance cookie only works from the same browser AND the same User-Agent that made it. Copy a fresh cf_clearance and paste your browser's User-Agent under Settings > Mods too".to_string(),
        )));
    }
    if status == 401 || status == 403 {
        return Ok(FreeDownload::NeedsSession(Some(
            "NexusMods rejected the session. Copy a fresh nexusmods_session cookie".to_string(),
        )));
    }
    if !(200..300).contains(&status) {
        return Err(format!("nexus download generator: HTTP {status}"));
    }
    let Some(url) = parse_generate_response(&body) else {
        return Ok(FreeDownload::NeedsSession(Some(
            "no download url in the response, the session may have expired".to_string(),
        )));
    };

    let spec = fetch_spec(key, appid, domain, mod_id, Some(file_id)).await?;
    tauri::async_runtime::spawn(run_archive_install(app.clone(), spec, url, HashMap::new()));
    Ok(FreeDownload::Started)
}

#[tauri::command]
pub async fn nexus_validate(state: State<'_, AppState>) -> Result<Value, String> {
    let res = async {
        let key = api_key(&state)?;
        let v = api_json(&key, &format!("{API}/v1/users/validate.json")).await?;
        Ok(json!({ "ok": true, "user": {
            "name": v.get("name").and_then(|x| x.as_str()).unwrap_or(""),
            "premium": v.get("is_premium").and_then(|x| x.as_bool()).unwrap_or(false),
            "profileUrl": v.get("profile_url").and_then(|x| x.as_str()).unwrap_or(""),
        }}))
    }
    .await;
    Ok(fold(res))
}

#[tauri::command]
pub async fn nexus_browse(
    domain: String,
    sort: String,
    order: String,
    period: String,
    offset: u32,
) -> Result<Value, String> {
    let res = async {
        let now = chrono::Utc::now().timestamp();
        let variables = browse_variables(&domain, &sort, &order, &period, offset, now);
        let body = json!({ "query": BROWSE_QUERY, "variables": variables });
        let mut headers = HashMap::new();
        headers.insert("Content-Type".to_string(), "application/json".to_string());
        headers.insert("Accept".to_string(), "application/json".to_string());
        let opts = http::FetchOpts {
            method: Some("POST".to_string()),
            headers,
            body: Some(serde_json::to_vec(&body).map_err(|e| format!("nexus browse encode: {e}"))?),
            ..Default::default()
        };
        let resp = http::fetch(GRAPHQL_URL, &opts)
            .await
            .map_err(|e| format!("nexus browse: {e}"))?;
        let status = resp.status();
        if status.as_u16() == 429 {
            return Err("NexusMods rate limit reached, wait a bit and try again".to_string());
        }
        if !status.is_success() {
            return Err(format!("nexus browse: HTTP {status}"));
        }
        let v: Value = resp.json().await.map_err(|e| format!("nexus browse parse: {e}"))?;
        if v.pointer("/data/mods").is_none() {
            let msg = v
                .pointer("/errors/0/message")
                .and_then(|m| m.as_str())
                .unwrap_or("unexpected response");
            return Err(format!("nexus browse: {msg}"));
        }
        let total = v
            .pointer("/data/mods/totalCount")
            .and_then(|t| t.as_u64())
            .unwrap_or(0);
        let nodes = v
            .pointer("/data/mods/nodes")
            .and_then(|n| n.as_array())
            .cloned()
            .unwrap_or_default();
        let mods: Vec<Value> = nodes
            .iter()
            .filter_map(|n| browse_mod_from_graphql(n, &domain))
            .collect();
        crate::logging::write_line("info", &format!("nexus browse {domain}: {} mapped / {total} total (offset {offset})", mods.len()));
        let has_more = (offset as u64) + (nodes.len() as u64) < total;
        Ok(json!({
            "ok": true,
            "mods": mods,
            "hasMore": has_more,
            "total": total,
            "offset": offset,
        }))
    }
    .await;
    Ok(fold(res))
}

#[tauri::command]
pub async fn nexus_search(domain: String, query: String, page: u32) -> Result<Value, String> {
    let res = async {
        let q = query.trim();
        if q.is_empty() {
            return Ok(json!({ "ok": true, "mods": [], "hasMore": false }));
        }
        let page = page.max(1);
        let offset = (page as u64 - 1) * SEARCH_PAGE_SIZE;
        let body = json!({
            "query": SEARCH_QUERY,
            "variables": {
                "count": SEARCH_PAGE_SIZE,
                "offset": offset,
                "filter": {
                    "name": { "value": q, "op": "WILDCARD" },
                    "gameDomainName": { "value": domain, "op": "EQUALS" }
                },
                "sort": [ { "downloads": { "direction": "DESC" } } ]
            }
        });
        let mut headers = HashMap::new();
        headers.insert("Content-Type".to_string(), "application/json".to_string());
        headers.insert("Accept".to_string(), "application/json".to_string());
        let opts = http::FetchOpts {
            method: Some("POST".to_string()),
            headers,
            body: Some(serde_json::to_vec(&body).map_err(|e| format!("nexus search encode: {e}"))?),
            ..Default::default()
        };
        let resp = http::fetch(GRAPHQL_URL, &opts)
            .await
            .map_err(|e| format!("nexus search: {e}"))?;
        let status = resp.status();
        if status.as_u16() == 429 {
            return Err("NexusMods rate limit reached — wait a bit and try again".to_string());
        }
        if !status.is_success() {
            return Err(format!("nexus search: HTTP {status}"));
        }
        let v: Value = resp.json().await.map_err(|e| format!("nexus search parse: {e}"))?;
        if v.pointer("/data/mods").is_none() {
            let msg = v
                .pointer("/errors/0/message")
                .and_then(|m| m.as_str())
                .unwrap_or("unexpected response");
            return Err(format!("nexus search: {msg}"));
        }
        let (mods, has_more) = map_graphql_search(&v, &domain, offset);
        Ok(json!({ "ok": true, "mods": mods, "hasMore": has_more }))
    }
    .await;
    Ok(fold(res))
}

#[tauri::command]
pub async fn nexus_mod_files(
    state: State<'_, AppState>,
    domain: String,
    mod_id: String,
) -> Result<Value, String> {
    let res = async {
        let mid: u64 = mod_id.parse().map_err(|_| format!("bad mod id {mod_id}"))?;
        let key = api_key(&state)?;
        let v = api_json(&key, &format!("{API}/v1/games/{domain}/mods/{mid}/files.json")).await?;
        let files: Vec<Value> = v
            .get("files")
            .and_then(|f| f.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|f| {
                        let category = match f.get("category_name").and_then(|c| c.as_str())? {
                            "MAIN" => "main",
                            "UPDATE" => "update",
                            "OPTIONAL" => "optional",
                            "MISCELLANEOUS" => "misc",
                            _ => return None,
                        };
                        Some(json!({
                            "fileId": f.get("file_id")?.as_u64()?,
                            "name": f.get("name").and_then(|v| v.as_str()).unwrap_or(""),
                            "version": f.get("version").and_then(|v| v.as_str()).unwrap_or(""),
                            "sizeBytes": f.get("size_in_bytes").and_then(|v| v.as_u64())
                                .or_else(|| f.get("size_kb").and_then(|v| v.as_u64()).map(|k| k * 1024))
                                .unwrap_or(0),
                            "category": category,
                            "uploadedAt": f.get("uploaded_timestamp").and_then(|v| v.as_u64()),
                            "description": f.get("description").and_then(|v| v.as_str()).unwrap_or(""),
                        }))
                    })
                    .collect()
            })
            .unwrap_or_default();
        Ok(json!({ "ok": true, "files": files }))
    }
    .await;
    Ok(fold(res))
}

#[tauri::command]
pub async fn nexus_install(
    app: AppHandle,
    state: State<'_, AppState>,
    appid: String,
    domain: String,
    mod_id: String,
    file_id: u64,
) -> Result<Value, String> {
    let res = async {
        let mid: u64 = mod_id.parse().map_err(|_| format!("bad mod id {mod_id}"))?;
        let key = api_key(&state)?;
        let user = api_json(&key, &format!("{API}/v1/users/validate.json")).await?;
        let premium = user.get("is_premium").and_then(|v| v.as_bool()).unwrap_or(false);
        if !premium {
            if let Some(sg) = crate::slipgate::cfg() {
                match slipgate_resolve(&state, &sg, &key, &domain, mid, file_id).await {
                    Ok(dl_url) => {
                        let spec = fetch_spec(&key, &appid, &domain, mid, Some(file_id)).await?;
                        tauri::async_runtime::spawn(run_archive_install(app.clone(), spec, dl_url, HashMap::new()));
                        return Ok(json!({ "ok": true, "started": true }));
                    }
                    Err(e) => {
                        return Ok(json!({
                            "ok": true,
                            "started": false,
                            "needsNxm": true,
                            "modPageUrl": format!("{}?tab=files", mod_page_url(&domain, mid)),
                            "slipgateError": e,
                        }));
                    }
                }
            }
            return match native_free_download(&app, &state, &key, &appid, &domain, mid, file_id)
                .await?
            {
                FreeDownload::Started => Ok(json!({ "ok": true, "started": true })),
                FreeDownload::NeedsSession(reason) => {
                    let mut out = json!({
                        "ok": true,
                        "started": false,
                        "needsSession": true,
                        "needsNxm": true,
                        "modPageUrl": format!("{}?tab=files", mod_page_url(&domain, mid)),
                    });
                    if let Some(r) = reason {
                        out["sessionError"] = json!(r);
                    }
                    Ok(out)
                }
            };
        }
        let spec = fetch_spec(&key, &appid, &domain, mid, Some(file_id)).await?;
        let links = api_json(
            &key,
            &format!("{API}/v1/games/{domain}/mods/{mid}/files/{file_id}/download_link.json"),
        )
        .await?;
        let url = first_link(&links).ok_or("NexusMods returned no download link")?;
        tauri::async_runtime::spawn(run_archive_install(app.clone(), spec, url, HashMap::new()));
        Ok(json!({ "ok": true, "started": true }))
    }
    .await;
    Ok(fold(res))
}

pub(crate) struct NxmLink {
    pub domain: String,
    pub mod_id: u64,
    pub file_id: u64,
    pub key: String,
    pub expires: String,
}

pub(crate) fn parse_nxm(url: &str) -> Option<NxmLink> {
    let u = url::Url::parse(url).ok()?;
    if u.scheme() != "nxm" {
        return None;
    }
    let domain = u.host_str()?.to_string();
    let segs: Vec<&str> = u.path_segments()?.collect();
    if segs.len() < 4 || segs[0] != "mods" || segs[2] != "files" {
        return None;
    }
    let mod_id = segs[1].parse().ok()?;
    let file_id = segs[3].parse().ok()?;
    let mut key = String::new();
    let mut expires = String::new();
    for (k, v) in u.query_pairs() {
        match k.as_ref() {
            "key" => key = v.to_string(),
            "expires" => expires = v.to_string(),
            _ => {}
        }
    }
    Some(NxmLink { domain, mod_id, file_id, key, expires })
}

fn games_for_domain(paths: &crate::paths::AppPaths, domain: &str) -> Vec<String> {
    let mut out = Vec::new();
    if let Ok(entries) = std::fs::read_dir(paths.mods_dir()) {
        for e in entries.flatten() {
            let Ok(text) = std::fs::read_to_string(e.path().join("mods.json")) else {
                continue;
            };
            let Ok(cfg) = serde_json::from_str::<super::GameMods>(&text) else {
                continue;
            };
            if cfg.nexus_domain.as_deref() == Some(domain) && !cfg.appid.is_empty() {
                out.push(cfg.appid);
            }
        }
    }
    out
}

static RECENT_NXM: LazyLock<parking_lot::Mutex<Vec<(String, Instant)>>> =
    LazyLock::new(|| parking_lot::Mutex::new(Vec::new()));

pub fn handle_nxm(app: &AppHandle, url: &str) {
    {
        let mut recent = RECENT_NXM.lock();
        let now = Instant::now();
        recent.retain(|(_, t)| now.duration_since(*t) < Duration::from_secs(10));
        if recent.iter().any(|(u, _)| u == url) {
            return;
        }
        recent.push((url.to_string(), now));
    }
    let app = app.clone();
    let url = url.to_string();
    tauri::async_runtime::spawn(async move {
        handle_nxm_inner(&app, &url).await;
    });
}

async fn handle_nxm_inner(app: &AppHandle, url: &str) {
    let Some(link) = parse_nxm(url) else {
        crate::logging::write_line("warn", &format!("unparseable nxm url: {url}"));
        return;
    };
    if let Some(main) = app.get_webview_window("main") {
        main.set_focus().ok();
    }
    let state = app.state::<AppState>();
    let matches = games_for_domain(&state.paths, &link.domain);
    if matches.len() != 1 {
        app.emit(
            "mods:nxm-unmatched",
            json!({ "domain": link.domain, "modId": link.mod_id.to_string() }),
        )
        .ok();
        return;
    }
    let appid = matches.into_iter().next().unwrap();
    let mod_id_str = format!("nexus-{}", link.mod_id);

    let res: Result<(), String> = async {
        let key = api_key(&state)?;
        let spec = fetch_spec(&key, &appid, &link.domain, link.mod_id, Some(link.file_id)).await?;
        let dl = api_json(
            &key,
            &format!(
                "{API}/v1/games/{}/mods/{}/files/{}/download_link.json?key={}&expires={}",
                link.domain,
                link.mod_id,
                link.file_id,
                urlenc(&link.key),
                urlenc(&link.expires)
            ),
        )
        .await?;
        let dl_url =
            first_link(&dl).ok_or("no download link — the nxm link may have expired, click Mod Manager Download again")?;
        run_archive_install(app.clone(), spec, dl_url, HashMap::new()).await;
        Ok(())
    }
    .await;
    if let Err(e) = res {
        let name = load_config(&state.paths, &appid)
            .mods
            .iter()
            .find(|m| m.id == mod_id_str)
            .map(|m| m.name.clone())
            .unwrap_or_else(|| format!("Nexus mod {}", link.mod_id));
        emit_progress(app, &appid, &mod_id_str, &name, "error", None, Some(&e));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_cookie_header_and_devtools_forms() {
        let p = parse_cookie_string("Cookie: nexusmods_session=abc; cf_clearance=xyz; __cf_bm=q");
        assert_eq!(p.len(), 3);
        assert_eq!(p[0], ("nexusmods_session".to_string(), "abc".to_string()));
        assert_eq!(p[1], ("cf_clearance".to_string(), "xyz".to_string()));
        let p2 = parse_cookie_string("\n nexusmods_session = def \n\n cf_clearance=123\n");
        assert_eq!(p2, vec![
            ("nexusmods_session".to_string(), "def".to_string()),
            ("cf_clearance".to_string(), "123".to_string()),
        ]);
        assert_eq!(
            parse_cookie_string("nexusmods_session=solo"),
            vec![("nexusmods_session".to_string(), "solo".to_string())]
        );
        assert!(parse_cookie_string("; junk ; =novalue ; noeq").is_empty());
    }

    #[test]
    fn builds_generate_form_body() {
        assert_eq!(build_generate_form(45678, 1704), "fid=45678&game_id=1704");
    }

    #[test]
    fn parses_generate_response_variants() {
        assert_eq!(
            parse_generate_response(r#"{"url":"https://cdn.nexus.com/file.zip?a=1&amp;b=2"}"#),
            Some("https://cdn.nexus.com/file.zip?a=1&b=2".to_string())
        );
        assert_eq!(
            parse_generate_response(r#"{"URI":"https://cdn.nexus.com/x.7z"}"#),
            Some("https://cdn.nexus.com/x.7z".to_string())
        );
        assert_eq!(parse_generate_response(r#"{"error":"nope"}"#), None);
        assert_eq!(parse_generate_response(r#"{"url":"/relative/path"}"#), None);
        assert_eq!(parse_generate_response("<html>Just a moment</html>"), None);
    }

    #[test]
    fn detects_cloudflare_challenge() {
        assert!(is_cloudflare_challenge(403, "<title>Just a moment...</title>"));
        assert!(is_cloudflare_challenge(503, r#"<div id="challenge-platform"></div>"#));
        assert!(!is_cloudflare_challenge(403, r#"{"error":"forbidden"}"#));
        assert!(!is_cloudflare_challenge(200, "Just a moment while we load"));
    }

    #[test]
    fn parses_full_nxm_url() {
        let l = parse_nxm("nxm://cyberpunk2077/mods/3020/files/45678?key=abc123&expires=1710000000&user_id=42")
            .unwrap();
        assert_eq!(l.domain, "cyberpunk2077");
        assert_eq!(l.mod_id, 3020);
        assert_eq!(l.file_id, 45678);
        assert_eq!(l.key, "abc123");
        assert_eq!(l.expires, "1710000000");
    }

    #[test]
    fn parses_nxm_without_query() {
        let l = parse_nxm("nxm://skyrimspecialedition/mods/1/files/2").unwrap();
        assert_eq!(l.domain, "skyrimspecialedition");
        assert_eq!(l.mod_id, 1);
        assert_eq!(l.file_id, 2);
        assert!(l.key.is_empty());
        assert!(l.expires.is_empty());
    }

    #[test]
    fn rejects_malformed_nxm_urls() {
        assert!(parse_nxm("nxm://domain/mods/1").is_none());
        assert!(parse_nxm("nxm://domain/other/1/files/2").is_none());
        assert!(parse_nxm("nxm://domain/mods/abc/files/2").is_none());
        assert!(parse_nxm("https://domain/mods/1/files/2").is_none());
        assert!(parse_nxm("not a url").is_none());
    }

    #[test]
    fn maps_graphql_search_results() {
        let v: Value = serde_json::from_str(
            r#"{
                "data": {
                    "mods": {
                        "totalCount": 319,
                        "nodes": [
                            {
                                "modId": 266,
                                "name": "Unofficial Skyrim Special Edition Patch",
                                "summary": "Fixes bugs",
                                "version": "4.3.5a",
                                "author": "The Unofficial Patch Project Team",
                                "downloads": 26722916,
                                "endorsements": 12345,
                                "pictureUrl": "https://staticdelivery.nexusmods.com/mod.jpg",
                                "updatedAt": "2026-01-02T03:04:05+00:00",
                                "game": { "domainName": "skyrimspecialedition" },
                                "uploader": { "name": "Arthmoor" }
                            },
                            {
                                "modId": 42,
                                "name": "Uploader fallback",
                                "summary": null,
                                "version": null,
                                "author": "",
                                "downloads": 10,
                                "endorsements": null,
                                "pictureUrl": null,
                                "updatedAt": null,
                                "game": { "domainName": "" },
                                "uploader": { "name": "someone" }
                            },
                            { "name": "No modId, skipped" }
                        ]
                    }
                }
            }"#,
        )
        .unwrap();
        let (mods, has_more) = map_graphql_search(&v, "skyrimspecialedition", 0);
        assert_eq!(mods.len(), 2);
        let m = &mods[0];
        assert_eq!(m["remoteId"], "266");
        assert_eq!(m["name"], "Unofficial Skyrim Special Edition Patch");
        assert_eq!(m["author"], "The Unofficial Patch Project Team");
        assert_eq!(m["downloads"], 26722916);
        assert_eq!(m["endorsements"], 12345);
        assert_eq!(m["picture"], "https://staticdelivery.nexusmods.com/mod.jpg");
        assert_eq!(m["version"], "4.3.5a");
        assert_eq!(m["updatedAt"], 1767323045, "ISO-8601 normalized to unix secs");
        assert_eq!(m["pageUrl"], "https://www.nexusmods.com/skyrimspecialedition/mods/266");
        assert_eq!(mods[1]["author"], "someone");
        assert_eq!(mods[1]["updatedAt"], Value::Null);
        assert_eq!(mods[1]["pageUrl"], "https://www.nexusmods.com/skyrimspecialedition/mods/42");
        assert!(has_more, "2 of 319 shown");

        let empty = json!({ "data": { "mods": { "totalCount": 1, "nodes": [] } } });
        let (_, has_more_last) = map_graphql_search(&empty, "d", 40);
        assert!(!has_more_last, "empty page ends pagination");
    }

    #[test]
    fn maps_all_sort_keys_to_v2_fields() {
        assert_eq!(sort_field("downloads"), "downloads");
        assert_eq!(sort_field("updated"), "updatedAt");
        assert_eq!(sort_field("published"), "createdAt");
        assert_eq!(sort_field("size"), "size");
        assert_eq!(sort_field("endorsements"), "endorsements");
        assert_eq!(sort_field("lastComment"), "lastComment");
        assert_eq!(sort_field("bogus"), "downloads");
    }

    #[test]
    fn period_days_only_recognizes_7_and_28() {
        assert_eq!(period_days("7"), Some(7));
        assert_eq!(period_days("28"), Some(28));
        assert_eq!(period_days("all"), None);
        assert_eq!(period_days(""), None);
    }

    #[test]
    fn browse_variables_encode_sort_order_and_paging() {
        let v = browse_variables("skyrimspecialedition", "endorsements", "asc", "all", 24, 1_720_000_000);
        assert_eq!(v["count"], 24);
        assert_eq!(v["offset"], 24);
        assert_eq!(v["filter"]["gameDomainName"]["value"], "skyrimspecialedition");
        assert_eq!(v["filter"]["gameDomainName"]["op"], "EQUALS");
        assert_eq!(v["sort"][0]["endorsements"]["direction"], "ASC");
        assert!(v["filter"].get("updatedAt").is_none());

        let d = browse_variables("cyberpunk2077", "downloads", "desc", "all", 0, 1_720_000_000);
        assert_eq!(d["sort"][0]["downloads"]["direction"], "DESC");
        let p = browse_variables("cyberpunk2077", "published", "", "all", 0, 1_720_000_000);
        assert_eq!(p["sort"][0]["createdAt"]["direction"], "DESC");
    }

    #[test]
    fn browse_query_declares_the_variables_browse_variables_emits() {
        let decl_list = BROWSE_QUERY
            .split_once('(')
            .and_then(|(_, rest)| rest.split_once(')'))
            .map(|(inner, _)| inner)
            .expect("BROWSE_QUERY has a variable declaration list");
        let mut declared: Vec<&str> = decl_list
            .split(',')
            .filter_map(|d| d.trim().strip_prefix('$'))
            .filter_map(|d| d.split(':').next())
            .collect();
        declared.sort_unstable();
        let v = browse_variables("d", "downloads", "desc", "all", 0, 1_720_000_000);
        let mut emitted: Vec<&str> = v.as_object().unwrap().keys().map(String::as_str).collect();
        emitted.sort_unstable();
        assert_eq!(declared, emitted);
    }

    #[test]
    fn browse_variables_period_cutoff_is_unix_seconds_string() {
        let now = 1_720_000_000_i64;
        let v7 = browse_variables("d", "updated", "desc", "7", 0, now);
        assert_eq!(v7["filter"]["updatedAt"]["op"], "GT");
        assert_eq!(v7["filter"]["updatedAt"]["value"], (now - 7 * 86_400).to_string());
        assert!(v7["filter"]["updatedAt"]["value"].is_string());

        let v28 = browse_variables("d", "updated", "desc", "28", 0, now);
        assert_eq!(v28["filter"]["updatedAt"]["value"], (now - 28 * 86_400).to_string());

        let vall = browse_variables("d", "updated", "desc", "all", 0, now);
        assert!(vall["filter"].get("updatedAt").is_none());
    }

    #[test]
    fn iso_updated_at_converts_to_unix_secs() {
        assert_eq!(
            to_unix_secs(Some(&json!("2026-01-02T03:04:05+00:00"))),
            json!(1767323045_i64)
        );
        assert_eq!(to_unix_secs(Some(&json!(1_700_000_000_u64))), json!(1_700_000_000_u64));
        assert_eq!(to_unix_secs(Some(&Value::Null)), Value::Null);
        assert_eq!(to_unix_secs(Some(&json!("not-a-date"))), Value::Null);
    }

    #[test]
    fn browse_mapper_includes_size_bytes() {
        let node = json!({
            "modId": 100,
            "name": "Big Mod",
            "author": "Someone",
            "fileSize": 987654321_u64,
            "updatedAt": "2026-01-02T03:04:05+00:00",
            "game": { "domainName": "stardewvalley" }
        });
        let m = browse_mod_from_graphql(&node, "fallback").unwrap();
        assert_eq!(m["remoteId"], "100");
        assert_eq!(m["sizeBytes"], 987654321_u64);
        assert_eq!(m["pageUrl"], "https://www.nexusmods.com/stardewvalley/mods/100");
        let no_size = json!({ "modId": 7, "name": "x", "game": { "domainName": "" } });
        let ms = browse_mod_from_graphql(&no_size, "dom").unwrap();
        assert_eq!(ms["sizeBytes"], Value::Null);
        assert_eq!(ms["pageUrl"], "https://www.nexusmods.com/dom/mods/7");
    }
}
