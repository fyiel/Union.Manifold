//! AstralGames (https://astralgames.net) — a Next.js pre-installed-games catalog
//! backed by Supabase, with Steam metadata proxied through api.bonker.dev. Browse
//! (`/?page=N`) is a server-rendered listing we parse into game cards; search is a
//! paginated Next.js server action returning JSON (its build-versioned action id is
//! discovered at runtime from the page's client chunks, with a browse-pool title
//! filter as fallback). Detail (`/game/<slug>`) embeds the game object in its RSC
//! payload, from which we lift the Steam appid, tags, nsfw flag and the download
//! button's Pearcrypt link-container url.
//!
//! Pearcrypt is a link container whose public JSON API
//! (`/api/container/<id>/mirrors`) lists every mirror host + file url, so we
//! expand it into one option per live mirror and route each through the shared
//! host dispatch (`hosts::resolve_url`) at download time — no source-specific
//! resolver. Most mirrors sit on Mocha (resolved in-app) or FileQ (browser-only,
//! Cloudflare-gated), with the occasional common host.

use std::collections::{HashMap, HashSet};
use std::sync::LazyLock;
use std::time::Duration;

use regex::Regex;
use serde_json::Value;
use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};

use crate::http::{self, FetchOpts};
use crate::sources::cache::{Cached, KeyedCache};
use crate::sources::hosts;
use crate::sources::schema::{dedup_key_for, parse_size_to_bytes, DownloadOption, SourceGame};
use crate::sources::{Capabilities, QueryParams};

const ID: &str = "astralgames";
const ORIGIN: &str = "https://astralgames.net";
const PEARCRYPT_API: &str = "https://pearcrypt.lol/api/container";
const PER_PAGE: usize = 48; // max listing page size via `?pageSize=`
const POOL_TARGET: usize = 300;
const SEARCH_PAGE: usize = 12; // the search action's page size
const SEARCH_PAGE_CAP: usize = 5; // exact matches rank first, so a few pages suffice

/// The site's genre taxonomy (the browse filter bar). Used for `list_tags` and
/// to keep detail-page genre chips clean.
static GENRES: &[&str] = &[
    "Multiplayer",
    "Achievements",
    "Action",
    "Adventure",
    "Horror",
    "Indie",
    "Open World",
    "RPG",
    "Racing",
    "Shooters",
    "Simulation",
    "Sports",
    "Strategy",
    "Virtual Reality",
];

static BROWSE: LazyLock<KeyedCache<Vec<SourceGame>>> =
    LazyLock::new(|| KeyedCache::new(Duration::from_secs(600)));
static DETAIL: LazyLock<KeyedCache<SourceGame>> =
    LazyLock::new(|| KeyedCache::new(Duration::from_secs(6 * 60 * 60)));

// ── Listing cards (rendered `<a class="game" ...>` tiles) ──
static CARD_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?s)<a[^>]*\bclass="game[^"]*"[^>]*href="/game/([^"]+)"(.*?)</a>"#).unwrap()
});
static CARD_ALT: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"<img[^>]*\balt="([^"]*)""#).unwrap());
static CARD_APPID: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"app_(\d+)_header").unwrap());
static CARD_ALLTAGS: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"All tags:\s*([^"]+)""#).unwrap());
static CARD_TAG: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"class="game-tag[^"]*"[^>]*>([^<]+)</p>"#).unwrap());

// ── Detail page ──
static TITLE_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?is)<title>\s*AstralGames\s*~\s*(.*?)\s*</title>").unwrap());
static STEAM_APP_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"store\.steampowered\.com/app/(\d+)").unwrap());
static IMG_APPID_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"app_(\d+)_header").unwrap());
static CONTAINER_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"pearcrypt\.lol/container/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})").unwrap()
});
static FILTER_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"/\?filters=([^"&\\]+)"#).unwrap());
static NSFW_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"nsfw\\?"\s*:\s*true"#).unwrap());
static BUILD_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"buildId\\?"\s*:\s*(\d+)"#).unwrap());

