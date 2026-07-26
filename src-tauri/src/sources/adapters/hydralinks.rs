use std::collections::HashSet;
use std::sync::{Arc, LazyLock};
use std::time::Duration;

use regex::Regex;
use serde::Deserialize;
use serde_json::Value;
use tokio::sync::Mutex as AsyncMutex;

use crate::http;
use crate::slipgate;
use crate::sources::hosts;
use crate::sources::metacache;
use crate::sources::schema::{
    dedup_key_for, parse_size_to_bytes, to_epoch_ms, DownloadOption, SourceGame,
};
use crate::sources::steam;
use crate::sources::Capabilities;

static REACHABLE: LazyLock<std::sync::RwLock<HashSet<&'static str>>> =
    LazyLock::new(|| std::sync::RwLock::new(HashSet::new()));

pub fn is_reachable(id: &str) -> bool {
    REACHABLE.read().map(|s| s.contains(id)).unwrap_or(false)
}

const POOL_TARGET: usize = 300;
const ART_CONCURRENCY: usize = 8;
const CATALOG_TTL_SECS: u64 = 7 * 24 * 60 * 60;
const ZEILINK_API: &str = "https://zeilink.net/api/public/container";

static PAREN_TAIL: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\s*\([^()]*\)\s*$").unwrap());
static FREE_DL: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\s*free\s+download\s*").unwrap());
static VER_IN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)(?:v\.?\s*)?(build\s*\d+|\d[\w.]*)").unwrap());
static WS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\s+").unwrap());
static NONWORD: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[^a-z0-9]+").unwrap());
static ZEILINK_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)^https?://(?:www\.)?zeilink\.net/c/([A-Za-z0-9]+)").unwrap());

#[derive(Clone)]
struct Entry {
    slug: String,
    title: String,
    version: Option<String>,
    size_text: Option<String>,
    size_bytes: Option<u64>,
    added_at: Option<i64>,
    uris: Vec<String>,
}

#[derive(Deserialize)]
struct RawDownload {
    #[serde(default)]
    title: String,
    #[serde(default)]
    uris: Vec<String>,
    #[serde(default, rename = "uploadDate")]
    upload_date: Option<String>,
    #[serde(default, rename = "fileSize")]
    file_size: Option<String>,
}

#[derive(Deserialize)]
struct RawSource {
    #[serde(default)]
    downloads: Vec<RawDownload>,
}

pub fn capabilities() -> Capabilities {
    Capabilities {
        search: true,
        catalog: true,
        appid: false,
        bulk_browse: true,
        tags: false,
        release_date: false,
        size: true,
        sort: vec![
            "latest".to_string(),
            "updated".to_string(),
            "title".to_string(),
        ],
    }
}

fn collapse(s: &str) -> String {
    WS.replace_all(s.trim(), " ").to_string()
}

fn clean_title(raw: &str) -> (String, Option<String>) {
    let mut t = collapse(&http::decode_entities(raw));
    let mut version = None;
    if let Some(m) = PAREN_TAIL.find(&t) {
        let inner = t[m.start()..].trim().trim_matches(|c| c == '(' || c == ')');
        if let Some(cap) = VER_IN.captures(inner) {
            let v = collapse(&cap[1]);
            if v.chars().any(|c| c.is_ascii_digit()) {
                version = Some(v);
            }
        }
        t = t[..m.start()].trim().to_string();
    }
    t = collapse(&FREE_DL.replace(&t, " "));
    (t, version)
}

fn slugify(title: &str) -> String {
    NONWORD
        .replace_all(&title.to_lowercase(), "-")
        .trim_matches('-')
        .to_string()
}

fn steam_image(appid: u64, kind: &str) -> String {
    format!("https://shared.steamstatic.com/store_item_assets/steam/apps/{appid}/{kind}")
}

