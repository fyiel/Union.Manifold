use once_cell::sync::Lazy;
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
    pub file_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size_text: Option<String>,
    pub resolvable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
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
    pub popularity: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size_text: Option<String>,
    #[serde(default)]
    pub nsfw: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub download_options: Vec<DownloadOption>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
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
    pub popularity: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size_text: Option<String>,
    #[serde(default)]
    pub nsfw: bool,
    pub sources: Vec<SourceGame>,
    #[serde(default)]
    pub fully_resolved: bool,
}

static EDITION_NOISE: &[&str] = &[
    "deluxe", "goty", "repack", "preinstalled", "pre-installed", "edition", "definitive",
    "ultimate", "complete", "remastered", "enhanced", "collectors", "collector", "gold",
    "premium", "standard", "digital",
];

static COMBINING: Lazy<regex::Regex> =
    Lazy::new(|| regex::Regex::new(r"[\u{0300}-\u{036f}]").unwrap());
static PARENS: Lazy<regex::Regex> = Lazy::new(|| {
    regex::Regex::new(r"(?i)\s*\((?:v[\d.]+|build\s+\d+|update\s+\d+)[^)]*\)").unwrap()
});
static PUNCT: Lazy<regex::Regex> = Lazy::new(|| regex::Regex::new(r"[^\w\s]").unwrap());
static WS: Lazy<regex::Regex> = Lazy::new(|| regex::Regex::new(r"\s+").unwrap());

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
            return d.and_hms_opt(0, 0, 0).map(|dt| dt.and_utc().timestamp_millis());
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

pub fn merge_games(records: Vec<SourceGame>) -> Vec<UnifiedGame> {
    let n = records.len();
    let mut parent: Vec<usize> = (0..n).collect();
    fn find(parent: &mut Vec<usize>, mut x: usize) -> usize {
        while parent[x] != x {
            parent[x] = parent[parent[x]];
            x = parent[x];
        }
        x
    }
    fn union(parent: &mut Vec<usize>, a: usize, b: usize) {
        let ra = find(parent, a);
        let rb = find(parent, b);
        if ra != rb {
            parent[ra] = rb;
        }
    }

    let mut by_appid: HashMap<u64, usize> = HashMap::new();
    let mut by_title: HashMap<String, usize> = HashMap::new();
    for (i, r) in records.iter().enumerate() {
        if let Some(id) = r.steam_app_id.filter(|v| *v > 0) {
            if let Some(&j) = by_appid.get(&id) {
                union(&mut parent, i, j);
            } else {
                by_appid.insert(id, i);
            }
        }
        let key = normalize_title(&r.title);
        if !key.is_empty() {
            if let Some(&j) = by_title.get(&key) {
                union(&mut parent, i, j);
            } else {
                by_title.insert(key, i);
            }
        }
    }

    let mut groups: HashMap<usize, Vec<usize>> = HashMap::new();
    for i in 0..n {
        let root = find(&mut parent, i);
        groups.entry(root).or_default().push(i);
    }

    let mut out = Vec::new();
    for (_, idxs) in groups {
        let mut game = UnifiedGame::default();
        let mut appid: Option<u64> = None;
        for &i in &idxs {
            let r = &records[i];
            if game.title.is_empty() {
                game.title = r.title.clone();
            }
            appid = appid.or(r.steam_app_id.filter(|v| *v > 0));
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
            game.popularity = max_opt_f(game.popularity, r.popularity);
            game.nsfw = game.nsfw || r.nsfw;
            for g in &r.genres {
                if !game.genres.contains(g) {
                    game.genres.push(g.clone());
                }
            }
            game.sources.push(r.clone());
        }
        game.steam_app_id = appid;
        game.dedup_key = dedup_key_for(appid, &game.title);
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

fn max_opt_f(a: Option<f64>, b: Option<f64>) -> Option<f64> {
    match (a, b) {
        (Some(x), Some(y)) => Some(x.max(y)),
        (Some(x), None) => Some(x),
        (None, y) => y,
    }
}
