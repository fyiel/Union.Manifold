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

pub(crate) fn positive_appid(r: &SourceGame) -> Option<u64> {
    r.steam_app_id.filter(|v| *v > 0)
}

pub(crate) fn titles_conflict(a: Option<u64>, b: Option<u64>) -> bool {
    matches!((a, b), (Some(x), Some(y)) if x != y)
}

/// Fold one source record into a unified game, applying the field precedence
/// contract of the batch merge: title first-wins by record index, first
/// positive appid, longest description, first image/hero/developer/release
/// date/version/size, max year/added/updated, genres append-deduplicated,
/// per-record sources pushed in record order, and a dedup_key recomputed as
/// the accumulated appid or normalized title. This is the single fold used by
/// both merge_games_cached and filters::PartialPool so the two paths cannot
/// drift.
pub(crate) fn fold_record_into(game: &mut UnifiedGame, r: &SourceGame) {
    if game.title.is_empty() {
        game.title = r.title.clone();
        if game.steam_app_id.is_none() {
            game.dedup_key = dedup_key_for(None, &game.title);
        }
    }
    if game.steam_app_id.is_none() {
        if let Some(id) = positive_appid(r) {
            game.steam_app_id = Some(id);
            game.dedup_key = dedup_key_for(Some(id), &game.title);
        }
    }
    if better(&game.description, &r.description) {
        game.description = r.description.clone();
    }
    if game.image.is_none() {
        game.image = r.image.clone();
    }
    if game.hero_image.is_none() {
        game.hero_image = r.hero_image.clone();
    }
    if game.developer.is_none() {
        game.developer = r.developer.clone();
    }
    if game.release_date.is_none() {
        game.release_date = r.release_date.clone();
    }
    if game.version.is_none() {
        game.version = r.version.clone();
    }
    if game.size_bytes.is_none() {
        game.size_bytes = r.size_bytes;
        game.size_text = r.size_text.clone();
    }
    game.release_year = max_opt(game.release_year, r.release_year);
    game.added_at = max_opt(game.added_at, r.added_at);
    game.updated_at = max_opt(game.updated_at, r.updated_at);
    for g in &r.genres {
        if !game.genres.contains(g) {
            game.genres.push(g.clone());
        }
    }
    let mut source = r.clone();
    source.direct |= source
        .download_options
        .iter()
        .any(|option| option.resolvable);
    game.sources.push(source);
}

pub(crate) fn merge_games_cached(records: &mut [SourceGame]) -> Vec<UnifiedGame> {
    for record in records.iter_mut() {
        if record.normalized_title.is_empty() {
            record.normalized_title = normalize_title(&record.title);
        }
    }
    let n = records.len();
    let mut parent: Vec<usize> = (0..n).collect();
    fn find(parent: &mut [usize], mut x: usize) -> usize {
        while parent[x] != x {
            parent[x] = parent[parent[x]];
            x = parent[x];
        }
        x
    }
    fn union(parent: &mut [usize], a: usize, b: usize) {
        let ra = find(parent, a);
        let rb = find(parent, b);
        if ra != rb {
            parent[ra] = rb;
        }
    }

    let mut by_appid: HashMap<u64, usize> = HashMap::new();
    let mut by_title: HashMap<String, usize> = HashMap::new();
    for (i, r) in records.iter().enumerate() {
        if let Some(id) = positive_appid(r) {
            if let Some(&j) = by_appid.get(&id) {
                union(&mut parent, i, j);
            } else {
                by_appid.insert(id, i);
            }
        }
        let key = &r.normalized_title;
        if !key.is_empty() {
            if let Some(&j) = by_title.get(key) {
                if !titles_conflict(positive_appid(r), positive_appid(&records[j])) {
                    union(&mut parent, i, j);
                }
            } else {
                by_title.insert(key.clone(), i);
            }
        }
    }

    let mut groups: HashMap<usize, Vec<usize>> = HashMap::new();
    for i in 0..n {
        let root = find(&mut parent, i);
        groups.entry(root).or_default().push(i);
    }
    let mut groups: Vec<Vec<usize>> = groups.into_values().collect();
    groups.sort_by_key(|idxs| idxs[0]);

    let mut out = Vec::new();
    for idxs in groups {
        let mut game = UnifiedGame::default();
        for &i in &idxs {
            fold_record_into(&mut game, &records[i]);
        }
        out.push(game);
    }
    out
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
