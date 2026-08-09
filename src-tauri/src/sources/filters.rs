use std::collections::HashMap;

use serde::Serialize;

use super::schema::{merge_games, SourceGame, UnifiedGame};
use super::{Capabilities, QueryParams, Registry};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Facets {
    pub tags: Vec<TagCount>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TagCount {
    pub tag: String,
    pub count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityReport {
    pub per_source: Vec<PerSource>,
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
pub struct SourceStatus {
    pub id: String,
    pub ok: bool,
    pub games: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
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
    pub sources_errored: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub per_source_status: Vec<SourceStatus>,
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
    let order = p.order.as_deref();
    match sort {
        "title" => {
            games.sort_by_key(|g| g.title.to_lowercase());
            if order == Some("desc") {
                games.reverse();
            }
        }
        "latest" => games.sort_by(|a, b| {
            b.added_at
                .unwrap_or(i64::MIN)
                .cmp(&a.added_at.unwrap_or(i64::MIN))
        }),
        _ => {}
    }
    if order == Some("asc") && sort != "title" {
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
    for g in games {
        for t in &g.genres {
            *tag_counts.entry(t.clone()).or_default() += 1;
        }
    }
    let mut tags: Vec<TagCount> = tag_counts
        .into_iter()
        .map(|(tag, count)| TagCount { tag, count })
        .collect();
    tags.sort_by(|a, b| b.count.cmp(&a.count).then(a.tag.cmp(&b.tag)));
    Facets {
        tags,
    }
}

pub fn capability_report(ids: &[String], reg: &Registry) -> CapabilityReport {
    let per_source = ids
        .iter()
        .map(|id| {
            let name = super::SOURCES
                .iter()
                .find(|s| s.id == id)
                .map(|s| s.name.to_string())
                .unwrap_or_else(|| id.clone());
            PerSource {
                id: id.clone(),
                name,
                enabled: reg.is_enabled(id),
                caps: super::capabilities_for(id),
            }
        })
        .collect();
    CapabilityReport { per_source }
}

pub fn finalize_pool(
    pool: Vec<SourceGame>,
    params: &QueryParams,
) -> (Vec<UnifiedGame>, Facets, usize) {
    let merged = merge_games(pool);
    let mut filtered: Vec<UnifiedGame> = merged
        .into_iter()
        .filter(|g| matches_filters(g, params))
        .collect();
    sort_games(&mut filtered, params);
    let facets = build_facets(&filtered);
    let total = filtered.len();
    let ordered = if params.balanced {
        balanced_interleave(filtered)
    } else {
        filtered
    };
    (ordered, facets, total)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ug(title: &str) -> UnifiedGame {
        UnifiedGame {
            title: title.to_string(),
            ..Default::default()
        }
    }

    fn titles(games: &[UnifiedGame]) -> Vec<String> {
        games.iter().map(|g| g.title.clone()).collect()
    }

    #[test]
    fn t_sort_games_title_ascending_is_a_to_z_case_insensitive() {
        let mut games = vec![ug("Charlie"), ug("alpha"), ug("Bravo")];
        let p = QueryParams {
            sort: Some("title".to_string()),
            order: Some("asc".to_string()),
            ..Default::default()
        };
        sort_games(&mut games, &p);
        assert_eq!(titles(&games), vec!["alpha", "Bravo", "Charlie"]);
    }

    #[test]
    fn t_sort_games_title_descending_reverses_ascending() {
        let input = vec![ug("Charlie"), ug("alpha"), ug("Bravo")];

        let mut asc = input.clone();
        let p_asc = QueryParams {
            sort: Some("title".to_string()),
            order: Some("asc".to_string()),
            ..Default::default()
        };
        sort_games(&mut asc, &p_asc);

        let mut desc = input.clone();
        let p_desc = QueryParams {
            sort: Some("title".to_string()),
            order: Some("desc".to_string()),
            ..Default::default()
        };
        sort_games(&mut desc, &p_desc);

        assert_eq!(titles(&desc), vec!["Charlie", "Bravo", "alpha"]);

        let mut asc_reversed = titles(&asc);
        asc_reversed.reverse();
        assert_eq!(titles(&desc), asc_reversed);
    }
}

#[cfg(test)]
#[path = "../../../.dev/rust/filters_tests.rs"]
mod dev_filters_tests;
