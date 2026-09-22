//! Kryo.to (https://kryo.to) — a DDL catalog with a fully public JSON API.
//!
//! Browse reads the whole catalog from `GET /api/games` (newest first, ~1700
//! records, roughly half a megabyte) and caches it; search asks the same
//! endpoint with `q` so the server does the matching; detail reads
//! `GET /api/games/<slug>`, which carries the download links inline, so no page
//! scrape and no gate is involved.
//!
//! The links split in two. The site's own host (`dl.kryo.to/#<tag>/<id>.7z`) is
//! behind an invisible Cloudflare Turnstile that the site only mints when its
//! own download button is clicked, so that option is offered as browser-only
//! with the game page as its fallback. Every mirror (pixeldrain, buzzheavier,
//! gofile, mediafire, vikingfile, fileditch, mocha, mega) is a plain outbound
//! URL and goes through the shared host dispatch, which decides per host
//! whether the resolver in use can take it.

use std::sync::LazyLock;
use std::time::Duration;

use serde_json::Value;

use crate::http;
use crate::sources::cache::{Cached, KeyedCache};
use crate::sources::hosts;
use crate::sources::parse::find_steam_app_id;
use crate::sources::schema::{
    dedup_key_for, parse_size_to_bytes, to_epoch_ms, DownloadOption, SourceGame,
};
use crate::sources::{Capabilities, QueryParams};

const ID: &str = "kryo";
const ORIGIN: &str = "https://kryo.to";
const DETAIL_TTL: Duration = Duration::from_secs(60 * 60 * 6);
const CATALOG_TTL: Duration = Duration::from_secs(60 * 30);

static CATALOG: LazyLock<Cached<Vec<Value>>> = LazyLock::new(|| Cached::new(CATALOG_TTL));
static DETAIL: LazyLock<KeyedCache<SourceGame>> = LazyLock::new(|| KeyedCache::new(DETAIL_TTL));

fn str_field(v: &Value, key: &str) -> String {
    v.get(key)
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string()
}

fn opt(value: String) -> Option<String> {
    (!value.is_empty()).then_some(value)
}

fn steam_app_id(v: &Value) -> Option<u64> {
    // The API carries the Steam appid as a string; `store` is a second source
    // for the same number when a record predates the field.
    v.get("steam_appid")
        .and_then(|x| x.as_str())
        .and_then(|s| s.trim().parse::<u64>().ok())
        .filter(|id| *id > 0)
        .or_else(|| find_steam_app_id(&str_field(v, "store")))
}