fn parse_source(body: &str) -> Vec<Entry> {
    let raw: RawSource = match serde_json::from_str(body) {
        Ok(r) => r,
        Err(_) => return Vec::new(),
    };
    let mut seen: HashSet<String> = HashSet::new();
    let mut out = Vec::new();
    for d in raw.downloads {
        let (title, version) = clean_title(&d.title);
        if title.is_empty() {
            continue;
        }
        let uris: Vec<String> = d
            .uris
            .into_iter()
            .map(|u| u.trim().to_string())
            .filter(|u| u.starts_with("http") || u.starts_with("magnet:"))
            .collect();
        if uris.is_empty() {
            continue;
        }
        let base = slugify(&title);
        if base.is_empty() {
            continue;
        }
        let mut slug = base.clone();
        let mut n = 1;
        while seen.contains(&slug) {
            n += 1;
            slug = format!("{base}-{n}");
        }
        seen.insert(slug.clone());

        let size_text = d.file_size.map(|s| collapse(&s)).filter(|s| !s.is_empty());
        let size_bytes = size_text.as_deref().and_then(parse_size_to_bytes);
        let added_at = d.upload_date.as_deref().and_then(to_epoch_ms);
        out.push(Entry {
            slug,
            title,
            version,
            size_text,
            size_bytes,
            added_at,
            uris,
        });
    }
    out
}

fn disk_age_secs(path: &std::path::Path) -> Option<u64> {
    std::fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.elapsed().ok())
        .map(|d| d.as_secs())
}

fn parse_from_disk(path: &std::path::Path) -> Option<Arc<Vec<Entry>>> {
    let entries = parse_source(&std::fs::read_to_string(path).ok()?);
    if entries.is_empty() {
        None
    } else {
        Some(Arc::new(entries))
    }
}

async fn attach_steam_art(mut g: SourceGame) -> SourceGame {
    if let Some(id) = steam::search_app_id(&g.title).await {
        g.steam_app_id = Some(id);
        g.dedup_key = dedup_key_for(Some(id), &g.title);
        g.image = Some(steam_image(id, "library_600x900.jpg"));
        g.hero_image = Some(steam_image(id, "library_hero.jpg"));
    }
    g
}

async fn options_from_uris(uris: &[String]) -> Vec<DownloadOption> {
    let mut options = Vec::new();
    for uri in uris {
        if let Some(cap) = ZEILINK_RE.captures(uri) {
            options.extend(zeilink_options(&cap[1]).await);
            continue;
        }
        if uri.starts_with("magnet:") {
            options.push(DownloadOption {
                label: "torrent (magnet)".to_string(),
                host_type: "magnet".to_string(),
                url: Some(uri.clone()),
                resolvable: false,
                ..Default::default()
            });
            continue;
        }
        let host_type = hosts::detect_host_type(uri);
        options.push(DownloadOption {
            label: host_type.clone(),
            host_type,
            url: Some(uri.clone()),
            resolvable: hosts::is_resolvable(uri),
            ..Default::default()
        });
    }
    options.sort_by(|a, b| (b.resolvable as u8).cmp(&(a.resolvable as u8)));
    options
}

async fn zeilink_options(slug: &str) -> Vec<DownloadOption> {
    let json: Value = match http::get_json(&format!("{ZEILINK_API}/{slug}")).await {
        Ok(v) => v,
        Err(_) => return Vec::new(),
    };
    let mut options = Vec::new();
    let hosts_arr = json.get("hosts").and_then(|h| h.as_array());
    for host in hosts_arr.into_iter().flatten() {
        let host_label = host.get("name").and_then(|v| v.as_str()).unwrap_or("");
        let links = host.get("links").and_then(|l| l.as_array());
        for link in links.into_iter().flatten() {
            if !link
                .get("isActive")
                .and_then(|v| v.as_bool())
                .unwrap_or(true)
            {
                continue;
            }
            let Some(url) = link
                .get("url")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
            else {
                continue;
            };
            let host_type = hosts::detect_host_type(url);
            let size_text = link
                .get("fileSize")
                .and_then(|v| v.as_str())
                .map(str::to_string);
            options.push(DownloadOption {
                label: if host_label.is_empty() {
                    host_type.clone()
                } else {
                    host_label.to_string()
                },
                host_type,
                url: Some(url.to_string()),
                file_name: link
                    .get("fileName")
                    .and_then(|v| v.as_str())
                    .map(str::to_string),
                size_bytes: size_text.as_deref().and_then(parse_size_to_bytes),
                size_text,
                resolvable: hosts::is_resolvable(url),
                ..Default::default()
            });
        }
    }
    options.sort_by(|a, b| (b.resolvable as u8).cmp(&(a.resolvable as u8)));
    options
}

