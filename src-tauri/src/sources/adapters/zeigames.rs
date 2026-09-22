//! ZeiGames (https://zeigames.com) — an Invision Community forum whose game
//! posts live as topics under per-genre forums. Browse pulls topic rows from
//! the genre forums; search rides the forum's own title search; detail parses
//! the post's og-meta block and expands the ZeiLink container behind the
//! download button into one option per mirror.
//!
//! ZeiLink is a Next.js link page whose public JSON API
//! (`/api/public/container/<slug>`) lists every host + direct file url, so we
//! skip scraping the JS page and read the mirrors straight from the API. Each
//! mirror routes through the shared host dispatch (`hosts::resolve_url`) at
//! download time, so no source-specific resolver is needed.

use std::collections::HashSet;
use std::sync::LazyLock;
use std::time::Duration;

use regex::Regex;

use crate::http;
use crate::sources::cache::KeyedCache;
use crate::sources::parse::find_steam_app_id;
use crate::sources::schema::{dedup_key_for, year_from, SourceGame};
use crate::sources::steam;
use crate::sources::{Capabilities, QueryParams};

const ID: &str = "zeigames";
const ORIGIN: &str = "https://zeigames.com";
const SEARCH_CONCURRENCY: usize = 5;
const POOL_TARGET: usize = 300;

// Genre forums (stable IPS node ids, with the slug the site routes them by).
// Browsing with no genre filter fans out across all of them; a single-genre
// filter fetches just that forum deeper.
static GENRES: &[(u32, &str, &str)] = &[
    (71, "action", "Action"),
    (72, "adventure", "Adventure"),
    (73, "survival", "Survival"),
    (74, "rpg", "RPG"),
    (75, "fps", "FPS"),
    (76, "simulation", "Simulation"),
    (77, "strategy", "Strategy"),
    (78, "sports", "Sports"),
    (79, "horror", "Horror"),
    (80, "racing", "Racing"),
    (81, "fighting", "Fighting"),
    (82, "puzzle", "Puzzle"),
    (84, "vr", "VR"),
    (85, "denuvo-games", "Denuvo"),
];
static ROW_URL_TITLE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"href="(https://zeigames\.com/topic/\d+-[^"?]+/)"\s+class="ipsLinkPanel"[^>]*><span>(.*?)</span>"#).unwrap()
});
static ROW_COVER: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"data-zeithumb-(?:large|small)="([^"]+)""#).unwrap());
static ROW_DATE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"datetime='([^']+)'").unwrap());
static SEARCH_ROW: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?s)<h3[^>]*data-ips-hook="commentTitle"[^>]*>.*?href="(https://zeigames\.com/topic/\d+-[^"?]+/)"[^>]*>(.*?)</a>"#).unwrap()
});
static TITLE_TAG: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?s)<title[^>]*>(.*?)</title>").unwrap());
static OG_DESC: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"<meta property="og:description" content="([^"]*)""#).unwrap());
static OG_IMAGE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"<meta property="og:image" content="([^"]*)""#).unwrap());
static ZEILINK_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"https?://zeilink\.net/c/([A-Za-z0-9]+)").unwrap());
static BREADCRUMB_FORUM: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"/forum/(\d+)-[a-z0-9-]+/").unwrap());
static P_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?is)<p[^>]*>(.*?)</p>").unwrap());
static SKIP_TITLE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)^(how to|rules|read (?:this|before)|announcement|introducing|welcome|request|installer|\[)").unwrap()
});

static LISTING: LazyLock<KeyedCache<Vec<SourceGame>>> =
    LazyLock::new(|| KeyedCache::new(Duration::from_secs(600)));
static DETAIL: LazyLock<KeyedCache<SourceGame>> =
    LazyLock::new(|| KeyedCache::new(Duration::from_secs(6 * 60 * 60)));

pub fn capabilities() -> Capabilities {
    Capabilities {
        search: true,
        catalog: true,
        tags: true,
        release_date: false,
        size: false,
        sort: vec![
            "latest".to_string(),
            "updated".to_string(),
            "title".to_string(),
        ],
    }
}

fn genre_name(id: u32) -> Option<&'static str> {
    GENRES.iter().find(|(g, _, _)| *g == id).map(|(_, _, n)| *n)
}

fn enc(s: &str) -> String {
    crate::mods::urlenc(s)
}

