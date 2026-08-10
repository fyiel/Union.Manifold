use std::sync::LazyLock;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use unicode_normalization::UnicodeNormalization;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DownloadOption {
    pub label: String,
    pub host_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub page_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size_text: Option<String>,
    pub resolvable: bool,
    /// Extra part URLs of a multi-part mirror. `url` is part one; extraction
    /// only succeeds once every part is downloaded into the same directory.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub parts: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SourceGame {
    pub source_id: String,
    pub source_slug: String,
    pub source_url: String,
    pub steam_app_id: Option<u64>,
    pub dedup_key: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hero_image: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub genres: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub developer: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub release_date: Option<String>,
    pub release_year: Option<i32>,
    pub added_at: Option<i64>,
    pub updated_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size_text: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub download_options: Vec<DownloadOption>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub direct: bool,
    #[serde(skip)]
    pub(crate) normalized_title: String,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UnifiedGame {
    pub dedup_key: String,
    pub steam_app_id: Option<u64>,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hero_image: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub genres: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub developer: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub release_date: Option<String>,
    pub release_year: Option<i32>,
    pub added_at: Option<i64>,
    pub updated_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size_text: Option<String>,
    pub sources: Vec<SourceGame>,
    #[serde(default)]
    pub fully_resolved: bool,
}

impl SourceGame {
    fn browse_summary(&self) -> Self {
        Self {
            source_id: self.source_id.clone(),
            source_slug: self.source_slug.clone(),
            source_url: self.source_url.clone(),
            steam_app_id: self.steam_app_id,
            dedup_key: self.dedup_key.clone(),
            title: self.title.clone(),
            description: None,
            image: self.image.clone(),
            hero_image: self.hero_image.clone(),
            genres: self.genres.clone(),
            developer: self.developer.clone(),
            release_date: self.release_date.clone(),
            release_year: self.release_year,
            added_at: self.added_at,
            updated_at: self.updated_at,
            version: self.version.clone(),
            size_bytes: self.size_bytes,
            size_text: self.size_text.clone(),
            download_options: Vec::new(),
            direct: self.direct || self.download_options.iter().any(|option| option.resolvable),
            normalized_title: String::new(),
        }
    }
}

impl UnifiedGame {
    pub fn browse_summary(&self) -> Self {
        Self {
            dedup_key: self.dedup_key.clone(),
            steam_app_id: self.steam_app_id,
            title: self.title.clone(),
            description: self.description.clone(),
            image: self.image.clone(),
            hero_image: self.hero_image.clone(),
            genres: self.genres.clone(),
            developer: self.developer.clone(),
            release_date: self.release_date.clone(),
            release_year: self.release_year,
            added_at: self.added_at,
            updated_at: self.updated_at,
            version: self.version.clone(),
            size_bytes: self.size_bytes,
            size_text: self.size_text.clone(),
            sources: self
                .sources
                .iter()
                .map(SourceGame::browse_summary)
                .collect(),
            fully_resolved: false,
        }
    }
}

impl AsRef<UnifiedGame> for UnifiedGame {
    fn as_ref(&self) -> &UnifiedGame {
        self
    }
}

static EDITION_NOISE: &[&str] = &[
    "deluxe",
    "goty",
    "repack",
    "preinstalled",
    "pre-installed",
    "edition",
    "definitive",
    "ultimate",
    "complete",
    "remastered",
    "enhanced",
    "collectors",
    "collector",
    "gold",
    "premium",
    "standard",
    "digital",
];

static COMBINING: LazyLock<regex::Regex> =
    LazyLock::new(|| regex::Regex::new(r"[\u{0300}-\u{036f}]").unwrap());
static PARENS: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(r"(?i)\s*\((?:v[\d.]+|build\s+\d+|update\s+\d+)[^)]*\)").unwrap()
});
static PUNCT: LazyLock<regex::Regex> = LazyLock::new(|| regex::Regex::new(r"[^\w\s]").unwrap());
static WS: LazyLock<regex::Regex> = LazyLock::new(|| regex::Regex::new(r"\s+").unwrap());

pub fn normalize_title(title: &str) -> String {
    let lowered = title.to_lowercase();
    let decomposed: String = lowered.nfd().collect();
    let stripped = COMBINING.replace_all(&decomposed, "");
    let anded = stripped.replace('&', " and ");
    let no_trademark = anded.replace(['\u{2122}', '\u{00ae}', '\u{00a9}'], "");
    let no_parens = PARENS.replace_all(&no_trademark, "");
    let no_punct = PUNCT.replace_all(&no_parens, " ");
    let collapsed = WS.replace_all(&no_punct, " ");
    collapsed
        .split_whitespace()
        .filter(|w| !EDITION_NOISE.contains(w))
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_string()
}

