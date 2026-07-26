pub mod adapters;
pub mod cache;
pub mod filters;
pub mod hosts;
pub mod metacache;
pub mod parse;
pub mod protondb;
pub mod schema;
pub mod steam;

use std::collections::HashSet;
use std::sync::{LazyLock, Mutex};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, State};

use crate::error::Result;
use crate::state::AppState;
use schema::SourceGame;

const POOL_SIZE: usize = 300;

#[derive(Clone)]
struct CachedPool {
    ordered: Vec<schema::UnifiedGame>,
    facets: filters::Facets,
    total: usize,
    errored: bool,
}

static QUERY_POOL: LazyLock<cache::KeyedCache<std::sync::Arc<CachedPool>>> =
    LazyLock::new(|| cache::KeyedCache::new(std::time::Duration::from_secs(90)));

static CATALOG_POOL: LazyLock<cache::KeyedCache<std::sync::Arc<CachedPool>>> =
    LazyLock::new(|| cache::KeyedCache::new(std::time::Duration::from_secs(600)));

fn pool_for(params: &QueryParams) -> &'static cache::KeyedCache<std::sync::Arc<CachedPool>> {
    let unfiltered = params
        .text
        .as_deref()
        .map(|t| t.trim().is_empty())
        .unwrap_or(true)
        && params.tags.is_empty()
        && params.min_year.is_none()
        && params.max_year.is_none()
        && params.min_size_bytes.is_none()
        && params.max_size_bytes.is_none();
    if unfiltered {
        &CATALOG_POOL
    } else {
        &QUERY_POOL
    }
}

