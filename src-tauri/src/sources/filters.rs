use std::collections::{HashMap, VecDeque};

use serde::Serialize;

use super::schema::{
    fold_record_into, merge_games_cached, normalize_title, positive_appid, titles_conflict,
    SourceGame, UnifiedGame,
};
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
    let mut buckets: HashMap<String, VecDeque<UnifiedGame>> = HashMap::new();
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
        buckets.entry(key).or_default().push_back(g);
    }
    let mut out = Vec::with_capacity(buckets.values().map(VecDeque::len).sum());
    loop {
        let mut pushed = false;
        for key in &order {
            if let Some(bucket) = buckets.get_mut(key) {
                if let Some(g) = bucket.pop_front() {
                    out.push(g);
                    pushed = true;
                }
            }
        }
        if !pushed {
            break;
        }
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

#[cfg(test)]
pub fn finalize_pool(
    mut pool: Vec<SourceGame>,
    params: &QueryParams,
) -> (Vec<UnifiedGame>, Facets, usize) {
    finalize_pool_cached(&mut pool, params)
}

pub(crate) fn finalize_pool_cached(
    pool: &mut [SourceGame],
    params: &QueryParams,
) -> (Vec<UnifiedGame>, Facets, usize) {
    let merged = merge_games_cached(pool);
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

/// Incremental stand-in for the batch merge pipeline used by the streaming
/// query path. Sources are fed in completion order with add_source, which
/// appends records to the raw pool and merges them into union-find groups in
/// place; snapshot reproduces exactly what finalize_pool_cached would return
/// over the pool prefix so far, without re-merging the accumulated records.
pub(crate) struct PartialPool {
    raw: Vec<SourceGame>,
    groups: Vec<GroupState>,
    by_appid: HashMap<u64, usize>,
    by_title: HashMap<String, TitleEntry>,
}

struct GroupState {
    parent: usize,
    first_idx: usize,
    records: Vec<usize>,
    game: UnifiedGame,
    live: bool,
}

struct TitleEntry {
    group: usize,
    first_appid: Option<u64>,
}

impl PartialPool {
    pub(crate) fn new() -> Self {
        Self {
            raw: Vec::new(),
            groups: Vec::new(),
            by_appid: HashMap::new(),
            by_title: HashMap::new(),
        }
    }

    pub(crate) fn add_source(&mut self, games: Vec<SourceGame>) {
        if games.is_empty() {
            return;
        }
        let start = self.raw.len();
        self.raw.extend(games);
        for i in start..self.raw.len() {
            self.add_record(i);
        }
    }

    pub(crate) fn snapshot(&self, params: &QueryParams) -> (Vec<UnifiedGame>, Facets, usize) {
        let mut filtered: Vec<UnifiedGame> = Vec::new();
        for g in self.groups.iter() {
            if g.live && matches_filters(&g.game, params) {
                filtered.push(g.game.clone());
            }
        }
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

    pub(crate) fn into_raw(self) -> Vec<SourceGame> {
        self.raw
    }

    fn add_record(&mut self, i: usize) {
        if self.raw[i].normalized_title.is_empty() {
            self.raw[i].normalized_title = normalize_title(&self.raw[i].title);
        }
        let appid = positive_appid(&self.raw[i]);
        let key = self.raw[i].normalized_title.clone();
        let mut game = UnifiedGame::default();
        fold_record_into(&mut game, &self.raw[i]);
        let gid = self.groups.len();
        self.groups.push(GroupState {
            parent: gid,
            first_idx: i,
            records: vec![i],
            game,
            live: true,
        });
        let mut targets: Vec<usize> = Vec::new();
        if let Some(id) = appid {
            if let Some(&g) = self.by_appid.get(&id) {
                targets.push(g);
            } else {
                self.by_appid.insert(id, gid);
            }
        }
        if !key.is_empty() {
            if let Some(entry) = self.by_title.get(&key) {
                if !titles_conflict(appid, entry.first_appid) {
                    targets.push(entry.group);
                }
            } else {
                self.by_title
                    .insert(key, TitleEntry { group: gid, first_appid: appid });
            }
        }
        let mut root = gid;
        for target in targets {
            let t = self.find(target);
            if t == root {
                continue;
            }
            let keep = if self.groups[t].first_idx < self.groups[root].first_idx {
                t
            } else {
                root
            };
            let drop = if keep == t { root } else { t };
            self.splice_into(keep, drop);
            root = keep;
        }
    }

    fn find(&mut self, mut x: usize) -> usize {
        let mut root = x;
        while self.groups[root].parent != root {
            root = self.groups[root].parent;
        }
        while self.groups[x].parent != x {
            let next = self.groups[x].parent;
            self.groups[x].parent = root;
            x = next;
        }
        root
    }

    fn splice_into(&mut self, keep: usize, drop: usize) {
        let (a, b) = if keep < drop { (keep, drop) } else { (drop, keep) };
        let (left, right) = self.groups.split_at_mut(b);
        let (ga, gb) = (&mut left[a], &mut right[0]);
        let (gkeep, gdrop) = if a == keep { (ga, gb) } else { (gb, ga) };
        let mut records = Vec::with_capacity(gkeep.records.len() + gdrop.records.len());
        let (mut i, mut j) = (0, 0);
        while i < gkeep.records.len() && j < gdrop.records.len() {
            if gkeep.records[i] < gdrop.records[j] {
                records.push(gkeep.records[i]);
                i += 1;
            } else {
                records.push(gdrop.records[j]);
                j += 1;
            }
        }
        records.extend_from_slice(&gkeep.records[i..]);
        records.extend_from_slice(&gdrop.records[j..]);
        let mut game = UnifiedGame::default();
        for &idx in &records {
            fold_record_into(&mut game, &self.raw[idx]);
        }
        gkeep.records = records;
        gkeep.game = game;
        gdrop.parent = keep;
        gdrop.live = false;
        gdrop.records = Vec::new();
        gdrop.game = UnifiedGame::default();
    }
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

    fn record(source: &str, title: &str, appid: Option<u64>) -> SourceGame {
        SourceGame {
            source_id: source.to_string(),
            source_slug: format!("{}-{}", source, title),
            title: title.to_string(),
            steam_app_id: appid,
            ..Default::default()
        }
    }

    fn parity_params() -> Vec<QueryParams> {
        vec![
            QueryParams::default(),
            QueryParams {
                balanced: true,
                ..Default::default()
            },
            QueryParams {
                text: Some("the".to_string()),
                ..Default::default()
            },
            QueryParams {
                sort: Some("latest".to_string()),
                order: Some("desc".to_string()),
                ..Default::default()
            },
            QueryParams {
                tags: vec!["action".to_string()],
                tag_mode: Some("and".to_string()),
                ..Default::default()
            },
        ]
    }

    fn assert_partial_matches_batch(pool: &[SourceGame], chunk_sizes: &[usize]) {
        let params_list = parity_params();
        let mut pp = PartialPool::new();
        let mut chunks: Vec<usize> = chunk_sizes.to_vec();
        let covered: usize = chunks.iter().sum();
        if covered < pool.len() {
            chunks.push(pool.len() - covered);
        }
        let mut start = 0;
        for cs in chunks {
            let end = (start + cs).min(pool.len());
            if end > start {
                pp.add_source(pool[start..end].to_vec());
            }
            start = end;
            let mut prefix = pool[..end].to_vec();
            for params in &params_list {
                let (ga, fa, ta) = pp.snapshot(params);
                let (gb, fb, tb) = finalize_pool_cached(&mut prefix, params);
                assert_eq!(
                    serde_json::to_value(&ga).unwrap(),
                    serde_json::to_value(&gb).unwrap(),
                    "games diverged at prefix {end} for params {params:?}"
                );
                assert_eq!(
                    serde_json::to_value(&fa).unwrap(),
                    serde_json::to_value(&fb).unwrap(),
                    "facets diverged at prefix {end} for params {params:?}"
                );
                assert_eq!(ta, tb, "total diverged at prefix {end}");
            }
            if end >= pool.len() {
                break;
            }
        }
        assert_eq!(
            serde_json::to_value(&pp.raw).unwrap(),
            serde_json::to_value(pool).unwrap(),
            "raw pool diverged from fed records"
        );
    }

    fn deterministic_pool() -> Vec<SourceGame> {
        let mut pool = Vec::new();
        let mut a = record("s1", "Totally Different Name", Some(777));
        a.description = Some("shorter".to_string());
        pool.push(a);
        let mut b = record("s2", "The Real Title", Some(777));
        b.description = Some("a much longer description".to_string());
        b.genres = vec!["Action".to_string(), "Indie".to_string()];
        b.release_year = Some(2020);
        b.added_at = Some(200);
        b.updated_at = Some(50);
        b.size_bytes = Some(999);
        pool.push(b);
        let mut c = record("s3", "The Real Title", None);
        c.genres = vec!["Action".to_string()];
        c.added_at = Some(100);
        c.updated_at = Some(200);
        pool.push(c);
        pool.push(record("s1", "Alpha", None));
        pool.push(record("s1", "Beta", None));
        let mut f = record("s2", "Alpha", Some(5));
        f.description = Some("the alpha description".to_string());
        f.image = Some("alpha.jpg".to_string());
        pool.push(f);
        pool.push(record("s2", "Beta", Some(5)));
        pool.push(record("s1", "Overcooked", Some(100)));
        pool.push(record("s2", "Overcooked", Some(200)));
        let mut j = record("s3", "Overcooked", Some(100));
        j.description = Some("overcooked detail".to_string());
        pool.push(j);
        pool.push(record("s1", "Dup Title", Some(1)));
        pool.push(record("s2", "Dup Title", Some(2)));
        let mut m = record("s3", "Dup Title", None);
        m.size_bytes = Some(1024);
        m.genres = vec!["Puzzle".to_string()];
        pool.push(m);
        pool.push(record("s4", "Dup Title", Some(2)));
        pool.push(record("s1", "!!!", Some(9)));
        pool.push(record("s1", "", None));
        pool.push(record("s1", "Zed", None));
        pool.push(record("s2", "Wye", Some(77)));
        let mut r = record("s3", "Zed", Some(77));
        r.release_year = Some(2024);
        pool.push(r);
        pool
    }

    #[test]
    fn t_partial_pool_matches_batch_at_every_prefix() {
        let pool = deterministic_pool();
        assert_partial_matches_batch(&pool, &[1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
        assert_partial_matches_batch(&pool, &[3, 2, 5, 1, 4, 3]);
        assert_partial_matches_batch(&pool, &[6]);
        assert_partial_matches_batch(&pool, &[pool.len()]);
    }

    #[test]
    fn t_partial_pool_randomized_matches_batch_at_every_prefix() {
        use rand::rngs::StdRng;
        use rand::{Rng, SeedableRng};
        let titles = [
            "Portal 2",
            "Portal 2 Deluxe",
            "Portal 2 Pre-Installed",
            "Dark Souls",
            "Dark Souls Remastered",
            "Overcooked",
            "Overcooked! 2",
            "Ratchet & Clank",
            "Ratchet and Clank",
            "Hades",
            "Hades II",
            "The Witcher 3 GOTY",
            "Elden Ring",
            "Elden Ring (v1.4)",
            "!!!",
            "",
        ];
        let genres = ["Action", "Indie", "RPG", "Puzzle", "Horror"];
        let mut rng = StdRng::seed_from_u64(0x9e37_79b9_7f4a_7c15);
        let mut pool = Vec::with_capacity(300);
        for i in 0..300 {
            let title = titles[rng.gen_range(0..titles.len())];
            let appid = match rng.gen_range(0..10) {
                0..=3 => None,
                4 => Some(0),
                k => Some(k * 7 % 9 + 1),
            };
            let mut rec = record(&format!("s{}", rng.gen_range(1..=4)), title, appid);
            rec.description = match rng.gen_range(0..3) {
                0 => None,
                1 => Some("short".to_string()),
                _ => Some(format!(
                    "a longer description number {i} with padding {}",
                    "x".repeat(rng.gen_range(0..40))
                )),
            };
            rec.genres = genres
                .iter()
                .enumerate()
                .filter(|(k, _)| rng.gen_range(0..2) == 0 && *k < 3)
                .map(|(_, g)| g.to_string())
                .collect();
            rec.added_at = Some(rng.gen_range(0..1000));
            rec.release_year = Some(1970 + rng.gen_range(0..60));
            rec.size_bytes = Some(rng.gen_range(0..100_000));
            rec.image = if rng.gen_range(0..2) == 0 {
                Some(format!("img-{i}.jpg"))
            } else {
                None
            };
            pool.push(rec);
        }
        let mut chunks = Vec::new();
        let mut start = 0;
        while start < pool.len() {
            let size = rng.gen_range(1..=50);
            chunks.push(size);
            start += size;
        }
        assert_partial_matches_batch(&pool, &chunks);
    }

    #[test]
    fn t_partial_pool_conflicting_appids_stay_separate() {
        let mut pp = PartialPool::new();
        pp.add_source(vec![record("s1", "Overcooked", Some(100))]);
        pp.add_source(vec![record("s2", "Overcooked", Some(200))]);
        pp.add_source(vec![record("s3", "Overcooked", Some(100))]);
        let (games, _, total) = pp.snapshot(&QueryParams::default());
        assert_eq!(total, 2);
        assert!(games
            .iter()
            .any(|g| g.steam_app_id == Some(100) && g.sources.len() == 2));
        assert!(games
            .iter()
            .any(|g| g.steam_app_id == Some(200) && g.sources.len() == 1));
    }

    #[test]
    fn t_partial_pool_total_can_decrease_as_sources_merge() {
        let mut pp = PartialPool::new();
        pp.add_source(vec![record("s1", "Zed", None), record("s2", "Wye", Some(77))]);
        assert_eq!(pp.snapshot(&QueryParams::default()).2, 2);
        pp.add_source(vec![record("s3", "Zed", Some(77))]);
        assert_eq!(pp.snapshot(&QueryParams::default()).2, 1);
    }

    #[test]
    fn t_partial_pool_dedup_key_flips_to_steam_when_appid_arrives() {
        let mut pp = PartialPool::new();
        pp.add_source(vec![record("s1", "Portal 2", None)]);
        let (games, _, _) = pp.snapshot(&QueryParams::default());
        assert_eq!(games[0].dedup_key, "title:portal 2");
        pp.add_source(vec![record("s2", "Portal 2 Deluxe", Some(620))]);
        let (games, _, _) = pp.snapshot(&QueryParams::default());
        assert_eq!(games.len(), 1);
        assert_eq!(games[0].dedup_key, "steam:620");
        assert_eq!(games[0].steam_app_id, Some(620));
        assert_eq!(games[0].title, "Portal 2");
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