/// Split "<Name> Free Download (<version/extras>)" into name + version. The
/// trailing paren after "Free Download" is always version/DLC noise on this
/// site, so peeling it is safe.
/// One label's value from the flat og:description "Game Details" block, cut at
/// the next known label so multi-word values (publishers, dates) stay intact.
fn meta_field(desc: &str, label: &str) -> Option<String> {
    const STOPS: &[&str] = &[
        "Release Name:",
        "Game Version:",
        "Release Date:",
        "Publisher:",
        "Developer:",
        "Based On:",
        "Game Review",
        "Direct Download",
    ];
    let start = desc.find(&format!("{label}:"))? + label.len() + 1;
    let rest = &desc[start..];
    let end = STOPS
        .iter()
        .filter_map(|s| rest.find(s).filter(|i| *i > 0))
        .min()
        .unwrap_or(rest.len());
    let v = http::decode_entities(rest[..end].trim());
    let v = v.trim().trim_end_matches(['.', ',', ' ']).to_string();
    (!v.is_empty()).then_some(v)
}

fn blurb(article: &str) -> Option<String> {
    let mut paras: Vec<String> = Vec::new();
    for cap in P_RE.captures_iter(article) {
        if paras.len() >= 3 {
            break;
        }
        let text = http::strip_tags(&cap[1]);
        if text.chars().count() > 40 {
            paras.push(text);
        }
    }
    let joined = paras.join("\n\n");
    if joined.is_empty() {
        return None;
    }
    if joined.chars().count() <= 800 {
        return Some(joined);
    }
    let cut: String = joined.chars().take(800).collect();
    Some(format!("{}\u{2026}", cut.trim_end()))
}


/// Topic path segment used as the detail slug, e.g.
/// "10440-broforce-free-download-build-12964083-online".
fn slug_from_url(url: &str) -> Option<String> {
    url.split("/topic/")
        .nth(1)
        .map(|s| s.trim_end_matches('/').to_string())
}

fn parse_listing(html: &str, genre: &str) -> Vec<SourceGame> {
    let mut games = Vec::new();
    let mut seen = HashSet::new();
    for chunk in html.split("data-ips-hook=\"topicRow\"").skip(1) {
        let Some(cap) = ROW_URL_TITLE.captures(chunk) else {
            continue;
        };
        let url = cap[1].to_string();
        let Some(slug) = slug_from_url(&url) else {
            continue;
        };
        if !seen.insert(slug.clone()) {
            continue;
        }
        let (title, version) = crate::sources::adapters::hydralinks::clean_title(&cap[2]);
        if title.is_empty() || SKIP_TITLE.is_match(&title) {
            continue;
        }
        let cover = ROW_COVER
            .captures(chunk)
            .map(|c| http::decode_entities(&c[1]));
        let added_at = ROW_DATE
            .captures(chunk)
            .and_then(|c| crate::sources::schema::to_epoch_ms(&c[1]));
        games.push(SourceGame {
            source_id: ID.to_string(),
            source_slug: slug,
            source_url: url,
            steam_app_id: None,
            dedup_key: dedup_key_for(None, &title),
            title,
            image: cover.clone(),
            hero_image: cover,
            genres: vec![genre.to_string()],
            added_at,
            updated_at: added_at,
            version,
            ..Default::default()
        });
    }
    games
}

/// Every ZeiGames page now sits behind a Cloudflare gate that answers plain
/// clients with a 403, so a fetch goes through the resolver's browser when one
/// is configured. The plain fetch stays as the fallback: it is what works if
/// the gate ever lets a plain client through, and it keeps the source honest
/// when no resolver is set up (the pages then come back empty rather than
/// failing the whole query).
async fn fetch_page(url: &str) -> Option<String> {
    if crate::slipgate::cfg().is_some() {
        if let Ok(body) = crate::slipgate::fetch_configured(url, Duration::from_secs(60)).await {
            if !body.trim().is_empty() {
                return Some(body);
            }
        }
    }
    http::get_text(url).await.ok()
}

async fn fetch_forum_page(forum_id: u32, slug: &str, genre: &str, page: usize) -> Vec<SourceGame> {
    let key = format!("{forum_id}:{page}");
    let genre = genre.to_string();
    let slug = slug.to_string();
    LISTING
        .get_or(&key, || async move {
            let url = format!(
                "{ORIGIN}/forum/{forum_id}-{slug}/page/{page}/?sortby=start_date&sortdirection=desc"
            );
            let html = fetch_page(&url).await?;
            Some(parse_listing(&html, &genre))
        })
        .await
        .unwrap_or_default()
}

