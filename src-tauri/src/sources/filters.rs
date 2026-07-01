use std::collections::HashMap;

use serde::Serialize;

use super::schema::{merge_games, SourceGame, UnifiedGame};
use super::{Capabilities, QueryParams, Registry};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Facets {
    pub tags: Vec<TagCount>,
    pub years: MinMax<i32>,
    pub size: MinMax<u64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TagCount {
    pub tag: String,
    pub count: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct MinMax<T> {
    pub min: Option<T>,
    pub max: Option<T>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityReport {
    pub per_source: Vec<PerSource>,
    pub scope: Vec<String>,
    pub coverage: HashMap<String, String>,
    pub supports: HashMap<String, Vec<String>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PerSource {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    #[serde(flatten)]
    pub caps: Capabilities,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryResult {
    pub ok: bool,
    pub games: Vec<UnifiedGame>,
    pub total: usize,
    pub facets: Facets,
    pub applied: QueryParams,
    pub capabilities: CapabilityReport,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

fn matches_filters(g: &UnifiedGame, p: &QueryParams) -> bool {
    if let Some(text) = &p.text {
        let t = text.to_lowercase();
        if !t.is_empty() && !g.title.to_lowercase().contains(&t) {
            return false;
        }
    }
    if !p.tags.is_empty() {
        let want: Vec<String> = p.tags.iter().map(|t| t.to_lowercase()).collect();
        let have: Vec<String> = g.genres.iter().map(|t| t.to_lowercase()).collect();
        let and = p.tag_mode.as_deref() == Some("and");
        let ok = if and {
            want.iter().all(|w| have.contains(w))
        } else {
            want.iter().any(|w| have.contains(w))
        };
        if !ok {
            return false;
        }
    }
    if p.min_year.is_some() || p.max_year.is_some() {
        match g.release_year {
            Some(y) => {
                if let Some(min) = p.min_year {
                    if y < min {
                        return false;
                    }
                }
                if let Some(max) = p.max_year {
                    if y > max {
                        return false;
                    }
                }
            }
            None => return false,
        }
    }
    if p.min_size_bytes.is_some() || p.max_size_bytes.is_some() {
        match g.size_bytes {
            Some(s) => {
                if let Some(min) = p.min_size_bytes {
                    if s < min {
                        return false;
                    }
                }
                if let Some(max) = p.max_size_bytes {
                    if s > max {
                        return false;
                    }
                }
            }
            None => return false,
        }
    }
    true
}

fn sort_games(games: &mut [UnifiedGame], p: &QueryParams) {
    let sort = p.sort.as_deref().unwrap_or("relevance");
    let desc = p.order.as_deref() != Some("asc");
    match sort {
        "title" => games.sort_by(|a, b| a.title.to_lowercase().cmp(&b.title.to_lowercase())),
        "latest" => games.sort_by(|a, b| b.added_at.unwrap_or(i64::MIN).cmp(&a.added_at.unwrap_or(i64::MIN))),
        "updated" => games.sort_by(|a, b| b.updated_at.unwrap_or(i64::MIN).cmp(&a.updated_at.unwrap_or(i64::MIN))),
        "popular" => games.sort_by(|a, b| {
            let pa = a.popularity.unwrap_or(f64::MIN);
            let pb = b.popularity.unwrap_or(f64::MIN);
            pb.partial_cmp(&pa)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then(b.sources.len().cmp(&a.sources.len()))
        }),
        _ => {}
    }
    if !desc && sort != "title" {
        games.reverse();
    }
}

fn balanced_interleave(games: Vec<UnifiedGame>) -> Vec<UnifiedGame> {
    let mut buckets: HashMap<String, Vec<UnifiedGame>> = HashMap::new();
    let mut order: Vec<String> = Vec::new();
    for g in games {
        let key = g
            .sources
            .first()
            .map(|s| s.source_id.clone())
            .unwrap_or_default();
        if !buckets.contains_key(&key) {
            order.push(key.clone());
        }
        buckets.entry(key).or_default().push(g);
    }
    let mut out = Vec::new();
    let mut idx = 0;
    loop {
        let mut pushed = false;
        for key in &order {
            if let Some(bucket) = buckets.get(key) {
                if let Some(g) = bucket.get(idx) {
                    out.push(g.clone());
                    pushed = true;
                }
            }
        }
        if !pushed {
            break;
        }
        idx += 1;
    }
    out
}

fn build_facets(games: &[UnifiedGame]) -> Facets {
    let mut tag_counts: HashMap<String, usize> = HashMap::new();
    let mut year_min = None;
    let mut year_max = None;
    let mut size_min = None;
    let mut size_max = None;
    for g in games {
        for t in &g.genres {
            *tag_counts.entry(t.clone()).or_default() += 1;
        }
        if let Some(y) = g.release_year {
            year_min = Some(year_min.map_or(y, |m: i32| m.min(y)));
            year_max = Some(year_max.map_or(y, |m: i32| m.max(y)));
        }
        if let Some(s) = g.size_bytes {
            size_min = Some(size_min.map_or(s, |m: u64| m.min(s)));
            size_max = Some(size_max.map_or(s, |m: u64| m.max(s)));
        }
    }
    let mut tags: Vec<TagCount> = tag_counts
        .into_iter()
        .map(|(tag, count)| TagCount { tag, count })
        .collect();
    tags.sort_by(|a, b| b.count.cmp(&a.count).then(a.tag.cmp(&b.tag)));
    Facets {
        tags,
        years: MinMax { min: year_min, max: year_max },
        size: MinMax { min: size_min, max: size_max },
    }
}

pub fn capability_report(ids: &[String], reg: &Registry) -> CapabilityReport {
    let mut per_source = Vec::new();
    let mut supports: HashMap<String, Vec<String>> = HashMap::new();
    for id in ids {
        let caps = super::capabilities_for(id);
        let name = super::SOURCES
            .iter()
            .find(|s| s.id == id)
            .map(|s| s.name.to_string())
            .unwrap_or_else(|| id.clone());
        for (feat, on) in [
            ("search", caps.search),
            ("catalog", caps.catalog),
            ("tags", caps.tags),
            ("releaseDate", caps.release_date),
            ("size", caps.size),
        ] {
            if on {
                supports.entry(feat.to_string()).or_default().push(id.clone());
            }
        }
        for s in &caps.sort {
            supports.entry(format!("sort:{s}")).or_default().push(id.clone());
        }
        per_source.push(PerSource {
            id: id.clone(),
            name,
            enabled: reg.is_enabled(id),
            caps,
        });
    }
    let total = ids.len();
    let mut coverage = HashMap::new();
    for feat in ["search", "catalog", "tags", "releaseDate", "size"] {
        let n = supports.get(feat).map(|v| v.len()).unwrap_or(0);
        let cov = if n == 0 {
            "none"
        } else if n == total {
            "full"
        } else {
            "partial"
        };
        coverage.insert(feat.to_string(), cov.to_string());
    }
    CapabilityReport {
        per_source,
        scope: ids.to_vec(),
        coverage,
        supports,
    }
}

pub fn finalize(pool: Vec<SourceGame>, params: &QueryParams, ids: &[String], reg: &Registry) -> QueryResult {
    let merged = merge_games(pool);
    let mut filtered: Vec<UnifiedGame> = merged.into_iter().filter(|g| matches_filters(g, params)).collect();
    sort_games(&mut filtered, params);
    let facets = build_facets(&filtered);
    let total = filtered.len();
    let ordered = if params.balanced && params.sort.as_deref().unwrap_or("relevance") == "relevance" {
        balanced_interleave(filtered)
    } else {
        filtered
    };
    let page: Vec<UnifiedGame> = ordered
        .into_iter()
        .skip(params.offset)
        .take(params.limit)
        .collect();
    QueryResult {
        ok: true,
        games: page,
        total,
        facets,
        applied: params.clone(),
        capabilities: capability_report(ids, reg),
        error: None,
    }
}