// ── Search (paginated Next.js server action) ──
static SEARCH_ACTION: LazyLock<Cached<String>> =
    LazyLock::new(|| Cached::new(Duration::from_secs(6 * 60 * 60)));
static CHUNK_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"/_next/static/chunks/[^"]+?\.js"#).unwrap());
static SERVER_REF_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"createServerReference\)\("([0-9a-f]{40,42})""#).unwrap());
static SEARCH_IMG_APPID: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?:steam/apps/|app_)(\d+)").unwrap());

pub fn capabilities() -> Capabilities {
    Capabilities {
        search: true,
        catalog: true,
        appid: true,
        bulk_browse: true,
        tags: true,
        // Browse cards carry no post date or size; those only land on detail, so
        // don't advertise date/size filtering or sorts that would sink our stubs.
        release_date: false,
        size: false,
        sort: vec!["title".to_string()],
    }
}

fn steam_image(appid: u64, kind: &str) -> String {
    format!("https://shared.steamstatic.com/store_item_assets/steam/apps/{appid}/{kind}")
}

fn appid_from(html: &str) -> Option<u64> {
    STEAM_APP_RE
        .captures(html)
        .or_else(|| IMG_APPID_RE.captures(html))
        .and_then(|c| c[1].parse::<u64>().ok())
        .filter(|v| *v > 0)
}

fn make_stub(slug: &str, title: String, appid: Option<u64>, genres: Vec<String>, nsfw: bool) -> SourceGame {
    SourceGame {
        source_id: ID.to_string(),
        source_slug: slug.to_string(),
        source_url: format!("{ORIGIN}/game/{slug}"),
        steam_app_id: appid,
        dedup_key: dedup_key_for(appid, &title),
        title,
        image: appid.map(|id| steam_image(id, "library_600x900.jpg")),
        hero_image: appid.map(|id| steam_image(id, "library_hero.jpg")),
        genres,
        nsfw,
        ..Default::default()
    }
}

/// Parse the game cards out of a browse/search listing page into lightweight
/// stubs (full detail + download options are fetched lazily in `get_detail`).
fn parse_listing(html: &str) -> Vec<SourceGame> {
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    for cap in CARD_RE.captures_iter(html) {
        let slug = cap[1].trim_end_matches('/').to_string();
        if slug.is_empty() || slug.contains('/') || !seen.insert(slug.clone()) {
            continue;
        }
        let body = &cap[2];
        let title = CARD_ALT
            .captures(body)
            .map(|c| http::decode_entities(c[1].trim()))
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| title_from_slug(&slug));
        let appid = CARD_APPID.captures(body).and_then(|c| c[1].parse::<u64>().ok()).filter(|v| *v > 0);
        let genres = card_genres(body);
        let nsfw = body.contains("Show mature content");
        out.push(make_stub(&slug, title, appid, genres, nsfw));
    }
    out
}

fn card_genres(body: &str) -> Vec<String> {
    // The "More..." chip carries the full list in its `All tags:` tooltip; when
    // a card shows ≤2 tags there's no tooltip, so fall back to the chip labels.
    if let Some(c) = CARD_ALLTAGS.captures(body) {
        return http::decode_entities(&c[1])
            .split(',')
            .map(|t| t.trim().to_string())
            .filter(|t| !t.is_empty())
            .collect();
    }
    let mut genres = Vec::new();
    for c in CARD_TAG.captures_iter(body) {
        let tag = http::decode_entities(c[1].trim());
        if !tag.is_empty() && tag != "More..." && !genres.contains(&tag) {
            genres.push(tag);
        }
    }
    genres
}

fn title_from_slug(slug: &str) -> String {
    let mut out = String::new();
    for word in slug.split('-') {
        if word.is_empty() {
            continue;
        }
        if !out.is_empty() {
            out.push(' ');
        }
        let mut chars = word.chars();
        if let Some(first) = chars.next() {
            out.extend(first.to_uppercase());
            out.push_str(chars.as_str());
        }
    }
    out
}