pub fn dedup_key_for(steam_app_id: Option<u64>, title: &str) -> String {
    match steam_app_id {
        Some(id) if id > 0 => format!("steam:{id}"),
        _ => format!("title:{}", normalize_title(title)),
    }
}

pub fn parse_size_to_bytes(text: &str) -> Option<u64> {
    let re = regex::Regex::new(r"(?i)([\d.]+)\s*(tb|gb|mb|kb|b)").ok()?;
    let caps = re.captures(text.trim())?;
    let num: f64 = caps.get(1)?.as_str().parse().ok()?;
    let mult = match caps.get(2)?.as_str().to_lowercase().as_str() {
        "tb" => 1024f64.powi(4),
        "gb" => 1024f64.powi(3),
        "mb" => 1024f64.powi(2),
        "kb" => 1024f64,
        _ => 1.0,
    };
    Some((num * mult) as u64)
}

pub fn to_epoch_ms(s: &str) -> Option<i64> {
    let s = s.trim();
    if s.is_empty() {
        return None;
    }
    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(s) {
        return Some(dt.timestamp_millis());
    }
    if let Ok(dt) = chrono::DateTime::parse_from_rfc2822(s) {
        return Some(dt.timestamp_millis());
    }
    for fmt in [
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d",
        "%d %b, %Y",
        "%d %B, %Y",
        "%b %d, %Y",
        "%B %d, %Y",
    ] {
        if let Ok(d) = chrono::NaiveDate::parse_from_str(s, fmt) {
            return d
                .and_hms_opt(0, 0, 0)
                .map(|dt| dt.and_utc().timestamp_millis());
        }
        if let Ok(dt) = chrono::NaiveDateTime::parse_from_str(s, fmt) {
            return Some(dt.and_utc().timestamp_millis());
        }
    }
    None
}

pub fn year_from(s: &str) -> Option<i32> {
    regex::Regex::new(r"(\d{4})")
        .ok()?
        .captures(s)?
        .get(1)?
        .as_str()
        .parse()
        .ok()
        .filter(|y: &i32| *y >= 1970 && *y <= 2100)
}

pub fn merge_games(mut records: Vec<SourceGame>) -> Vec<UnifiedGame> {
    merge_games_cached(&mut records)
}

pub(crate) fn merge_games_cached(records: &mut [SourceGame]) -> Vec<UnifiedGame> {
    let mut pool = PartialPool::new();
    for i in 0..records.len() {
        pool.push(records, i);
    }
    pool.finalize_games()
}

/// Accumulated fold of one dedup group. The merge precedence rules from the
/// former batch-only fold live here and in `fold_into`, so the batch path
/// (`merge_games_cached` via `PartialPool`) and the incremental streaming path
/// (`PartialPool` reused across partials) cannot drift.
#[derive(Default)]
struct GroupState {
    title: String,
    appid: Option<u64>,
    description: Option<String>,
    image: Option<String>,
    hero_image: Option<String>,
    developer: Option<String>,
    release_date: Option<String>,
    version: Option<String>,
    size_bytes: Option<u64>,
    size_text: Option<String>,
    release_year: Option<i32>,
    added_at: Option<i64>,
    updated_at: Option<i64>,
    genres: Vec<String>,
    sources: Vec<SourceGame>,
}

/// Fold one record into a group state following the shared precedence rules:
/// title first-wins by record index, first positive appid, longest description,
/// first-wins image/hero/developer/release_date/version/size, max timestamps and
/// year, genres append-dedup, sources in record order.
fn fold_into(state: &mut GroupState, r: &SourceGame) {
    if state.title.is_empty() {
        state.title = r.title.clone();
    }
    state.appid = state.appid.or(r.steam_app_id.filter(|v| *v > 0));
    if better(&state.description, &r.description) {
        state.description = r.description.clone();
    }
    if state.image.is_none() {
        state.image = r.image.clone();
    }
    if state.hero_image.is_none() {
        state.hero_image = r.hero_image.clone();
    }
    if state.developer.is_none() {
        state.developer = r.developer.clone();
    }
    if state.release_date.is_none() {
        state.release_date = r.release_date.clone();
    }
    if state.version.is_none() {
        state.version = r.version.clone();
    }
    if state.size_bytes.is_none() {
        state.size_bytes = r.size_bytes;
        state.size_text = r.size_text.clone();
    }
    state.release_year = max_opt(state.release_year, r.release_year);
    state.added_at = max_opt(state.added_at, r.added_at);
    state.updated_at = max_opt(state.updated_at, r.updated_at);
    for g in &r.genres {
        if !state.genres.contains(g) {
            state.genres.push(g.clone());
        }
    }
    let mut source = r.clone();
    source.direct |= source
        .download_options
        .iter()
        .any(|option| option.resolvable);
    state.sources.push(source);
}

