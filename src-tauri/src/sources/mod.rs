pub mod adapters;
pub mod cache;
pub mod filters;
pub mod hosts;
pub mod parse;
pub mod schema;
pub mod steam;

use std::collections::HashSet;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::State;

use crate::error::Result;
use crate::state::AppState;
use schema::SourceGame;

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
}

pub struct SourceMeta {
    pub id: &'static str,
    pub name: &'static str,
    pub homepage: &'static str,
}

pub const SOURCES: &[SourceMeta] = &[
    SourceMeta { id: "unioncrax", name: "UnionCrax", homepage: "https://union-crax.xyz" },
    SourceMeta { id: "gamebounty", name: "GameBounty", homepage: "https://gamebounty.world" },
    SourceMeta { id: "ankergames", name: "AnkerGames", homepage: "https://ankergames.net" },
    SourceMeta { id: "steamrip", name: "SteamRIP", homepage: "https://steamrip.com" },
];

pub fn capabilities_for(id: &str) -> Capabilities {
    match id {
        "unioncrax" => adapters::unioncrax::capabilities(),
        "gamebounty" => adapters::gamebounty::capabilities(),
        "ankergames" => adapters::ankergames::capabilities(),
        "steamrip" => adapters::steamrip::capabilities(),
        _ => Capabilities::default(),
    }
}

async fn adapter_query(id: &str, params: &QueryParams) -> Vec<SourceGame> {
    match id {
        "unioncrax" => adapters::unioncrax::query(params).await,
        "gamebounty" => adapters::gamebounty::query(params).await,
        "ankergames" => adapters::ankergames::query(params).await,
        "steamrip" => adapters::steamrip::query(params).await,
        _ => Vec::new(),
    }
}

async fn adapter_search(id: &str, q: &str, limit: usize) -> Vec<SourceGame> {
    match id {
        "unioncrax" => adapters::unioncrax::search(q, limit).await,
        "gamebounty" => adapters::gamebounty::search(q, limit).await,
        "ankergames" => adapters::ankergames::search(q, limit).await,
        "steamrip" => adapters::steamrip::search(q, limit).await,
        _ => Vec::new(),
    }
}

async fn adapter_detail(id: &str, slug: &str) -> Option<SourceGame> {
    match id {
        "unioncrax" => adapters::unioncrax::get_detail(slug).await,
        "gamebounty" => adapters::gamebounty::get_detail(slug).await,
        "ankergames" => adapters::ankergames::get_detail(slug).await,
        "steamrip" => adapters::steamrip::get_detail(slug).await,
        _ => None,
    }
}

async fn adapter_tags(id: &str) -> Vec<String> {
    match id {
        "unioncrax" => adapters::unioncrax::list_tags().await,
        "ankergames" => adapters::ankergames::list_tags().await,
        "steamrip" => adapters::steamrip::list_tags().await,
        _ => Vec::new(),
    }
}

async fn adapter_resolve(
    id: &str,
    option: &schema::DownloadOption,
) -> ResolveResult {
    match id {
        "unioncrax" => adapters::unioncrax::resolve_download(option).await,
        "ankergames" => adapters::ankergames::resolve_download(option).await,
        _ => hosts::resolve_url(option).await,
    }
}

pub struct Registry {
    enabled: Mutex<HashSet<String>>,
}

impl Registry {
    pub fn new() -> Self {
        let enabled = SOURCES.iter().map(|s| s.id.to_string()).collect();
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
        SOURCES
            .iter()
            .map(|s| s.id.to_string())
            .filter(|id| self.is_enabled(id))
            .filter(|id| requested.as_ref().map(|r| r.contains(id)).unwrap_or(true))
            .collect()
    }

    pub fn list(&self) -> Vec<SourceInfo> {
        SOURCES
            .iter()
            .map(|s| SourceInfo {
                id: s.id.to_string(),
                name: s.name.to_string(),
                homepage: s.homepage.to_string(),
                capabilities: capabilities_for(s.id),
                enabled: self.is_enabled(s.id),
            })
            .collect()
    }
}

async fn run_query(reg: &Registry, params: QueryParams) -> filters::QueryResult {
    let ids = reg.active_ids(&params.sources);
    let candidate_limit = (params.offset + params.limit).max(36) + 24;
    let mut pool: Vec<SourceGame> = Vec::new();
    let per_source = crate::http::map_limit(ids.clone(), ids.len().max(1), |id| {
        let mut p = params.clone();
        p.limit = candidate_limit;
        async move { Some(adapter_query(&id, &p).await) }
    })
    .await;
    for mut v in per_source {
        pool.append(&mut v);
    }
    filters::finalize(pool, &params, &ids, reg)
}

#[tauri::command]
pub fn sources_list(state: State<'_, AppState>) -> Value {
    json!({ "ok": true, "sources": state.sources.list() })
}

#[tauri::command]
pub fn sources_set_enabled(state: State<'_, AppState>, id: String, enabled: bool) -> Value {
    state.sources.set_enabled(&id, enabled);
    json!({ "ok": true })
}

#[tauri::command]
pub async fn sources_query(state: State<'_, AppState>, params: QueryParams) -> Result<filters::QueryResult> {
    Ok(run_query(&state.sources, params).await)
}

#[tauri::command]
pub async fn sources_search(state: State<'_, AppState>, query: String, limit: Option<usize>) -> Result<Value> {
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
pub async fn sources_catalog(state: State<'_, AppState>, offset: Option<usize>, limit: Option<usize>) -> Result<Value> {
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
        let slug = stub.get("sourceSlug").and_then(|v| v.as_str()).unwrap_or("");
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
pub async fn sources_resolve(_state: State<'_, AppState>, source_id: String, option: schema::DownloadOption) -> Result<Value> {
    let result = adapter_resolve(&source_id, &option).await;
    Ok(json!({ "ok": true, "result": result }))
}

#[tauri::command]
pub async fn sources_steam_art(appid: u64) -> Result<Value> {
    let art = steam::steam_art(appid).await;
    Ok(json!({ "ok": true, "art": art }))
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