/// Resolve a Steam appid from the (cleaned) title so browse cards get Steam's
/// portrait capsule instead of the site's landscape header, which would
/// zoom-crop in a portrait tile. Also lets these stubs dedup by appid against
/// the other sources. `search_app_id` caches to disk with no TTL, so this is
/// one Steam search per new title and free thereafter. Titles Steam does not
/// carry (console-only, unreleased) keep the landscape header as a fallback.
pub async fn query(params: &QueryParams) -> Option<Vec<SourceGame>> {
    if let Some(q) = params
        .text
        .as_deref()
        .map(str::trim)
        .filter(|q| !q.is_empty())
    {
        return Some(search(q, params.limit).await);
    }

    // Map requested genre tags to forums; unknown tags (or none) => all genres.
    let wanted: Vec<(u32, &str, &str)> = {
        let picked: Vec<_> = GENRES
            .iter()
            .filter(|(_, _, n)| params.tags.iter().any(|t| t.eq_ignore_ascii_case(n)))
            .copied()
            .collect();
        if picked.is_empty() {
            GENRES.to_vec()
        } else {
            picked
        }
    };
    // Single genre: go deeper (4 pages). Many genres: one page each is plenty
    // to fill the 300 pool after the central layer sorts/filters.
    let pages = if wanted.len() == 1 { 4 } else { 1 };
    let mut jobs = Vec::new();
    for (fid, slug, genre) in &wanted {
        for page in 1..=pages {
            jobs.push((*fid, slug.to_string(), genre.to_string(), page));
        }
    }
    let batches = http::map_limit(jobs, 8, |(fid, slug, genre, page)| async move {
        Some(fetch_forum_page(fid, &slug, &genre, page).await)
    })
    .await;
    let mut pool: Vec<SourceGame> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    'fill: for batch in batches {
        for g in batch {
            if seen.insert(g.source_slug.clone()) {
                pool.push(g);
            }
            if pool.len() >= POOL_TARGET {
                break 'fill;
            }
        }
    }
    Some(http::map_limit(pool, 8, |g| async move { Some(super::hydralinks::attach_steam_art(g).await) }).await)
}

pub async fn search(q: &str, limit: usize) -> Vec<SourceGame> {
    let q = q.trim();
    if q.is_empty() {
        return Vec::new();
    }
    // Quoted phrase + title-only is the site's "exact" mode; bare terms pull in
    // unrelated posts (per the source's own search hint).
    let url = format!(
        "{ORIGIN}/search/?q={}&type=forums_topic&search_in=titles&sortby=relevancy&quick=1",
        enc(&format!("\"{q}\""))
    );
    let Some(html) = fetch_page(&url).await else {
        return Vec::new();
    };
    let terms: Vec<String> = q
        .to_lowercase()
        .split_whitespace()
        .map(str::to_string)
        .collect();
    let mut slugs: Vec<String> = Vec::new();
    let mut seen = HashSet::new();
    for cap in SEARCH_ROW.captures_iter(&html) {
        let title = crate::sources::adapters::hydralinks::clean_title(&http::strip_tags(&cap[2])).0.to_lowercase();
        if !terms.iter().all(|t| title.contains(t.as_str())) {
            continue;
        }
        if let Some(slug) = slug_from_url(&cap[1]) {
            if seen.insert(slug.clone()) {
                slugs.push(slug);
            }
        }
        if slugs.len() >= limit {
            break;
        }
    }
    http::map_limit(slugs, SEARCH_CONCURRENCY, |slug| async move {
        get_detail(&slug).await
    })
    .await
}

