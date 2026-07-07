// NexusMods v1 REST client (header `apikey`), legacy search endpoint, and the
// nxm:// deep-link install flow for free accounts.

use std::collections::HashMap;
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

// ---------------------------------------------------------------------------
// Games index (/v1/games.json), disk-cached: id + domain per title, used for
// domain auto-detection and the legacy search endpoint's numeric game_id.

#[derive(Clone, Serialize, Deserialize)]
pub(crate) struct NexusGame {
    pub id: u64,
    pub name: String,
    pub domain: String,
}

static GAMES_CACHE: LazyLock<metacache::WriteBehind<Vec<NexusGame>>> =
    LazyLock::new(|| metacache::WriteBehind::load("nexus-games.json"));

async fn games_list(key: &str) -> Result<Vec<NexusGame>, String> {
    if let Some(list) = GAMES_CACHE.get("all") {
        if !list.is_empty() {
            return Ok(list);
        }
    }
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

/// Exact normalized-title match against the games index — same policy as
/// steam::search_app_id: a fuzzy first-pick would persist a wrong domain.
pub(crate) async fn match_domain(key: &str, title: &str) -> Result<Option<String>, String> {
    let norm = normalize_title(title);
    if norm.is_empty() {
        return Ok(None);
    }
    let list = games_list(key).await?;
    Ok(list
        .iter()
        .find(|g| normalize_title(&g.name) == norm)
        .map(|g| g.domain.clone()))
}

// ---------------------------------------------------------------------------
// Mapping

fn mod_page_url(domain: &str, mod_id: u64) -> String {
    format!("https://www.nexusmods.com/{domain}/mods/{mod_id}")
}

fn browse_mod_from_v1(domain: &str, m: &Value) -> Option<Value> {
    let id = m.get("mod_id")?.as_u64()?;
    if !m.get("available").and_then(|v| v.as_bool()).unwrap_or(true) {
        return None;
    }
    let s = |k: &str| m.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string();
    let author = {
        let a = s("author");
        if a.is_empty() {
            s("uploaded_by")
        } else {
            a
        }
    };
    Some(json!({
        "remoteId": id.to_string(),
        "name": s("name"),
        "summary": s("summary"),
        "author": author,
        "picture": m.get("picture_url").and_then(|v| v.as_str()),
        "downloads": m.get("mod_downloads").and_then(|v| v.as_u64()).unwrap_or(0),
        "endorsements": m.get("endorsement_count").and_then(|v| v.as_u64()).unwrap_or(0),
        "version": s("version"),
        "updatedAt": m.get("updated_timestamp").and_then(|v| v.as_u64()),
        "pageUrl": mod_page_url(domain, id),
    }))
}

const SEARCH_PAGE_SIZE: u64 = 20;

// Keyless v2 GraphQL search (search.nexusmods.com is gone). Only search uses
// v2; browse/validate/files/install stay on v1 + apikey.
const GRAPHQL_URL: &str = "https://api.nexusmods.com/v2/graphql";
const SEARCH_QUERY: &str = "query Mods($count: Int!, $offset: Int!, $filter: ModsFilter, $sort: [ModsSort!]) { mods(count: $count, offset: $offset, filter: $filter, sort: $sort) { totalCount nodes { modId name summary version author downloads endorsements pictureUrl updatedAt game { domainName } uploader { name } } } }";

// updatedAt arrives as an ISO-8601 string from v2; the v1 mappers emit unix
// seconds, so normalize to keep BrowseMod.updatedAt one shape.
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
        .filter_map(|n| {
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
                "pageUrl": mod_page_url(domain, id),
            }))
        })
        .collect();
    let has_more = !mods.is_empty() && offset + (mods.len() as u64) < total;
    (mods, has_more)
}

/// download_link.json returns an array of CDN mirrors `{ name, short_name,
/// URI }`; the first entry is Nexus' preferred one.
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

// ---------------------------------------------------------------------------
// Commands

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
    state: State<'_, AppState>,
    domain: String,
    category: String,
) -> Result<Value, String> {
    let res = async {
        if !matches!(category.as_str(), "trending" | "latest_added" | "latest_updated") {
            return Err(format!("unknown browse category {category}"));
        }
        let key = api_key(&state)?;
        let v = api_json(&key, &format!("{API}/v1/games/{domain}/mods/{category}.json")).await?;
        let mods: Vec<Value> = v
            .as_array()
            .map(|arr| arr.iter().filter_map(|m| browse_mod_from_v1(&domain, m)).collect())
            .unwrap_or_default();
        Ok(json!({ "ok": true, "mods": mods, "hasMore": false }))
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
                            _ => return None, // OLD_VERSION / ARCHIVED noise
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
            // Free accounts can't request direct links; the site's
            // "Mod Manager Download" button sends an nxm:// deep link back.
            return Ok(json!({
                "ok": true,
                "started": false,
                "needsNxm": true,
                "modPageUrl": format!("{}?tab=files", mod_page_url(&domain, mid)),
            }));
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

// ---------------------------------------------------------------------------
// nxm:// deep link

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

/// Installed games whose mods.json binds them to this nexus domain.
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

// A single OS deep-link delivery can reach us twice: once via the
// single-instance argv scan and once via the deep-link plugin's forwarded
// on_open_url. Collapse duplicates within a short window.
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
    // Ambiguous or no match: hand it to the frontend to resolve.
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
        // load_config names the mod only if it was installed before; fall back
        // to the numeric id for the toast.
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
        // Empty author falls back to uploader.name; empty domain to the
        // requested one; null updatedAt stays null.
        assert_eq!(mods[1]["author"], "someone");
        assert_eq!(mods[1]["updatedAt"], Value::Null);
        assert_eq!(mods[1]["pageUrl"], "https://www.nexusmods.com/skyrimspecialedition/mods/42");
        assert!(has_more, "2 of 319 shown");

        let empty = json!({ "data": { "mods": { "totalCount": 1, "nodes": [] } } });
        let (_, has_more_last) = map_graphql_search(&empty, "d", 40);
        assert!(!has_more_last, "empty page ends pagination");
    }
}