async fn browse_pool(limit: usize) -> Vec<SourceGame> {
    // A handful of "trending" tiles repeat on every page; the slug dedup below
    // trims them and the pool still fills from the newest listings.
    let pages = limit.min(POOL_TARGET).div_ceil(PER_PAGE).max(1);
    let key = format!("c|{pages}");
    BROWSE
        .get_or(&key, || async move {
            let nums: Vec<usize> = (1..=pages).collect();
            let batches = http::map_limit(nums, 6, |p| async move {
                let url = format!("{ORIGIN}/?page={p}&pageSize={PER_PAGE}");
                let html = http::get_text(&url).await.ok()?;
                Some(parse_listing(&html))
            })
            .await;
            let mut pool: Vec<SourceGame> = Vec::new();
            let mut seen = HashSet::new();
            for batch in batches {
                for g in batch {
                    if seen.insert(g.source_slug.clone()) {
                        pool.push(g);
                    }
                }
            }
            if pool.is_empty() {
                None
            } else {
                Some(pool)
            }
        })
        .await
        .unwrap_or_default()
}

pub async fn query(params: &QueryParams) -> Option<Vec<SourceGame>> {
    if let Some(text) = params.text.as_deref() {
        let text = text.trim();
        if !text.is_empty() {
            let limit = params.limit;
            let key = format!("s|{}|{limit}", text.to_lowercase());
            let text_owned = text.to_string();
            let cached = BROWSE
                .get_or(&key, || async move {
                    let out = do_search(&text_owned, limit).await;
                    if out.is_empty() {
                        None
                    } else {
                        Some(out)
                    }
                })
                .await;
            return Some(cached.unwrap_or_default());
        }
    }
    Some(browse_pool(params.limit).await)
}

pub async fn search(q: &str, limit: usize) -> Vec<SourceGame> {
    let q = q.trim();
    if q.is_empty() {
        return Vec::new();
    }
    do_search(q, limit).await
}

fn enc(s: &str) -> String {
    utf8_percent_encode(s, NON_ALPHANUMERIC).to_string()
}

/// Full-catalog search via the site's paginated Next.js server action, falling
/// back to a browse-pool title filter when the action can't be reached.
async fn do_search(q: &str, limit: usize) -> Vec<SourceGame> {
    if let Some(id) = search_action_id().await {
        let pages = limit.div_ceil(SEARCH_PAGE).clamp(1, SEARCH_PAGE_CAP);
        let nums: Vec<usize> = (1..=pages).collect();
        let q_owned = q.to_string();
        let batches = http::map_limit(nums, 5, |page| {
            let id = id.clone();
            let q = q_owned.clone();
            async move { search_raw(&id, &q, page, SEARCH_PAGE).await.map(|b| parse_flight_games(&b)) }
        })
        .await;
        let mut out = Vec::new();
        let mut seen = HashSet::new();
        for batch in batches {
            for g in batch {
                if seen.insert(g.source_slug.clone()) {
                    out.push(g);
                }
            }
        }
        if !out.is_empty() {
            out.truncate(limit);
            return out;
        }
    }
    pool_title_filter(q, limit).await
}

async fn pool_title_filter(q: &str, limit: usize) -> Vec<SourceGame> {
    let terms: Vec<String> = q.to_lowercase().split_whitespace().map(str::to_string).collect();
    if terms.is_empty() {
        return Vec::new();
    }
    browse_pool(POOL_TARGET)
        .await
        .into_iter()
        .filter(|g| {
            let title = g.title.to_lowercase();
            terms.iter().all(|t| title.contains(t))
        })
        .take(limit)
        .collect()
}

