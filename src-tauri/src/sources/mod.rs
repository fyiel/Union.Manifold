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
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{LazyLock, Mutex};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, State};

use crate::error::Result;
use crate::state::AppState;
use schema::{PartialPool, SourceGame};

const POOL_SIZE: usize = 300;
const MAX_PAGE_SIZE: usize = 100;

static LATEST_STREAM_REQUEST: AtomicU64 = AtomicU64::new(0);
static CANCELLED_THROUGH: AtomicU64 = AtomicU64::new(0);
static STREAM_REQUEST_CHANGED: LazyLock<tokio::sync::Notify> =
    LazyLock::new(tokio::sync::Notify::new);

fn notify_stream_requests() {
    STREAM_REQUEST_CHANGED.notify_one();
    STREAM_REQUEST_CHANGED.notify_waiters();
}

fn start_stream_request(req_id: u64) {
    let previous = LATEST_STREAM_REQUEST.fetch_max(req_id, Ordering::SeqCst);
    if req_id > previous {
        notify_stream_requests();
    }
}

fn cancel_stream_request(req_id: u64) {
    CANCELLED_THROUGH.fetch_max(req_id, Ordering::SeqCst);
    notify_stream_requests();
}

fn stream_request_current(req_id: u64) -> bool {
    LATEST_STREAM_REQUEST.load(Ordering::SeqCst) == req_id
        && CANCELLED_THROUGH.load(Ordering::SeqCst) < req_id
}

#[derive(Clone)]
struct CachedPool {
    ordered: Vec<schema::UnifiedGame>,
    facets: filters::Facets,
    total: usize,
    errored: bool,
    status: Vec<filters::SourceStatus>,
    raw: Vec<schema::SourceGame>,
    fetched_at_ms: i64,
}

static QUERY_POOL: LazyLock<cache::KeyedCache<std::sync::Arc<CachedPool>>> =
    LazyLock::new(|| cache::KeyedCache::with_limit(std::time::Duration::from_secs(90), 64));

static CATALOG_POOL: LazyLock<cache::KeyedCache<std::sync::Arc<CachedPool>>> =
    LazyLock::new(|| cache::KeyedCache::with_limit(std::time::Duration::from_secs(600), 8));

/// How long a pool with failing sources is served before the failed sources
/// are refetched on the next access.
const ERRED_REFRESH_MS: i64 = 30_000;

#[derive(Clone, Default, Serialize, Deserialize)]
struct SourceHealth {
    last_success_at: Option<i64>,
    consecutive_failures: u32,
    last_error: Option<String>,
}

static SOURCE_HEALTH: LazyLock<metacache::WriteBehind<SourceHealth>> =
    LazyLock::new(|| metacache::WriteBehind::load("source-health.json"));

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

/// Record one query outcome per source in the durable health ledger.
fn record_health(status: &[filters::SourceStatus]) {
    for st in status {
        let mut entry = SOURCE_HEALTH.get(&st.id).unwrap_or_default();
        if st.ok {
            entry.last_success_at = Some(now_ms());
            entry.consecutive_failures = 0;
            entry.last_error = None;
        } else {
            entry.consecutive_failures = entry.consecutive_failures.saturating_add(1);
            entry.last_error = st.reason.clone();
        }
        SOURCE_HEALTH.insert(st.id.clone(), entry);
    }
}

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
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub cancelled: bool,
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
        torrent_only: true,
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
    source.torrent_only
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

fn simple_text_query(params: &QueryParams) -> Option<&str> {
    let query = params.text.as_deref()?.trim();
    (!query.is_empty()
        && params.tags.is_empty()
        && params.min_year.is_none()
        && params.max_year.is_none()
        && params.min_size_bytes.is_none()
        && params.max_size_bytes.is_none()
        && matches!(params.sort.as_deref(), None | Some("relevance"))
        && params.order.is_none()
        && !params.balanced)
        .then_some(query)
}