pub struct HydraSource {
    id: &'static str,
    origin: &'static str,
    source_json: &'static str,
    mem: AsyncMutex<Option<Arc<Vec<Entry>>>>,
}

impl HydraSource {
    pub fn new(id: &'static str, origin: &'static str, source_json: &'static str) -> Self {
        HydraSource {
            id,
            origin,
            source_json,
            mem: AsyncMutex::new(None),
        }
    }

    fn cache_file(&self) -> String {
        format!("{}-source.json", self.id)
    }

    async fn fetch_source_body(&self) -> Option<String> {
        if let Some(cfg) = slipgate::cfg() {
            match slipgate::fetch(&cfg, self.source_json, Duration::from_secs(150)).await {
                Ok(body) if !parse_source(&body).is_empty() => return Some(body),
                Ok(body) => crate::logging::write_line(
                    "warn",
                    &format!(
                        "{}: slipgate returned {} bytes, 0 catalogue entries",
                        self.id,
                        body.len()
                    ),
                ),
                Err(e) => crate::logging::write_line(
                    "warn",
                    &format!("{}: slipgate fetch failed: {e}", self.id),
                ),
            }
        }
        match http::get_text(self.source_json).await {
            Ok(body) if !parse_source(&body).is_empty() => Some(body),
            _ => None,
        }
    }

    async fn catalogue_opt(&self, force: bool) -> Option<Arc<Vec<Entry>>> {
        let result = self.load(force).await;
        if let Ok(mut set) = REACHABLE.write() {
            if result.is_some() {
                set.insert(self.id);
            } else {
                set.remove(self.id);
            }
        }
        result
    }

    async fn load(&self, force: bool) -> Option<Arc<Vec<Entry>>> {
        let mut mem = self.mem.lock().await;
        let path = metacache::file_path(&self.cache_file());
        let fresh = path
            .as_ref()
            .and_then(|p| disk_age_secs(p))
            .map(|age| age < CATALOG_TTL_SECS)
            .unwrap_or(false);

        if !force && fresh {
            if let Some(c) = mem.as_ref() {
                return Some(c.clone());
            }
            if let Some(arc) = path.as_ref().and_then(|p| parse_from_disk(p)) {
                *mem = Some(arc.clone());
                return Some(arc);
            }
        }

        if let Some(body) = self.fetch_source_body().await {
            let parsed = parse_source(&body);
            let prev = mem.as_ref().map(|c| c.len()).unwrap_or(0);
            if prev >= 50 && parsed.len() * 2 < prev {
                crate::logging::write_line(
                    "warn",
                    &format!(
                        "{}: fetched {} entries but cache holds {}, keeping cache",
                        self.id,
                        parsed.len(),
                        prev
                    ),
                );
            } else {
                if let Some(p) = &path {
                    let tmp = p.with_extension("json.tmp");
                    if std::fs::write(&tmp, &body).is_ok() {
                        std::fs::rename(&tmp, p).ok();
                    }
                }
                let arc = Arc::new(parsed);
                *mem = Some(arc.clone());
                return Some(arc);
            }
        }

        if let Some(c) = mem.as_ref() {
            return Some(c.clone());
        }
        if let Some(arc) = path.as_ref().and_then(|p| parse_from_disk(p)) {
            *mem = Some(arc.clone());
            return Some(arc);
        }
        None
    }

    async fn catalogue(&self) -> Option<Arc<Vec<Entry>>> {
        self.catalogue_opt(false).await
    }

    pub async fn prime_direct(&self) -> bool {
        let Ok(body) = http::get_text(self.source_json).await else {
            return false;
        };
        let parsed = parse_source(&body);
        if parsed.is_empty() {
            return false;
        }
        if let Some(p) = metacache::file_path(&self.cache_file()) {
            let tmp = p.with_extension("json.tmp");
            if std::fs::write(&tmp, &body).is_ok() {
                std::fs::rename(&tmp, &p).ok();
            }
        }
        *self.mem.lock().await = Some(Arc::new(parsed));
        if let Ok(mut set) = REACHABLE.write() {
            set.insert(self.id);
        }
        true
    }