/// The search action id is build-versioned and lives in a client chunk, so we
/// discover it at runtime: pull every `createServerReference` id off the search
/// page's chunks and keep the one whose response carries a `games` array.
async fn search_action_id() -> Option<String> {
    SEARCH_ACTION
        .get_or(|| async {
            let html = http::get_text(&format!("{ORIGIN}/search?q=a")).await.ok()?;
            let mut chunks: Vec<String> =
                CHUNK_RE.find_iter(&html).map(|m| m.as_str().to_string()).collect();
            chunks.sort();
            chunks.dedup();
            let jss = http::map_limit(chunks, 6, |c| async move {
                http::get_text(&format!("{ORIGIN}{c}")).await.ok()
            })
            .await;
            let mut ids = Vec::new();
            let mut seen = HashSet::new();
            for js in jss {
                for cap in SERVER_REF_RE.captures_iter(&js) {
                    let id = cap[1].to_string();
                    if seen.insert(id.clone()) {
                        ids.push(id);
                    }
                }
            }
            for id in ids {
                let hit = search_raw(&id, "a", 1, 1)
                    .await
                    .map(|b| b.contains("\"games\""))
                    .unwrap_or(false);
                if hit {
                    return Some(id);
                }
            }
            None
        })
        .await
}

/// POST one page of the search action and return the raw RSC flight payload.
async fn search_raw(action_id: &str, q: &str, page: usize, limit: usize) -> Option<String> {
    let mut headers = HashMap::new();
    headers.insert("Next-Action".to_string(), action_id.to_string());
    headers.insert("Content-Type".to_string(), "text/plain;charset=UTF-8".to_string());
    let body = serde_json::to_vec(&serde_json::json!([q, { "page": page, "limit": limit }])).ok()?;
    let opts = FetchOpts {
        method: Some("POST".to_string()),
        headers,
        body: Some(body),
        timeout: Some(Duration::from_secs(20)),
        ..Default::default()
    };
    let resp = http::fetch(&format!("{ORIGIN}/search?q={}", enc(q)), &opts).await.ok()?;
    if !resp.status().is_success() {
        return None;
    }
    resp.text().await.ok()
}

/// The action streams RSC rows as `<ref>:<json>`; the results row is a JSON
/// object with a `games` array. Parse the first such row into stubs.
fn parse_flight_games(payload: &str) -> Vec<SourceGame> {
    for line in payload.lines() {
        let Some(idx) = line.find(':') else { continue };
        let Ok(val) = serde_json::from_str::<Value>(&line[idx + 1..]) else {
            continue;
        };
        if let Some(games) = val.get("games").and_then(|g| g.as_array()) {
            return games.iter().filter_map(game_from_json).collect();
        }
    }
    Vec::new()
}

fn game_from_json(v: &Value) -> Option<SourceGame> {
    let slug = v.get("slug").and_then(|s| s.as_str()).filter(|s| !s.is_empty())?;
    let name = v
        .get("name")
        .and_then(|s| s.as_str())
        .map(http::decode_entities)
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| title_from_slug(slug));
    let image = v.get("image").and_then(|s| s.as_str()).unwrap_or("");
    let appid = SEARCH_IMG_APPID
        .captures(image)
        .and_then(|c| c[1].parse::<u64>().ok())
        .filter(|v| *v > 0);
    let genres = v
        .get("tags")
        .and_then(|t| t.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|t| t.as_str())
                .map(|t| t.trim().to_string())
                .filter(|t| !t.is_empty())
                .collect()
        })
        .unwrap_or_default();
    let nsfw = v.get("nsfw").and_then(|b| b.as_bool()).unwrap_or(false);
    let mut g = make_stub(slug, name, appid, genres, nsfw);
    if g.image.is_none() && !image.is_empty() {
        g.image = Some(image.to_string());
    }
    Some(g)
}