async fn adapter_query(id: &str, params: &QueryParams) -> Option<Vec<SourceGame>> {
    if id == "unioncrax" {
        if let Some(query) = simple_text_query(params) {
            return Some(adapters::unioncrax::search(query, params.limit).await);
        }
    }
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

/// Resolve every part of a multi-part mirror and merge them into one result.
/// All parts must resolve — a partial set of archives cannot extract, so the
/// option falls back to the browser unless the whole mirror comes through.
/// Parts of one mirror share a host, so the first part's headers apply to all.
async fn resolve_mirror_parts(
    app: Option<&AppHandle>,
    option: &schema::DownloadOption,
) -> ResolveResult {
    let urls: Vec<String> = std::iter::once(option.url.clone().unwrap_or_default())
        .chain(option.parts.iter().cloned())
        .filter(|u| !u.is_empty())
        .collect();
    if urls.is_empty() {
        return ResolveResult {
            resolvable: false,
            reason: Some("multi-part option has no part urls".to_string()),
            ..Default::default()
        };
    }
    let mut files: Vec<ResolvedFile> = Vec::new();
    let mut headers: Option<std::collections::HashMap<String, String>> = None;
    for (i, url) in urls.iter().enumerate() {
        let part = schema::DownloadOption {
            url: Some(url.clone()),
            ..Default::default()
        };
        let res = match app {
            Some(app) => hosts::resolve_url_via(app, &part).await,
            None => hosts::resolve_url(&part).await,
        };
        if !res.resolvable {
            let reason = res.reason.unwrap_or_default();
            let suffix = if reason.is_empty() {
                String::new()
            } else {
                format!(": {reason}")
            };
            return ResolveResult {
                resolvable: false,
                open_url: Some(url.clone()),
                reason: Some(format!("part {} of {} failed{suffix}", i + 1, urls.len())),
                ..Default::default()
            };
        }
        match res.files {
            Some(mut fs) => {
                fs.retain(|f| !files.iter().any(|g| g.url == f.url && g.file_name == f.file_name));
                files.append(&mut fs)
            }
            None => {
                if let Some(url) = res.url {
                    let file = ResolvedFile {
                        url: url.clone(),
                        file_name: res.file_name,
                        size_bytes: res.size_bytes,
                    };
                    if !files.iter().any(|g| g.url == file.url) {
                        // Same host serves part archives once; URL variants
                        // (trailing slash, query, case) would double-enqueue.
                        files.push(file);
                    }
                }
            }
        }
        if headers.is_none() {
            headers = res.headers.filter(|h| !h.is_empty());
        }
    }
    if files.is_empty() {
        return ResolveResult {
            resolvable: false,
            open_url: Some(urls[0].clone()),
            reason: Some("no part resolved to a downloadable file".to_string()),
            ..Default::default()
        };
    }
    ResolveResult {
        resolvable: true,
        files: Some(files),
        headers,
        ..Default::default()
    }
}

pub(crate) async fn adapter_resolve_with(
    app: Option<&AppHandle>,
    id: &str,
    option: &schema::DownloadOption,
) -> ResolveResult {
    match id {
        "unioncrax" => adapters::unioncrax::resolve_download(option).await,
        _ if option.parts.is_empty() => match app {
            Some(app) => hosts::resolve_url_via(app, option).await,
            None => hosts::resolve_url(option).await,
        },
        _ => resolve_mirror_parts(app, option).await,
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

    fn source_available_with(
        source: &SourceMeta,
        slipgate: bool,
        hide_torrent: bool,
        onlinefix_ready: bool,
    ) -> bool {
        let reachable = if source.id == "onlinefix" {
            slipgate && onlinefix_ready
        } else {
            slipgate || !source.requires_slipgate || adapters::hydralinks::is_reachable(source.id)
        };
        reachable && !(hide_torrent && hidden_by_torrent_filter(source))
    }

    fn source_available(source: &SourceMeta, slipgate: bool, hide_torrent: bool) -> bool {
        Self::source_available_with(
            source,
            slipgate,
            hide_torrent,
            adapters::onlinefix::is_ready(),
        )
    }

    /// Regular, user-facing sources. Online-Fix is a torrent-only source whose
    /// only in-app use is fetching repair archives, so it is managed by its own
    /// dedicated toggle and never surfaces in Browse, search, or the sidebar.
    fn is_regular_source(source: &SourceMeta) -> bool {
        source.id != "onlinefix"
    }

    /// Whether an id names a source that the generic enable/disable surface
    /// may touch. Unknown ids and sources behind their own toggle (Online-Fix)
    /// are rejected so a stray call cannot silently desync the registry.
    fn is_regular_source_id(id: &str) -> bool {
        SOURCES.iter().any(|s| s.id == id && Self::is_regular_source(s))
    }

    pub fn active_ids(&self, requested: &Option<Vec<String>>) -> Vec<String> {
        let slipgate = crate::slipgate::cfg().is_some();
        let hide_torrent = crate::settings::hide_torrent_sources();
        SOURCES
            .iter()
            .filter(|s| Self::is_regular_source(s))
            .filter(|s| Self::source_available(s, slipgate, hide_torrent))
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
            .filter(|s| Self::is_regular_source(s))
            .map(|s| SourceInfo {
                id: s.id.to_string(),
                name: s.name.to_string(),
                homepage: s.homepage.to_string(),
                capabilities: capabilities_for(s.id),
                enabled: self.is_enabled(s.id),
                requires_slipgate: s.requires_slipgate,
                available: Self::source_available(s, slipgate, hide_torrent),
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
    let pool_cache = pool_for(&params);

    // Per-source retry: a pool whose fetch had failures is refetched for the
    // failed sources only once the 30s cooldown has passed, so a recovered
    // source clears the gap promptly without re-querying healthy sources.
    if let Some(cp) = pool_cache.peek(&sig).await {
        if !cp.errored || now_ms() - cp.fetched_at_ms < ERRED_REFRESH_MS {
            return page_from(&cp, &params, &ids, reg);
        }
        let failed: Vec<String> = cp
            .status
            .iter()
            .filter(|s| !s.ok)
            .map(|s| s.id.clone())
            .collect();
        if !failed.is_empty() {
            let mut raw = cp.raw.clone();
            let mut status = cp.status.clone();
            let epoch = pool_cache.epoch();
            let mut retry_params = params_fetch.clone();
            retry_params.limit = POOL_SIZE;
            retry_params.offset = 0;
            let fresh = crate::http::map_limit(failed, 3, |id| {
                let p = retry_params.clone();
                let idc = id.clone();
                async move { Some((idc, adapter_query(&id, &p).await)) }
            })
            .await;
            for (id, games) in fresh {
                if let Some(g) = games {
                    let n = g.len();
                    raw.extend(g);
                    if let Some(st) = status.iter_mut().find(|st| st.id == id) {
                        st.ok = true;
                        st.games = n;
                        st.reason = None;
                    }
                }
            }
            let errored = status.iter().any(|s| !s.ok);
            let (ordered, facets, total) =
                filters::finalize_pool_cached(&mut raw, &params_fetch);
            record_health(&status);
            let refreshed = std::sync::Arc::new(CachedPool {
                ordered,
                facets,
                total,
                errored,
                status,
                raw,
                fetched_at_ms: now_ms(),
            });
            let stored = refreshed.clone();
            pool_cache.store_if_epoch(&sig, epoch, stored).await;
            return page_from(&refreshed, &params, &ids, reg);
        }
    }

    let cached = pool_cache
        .get_or(&sig, || async move {
            let mut p = params_fetch;
            p.limit = POOL_SIZE;
            p.offset = 0;
            let per_source =
                crate::http::map_limit(ids_fetch.clone(), ids_fetch.len().max(1), |id| {
                    let p = p.clone();
                    let idc = id.clone();
                    async move { Some((idc, adapter_query(&id, &p).await)) }
                })
                .await;
            let mut pool: Vec<schema::SourceGame> = Vec::new();
            let mut status: Vec<filters::SourceStatus> = Vec::new();
            let mut errored = false;
            for (id, games) in per_source {
                match games {
                    Some(mut g) => {
                        let n = g.len();
                        pool.append(&mut g);
                        status.push(filters::SourceStatus {
                            id,
                            ok: true,
                            games: n,
                            reason: None,
                        });
                    }
                    None => {
                        errored = true;
                        status.push(filters::SourceStatus {
                            id,
                            ok: false,
                            games: 0,
                            reason: Some("no response".to_string()),
                        });
                    }
                }
            }
            let (ordered, facets, total) = filters::finalize_pool_cached(&mut pool, &p);
            record_health(&status);
            Some(std::sync::Arc::new(CachedPool {
                ordered,
                facets,
                total,
                errored,
                status,
                raw: pool,
                fetched_at_ms: now_ms(),
            }))
        })
        .await;
    match cached {
        Some(cp) => page_from(&cp, &params, &ids, reg),
        None => page_from(&empty_pool(), &params, &ids, reg),
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
        .take(params.limit.min(MAX_PAGE_SIZE))
        .map(schema::UnifiedGame::browse_summary)
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
        per_source_status: cp.status.clone(),
    }
}

fn empty_pool() -> std::sync::Arc<CachedPool> {
    std::sync::Arc::new(CachedPool {
        ordered: Vec::new(),
        facets: filters::Facets {
            tags: Vec::new(),
        },
        total: 0,
        errored: false,
        status: Vec::new(),
        raw: Vec::new(),
        fetched_at_ms: now_ms(),
    })
}

async fn run_query_stream(
    app: &AppHandle,
    req_id: u64,
    reg: &Registry,
    params: QueryParams,
) -> filters::QueryResult {
    use futures::stream::{FuturesUnordered, StreamExt};
    if !stream_request_current(req_id) {
        return page_from(&empty_pool(), &params, &[], reg);
    }
    let ids = reg.active_ids(&params.sources);
    let sig = pool_sig(&params, &ids);
    let pool_cache = pool_for(&params);
    if let Some(cp) = pool_cache.peek(&sig).await {
        return page_from(&cp, &params, &ids, reg);
    }
    let mut p = params.clone();
    p.limit = POOL_SIZE;
    p.offset = 0;
    let app = app.clone();
    let ids_fetch = ids.clone();
    let page_params = params.clone();
    let cached = pool_cache
        .get_or(&sig, || async move {
            let mut futs = FuturesUnordered::new();
            for id in ids_fetch {
                let pp = p.clone();
                futs.push(async move {
                    let games = adapter_query(&id, &pp).await;
                    (id, games)
                });
            }
            let mut pool: Vec<SourceGame> = Vec::new();
            // Per-request incremental dedup index: built inside the get_or
            // closure so it is never shared across requests or cache epochs.
            let mut acc = PartialPool::new();
            let mut done: Vec<String> = Vec::new();
            let mut failed: Vec<String> = Vec::new();
            let mut status: Vec<filters::SourceStatus> = Vec::new();
            let mut errored = false;
            while !futs.is_empty() {
                if !stream_request_current(req_id) {
                    return None;
                }
                let next = tokio::select! {
                    _ = STREAM_REQUEST_CHANGED.notified() => {
                        if !stream_request_current(req_id) {
                            return None;
                        }
                        continue;
                    }
                    next = futs.next() => next,
                };
                let Some((id, games)) = next else { break };
                match games {
                    Some(g) if g.is_empty() => {
                        done.push(id.clone());
                        status.push(filters::SourceStatus {
                            id,
                            ok: true,
                            games: 0,
                            reason: None,
                        });
                    }
                    Some(g) => {
                        done.push(id.clone());
                        let n = g.len();
                        for game in g {
                            let i = pool.len();
                            pool.push(game);
                            acc.push(&mut pool, i);
                        }
                        status.push(filters::SourceStatus {
                            id,
                            ok: true,
                            games: n,
                            reason: None,
                        });
                    }
                    None => {
                        // A failed source must not be labelled 'done' in the stream:
                        // the renderer strip keys off doneSources to show progress.
                        errored = true;
                        failed.push(id.clone());
                        status.push(filters::SourceStatus {
                            id,
                            ok: false,
                            games: 0,
                            reason: Some("no response".to_string()),
                        });
                    }
                }
                {
                    let games = acc.snapshot();
                    let (ordered, _facets, total) = filters::order_and_filter(games, &p);
                    let page: Vec<schema::UnifiedGame> = ordered
                        .iter()
                        .skip(page_params.offset)
                        .take(page_params.limit.min(MAX_PAGE_SIZE))
                        .map(|g| g.browse_summary())
                        .collect();
                    app.emit(
                        "uc:browse-partial",
                        json!({
                            "reqId": req_id,
                            "games": page,
                            "total": total,
                            "doneSources": done,
                            "failedSources": failed,
                        }),
                    )
                    .ok();
                }
            }
            // Final pool goes through the batch path so the cached pool (and
            // the last partial) is exactly what finalize_pool_cached produces
            // for the complete pool.
            let (ordered, facets, total) = filters::finalize_pool_cached(&mut pool, &p);
            let latest = std::sync::Arc::new(CachedPool {
                ordered,
                facets,
                total,
                errored,
                status,
                raw: pool,
                fetched_at_ms: now_ms(),
            });
            record_health(&latest.status);
            Some(latest)
        })
        .await;
    let cp = cached.unwrap_or_else(empty_pool);
    page_from(&cp, &params, &ids, reg)
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
    let regular = Registry::is_regular_source_id(&id);
    if !regular {
        return json!({
            "ok": false,
            "error": format!("{id} is not a regular source and cannot be toggled here")
        });
    }
    state.sources.set_enabled(&id, enabled);
    let disabled: Vec<String> = SOURCES
        .iter()
        .filter(|s| Registry::is_regular_source(s))
        .map(|s| s.id.to_string())
        .filter(|id| !state.sources.is_enabled(id))
        .collect();
    state.settings.set("disabledSources", json!(disabled));
    json!({ "ok": true })
}

#[tauri::command]
pub fn sources_onlinefix_status(_state: State<'_, AppState>) -> Value {
    json!({
        "ok": true,
        "enabled": crate::settings::onlinefix_enabled(),
        "available": adapters::onlinefix::is_ready(),
    })
}

#[tauri::command]
pub fn sources_onlinefix_set_enabled(
    app: AppHandle,
    state: State<'_, AppState>,
    enabled: bool,
) -> Value {
    state.settings.set("onlineFixEnabled", json!(enabled));
    app.emit("uc:sources-updated", json!({})).ok();
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
            start_stream_request(rid);
            Ok(run_query_stream(&app, rid, &state.sources, params).await)
        }
        _ => Ok(run_query(&state.sources, params).await),
    }
}

#[tauri::command]
pub fn sources_cancel(req_id: u64) -> Value {
    cancel_stream_request(req_id);
    json!({ "ok": true })
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
    let games: Vec<_> = schema::merge_games(pool)
        .iter()
        .map(schema::UnifiedGame::browse_summary)
        .collect();
    Ok(json!({ "ok": true, "games": games }))
}

#[tauri::command]
pub async fn sources_detail(_state: State<'_, AppState>, sources: Vec<Value>) -> Result<Value> {
    let records = crate::http::map_limit(sources, 4, |stub| async move {
        let sid = stub
            .get("sourceId")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let slug = stub
            .get("sourceSlug")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        adapter_detail(&sid, &slug).await
    })
    .await;
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
    app: AppHandle,
    _state: State<'_, AppState>,
    source_id: String,
    option: schema::DownloadOption,
) -> Result<Value> {
    // Non-unioncrax sources resolve through hosts::resolve_url (with a
    // webview-solver escalation for gated hosts, then a Slipgate fallback);
    // multi-part mirrors resolve every part and merge the files so the
    // renderer enqueues the whole set.
    let result = adapter_resolve_with(Some(&app), &source_id, &option).await;
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
    app.emit("uc:sources-updated", json!({})).ok();
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
    fn torrent_filter_groups_onlinefix_with_torrents() {
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
        assert!(onlinefix.torrent_only);
        assert!(hidden_by_torrent_filter(gog));
        assert!(gog.torrent_only);
        assert!(!hidden_by_torrent_filter(steamrip));
    }

    #[test]
    fn onlinefix_is_excluded_from_regular_source_lists() {
        let reg = Registry::new(&[]);
        let listed = reg.list();
        assert!(!listed.iter().any(|s| s.id == "onlinefix"));
        assert!(listed.iter().any(|s| s.id == "gog"));
        let active = reg.active_ids(&None);
        assert!(!active.iter().any(|id| id == "onlinefix"));
    }

    #[test]
    fn generic_enable_surface_rejects_onlinefix_and_unknown_ids() {
        assert!(!Registry::is_regular_source_id("onlinefix"));
        assert!(!Registry::is_regular_source_id("nope"));
        assert!(Registry::is_regular_source_id("gog"));
        assert!(Registry::is_regular_source_id("steamrip"));
    }

    #[test]
    fn onlinefix_requires_slipgate_and_live_readiness() {
        let onlinefix = SOURCES
            .iter()
            .find(|source| source.id == "onlinefix")
            .unwrap();

        assert!(!Registry::source_available_with(
            onlinefix, false, false, false
        ));
        assert!(!Registry::source_available_with(
            onlinefix, true, false, false
        ));
        assert!(!Registry::source_available_with(
            onlinefix, false, false, true
        ));
        assert!(Registry::source_available_with(
            onlinefix, true, false, true
        ));
    }

    #[test]
    fn cancellation_only_supersedes_the_owned_stream_request() {
        let id = LATEST_STREAM_REQUEST.fetch_add(10_000, Ordering::SeqCst) + 10_000;
        start_stream_request(id);
        assert!(stream_request_current(id));
        cancel_stream_request(id);
        assert!(!stream_request_current(id));
        start_stream_request(id + 1);
        assert!(stream_request_current(id + 1));
    }

    #[test]
    fn page_response_is_bounded_and_uses_browse_summaries() {
        let source = |i| SourceGame {
            source_id: "test".into(),
            source_slug: format!("game-{i}"),
            title: format!("Game {i}"),
            description: Some("detail-only".repeat(100)),
            download_options: vec![schema::DownloadOption {
                label: "Direct".into(),
                resolvable: true,
                ..Default::default()
            }],
            ..Default::default()
        };
        let (ordered, facets, total) =
            filters::finalize_pool((0..150).map(source).collect(), &QueryParams::default());
        let pool = CachedPool {
            ordered,
            facets,
            total,
            errored: false,
            status: Vec::new(),
            raw: Vec::new(),
            fetched_at_ms: now_ms(),
        };
        let result = page_from(
            &pool,
            &QueryParams {
                limit: usize::MAX,
                ..Default::default()
            },
            &[],
            &Registry::new(&[]),
        );
        assert_eq!(result.games.len(), MAX_PAGE_SIZE);
        assert!(result.games[0].sources[0].download_options.is_empty());
        assert!(result.games[0].sources[0].direct);
    }

    #[test]
    fn only_plain_relevance_queries_use_source_search() {
        let plain = QueryParams {
            text: Some(" wuchang ".to_string()),
            sort: Some("relevance".to_string()),
            ..Default::default()
        };
        assert_eq!(simple_text_query(&plain), Some("wuchang"));

        for filtered in [
            QueryParams {
                tags: vec!["RPG".to_string()],
                ..plain.clone()
            },
            QueryParams {
                min_year: Some(2025),
                ..plain.clone()
            },
            QueryParams {
                sort: Some("latest".to_string()),
                ..plain.clone()
            },
            QueryParams {
                order: Some("asc".to_string()),
                ..plain.clone()
            },
            QueryParams {
                balanced: true,
                ..plain.clone()
            },
        ] {
            assert_eq!(simple_text_query(&filtered), None);
        }
    }
}