fn download_options(v: &Value, slug: &str) -> Vec<DownloadOption> {
    let page_url = format!("{ORIGIN}/game/{slug}");
    let download_size = parse_size_to_bytes(&str_field(v, "download_size"));
    v.get("links")
        .and_then(Value::as_array)
        .map(|links| {
            links
                .iter()
                .filter_map(|link| {
                    let url = str_field(link, "url");
                    if url.is_empty() {
                        return None;
                    }
                    let host = str_field(link, "host");
                    // The site's own host is the one link that cannot be handed
                    // to a downloader: its resolver wants a Turnstile token the
                    // site only mints from its own download button.
                    let own_host = host.eq_ignore_ascii_case("kryo") || url.starts_with("https://dl.kryo.to/");
                    let label = str_field(link, "label");
                    Some(DownloadOption {
                        label: if own_host {
                            "Kryo".to_string()
                        } else if !label.is_empty() {
                            label
                        } else if !host.is_empty() {
                            host
                        } else {
                            "Mirror".to_string()
                        },
                        host_type: if own_host {
                            "kryo".to_string()
                        } else {
                            hosts::detect_host_type(&url)
                        },
                        resolvable: !own_host && hosts::is_resolvable(&url),
                        page_url: own_host.then(|| page_url.clone()),
                        size_bytes: own_host.then_some(download_size).flatten(),
                        url: Some(url),
                        ..Default::default()
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

fn normalize(v: &Value) -> SourceGame {
    let slug = str_field(v, "slug");
    let title = str_field(v, "title");
    let appid = steam_app_id(v);
    let cover = str_field(v, "cover");
    let cover_horizontal = str_field(v, "cover_horizontal");
    let size_text = str_field(v, "size");
    let genres: Vec<String> = v
        .get("genres")
        .and_then(Value::as_array)
        .map(|list| {
            list.iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();
    let download_options = download_options(v, &slug);
    let size_bytes = parse_size_to_bytes(&size_text).or_else(|| {
        download_options
            .iter()
            .filter_map(|o| o.size_bytes)
            .max()
    });
    SourceGame {
        source_id: ID.to_string(),
        source_slug: slug.clone(),
        source_url: format!("{ORIGIN}/game/{slug}"),
        steam_app_id: appid,
        dedup_key: dedup_key_for(appid, &title),
        title,
        description: opt(str_field(v, "short")),
        image: opt(cover).or_else(|| opt(cover_horizontal.clone())),
        hero_image: opt(cover_horizontal),
        genres,
        developer: opt(str_field(v, "developer")),
        // The API carries the release year only, so there is no date to offer.
        release_year: v.get("year").and_then(Value::as_i64).map(|y| y as i32),
        release_date: None,
        added_at: to_epoch_ms(&str_field(v, "created_at")),
        updated_at: to_epoch_ms(&str_field(v, "updated_at")),
        version: opt(str_field(v, "version")),
        size_bytes,
        size_text: opt(size_text),
        download_options,
        direct: true,
        normalized_title: String::new(),
    }
}

fn games_from(value: &Value) -> Vec<Value> {
    value
        .get("games")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
}

async fn fetch_catalog() -> Option<Vec<Value>> {
    CATALOG
        .get_or(|| async {
            let value = http::get_json(&format!("{ORIGIN}/api/games")).await.ok()?;
            let games = games_from(&value);
            (!games.is_empty()).then_some(games)
        })
        .await
}

pub fn capabilities() -> Capabilities {
    Capabilities {
        search: true,
        catalog: true,
        // The API carries no tags, only a year (no date), and it ignores sort
        // and page entirely: the catalog always comes back newest-first.
        tags: false,
        release_date: false,
        size: true,
        sort: Vec::new(),
    }
}

pub async fn query(params: &QueryParams) -> Option<Vec<SourceGame>> {
    let q = params.text.as_deref().unwrap_or("").trim().to_string();
    let games = if q.is_empty() {
        fetch_catalog().await?
    } else {
        let url = format!(
            "{ORIGIN}/api/games?q={}&limit={}",
            crate::mods::urlenc(&q),
            params.limit.max(1)
        );
        games_from(&http::get_json(&url).await.ok()?)
    };
    Some(games.iter().map(normalize).collect())
}

pub async fn search(q: &str, limit: usize) -> Vec<SourceGame> {
    let q = q.trim();
    if q.is_empty() {
        return Vec::new();
    }
    let url = format!(
        "{ORIGIN}/api/games?q={}&limit={}",
        crate::mods::urlenc(q),
        limit.max(1)
    );
    match http::get_json(&url).await {
        Ok(value) => games_from(&value).iter().map(normalize).collect(),
        Err(_) => Vec::new(),
    }
}

pub async fn get_detail(slug: &str) -> Option<SourceGame> {
    let clean = slug.trim().trim_matches('/').to_string();
    if clean.is_empty() {
        return None;
    }
    let key = clean.clone();
    DETAIL
        .get_or(&key, || async move {
            let url = format!("{ORIGIN}/api/games/{}", crate::mods::urlenc(&clean));
            let value: Value = http::get_json(&url).await.ok()?;
            let game = value.get("game")?;
            (!str_field(game, "title").is_empty()).then(|| normalize(game))
        })
        .await
}