fn materialize(state: &GroupState) -> UnifiedGame {
    let appid = state.appid;
    UnifiedGame {
        steam_app_id: appid,
        title: state.title.clone(),
        description: state.description.clone(),
        image: state.image.clone(),
        hero_image: state.hero_image.clone(),
        genres: state.genres.clone(),
        developer: state.developer.clone(),
        release_date: state.release_date.clone(),
        release_year: state.release_year,
        added_at: state.added_at,
        updated_at: state.updated_at,
        version: state.version.clone(),
        size_bytes: state.size_bytes,
        size_text: state.size_text.clone(),
        sources: state.sources.clone(),
        dedup_key: dedup_key_for(appid, &state.title),
        fully_resolved: false,
    }
}

struct Group {
    /// Index of the group's earliest record: the stable sort key for output
    /// order (groups are emitted by ascending first-record index, matching the
    /// batch path).
    first: usize,
    /// Member record indices in ascending order. Needed to re-fold in index
    /// order when two established groups merge through a bridging record.
    members: Vec<usize>,
    state: GroupState,
    /// Last materialized game for this group, reused across partials until the
    /// group is dirty, so streaming snapshots avoid re-cloning every game.
    materialized: Option<UnifiedGame>,
    dirty: bool,
}

/// Incremental dedup index over a streamed record pool. Mirrors exactly the
/// dedup/conflict semantics of `merge_games_cached`: records link by positive
/// steam appid, or by normalized title unless the first title claimant holds a
/// different positive appid (conflict keeps them separate). Records arrive in
/// index order, so each record folds into its group once; only the rare bridge
/// case (a record linking two established groups) re-folds.
pub struct PartialPool {
    parent: Vec<usize>,
    size: Vec<usize>,
    by_appid: HashMap<u64, usize>,
    by_title: HashMap<String, usize>,
    groups: HashMap<usize, Group>,
}

impl PartialPool {
    pub fn new() -> Self {
        PartialPool {
            parent: Vec::new(),
            size: Vec::new(),
            by_appid: HashMap::new(),
            by_title: HashMap::new(),
            groups: HashMap::new(),
        }
    }

    /// Index record `i` (which must already be in `records`) and fold it into
    /// its dedup group. Memoizes `normalized_title` on the record (frozen
    /// pipeline), so repeated calls on the same slice stay cached.
    pub fn push(&mut self, records: &mut [SourceGame], i: usize) {
        if records[i].normalized_title.is_empty() {
            records[i].normalized_title = normalize_title(&records[i].title);
        }
        while self.parent.len() <= i {
            self.parent.push(self.parent.len());
            self.size.push(1);
        }
        self.groups.insert(
            i,
            Group {
                first: i,
                members: vec![i],
                state: GroupState::default(),
                materialized: None,
                dirty: true,
            },
        );
        let appid = records[i].steam_app_id.filter(|v| *v > 0);
        let key = records[i].normalized_title.clone();
        if let Some(id) = appid {
            if let Some(&j) = self.by_appid.get(&id) {
                self.join(records, i, j);
            } else {
                self.by_appid.insert(id, i);
            }
        }
        if !key.is_empty() {
            if let Some(&j) = self.by_title.get(&key) {
                let other = records[j].steam_app_id.filter(|v| *v > 0);
                let conflict = matches!((appid, other), (Some(x), Some(y)) if x != y);
                if !conflict {
                    self.join(records, i, j);
                }
            } else {
                self.by_title.insert(key, i);
            }
        }
        if self.groups.contains_key(&i) {
            let group = self.groups.get_mut(&i).unwrap();
            fold_into(&mut group.state, &records[i]);
        }
    }

    /// Materialize every dirty group and return references to all games in
    /// first-record-index order. Clean groups reuse their previous
    /// materialization, so repeated partials only clone groups that changed.
    pub fn snapshot(&mut self) -> Vec<&UnifiedGame> {
        let roots: Vec<usize> = self.groups.keys().copied().collect();
        for root in roots {
            let group = self.groups.get_mut(&root).unwrap();
            if group.dirty {
                group.materialized = Some(materialize(&group.state));
                group.dirty = false;
            }
        }
        let mut ordered: Vec<(usize, usize)> = self
            .groups
            .iter()
            .map(|(&root, group)| (group.first, root))
            .collect();
        ordered.sort_unstable();
        ordered
            .into_iter()
            .map(|(_, root)| self.groups.get(&root).unwrap().materialized.as_ref().unwrap())
            .collect()
    }

    /// One-shot owned materialization of every group in first-record-index
    /// order (the batch path).
    pub fn finalize_games(&self) -> Vec<UnifiedGame> {
        let mut ordered: Vec<(usize, usize)> = self
            .groups
            .iter()
            .map(|(&root, group)| (group.first, root))
            .collect();
        ordered.sort_unstable();
        ordered
            .into_iter()
            .map(|(_, root)| materialize(&self.groups.get(&root).unwrap().state))
            .collect()
    }

