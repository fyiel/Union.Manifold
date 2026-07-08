//! RexaGames (https://rexagames.com) — catalogued from the Hydra download-source
//! JSON published at hydralinks.cloud, rather than scraping the Invision forum.
//!
//! The source JSON is the standard Hydra shape: a flat `downloads` list of
//! `{ title, uris, uploadDate, fileSize }`. Titles arrive in the site's
//! "<Name> Free Download (<version>)" form, so `clean_title` peels the name and
//! version; browse and search both read straight from one cached fetch of that
//! list. Each entry's `uris` are the download links — direct file-host URLs that
//! route through the shared host dispatch (`hosts::resolve_url`), with a
//! `zeilink.net/c/<slug>` container expanded into its live mirrors via the
//! public ZeiLink API first. Detail is an in-memory lookup over the same cache,
//! so a game page costs no extra network beyond the (disk-cached) Steam art
//! lookup and any container expansion.
//!
//! NOTE: hydralinks.cloud sits behind a Cloudflare check that challenges
//! datacenter IPs; the shared client (browser UA) fetches it fine from a normal
//! residential IP, which is where the app runs.

use std::collections::HashSet;
use std::sync::{Arc, LazyLock};
use std::time::Duration;

use regex::Regex;
use serde::Deserialize;
use serde_json::Value;

use crate::http;
use crate::sources::cache::Cached;
use crate::sources::hosts;
use crate::sources::schema::{
    dedup_key_for, parse_size_to_bytes, to_epoch_ms, DownloadOption, SourceGame,
};
use crate::sources::steam;
use crate::sources::{Capabilities, QueryParams};

const ID: &str = "rexagames";
const ORIGIN: &str = "https://rexagames.com";
const SOURCE_JSON: &str = "https://hydralinks.cloud/sources/rexagames.json";
const ZEILINK_API: &str = "https://zeilink.net/api/public/container";
// Cap the browse pool so the central layer sorts/filters a bounded, fresh set
// and we do at most this many (disk-cached) Steam art lookups per refresh.
const POOL_TARGET: usize = 300;
const ART_CONCURRENCY: usize = 8;

static PAREN_TAIL: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\s*\([^()]*\)\s*$").unwrap());
static FREE_DL: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\s*free\s+download\s*").unwrap());
static VER_IN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)(?:v\.?\s*)?(build\s*\d+|\d[\w.]*)").unwrap());
static WS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\s+").unwrap());
static NONWORD: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[^a-z0-9]+").unwrap());
static ZEILINK_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)^https?://(?:www\.)?zeilink\.net/c/([A-Za-z0-9]+)").unwrap()
});

/// A parsed catalogue entry: the cleaned game plus its raw download links.
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

// The whole source list behind one fetch; detail/search/browse share it.
static CATALOG: LazyLock<Cached<Arc<Vec<Entry>>>> =
    LazyLock::new(|| Cached::new(Duration::from_secs(600)));