/// Read the Pearcrypt container's mirror list and turn every live link into a
/// download option, resolvable-first so the UI surfaces the easy hosts.
async fn pearcrypt_options(container_id: &str) -> Vec<DownloadOption> {
    let json: Value = match http::get_json(&format!("{PEARCRYPT_API}/{container_id}/mirrors")).await {
        Ok(v) => v,
        Err(_) => return Vec::new(),
    };
    let mut options = Vec::new();
    for mirror in json.get("mirrors").and_then(|m| m.as_array()).into_iter().flatten() {
        let mirror_name = mirror.get("name").and_then(|v| v.as_str()).unwrap_or("");
        for link in mirror.get("links").and_then(|l| l.as_array()).into_iter().flatten() {
            if !link.get("is_alive").and_then(|v| v.as_bool()).unwrap_or(true) {
                continue;
            }
            let Some(url) = link.get("url").and_then(|v| v.as_str()).filter(|s| !s.is_empty()) else {
                continue;
            };
            let host = link.get("host_name").and_then(|v| v.as_str()).unwrap_or("");
            let host_type = hosts::detect_host_type(url);
            let size_text = link.get("file_size").and_then(|v| v.as_str()).map(str::to_string);
            let label = if !host.is_empty() {
                host.to_string()
            } else if !mirror_name.is_empty() {
                mirror_name.to_string()
            } else {
                host_type.clone()
            };
            options.push(DownloadOption {
                label,
                host_type,
                url: Some(url.to_string()),
                file_name: link.get("file_name").and_then(|v| v.as_str()).map(str::to_string),
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

fn detail_genres(html: &str) -> Vec<String> {
    let mut genres = Vec::new();
    for cap in FILTER_RE.captures_iter(html) {
        let raw = cap[1].replace("%20", " ");
        let tag = http::decode_entities(raw.trim());
        if let Some(known) = GENRES.iter().find(|g| g.eq_ignore_ascii_case(&tag)) {
            let known = known.to_string();
            if !genres.contains(&known) {
                genres.push(known);
            }
        }
    }
    genres
}

pub async fn get_detail(slug: &str) -> Option<SourceGame> {
    let clean = slug.trim_matches('/').to_string();
    if clean.is_empty() {
        return None;
    }
    let key = clean.clone();
    DETAIL
        .get_or(&key, || async move {
            let url = format!("{ORIGIN}/game/{clean}");
            let html = http::get_text(&url).await.ok()?;

            let title = TITLE_RE
                .captures(&html)
                .map(|c| http::decode_entities(c[1].trim()))
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| title_from_slug(&clean));
            if title.is_empty() {
                return None;
            }

            let appid = appid_from(&html);
            let genres = detail_genres(&html);
            let nsfw = NSFW_RE.is_match(&html);
            let version = BUILD_RE.captures(&html).map(|c| format!("Build {}", &c[1]));

            let download_options = match CONTAINER_RE.captures(&html) {
                Some(c) => pearcrypt_options(&c[1]).await,
                None => Vec::new(),
            };
            let size_bytes = download_options.iter().filter_map(|o| o.size_bytes).max();
            let size_text = download_options.iter().find_map(|o| o.size_text.clone());

            Some(SourceGame {
                source_id: ID.to_string(),
                source_slug: clean.clone(),
                source_url: url,
                steam_app_id: appid,
                dedup_key: dedup_key_for(appid, &title),
                title,
                image: appid.map(|id| steam_image(id, "library_600x900.jpg")),
                hero_image: appid.map(|id| steam_image(id, "library_hero.jpg")),
                genres,
                version,
                size_bytes,
                size_text,
                nsfw,
                download_options,
                ..Default::default()
            })
        })
        .await
}

pub async fn list_tags() -> Vec<String> {
    GENRES.iter().map(|s| s.to_string()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const CARD: &str = r#"<a class="game relative border" href="/game/forza-horizon-6"><div class="game-image"><img alt="Forza Horizon 6" srcset="/_next/image?url=https%3A%2F%2Fapi.bonker.dev%2Fapi%2Fimage-cache%2Fapp_2483190_header.jpg&amp;w=640"></div><div><p class="game-title" title="Forza Horizon 6">Forza Horizon 6</p><div class="tag-container"><p class="game-tag text-primary-600">RPG</p></div><div class="tag-container" title="All tags: Achievements, Multiplayer, RPG, Simulation, Sports"><p class="game-tag text-primary-600">More...</p></div></div></a>"#;

    #[test]
    fn parses_card() {
        let games = parse_listing(CARD);
        assert_eq!(games.len(), 1);
        let g = &games[0];
        assert_eq!(g.source_slug, "forza-horizon-6");
        assert_eq!(g.title, "Forza Horizon 6");
        assert_eq!(g.steam_app_id, Some(2483190));
        assert_eq!(g.image.as_deref(), Some("https://shared.steamstatic.com/store_item_assets/steam/apps/2483190/library_600x900.jpg"));
        assert_eq!(
            g.genres,
            vec!["Achievements", "Multiplayer", "RPG", "Simulation", "Sports"]
        );
        assert!(!g.nsfw);
    }

    #[test]
    fn card_genres_fallback_to_chips() {
        let body = r#"<div class="tag-container"><p class="game-tag x">Indie</p></div><div class="tag-container"><p class="game-tag x">Sports</p></div>"#;
        assert_eq!(card_genres(body), vec!["Indie", "Sports"]);
    }

    #[test]
    fn detail_genres_are_validated_and_deduped() {
        let html = r#"<a href="/?filters=RPG">RPG</a><a href="/?filters=RPG">RPG</a><a href="/?filters=Open%20World">Open World</a><a href="/?filters=Bogus">Bogus</a>"#;
        assert_eq!(detail_genres(html), vec!["RPG", "Open World"]);
    }

    #[test]
    fn extracts_detail_fields() {
        let html = r#"<title>AstralGames ~ Forza Horizon 6</title>
            <a href="https://store.steampowered.com/app/2483190">Steam</a>
            button pearcrypt.lol/container/07d8a0ed-acea-44bd-9af5-11c8090a270c more
            \"buildId\":23370889,\"steamDbUrl\" \"nsfw\":false"#;
        assert_eq!(appid_from(html), Some(2483190));
        assert!(TITLE_RE.captures(html).is_some());
        let c = CONTAINER_RE.captures(html).unwrap();
        assert_eq!(&c[1], "07d8a0ed-acea-44bd-9af5-11c8090a270c");
        assert_eq!(BUILD_RE.captures(html).map(|c| c[1].to_string()), Some("23370889".to_string()));
        assert!(!NSFW_RE.is_match(html));
    }

    #[test]
    fn nsfw_true_detected() {
        assert!(NSFW_RE.is_match(r#"\"nsfw\":true"#));
        assert!(NSFW_RE.is_match(r#""nsfw": true"#));
    }
    #[test]
    fn parses_flight_search_payload() {
        let payload = "0:{\"a\":\"$@1\",\"q\":\"?q=witcher\"}\n1:{\"games\":[{\"name\":\"The Witcher 3: Wild Hunt\",\"slug\":\"the-witcher-3-wild-hunt\",\"image\":\"https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/292030/header.jpg?t=1\",\"tags\":[\"Achievements\",\" RPG\"],\"collection_id\":null,\"nsfw\":false}]}";
        let games = parse_flight_games(payload);
        assert_eq!(games.len(), 1);
        let g = &games[0];
        assert_eq!(g.source_slug, "the-witcher-3-wild-hunt");
        assert_eq!(g.title, "The Witcher 3: Wild Hunt");
        assert_eq!(g.steam_app_id, Some(292030));
        assert_eq!(g.genres, vec!["Achievements", "RPG"]);
        assert_eq!(
            g.image.as_deref(),
            Some("https://shared.steamstatic.com/store_item_assets/steam/apps/292030/library_600x900.jpg")
        );
        assert_eq!(g.source_id, "astralgames");
    }
}