    fn find(&mut self, mut x: usize) -> usize {
        let mut root = x;
        while self.parent[root] != root {
            root = self.parent[root];
        }
        while self.parent[x] != root {
            let next = self.parent[x];
            self.parent[x] = root;
            x = next;
        }
        root
    }

    /// Merge record `i`'s group with the group containing `j`. When `i` is a
    /// freshly pushed singleton this is an O(1) incremental fold; when two
    /// established groups meet (the bridging-record case) the combined members
    /// are re-folded in index order from the records.
    fn join(&mut self, records: &[SourceGame], i: usize, j: usize) {
        let ri = self.find(i);
        let rj = self.find(j);
        if ri == rj {
            return;
        }
        let fresh = self.groups[&ri].members.len() == 1 && self.groups[&ri].members[0] == i;
        if fresh {
            self.parent[ri] = rj;
            self.size[rj] += 1;
            let group = self.groups.get_mut(&rj).unwrap();
            group.members.push(i);
            fold_into(&mut group.state, &records[i]);
            group.materialized = None;
            group.dirty = true;
            self.groups.remove(&ri);
            return;
        }
        let (big, small) = if self.size[ri] >= self.size[rj] {
            (ri, rj)
        } else {
            (rj, ri)
        };
        self.parent[small] = big;
        self.size[big] += self.size[small];
        let small_group = self.groups.remove(&small).unwrap();
        let big_group = self.groups.get_mut(&big).unwrap();
        let mut members = Vec::with_capacity(big_group.members.len() + small_group.members.len());
        let (mut a, mut b) = (0, 0);
        while a < big_group.members.len() && b < small_group.members.len() {
            if big_group.members[a] < small_group.members[b] {
                members.push(big_group.members[a]);
                a += 1;
            } else {
                members.push(small_group.members[b]);
                b += 1;
            }
        }
        members.extend_from_slice(&big_group.members[a..]);
        members.extend_from_slice(&small_group.members[b..]);
        big_group.members = members;
        big_group.first = big_group.first.min(small_group.first);
        let mut state = GroupState::default();
        for &m in &big_group.members {
            fold_into(&mut state, &records[m]);
        }
        big_group.state = state;
        big_group.materialized = None;
        big_group.dirty = true;
    }
}

fn better(cur: &Option<String>, cand: &Option<String>) -> bool {
    match (cur, cand) {
        (_, None) => false,
        (None, Some(_)) => true,
        (Some(a), Some(b)) => b.len() > a.len(),
    }
}

fn max_opt<T: Ord + Copy>(a: Option<T>, b: Option<T>) -> Option<T> {
    match (a, b) {
        (Some(x), Some(y)) => Some(x.max(y)),
        (Some(x), None) => Some(x),
        (None, y) => y,
    }
}


#[cfg(test)]
mod tests {
    use super::*;

    fn sg(title: &str, appid: Option<u64>) -> SourceGame {
        SourceGame {
            title: title.to_string(),
            steam_app_id: appid,
            ..Default::default()
        }
    }

    #[test]
    fn t_normalize_title_strips_edition_noise() {
        assert_eq!(normalize_title("Dark Souls"), "dark souls");
        assert_eq!(
            normalize_title("Dark Souls"),
            normalize_title("Dark Souls Remastered"),
        );
    }

    #[test]
    fn t_merge_games_keeps_distinct_appids_apart() {
        let out = merge_games(vec![
            sg("Dark Souls", Some(1)),
            sg("Dark Souls Remastered", Some(2)),
        ]);
        assert_eq!(out.len(), 2);
    }

    #[test]
    fn t_merge_games_merges_same_title_without_appid_conflict() {
        let no_ids = merge_games(vec![
            sg("Dark Souls", None),
            sg("Dark Souls Remastered", None),
        ]);
        assert_eq!(no_ids.len(), 1);

        let same_id = merge_games(vec![
            sg("Portal", Some(400)),
            sg("Portal Deluxe Edition", Some(400)),
        ]);
        assert_eq!(same_id.len(), 1);
    }

    #[test]
    fn t_merge_games_is_deterministic() {
        let records = || {
            vec![
                sg("Alpha", Some(10)),
                sg("Beta", Some(20)),
                sg("Gamma", Some(30)),
                sg("Delta", Some(40)),
            ]
        };
        let order = |v: Vec<UnifiedGame>| {
            v.into_iter()
                .map(|g| (g.title, g.steam_app_id))
                .collect::<Vec<_>>()
        };
        let first = order(merge_games(records()));
        let second = order(merge_games(records()));
        assert_eq!(first, second);
        assert_eq!(first.len(), 4);
    }
}

#[cfg(test)]
#[path = "../../../.dev/rust/schema_tests.rs"]
mod dev_schema_tests;