/// Read the ZeiLink container JSON and turn every active mirror into a
/// download option, resolvable-first so the UI surfaces the easy hosts.
pub async fn get_detail(slug: &str) -> Option<SourceGame> {
    let clean = slug.trim_matches('/').to_string();
    let key = clean.clone();
    DETAIL
        .get_or(&key, || async move {
            let url = format!("{ORIGIN}/topic/{clean}/");
            let html = fetch_page(&url).await?;

            let raw_title = TITLE_TAG
                .captures(&html)
                .map(|c| c[1].split(" - ").next().unwrap_or(&c[1]).to_string())
                .unwrap_or_default();
            let (fallback_title, version) = crate::sources::adapters::hydralinks::clean_title(&raw_title);
            let desc_block = OG_DESC
                .captures(&html)
                .map(|c| http::decode_entities(&c[1]));
            let title = desc_block
                .as_deref()
                .and_then(|d| meta_field(d, "Release Name"))
                .filter(|s| !s.is_empty())
                .unwrap_or(fallback_title);
            if title.is_empty() {
                return None;
            }

            let developer = desc_block
                .as_deref()
                .and_then(|d| meta_field(d, "Developer"));
            let release_date = desc_block
                .as_deref()
                .and_then(|d| meta_field(d, "Release Date"));
            let release_year = release_date.as_deref().and_then(year_from);
            let version = version.or_else(|| {
                desc_block
                    .as_deref()
                    .and_then(|d| meta_field(d, "Game Version"))
            });

            let article = html.find("<article").map(|i| &html[i..]).unwrap_or(&html);
            let description = blurb(article);

            let mut appid = find_steam_app_id(&html);
            if appid.is_none() {
                appid = steam::search_app_id(&title).await;
            }
            let appid = appid.filter(|v| *v > 0);

            let cover = OG_IMAGE
                .captures(&html)
                .map(|c| http::decode_entities(&c[1]));
            let image = appid
                .map(|id| crate::sources::steam::steam_image(id, "library_600x900.jpg"))
                .or_else(|| cover.clone());
            let hero_image = appid
                .map(|id| crate::sources::steam::steam_image(id, "library_hero.jpg"))
                .or(cover);

            let genre = BREADCRUMB_FORUM
                .captures_iter(&html)
                .filter_map(|c| c[1].parse::<u32>().ok())
                .find_map(genre_name);
            let genres = genre.map(|g| vec![g.to_string()]).unwrap_or_default();

            let download_options = match ZEILINK_RE.captures(&html) {
                Some(c) => super::hydralinks::zeilink_options(&c[1]).await,
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
                description,
                image,
                hero_image,
                genres,
                developer,
                release_date,
                release_year,
                version,
                size_bytes,
                size_text,
                download_options,
                ..Default::default()
            })
        })
        .await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn clean_title_strips_free_download_and_version() {
        let (t, v) = crate::sources::adapters::hydralinks::clean_title("Broforce Free Download (Build 12964083 + Online)");
        assert_eq!(t, "Broforce");
        assert_eq!(v.as_deref(), Some("Build 12964083"));
        let (t, v) = crate::sources::adapters::hydralinks::clean_title("Arma Reforger Free Download (v1.7.0.41 + Supporter Pack DLC)");
        assert_eq!(t, "Arma Reforger");
        assert_eq!(v.as_deref(), Some("1.7.0.41"));
        let (t, _) = crate::sources::adapters::hydralinks::clean_title("Don&#8217;t Starve Free Download");
        assert_eq!(t, "Don\u{2019}t Starve");
    }

    #[test]
    fn meta_field_cuts_at_next_label() {
        let d = "Game DetailsRelease Name: BroforceGame Version: Build 12964083Release Date: 15 Oct, 2015Publisher: Devolver DigitalDeveloper: Free LivesBased On: CSF & Goldberg";
        assert_eq!(meta_field(d, "Release Name").as_deref(), Some("Broforce"));
        assert_eq!(
            meta_field(d, "Release Date").as_deref(),
            Some("15 Oct, 2015")
        );
        assert_eq!(
            meta_field(d, "Publisher").as_deref(),
            Some("Devolver Digital")
        );
        assert_eq!(meta_field(d, "Developer").as_deref(), Some("Free Lives"));
    }

    #[test]
    fn slug_from_url_extracts_topic_segment() {
        assert_eq!(
            slug_from_url("https://zeigames.com/topic/10440-broforce-free-download/").as_deref(),
            Some("10440-broforce-free-download")
        );
    }

    #[test]
    fn listing_row_yields_title_slug_and_cover() {
        // The row markup as the forum serves it: the thumbnail plugin renamed
        // its attributes from `data-tthumb-*` to `data-zeithumb-*` (now quoted),
        // which silently emptied every cover until this test pinned it.
        let row = r#"
<li data-ips-hook="topicRow" class="ipsData__item topic_11438 zeithumb_row zeithumb_grid " data-rowid="11438">
  <a href="https://zeigames.com/topic/11438-lamp-chronicle-free-download-v09147437/" class="ipsLinkPanel" aria-hidden="true" tabindex="-1"><span>Lamp Chronicle Free Download (v0.9.14.7437)</span></a>
  <span class="zeithumb_marker ipsHide" data-zeithumb-topic="11438" data-zeithumb-small="https://zeigames.com/uploads/monthly_2026_08/lamp-chronicle.webp.08ebbd132f683330938fc2ee508ccf38.webp" data-zeithumb-size="460px" data-zeithumb-ratio="460/215" data-zeithumb-alt="Lamp Chronicle"></span>
  <time datetime='2026-08-26T12:13:21Z' title='08/26/2026 12:13  PM' data-short='50 min' class='ipsTime ipsTime--long'></time>
</li>
"#;
        let games = parse_listing(row, "Action");
        assert_eq!(games.len(), 1, "the row parses");
        let game = &games[0];
        assert_eq!(game.title, "Lamp Chronicle");
        assert_eq!(game.version.as_deref(), Some("0.9.14.7437"));
        assert_eq!(
            game.source_slug,
            "11438-lamp-chronicle-free-download-v09147437"
        );
        assert_eq!(
            game.image.as_deref(),
            Some(
                "https://zeigames.com/uploads/monthly_2026_08/lamp-chronicle.webp.08ebbd132f683330938fc2ee508ccf38.webp"
            ),
            "the row's own thumbnail is the card image"
        );
        assert!(game.added_at.is_some(), "the topic start date parses");
        assert_eq!(game.genres, vec!["Action".to_string()]);
    }
}