fn pool_sig(params: &QueryParams, ids: &[String]) -> String {
    let mut tags = params.tags.clone();
    tags.sort();
    let mut sources = ids.to_vec();
    sources.sort();
    format!(
        "{}|{}|{}|{:?}|{:?}|{:?}|{:?}|{}|{}|{}|{}",
        params.text.as_deref().unwrap_or(""),
        tags.join(","),
        params.tag_mode.as_deref().unwrap_or(""),
        params.min_year,
        params.max_year,
        params.min_size_bytes,
        params.max_size_bytes,
        params.sort.as_deref().unwrap_or(""),
        params.order.as_deref().unwrap_or(""),
        params.balanced,
        sources.join(","),
    )
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Capabilities {
    pub search: bool,
    pub catalog: bool,
    pub appid: bool,
    pub bulk_browse: bool,
    pub tags: bool,
    pub release_date: bool,
    pub size: bool,
    pub sort: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct QueryParams {
    pub text: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    pub tag_mode: Option<String>,
    pub min_year: Option<i32>,
    pub max_year: Option<i32>,
    pub min_size_bytes: Option<u64>,
    pub max_size_bytes: Option<u64>,
    pub sort: Option<String>,
    pub order: Option<String>,
    #[serde(default)]
    pub offset: usize,
    #[serde(default = "default_limit")]
    pub limit: usize,
    pub sources: Option<Vec<String>>,
    #[serde(default)]
    pub balanced: bool,
}

fn default_limit() -> usize {
    36
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ResolveResult {
    pub resolvable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub files: Option<Vec<ResolvedFile>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub headers: Option<std::collections::HashMap<String, String>>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub ephemeral: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub open_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedFile {
    pub url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size_bytes: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceInfo {
    pub id: String,
    pub name: String,
    pub homepage: String,
    pub capabilities: Capabilities,
    pub enabled: bool,
    pub requires_slipgate: bool,
    pub available: bool,
    pub torrent_only: bool,
    pub hidden_by_torrent_filter: bool,
}

pub struct SourceMeta {
    pub id: &'static str,
    pub name: &'static str,
    pub homepage: &'static str,
    pub requires_slipgate: bool,
    pub torrent_only: bool,
}

pub const SOURCES: &[SourceMeta] = &[
    SourceMeta {
        id: "unioncrax",
        name: "UnionCrax",
        homepage: "https://union-crax.xyz",
        requires_slipgate: false,
        torrent_only: false,
    },
    SourceMeta {
        id: "gamebounty",
        name: "GameBounty",
        homepage: "https://gamebounty.world",
        requires_slipgate: false,
        torrent_only: false,
    },
    SourceMeta {
        id: "steamrip",
        name: "SteamRIP",
        homepage: "https://steamrip.com",
        requires_slipgate: false,
        torrent_only: false,
    },
    SourceMeta {
        id: "zeigames",
        name: "ZeiGames",
        homepage: "https://zeigames.com",
        requires_slipgate: false,
        torrent_only: false,
    },
    SourceMeta {
        id: "onlinefix",
        name: "Online-Fix",
        homepage: "https://online-fix.me",
        requires_slipgate: true,
        torrent_only: false,
    },
    SourceMeta {
        id: "gog",
        name: "GOG",
        homepage: "https://gog-games.to",
        requires_slipgate: true,
        torrent_only: true,
    },
    SourceMeta {
        id: "empress",
        name: "EMPRESS",
        homepage: "https://hydralinks.cloud",
        requires_slipgate: true,
        torrent_only: true,
    },
    SourceMeta {
        id: "kaoskrew",
        name: "KaOsKrew",
        homepage: "https://kaoskrew.org",
        requires_slipgate: true,
        torrent_only: true,
    },
];

fn hidden_by_torrent_filter(source: &SourceMeta) -> bool {
    source.torrent_only || source.id == "onlinefix"
}

pub fn capabilities_for(id: &str) -> Capabilities {
    match id {
        "unioncrax" => adapters::unioncrax::capabilities(),
        "gamebounty" => adapters::gamebounty::capabilities(),
        "steamrip" => adapters::steamrip::capabilities(),
        "zeigames" => adapters::zeigames::capabilities(),
        "onlinefix" => adapters::onlinefix::capabilities(),
        "gog" => adapters::gog::capabilities(),
        "empress" => adapters::empress::capabilities(),
        "kaoskrew" => adapters::kaoskrew::capabilities(),
        _ => Capabilities::default(),
    }
}

async fn adapter_query(id: &str, params: &QueryParams) -> Option<Vec<SourceGame>> {
    match id {
        "unioncrax" => adapters::unioncrax::query(params).await,
        "gamebounty" => adapters::gamebounty::query(params).await,
        "steamrip" => adapters::steamrip::query(params).await,
        "zeigames" => adapters::zeigames::query(params).await,
        "onlinefix" => adapters::onlinefix::query(params).await,
        "gog" => adapters::gog::query(params).await,
        "empress" => adapters::empress::query(params).await,
        "kaoskrew" => adapters::kaoskrew::query(params).await,
        _ => Some(Vec::new()),
    }
}

async fn adapter_search(id: &str, q: &str, limit: usize) -> Vec<SourceGame> {
    match id {
        "unioncrax" => adapters::unioncrax::search(q, limit).await,
        "gamebounty" => adapters::gamebounty::search(q, limit).await,
        "steamrip" => adapters::steamrip::search(q, limit).await,
        "zeigames" => adapters::zeigames::search(q, limit).await,
        "onlinefix" => adapters::onlinefix::search(q, limit).await,
        "gog" => adapters::gog::search(q, limit).await,
        "empress" => adapters::empress::search(q, limit).await,
        "kaoskrew" => adapters::kaoskrew::search(q, limit).await,
        _ => Vec::new(),
    }
}

async fn adapter_detail(id: &str, slug: &str) -> Option<SourceGame> {
    match id {
        "unioncrax" => adapters::unioncrax::get_detail(slug).await,
        "gamebounty" => adapters::gamebounty::get_detail(slug).await,
        "steamrip" => adapters::steamrip::get_detail(slug).await,
        "zeigames" => adapters::zeigames::get_detail(slug).await,
        "onlinefix" => adapters::onlinefix::get_detail(slug).await,
        "gog" => adapters::gog::get_detail(slug).await,
        "empress" => adapters::empress::get_detail(slug).await,
        "kaoskrew" => adapters::kaoskrew::get_detail(slug).await,
        _ => None,
    }
}

async fn adapter_tags(id: &str) -> Vec<String> {
    match id {
        "unioncrax" => adapters::unioncrax::list_tags().await,
        "steamrip" => adapters::steamrip::list_tags().await,
        "zeigames" => adapters::zeigames::list_tags().await,
        _ => Vec::new(),
    }
}

async fn adapter_resolve(id: &str, option: &schema::DownloadOption) -> ResolveResult {
    match id {
        "unioncrax" => adapters::unioncrax::resolve_download(option).await,
        _ => hosts::resolve_url(option).await,
    }
}

pub struct Registry {
    enabled: Mutex<HashSet<String>>,
}

impl Registry {
    pub fn new(disabled: &[String]) -> Self {
        let enabled = SOURCES
            .iter()
            .map(|s| s.id.to_string())
            .filter(|id| !disabled.contains(id))
            .collect();
        Registry {
            enabled: Mutex::new(enabled),
        }
    }

    pub fn is_enabled(&self, id: &str) -> bool {
        self.enabled.lock().unwrap().contains(id)
    }

    pub fn set_enabled(&self, id: &str, on: bool) {
        let mut set = self.enabled.lock().unwrap();
        if on {
            set.insert(id.to_string());
        } else {
            set.remove(id);
        }
    }

    pub fn active_ids(&self, requested: &Option<Vec<String>>) -> Vec<String> {
        let slipgate = crate::slipgate::cfg().is_some();
        let hide_torrent = crate::settings::hide_torrent_sources();
        SOURCES
            .iter()
            .filter(|s| {
                slipgate || !s.requires_slipgate || adapters::hydralinks::is_reachable(s.id)
            })
            .filter(|s| !hide_torrent || !hidden_by_torrent_filter(s))
            .map(|s| s.id.to_string())
            .filter(|id| self.is_enabled(id))
            .filter(|id| requested.as_ref().map(|r| r.contains(id)).unwrap_or(true))
            .collect()
    }

    pub fn list(&self) -> Vec<SourceInfo> {
        let slipgate = crate::slipgate::cfg().is_some();
        let hide_torrent = crate::settings::hide_torrent_sources();
        SOURCES
            .iter()
            .map(|s| SourceInfo {
                id: s.id.to_string(),
                name: s.name.to_string(),
                homepage: s.homepage.to_string(),
                capabilities: capabilities_for(s.id),
                enabled: self.is_enabled(s.id),
                requires_slipgate: s.requires_slipgate,
                available: (slipgate
                    || !s.requires_slipgate
                    || adapters::hydralinks::is_reachable(s.id))
                    && !(hide_torrent && hidden_by_torrent_filter(s)),
                torrent_only: s.torrent_only,
                hidden_by_torrent_filter: hidden_by_torrent_filter(s),
            })
            .collect()
    }
}

async fn run_query(reg: &Registry, params: QueryParams) -> filters::QueryResult {
    let ids = reg.active_ids(&params.sources);
    let sig = pool_sig(&params, &ids);
    let params_fetch = params.clone();
    let ids_fetch = ids.clone();
    let cached = pool_for(&params)
        .get_or(&sig, || async move {
            let mut p = params_fetch;
            p.limit = POOL_SIZE;
            p.offset = 0;
            let per_source =
                crate::http::map_limit(ids_fetch.clone(), ids_fetch.len().max(1), |id| {
                    let p = p.clone();
                    async move { Some(adapter_query(&id, &p).await) }
                })
                .await;
            let mut pool: Vec<SourceGame> = Vec::new();
            let mut errored = false;
            for v in per_source {
                match v {
                    Some(mut games) => pool.append(&mut games),
                    None => errored = true,
                }
            }
            let (ordered, facets, total) = filters::finalize_pool(pool, &p);
            Some(std::sync::Arc::new(CachedPool {
                ordered,
                facets,
                total,
                errored,
            }))
        })
        .await;
    match cached {
        Some(cp) => page_from(&cp, &params, &ids, reg),
        None => filters::QueryResult {
            ok: true,
            games: Vec::new(),
            total: 0,
            facets: filters::Facets {
                tags: Vec::new(),
                years: filters::MinMax {
                    min: None,
                    max: None,
                },
                size: filters::MinMax {
                    min: None,
                    max: None,
                },
            },
            applied: params.clone(),
            capabilities: filters::capability_report(&ids, reg),
            error: None,
            sources_errored: false,
        },
    }
}

fn page_from(
    cp: &CachedPool,
    params: &QueryParams,
    ids: &[String],
    reg: &Registry,
) -> filters::QueryResult {
    let page: Vec<schema::UnifiedGame> = cp
        .ordered
        .iter()
        .skip(params.offset)
        .take(params.limit)
        .cloned()
        .collect();
    filters::QueryResult {
        ok: true,
        games: page,
        total: cp.total,
        facets: cp.facets.clone(),
        applied: params.clone(),
        capabilities: filters::capability_report(ids, reg),
        error: None,
        sources_errored: cp.errored,
    }
}

fn empty_pool() -> std::sync::Arc<CachedPool> {
    std::sync::Arc::new(CachedPool {
        ordered: Vec::new(),
        facets: filters::Facets {
            tags: Vec::new(),
            years: filters::MinMax {
                min: None,
                max: None,
            },
            size: filters::MinMax {
                min: None,
                max: None,
            },
        },
        total: 0,
        errored: false,
    })
}

async fn run_query_stream(
    app: &AppHandle,
    req_id: u64,
    reg: &Registry,
    params: QueryParams,
) -> filters::QueryResult {
    use futures::stream::{FuturesUnordered, StreamExt};
    let ids = reg.active_ids(&params.sources);
    let sig = pool_sig(&params, &ids);
    let pool_cache = pool_for(&params);
    if let Some(cp) = pool_cache.peek(&sig).await {
        return page_from(&cp, &params, &ids, reg);
    }
    let mut p = params.clone();
    p.limit = POOL_SIZE;
    p.offset = 0;
    let mut futs = FuturesUnordered::new();
    for id in ids.clone() {
        let pp = p.clone();
        futs.push(async move {
            let games = adapter_query(&id, &pp).await;
            (id, games)
        });
    }
    let mut pool: Vec<SourceGame> = Vec::new();
    let mut done: Vec<String> = Vec::new();
    let mut errored = false;
    let mut latest: Option<std::sync::Arc<CachedPool>> = None;
    while let Some((id, games)) = futs.next().await {
        done.push(id);
        match games {
            Some(g) if g.is_empty() => continue,
            Some(mut g) => pool.append(&mut g),
            None => errored = true,
        }
        let (ordered, facets, total) = filters::finalize_pool(pool.clone(), &p);
        let page: Vec<schema::UnifiedGame> = ordered
            .iter()
            .skip(params.offset)
            .take(params.limit)
            .cloned()
            .collect();
        app.emit(
            "uc:browse-partial",
            json!({ "reqId": req_id, "games": page, "total": total, "doneSources": done }),
        )
        .ok();
        latest = Some(std::sync::Arc::new(CachedPool {
            ordered,
            facets,
            total,
            errored,
        }));
    }
    let cp = latest.unwrap_or_else(empty_pool);
    let stored = cp.clone();
    pool_cache
        .get_or(&sig, || async move { Some(stored) })
        .await;
    page_from(&cp, &params, &ids, reg)
}

pub async fn warm_catalog(reg: &Registry) {
    let params = QueryParams {
        balanced: true,
        limit: 48,
        ..Default::default()
    };
    let _ = run_query(reg, params).await;
}

pub async fn warm_hydralinks(app: AppHandle) {
    let _ = tokio::join!(
        adapters::onlinefix::prime(),
        adapters::gog::prime(),
        adapters::empress::prime(),
        adapters::kaoskrew::prime(),
    );
    app.emit("uc:sources-updated", json!({})).ok();
}

#[tauri::command]
pub fn sources_list(state: State<'_, AppState>) -> Value {
    json!({ "ok": true, "sources": state.sources.list() })
}

#[tauri::command(async)]
pub fn sources_set_enabled(state: State<'_, AppState>, id: String, enabled: bool) -> Value {
    state.sources.set_enabled(&id, enabled);
    let disabled: Vec<String> = SOURCES
        .iter()
        .map(|s| s.id.to_string())
        .filter(|id| !state.sources.is_enabled(id))
        .collect();
    state.settings.set("disabledSources", json!(disabled));
    json!({ "ok": true })
}

#[tauri::command]
pub async fn sources_query(
    app: AppHandle,
    state: State<'_, AppState>,
    params: QueryParams,
    req_id: Option<u64>,
) -> Result<filters::QueryResult> {
    match req_id {
        Some(rid) if params.offset == 0 => {
            Ok(run_query_stream(&app, rid, &state.sources, params).await)
        }
        _ => Ok(run_query(&state.sources, params).await),
    }
}

#[tauri::command]
pub async fn sources_search(
    state: State<'_, AppState>,
    query: String,
    limit: Option<usize>,
) -> Result<Value> {
    let limit = limit.unwrap_or(40);
    let ids = state.sources.active_ids(&None);
    let mut pool = Vec::new();
    let results = crate::http::map_limit(ids, 4, |id| {
        let q = query.clone();
        async move { Some(adapter_search(&id, &q, limit).await) }
    })
    .await;
    for mut v in results {
        pool.append(&mut v);
    }
    let games = schema::merge_games(pool);
    Ok(json!({ "ok": true, "games": games }))
}

#[tauri::command]
pub async fn sources_catalog(
    state: State<'_, AppState>,
    offset: Option<usize>,
    limit: Option<usize>,
) -> Result<Value> {
    let params = QueryParams {
        offset: offset.unwrap_or(0),
        limit: limit.unwrap_or(36),
        balanced: true,
        ..Default::default()
    };
    let res = run_query(&state.sources, params).await;
    Ok(json!({ "ok": true, "games": res.games }))
}

#[tauri::command]
pub async fn sources_detail(_state: State<'_, AppState>, sources: Vec<Value>) -> Result<Value> {
    let mut records: Vec<SourceGame> = Vec::new();
    for stub in &sources {
        let sid = stub.get("sourceId").and_then(|v| v.as_str()).unwrap_or("");
        let slug = stub
            .get("sourceSlug")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if let Some(g) = adapter_detail(sid, slug).await {
            records.push(g);
        }
    }
    if records.is_empty() {
        return Ok(json!({ "ok": true, "game": Value::Null }));
    }
    let mut merged = schema::merge_games(records);
    let mut game = merged.remove(0);
    steam::enrich(&mut game).await;
    game.fully_resolved = true;
    Ok(json!({ "ok": true, "game": game }))
}

#[tauri::command]
pub async fn sources_resolve(
    _state: State<'_, AppState>,
    source_id: String,
    option: schema::DownloadOption,
) -> Result<Value> {
    let result = adapter_resolve(&source_id, &option).await;
    Ok(json!({ "ok": true, "result": result }))
}

#[tauri::command]
pub async fn sources_steam_art(appid: u64, name: Option<String>) -> Result<Value> {
    let art = steam::steam_art(appid, name.as_deref()).await;
    Ok(json!({ "ok": true, "art": art }))
}

#[tauri::command]
pub async fn sources_steam_meta(appid: u64) -> Result<Value> {
    Ok(json!({ "ok": true, "meta": steam::steam_meta(appid).await }))
}

#[tauri::command]
pub async fn sources_protondb(appid: u64) -> Result<Value> {
    Ok(json!({ "ok": true, "data": protondb::summary(appid).await }))
}

#[tauri::command]
pub async fn sources_tags(state: State<'_, AppState>) -> Result<Value> {
    let ids = state.sources.active_ids(&None);
    let mut by_source = serde_json::Map::new();
    let mut all: HashSet<String> = HashSet::new();
    for id in ids {
        let tags = adapter_tags(&id).await;
        for t in &tags {
            all.insert(t.clone());
        }
        by_source.insert(id, json!(tags));
    }
    let mut tags: Vec<String> = all.into_iter().collect();
    tags.sort();
    Ok(json!({ "ok": true, "tags": tags, "bySource": by_source }))
}

#[tauri::command]
pub fn sources_capabilities(state: State<'_, AppState>, source_ids: Option<Vec<String>>) -> Value {
    let ids = state.sources.active_ids(&source_ids);
    json!({ "ok": true, "capabilities": filters::capability_report(&ids, &state.sources) })
}

#[tauri::command]
pub async fn sources_refresh(app: AppHandle) -> Result<Value> {
    const HYDRA_SOURCES: &[(&str, &str)] = &[
        ("steamrip", "SteamRIP"),
        ("onlinefix", "Online-Fix"),
        ("gog", "GOG"),
        ("empress", "EMPRESS"),
        ("kaoskrew", "KaOsKrew"),
    ];
    let slip = crate::slipgate::cfg().is_some();
    let targets: Vec<(&str, &str)> = HYDRA_SOURCES
        .iter()
        .copied()
        .filter(|(id, _)| slip || adapters::hydralinks::is_reachable(id))
        .collect();
    let total = targets.len();
    let src_list: Vec<Value> = targets
        .iter()
        .map(|(id, name)| json!({ "id": id, "name": name }))
        .collect();
    app.emit(
        "uc:sources-refresh",
        json!({ "state": "start", "total": total as u64, "sources": src_list }),
    )
    .ok();
    use futures::stream::StreamExt;
    let jobs: Vec<(usize, String, String)> = targets
        .into_iter()
        .enumerate()
        .map(|(i, (id, name))| (i, id.to_string(), name.to_string()))
        .collect();
    let results: Vec<bool> = futures::stream::iter(jobs)
        .map(|(i, id, name)| {
            let app = app.clone();
            async move {
                app.emit(
                    "uc:sources-refresh",
                    json!({ "state": "fetching", "id": id, "name": name, "index": i as u64, "total": total as u64 }),
                )
                .ok();
                let t0 = std::time::Instant::now();
                let count = refresh_source(&id).await;
                let ms = t0.elapsed().as_millis() as u64;
                let state = if count.is_some() { "done" } else { "failed" };
                let games = count.map(|n| json!(n as u64)).unwrap_or(Value::Null);
                app.emit(
                    "uc:sources-refresh",
                    json!({ "state": state, "id": id, "name": name, "index": i as u64, "total": total as u64, "games": games, "ms": ms }),
                )
                .ok();
                count.is_some()
            }
        })
        .buffer_unordered(4)
        .collect()
        .await;
    let any = results.iter().any(|&ok| ok);
    QUERY_POOL.clear();
    CATALOG_POOL.clear();
    app.emit(
        "uc:sources-refresh",
        json!({ "state": "complete", "total": total as u64 }),
    )
    .ok();
    Ok(json!({ "ok": any || total == 0 }))
}

async fn refresh_source(id: &str) -> Option<usize> {
    match id {
        "steamrip" => adapters::steamrip::refresh().await,
        "onlinefix" => adapters::onlinefix::refresh().await,
        "gog" => adapters::gog::refresh().await,
        "empress" => adapters::empress::refresh().await,
        "kaoskrew" => adapters::kaoskrew::refresh().await,
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn torrent_filter_groups_onlinefix_without_relabeling_it() {
        let onlinefix = SOURCES
            .iter()
            .find(|source| source.id == "onlinefix")
            .unwrap();
        let gog = SOURCES.iter().find(|source| source.id == "gog").unwrap();
        let steamrip = SOURCES
            .iter()
            .find(|source| source.id == "steamrip")
            .unwrap();

        assert!(hidden_by_torrent_filter(onlinefix));
        assert!(!onlinefix.torrent_only);
        assert!(hidden_by_torrent_filter(gog));
        assert!(gog.torrent_only);
        assert!(!hidden_by_torrent_filter(steamrip));
    }
}

#[cfg(test)]
#[path = "../../../.dev/rust/live_tests.rs"]
mod dev_live_tests;