    pub async fn refresh(&self) -> Option<usize> {
        self.catalogue_opt(true).await.map(|c| c.len())
    }

    fn entry_to_stub(&self, e: &Entry) -> SourceGame {
        SourceGame {
            source_id: self.id.to_string(),
            source_slug: e.slug.clone(),
            source_url: e
                .uris
                .first()
                .cloned()
                .unwrap_or_else(|| self.origin.to_string()),
            dedup_key: dedup_key_for(None, &e.title),
            title: e.title.clone(),
            added_at: e.added_at,
            updated_at: e.added_at,
            version: e.version.clone(),
            size_bytes: e.size_bytes,
            size_text: e.size_text.clone(),
            ..Default::default()
        }
    }

    pub async fn query(&self) -> Option<Vec<SourceGame>> {
        let cat = self.catalogue().await?;
        let mut idx: Vec<usize> = (0..cat.len()).collect();
        idx.sort_by(|&a, &b| cat[b].added_at.cmp(&cat[a].added_at));
        idx.truncate(POOL_TARGET);
        let stubs: Vec<SourceGame> = idx.iter().map(|&i| self.entry_to_stub(&cat[i])).collect();
        Some(
            http::map_limit(stubs, ART_CONCURRENCY, |g| async move {
                Some(attach_steam_art(g).await)
            })
            .await,
        )
    }

    pub async fn search(&self, q: &str, limit: usize) -> Vec<SourceGame> {
        let ql = q.trim().to_lowercase();
        if ql.is_empty() {
            return Vec::new();
        }
        let terms: Vec<String> = ql.split_whitespace().map(str::to_string).collect();
        let cat = match self.catalogue().await {
            Some(c) => c,
            None => return Vec::new(),
        };
        let mut stubs = Vec::new();
        for e in cat.iter() {
            let title = e.title.to_lowercase();
            if terms.iter().all(|t| title.contains(t.as_str())) {
                stubs.push(self.entry_to_stub(e));
                if stubs.len() >= limit {
                    break;
                }
            }
        }
        http::map_limit(stubs, ART_CONCURRENCY, |g| async move {
            Some(attach_steam_art(g).await)
        })
        .await
    }

    pub async fn get_detail(&self, slug: &str) -> Option<SourceGame> {
        let clean = slug.trim_matches('/');
        let cat = self.catalogue().await?;
        let entry = cat.iter().find(|e| e.slug == clean)?;
        let mut game = attach_steam_art(self.entry_to_stub(entry)).await;
        let options = options_from_uris(&entry.uris).await;
        game.size_bytes = game
            .size_bytes
            .or_else(|| options.iter().filter_map(|o| o.size_bytes).max());
        game.size_text = game
            .size_text
            .clone()
            .or_else(|| options.iter().find_map(|o| o.size_text.clone()));
        game.download_options = options;
        Some(game)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clean_title_strips_free_download_and_version() {
        let (t, v) = clean_title("Broforce Free Download (Build 12964083 + Online)");
        assert_eq!(t, "Broforce");
        assert_eq!(v.as_deref(), Some("Build 12964083"));
        let (t, v) = clean_title("Arma Reforger Free Download (v1.7.0.41 + Supporter Pack DLC)");
        assert_eq!(t, "Arma Reforger");
        assert_eq!(v.as_deref(), Some("1.7.0.41"));
        let (t, _) = clean_title("Don&#8217;t Starve Free Download");
        assert_eq!(t, "Don\u{2019}t Starve");
    }

    const FEED: &str = r#"{
  "name": "RexaGames",
  "downloads": [
    { "title": "Broforce Free Download (Build 12964083 + Online)", "uris": ["https://gofile.io/d/abc123"], "uploadDate": "2025-01-16T15:58:09+00:00", "fileSize": "1.2 GB" },
    { "title": "Broforce Free Download (Build 20000000)", "uris": ["https://buzzheavier.com/xyz"], "uploadDate": "2025-02-01T00:00:00.000Z", "fileSize": "1.3 GB" },
    { "title": "Arma Reforger Free Download (v1.7.0.41)", "uris": ["magnet:?xt=urn:btih:DEADBEEF", "https://datavaults.co/file/9"], "uploadDate": "2025-03-01T12:00:00Z", "fileSize": "20 GB" },
    { "title": "Torrent Only Game", "uris": ["magnet:?xt=urn:btih:CAFE"], "uploadDate": "2024-01-01T00:00:00Z", "fileSize": "5 GB" },
    { "title": "   ", "uris": ["https://example.com/x"], "uploadDate": "2024-01-01T00:00:00Z", "fileSize": "1 GB" }
  ]
}"#;