pub fn capabilities() -> Capabilities {
    Capabilities {
        search: true,
        catalog: true,
        appid: false,
        bulk_browse: true,
        // The source JSON carries no genres, so no tag facet for this source.
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

/// Split "<Name> Free Download (<version/extras>)" into name + version. The
/// trailing paren after "Free Download" is always version/DLC noise on this
/// site, so peeling it is safe.
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

/// URL-safe, stable per cleaned title. Used as the detail slug (the source JSON
/// has no ids of its own); collisions get a numeric suffix so lookups stay 1:1.
fn slugify(title: &str) -> String {
    NONWORD
        .replace_all(&title.to_lowercase(), "-")
        .trim_matches('-')
        .to_string()
}

fn steam_image(appid: u64, kind: &str) -> String {
    format!("https://shared.steamstatic.com/store_item_assets/steam/apps/{appid}/{kind}")
}

/// Parse the source JSON body into deduped catalogue entries. Pure (no network)
/// so it can be unit-tested against a fixture.
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
        // Only http(s) links are downloadable in-app; drop magnets / empties.
        let uris: Vec<String> = d
            .uris
            .into_iter()
            .map(|u| u.trim().to_string())
            .filter(|u| u.starts_with("http"))
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

async fn catalogue() -> Option<Arc<Vec<Entry>>> {
    CATALOG
        .get_or(|| async {
            let body = http::get_text(SOURCE_JSON).await.ok()?;
            let entries = parse_source(&body);
            // hydralinks.cloud challenges flagged IPs with a Cloudflare
            // interstitial; that (or any error page) parses to zero entries.
            // Returning None keeps it out of the cache, so a transient block
            // can't pin the source blank for the whole TTL: the next browse
            // retries while a stale catalogue (if any) is served.
            if entries.is_empty() {
                crate::logging::write_line(
                    "warn",
                    "rexagames: source fetch yielded no entries (Cloudflare block or empty body)",
                );
                None
            } else {
                Some(Arc::new(entries))
            }
        })
        .await
}

/// Lightweight browse/search stub from a catalogue entry. Steam art + appid are
/// filled by `attach_steam_art`.
fn entry_to_stub(e: &Entry) -> SourceGame {
    SourceGame {
        source_id: ID.to_string(),
        source_slug: e.slug.clone(),
        source_url: e.uris.first().cloned().unwrap_or_else(|| ORIGIN.to_string()),
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

/// Resolve a Steam appid from the title so cards get Steam's portrait capsule
/// (the source has no art of its own) and dedup by appid against other sources.
/// `search_app_id` caches to disk with no TTL, so this is one lookup per new
/// title and free thereafter.
async fn attach_steam_art(mut g: SourceGame) -> SourceGame {
    if let Some(id) = steam::search_app_id(&g.title).await {
        g.steam_app_id = Some(id);
        g.dedup_key = dedup_key_for(Some(id), &g.title);
        g.image = Some(steam_image(id, "library_600x900.jpg"));
        g.hero_image = Some(steam_image(id, "library_hero.jpg"));
    }
    g
}

/// Turn a game's `uris` into download options. A ZeiLink container URL expands
/// into its live mirrors via the public API; every other URL is a direct file
/// host routed through the shared host dispatch. Resolvable hosts sort first so
/// the UI surfaces the in-app ones.
async fn options_from_uris(uris: &[String]) -> Vec<DownloadOption> {
    let mut options = Vec::new();
    for uri in uris {
        if let Some(cap) = ZEILINK_RE.captures(uri) {
            options.extend(zeilink_options(&cap[1]).await);
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

/// Read a ZeiLink container's public JSON and turn every active mirror into a
/// download option, resolvable-first so the UI surfaces the easy hosts.
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
            if !link.get("isActive").and_then(|v| v.as_bool()).unwrap_or(true) {
                continue;
            }
            let Some(url) = link.get("url").and_then(|v| v.as_str()).filter(|s| !s.is_empty())
            else {
                continue;
            };
            let host_type = hosts::detect_host_type(url);
            let size_text = link.get("fileSize").and_then(|v| v.as_str()).map(str::to_string);
            options.push(DownloadOption {
                label: if host_label.is_empty() {
                    host_type.clone()
                } else {
                    host_label.to_string()
                },
                host_type,
                url: Some(url.to_string()),
                file_name: link.get("fileName").and_then(|v| v.as_str()).map(str::to_string),
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

pub async fn query(_params: &QueryParams) -> Option<Vec<SourceGame>> {
    // None => the catalogue fetch hard-failed (Cloudflare block, no stale copy);
    // propagate it so the source is flagged errored instead of silently empty.
    let cat = catalogue().await?;
    // Newest first, capped — the central layer applies the user's real sort and
    // filters over this pool.
    let mut idx: Vec<usize> = (0..cat.len()).collect();
    idx.sort_by(|&a, &b| cat[b].added_at.cmp(&cat[a].added_at));
    idx.truncate(POOL_TARGET);
    let stubs: Vec<SourceGame> = idx.iter().map(|&i| entry_to_stub(&cat[i])).collect();
    Some(http::map_limit(stubs, ART_CONCURRENCY, |g| async move { Some(attach_steam_art(g).await) }).await)
}

pub async fn search(q: &str, limit: usize) -> Vec<SourceGame> {
    let ql = q.trim().to_lowercase();
    if ql.is_empty() {
        return Vec::new();
    }
    let terms: Vec<String> = ql.split_whitespace().map(str::to_string).collect();
    let cat = match catalogue().await {
        Some(c) => c,
        None => return Vec::new(),
    };
    let mut stubs = Vec::new();
    for e in cat.iter() {
        let title = e.title.to_lowercase();
        if terms.iter().all(|t| title.contains(t.as_str())) {
            stubs.push(entry_to_stub(e));
            if stubs.len() >= limit {
                break;
            }
        }
    }
    http::map_limit(stubs, ART_CONCURRENCY, |g| async move { Some(attach_steam_art(g).await) }).await
}

pub async fn get_detail(slug: &str) -> Option<SourceGame> {
    let clean = slug.trim_matches('/');
    let cat = catalogue().await?;
    let entry = cat.iter().find(|e| e.slug == clean)?;
    let mut game = attach_steam_art(entry_to_stub(entry)).await;
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
    fn parse_source_drops_magnet_only_and_blank_titles() {
        let entries = parse_source(FEED);
        // Magnet-only "Torrent Only Game" and the blank-title row are both dropped.
        assert_eq!(entries.len(), 3);
        let titles: Vec<&str> = entries.iter().map(|e| e.title.as_str()).collect();
        assert!(titles.contains(&"Broforce"));
        assert!(titles.contains(&"Arma Reforger"));
        assert!(!titles.contains(&"Torrent Only Game"));
    }

    #[test]
    fn parse_source_suffixes_slug_collisions() {
        let entries = parse_source(FEED);
        // Both Broforce rows clean to the same name but survive with distinct slugs.
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
    fn parse_source_keeps_only_http_uris() {
        let entries = parse_source(FEED);
        // The Arma row's magnet is filtered; only the direct http host remains.
        let arma = entries.iter().find(|e| e.title == "Arma Reforger").unwrap();
        assert_eq!(arma.uris, vec!["https://datavaults.co/file/9".to_string()]);
    }

    #[test]
    fn parse_source_parses_size_and_date_forms() {
        let entries = parse_source(FEED);
        // Every surviving row yields positive bytes, retained size text, and a
        // timestamp — the three rows cover +00:00, .000Z, and bare-Z date forms.
        for e in &entries {
            assert!(e.size_bytes.is_some_and(|b| b > 0), "size_bytes for {}", e.slug);
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
        assert!(!s.starts_with('-') && !s.ends_with('-'), "no edge dashes: {s}");
        assert_eq!(s, s.to_lowercase());
        assert!(
            s.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-'),
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
        // buzzheavier is a known/resolvable host; the unknown host is not, and
        // the resolvable option sorts ahead of it.
        assert!(options[0].resolvable);
        assert!(!options[1].resolvable);
        assert_eq!(options[0].url.as_deref(), Some("https://buzzheavier.com/xyz"));
    }
}