    #[test]
    fn parse_source_keeps_magnet_and_drops_blank_titles() {
        let entries = parse_source(FEED);
        assert_eq!(entries.len(), 4);
        let titles: Vec<&str> = entries.iter().map(|e| e.title.as_str()).collect();
        assert!(titles.contains(&"Broforce"));
        assert!(titles.contains(&"Arma Reforger"));
        assert!(titles.contains(&"Torrent Only Game"));
    }

    #[test]
    fn parse_source_suffixes_slug_collisions() {
        let entries = parse_source(FEED);
        let slugs: Vec<&str> = entries
            .iter()
            .filter(|e| e.title == "Broforce")
            .map(|e| e.slug.as_str())
            .collect();
        assert_eq!(slugs.len(), 2);
        assert!(slugs.contains(&"broforce"));
        assert!(slugs.contains(&"broforce-2"));
    }

    #[test]
    fn parse_source_peels_version_from_title() {
        let entries = parse_source(FEED);
        let first_broforce = entries.iter().find(|e| e.slug == "broforce").unwrap();
        assert_eq!(first_broforce.version.as_deref(), Some("Build 12964083"));
        let arma = entries.iter().find(|e| e.title == "Arma Reforger").unwrap();
        assert_eq!(arma.version.as_deref(), Some("1.7.0.41"));
    }

    #[test]
    fn parse_source_keeps_http_and_magnet_uris() {
        let entries = parse_source(FEED);
        let arma = entries.iter().find(|e| e.title == "Arma Reforger").unwrap();
        assert_eq!(
            arma.uris,
            vec![
                "magnet:?xt=urn:btih:DEADBEEF".to_string(),
                "https://datavaults.co/file/9".to_string(),
            ]
        );
    }

    #[test]
    fn parse_source_parses_size_and_date_forms() {
        let entries = parse_source(FEED);
        for e in &entries {
            assert!(
                e.size_bytes.is_some_and(|b| b > 0),
                "size_bytes for {}",
                e.slug
            );
            assert!(e.size_text.is_some(), "size_text for {}", e.slug);
            assert!(e.added_at.is_some(), "added_at for {}", e.slug);
        }
        let first_broforce = entries.iter().find(|e| e.slug == "broforce").unwrap();
        assert_eq!(first_broforce.size_text.as_deref(), Some("1.2 GB"));
    }

    #[test]
    fn parse_source_returns_empty_on_bad_or_empty_json() {
        assert!(parse_source("not json").is_empty());
        assert!(parse_source("{}").is_empty());
    }

    #[test]
    fn slugify_produces_clean_lowercase_slugs() {
        let s = slugify("Don't Starve!!");
        assert!(
            !s.starts_with('-') && !s.ends_with('-'),
            "no edge dashes: {s}"
        );
        assert_eq!(s, s.to_lowercase());
        assert!(
            s.chars()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-'),
            "slug charset: {s}"
        );
        assert_eq!(slugify("Broforce"), "broforce");
    }

    #[tokio::test]
    async fn options_from_uris_sorts_resolvable_first_without_network() {
        let uris = vec![
            "https://buzzheavier.com/xyz".to_string(),
            "https://no-such-host.example/x".to_string(),
        ];
        let options = options_from_uris(&uris).await;
        assert_eq!(options.len(), 2);
        assert!(options.iter().all(|o| o.url.is_some()));
        assert!(options[0].resolvable);
        assert!(!options[1].resolvable);
        assert_eq!(
            options[0].url.as_deref(),
            Some("https://buzzheavier.com/xyz")
        );
    }
}
