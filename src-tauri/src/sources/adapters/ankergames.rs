use std::collections::{HashMap, HashSet};
use std::time::Duration;

use once_cell::sync::Lazy;
use regex::Regex;
use serde_json::{json, Value};

use crate::http::{decode_entities, fetch, map_limit, FetchOpts, Jar};
use crate::sources::cache::{Cached, KeyedCache};
use crate::sources::parse::{find_steam_app_id, first_match};
use crate::sources::schema::{self, DownloadOption, SourceGame};
use crate::sources::{Capabilities, QueryParams, ResolveResult};

const ID: &str = "ankergames";
const ORIGIN: &str = "https://ankergames.net";
const LIST_PAGE_SIZE: usize = 56;
const AK_CONCURRENCY: usize = 2;
const AK_RETRIES: u32 = 4;

static SLUGS: Lazy<Cached<Vec<String>>> =
    Lazy::new(|| Cached::new(Duration::from_secs(60 * 60 * 6)));
static LW: Lazy<Cached<LwSession>> = Lazy::new(|| Cached::new(Duration::from_secs(60 * 10)));
static BROWSE: Lazy<KeyedCache<Vec<SourceGame>>> =
    Lazy::new(|| KeyedCache::new(Duration::from_secs(60 * 5)));
static GENRES: Lazy<Cached<GenreMap>> =
    Lazy::new(|| Cached::new(Duration::from_secs(60 * 60 * 6)));

static OG_TITLE_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r#"(?i)<meta[^>]+property="og:title"[^>]+content="([^"]+)""#).unwrap()
});
static TITLE_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)<title>([^<]+)</title>").unwrap());
static OG_IMAGE_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r#"(?i)<meta[^>]+property="og:image"[^>]+content="([^"]+)""#).unwrap()
});
static OG_DESC_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r#"(?i)<meta[^>]+property="og:description"[^>]+content="([^"]+)""#).unwrap()
});
static META_DESC_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r#"(?i)<meta[^>]+name="description"[^>]+content="([^"]+)""#).unwrap()
});
static GEN_DL_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"generateDownloadUrl\((\d+)\)").unwrap());
static SIZE_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)(\d[\d.]*\s*(?:TB|GB|MB))\b").unwrap());
static SLUG_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"/game/([a-z0-9][a-z0-9-]*)").unwrap());
static LOC_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"<loc>\s*([^<]+sitemap_post_\d+\.xml)\s*</loc>").unwrap());
static CSRF_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r#"<meta name="csrf-token" content="([^"]+)""#).unwrap());
static URI_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r#""uri"\s*:\s*"([^"]+/update)""#).unwrap());
static SNAPSHOT_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r#"wire:snapshot="([^"]+)""#).unwrap());
static LISTING_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r#"listing="([^"]+)""#).unwrap());
static GENRE_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r#"id="genre(\d+)"[\s\S]{0,300}?value="(\d+)"[\s\S]{0,900}?<span class="truncate">([^<]+)</span>"#).unwrap()
});
static FREE_DL_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)\s*Free Download\b").unwrap());
static ANKER_SUFFIX_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\s*[-–—]\s*AnkerGames\s*$").unwrap());
static FREE_DL_SUFFIX_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)-free-download.*$").unwrap());
static VERSION_PREFIX_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)^\s*v\s*").unwrap());
static DOWNLOAD_PAGE_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"downloadPage\(\s*'([^']+)'").unwrap());

#[derive(Clone)]
struct LwSession {
    csrf: String,
    update_url: String,
    snapshot: String,
    jar: Jar,
}

#[derive(Clone, Default)]
struct GenreMap {
    id_to_name: Vec<(String, String)>,
    name_to_id: HashMap<String, String>,
}

#[derive(Default)]
struct GameInput {
    source_slug: String,
    source_url: String,
    steam_app_id: Option<u64>,
    title: String,
    description: String,
    image: String,
    hero_image: String,
    genres: Vec<String>,
    developer: String,
    release_date: String,
    added_at: Option<String>,
    updated_at: Option<String>,
    version: String,
    size_text: String,
    nsfw: bool,
    download_options: Vec<DownloadOption>,
}

fn opt(s: String) -> Option<String> {
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}

fn make_game(i: GameInput) -> SourceGame {
    let steam_app_id = i.steam_app_id.filter(|v| *v > 0);
    let title = i.title.trim().to_string();
    let dedup_key = schema::dedup_key_for(steam_app_id, &title);
    let release_year = schema::year_from(&i.release_date);
    let added_at = i.added_at.as_deref().and_then(|s| schema::to_epoch_ms(s));
    let updated_at = i.updated_at.as_deref().and_then(|s| schema::to_epoch_ms(s));
    let size_bytes = schema::parse_size_to_bytes(&i.size_text);
    SourceGame {
        source_id: ID.to_string(),
        source_slug: i.source_slug,
        source_url: i.source_url,
        steam_app_id,
        dedup_key,
        title,
        description: opt(i.description),
        image: opt(i.image),
        hero_image: opt(i.hero_image),
        genres: i.genres.into_iter().filter(|g| !g.is_empty()).collect(),
        developer: opt(i.developer),
        release_date: opt(i.release_date),
        release_year,
        added_at,
        updated_at,
        popularity: None,
        version: opt(i.version),
        size_bytes,
        size_text: opt(i.size_text),
        nsfw: i.nsfw,
        download_options: i.download_options,
    }
}

async fn fetch_full(url: &str, opts: FetchOpts) -> Option<(u16, String)> {
    let resp = fetch(url, &opts).await.ok()?;
    let status = resp.status().as_u16();
    let text = resp.text().await.ok()?;
    Some((status, text))
}

fn ok_status(status: u16) -> bool {
    (200..300).contains(&status)
}

fn title_from_slug(slug: &str) -> String {
    slug.split('-')
        .map(|w| {
            let mut chars = w.chars();
            match chars.next() {
                Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_string()
}

fn clean_title(raw: &str) -> String {
    let decoded = decode_entities(raw);
    let a = FREE_DL_RE.replace(&decoded, "");
    let b = ANKER_SUFFIX_RE.replace(&a, "");
    b.trim().to_string()
}

fn clean_slug_title(slug: &str) -> String {
    let trimmed = FREE_DL_SUFFIX_RE.replace(slug, "");
    title_from_slug(&trimmed)
}

fn unescape_html_attr(s: &str) -> String {
    s.replace("&quot;", "\"")
        .replace("&#039;", "'")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
}

fn extract_game_slugs(markup: &str) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for cap in SLUG_RE.captures_iter(markup) {
        let slug = cap[1].to_string();
        if seen.insert(slug.clone()) {
            out.push(slug);
        }
    }
    out
}

async fn all_slugs() -> Vec<String> {
    SLUGS
        .get_or(|| async {
            let index_xml = fetch_full(
                &format!("{ORIGIN}/sitemap.xml"),
                FetchOpts {
                    retries: Some(AK_RETRIES),
                    ..Default::default()
                },
            )
            .await
            .map(|(_, t)| t)
            .unwrap_or_default();

            let mut shards: Vec<String> = LOC_RE
                .captures_iter(&index_xml)
                .map(|c| c[1].trim().to_string())
                .collect();
            if shards.is_empty() {
                shards.push(format!("{ORIGIN}/sitemap_post_1.xml"));
            }

            let texts = map_limit(shards, AK_CONCURRENCY, |shard| async move {
                fetch_full(
                    &shard,
                    FetchOpts {
                        retries: Some(AK_RETRIES),
                        ..Default::default()
                    },
                )
                .await
                .map(|(_, t)| t)
            })
            .await;

            let mut seen = HashSet::new();
            let mut out = Vec::new();
            for xml in texts {
                for slug in extract_game_slugs(&xml) {
                    if seen.insert(slug.clone()) {
                        out.push(slug);
                    }
                }
            }
            if out.is_empty() {
                None
            } else {
                Some(out)
            }
        })
        .await
        .unwrap_or_default()
}

fn parse_game_page(html: &str, slug: &str) -> SourceGame {
    let og_title = {
        let m = first_match(html, &OG_TITLE_RE);
        if m.is_empty() {
            first_match(html, &TITLE_RE)
        } else {
            m
        }
    };
    let og_image = first_match(html, &OG_IMAGE_RE);
    let og_desc = {
        let m = first_match(html, &OG_DESC_RE);
        if m.is_empty() {
            first_match(html, &META_DESC_RE)
        } else {
            m
        }
    };

    let mut seen = HashSet::new();
    let mut ids = Vec::new();
    for cap in GEN_DL_RE.captures_iter(html) {
        let id = cap[1].to_string();
        if seen.insert(id.clone()) {
            ids.push(id);
        }
    }

    let page_url = format!("{ORIGIN}/game/{slug}");
    let n = ids.len();
    let download_options: Vec<DownloadOption> = ids
        .iter()
        .enumerate()
        .map(|(i, id)| DownloadOption {
            label: if n > 1 {
                format!("AnkerGames mirror {}", i + 1)
            } else {
                "AnkerGames".to_string()
            },
            host_type: "ankergames".to_string(),
            url: Some(id.clone()),
            page_url: Some(page_url.clone()),
            resolvable: true,
            ..Default::default()
        })
        .collect();

    let size_text = first_match(&decode_entities(html), &SIZE_RE);

    let title = {
        let t = clean_title(&og_title);
        if t.is_empty() {
            title_from_slug(slug)
        } else {
            t
        }
    };

    make_game(GameInput {
        source_slug: slug.to_string(),
        source_url: page_url,
        steam_app_id: find_steam_app_id(html),
        title,
        description: decode_entities(&og_desc),
        image: og_image,
        size_text,
        download_options,
        ..Default::default()
    })
}

async fn livewire_session() -> Option<LwSession> {
    LW.get_or(|| async {
        let jar = Jar::new();
        let (status, html) = fetch_full(
            &format!("{ORIGIN}/games-list"),
            FetchOpts {
                jar: Some(jar.clone()),
                retries: Some(AK_RETRIES),
                ..Default::default()
            },
        )
        .await?;
        if !ok_status(status) {
            return None;
        }
        let csrf = first_match(&html, &CSRF_RE);
        let uri = first_match(&html, &URI_RE).replace("\\/", "/");
        let update_url = if uri.is_empty() {
            String::new()
        } else if uri.starts_with("http") {
            uri
        } else {
            format!("{ORIGIN}{uri}")
        };
        let mut snapshot = String::new();
        for cap in SNAPSHOT_RE.captures_iter(&html) {
            let s = unescape_html_attr(&cap[1]);
            if let Ok(v) = serde_json::from_str::<Value>(&s) {
                if v.get("memo").and_then(|m| m.get("name")).and_then(|n| n.as_str())
                    == Some("games-list")
                {
                    snapshot = s;
                    break;
                }
            }
        }
        if csrf.is_empty() || update_url.is_empty() || snapshot.is_empty() {
            return None;
        }
        Some(LwSession {
            csrf,
            update_url,
            snapshot,
            jar,
        })
    })
    .await
}

async fn livewire_commit(
    session: &LwSession,
    updates: Value,
    snapshot: &str,
    extra_calls: Vec<Value>,
) -> Option<(String, String)> {
    let mut calls = extra_calls;
    calls.push(json!({ "method": "$commit", "params": [], "metadata": { "type": "model.live" } }));
    let body = json!({
        "_token": session.csrf,
        "components": [{
            "snapshot": snapshot,
            "updates": updates,
            "calls": calls,
        }],
    });
    let body_bytes = serde_json::to_vec(&body).ok()?;

    let mut headers = HashMap::new();
    headers.insert("Content-Type".to_string(), "application/json".to_string());
    headers.insert("X-Livewire".to_string(), "1".to_string());
    headers.insert("Accept".to_string(), "*/*".to_string());
    headers.insert("Referer".to_string(), format!("{ORIGIN}/games-list"));
    headers.insert("Origin".to_string(), ORIGIN.to_string());

    let (status, text) = fetch_full(
        &session.update_url,
        FetchOpts {
            method: Some("POST".to_string()),
            headers,
            body: Some(body_bytes),
            jar: Some(session.jar.clone()),
            retries: Some(AK_RETRIES),
            ..Default::default()
        },
    )
    .await?;
    if !ok_status(status) {
        return None;
    }
    let json: Value = serde_json::from_str(&text).ok()?;
    let comp = json.get("components").and_then(|c| c.get(0))?;
    let html = comp
        .get("effects")
        .and_then(|e| e.get("html"))
        .and_then(|h| h.as_str())
        .unwrap_or("")
        .to_string();
    let new_snapshot = comp
        .get("snapshot")
        .and_then(|s| s.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| snapshot.to_string());
    Some((html, new_snapshot))
}

fn str_field(o: &Value, key: &str) -> String {
    o.get(key).and_then(|v| v.as_str()).unwrap_or("").to_string()
}

fn version_from(o: &Value) -> String {
    let raw = match o.get("vote_average") {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Number(n)) => {
            if n.as_f64().unwrap_or(0.0) == 0.0 {
                String::new()
            } else {
                n.to_string()
            }
        }
        _ => String::new(),
    };
    VERSION_PREFIX_RE.replace(&raw, "").trim().to_string()
}

fn is_nsfw(o: &Value) -> bool {
    let raw = match o.get("nsfw") {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Bool(b)) => b.to_string(),
        Some(Value::Number(n)) => n.to_string(),
        _ => String::new(),
    };
    raw.to_lowercase() == "enable"
}

fn parse_listing_cards(html: &str) -> Vec<SourceGame> {
    let mut games = Vec::new();
    for cap in LISTING_RE.captures_iter(html) {
        let raw = unescape_html_attr(&cap[1]);
        let o: Value = match serde_json::from_str(&raw) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let slug = match o.get("slug").and_then(|v| v.as_str()) {
            Some(s) if !s.is_empty() => s.to_string(),
            _ => continue,
        };
        let size_text = str_field(&o, "runtime");
        let version = version_from(&o);
        let genres = o
            .get("genres")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|g| {
                        let title = g.get("title").and_then(|t| t.as_str())?;
                        let cleaned = decode_entities(title.trim());
                        if cleaned.is_empty() {
                            None
                        } else {
                            Some(cleaned)
                        }
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let title = {
            let t = clean_title(&str_field(&o, "title"));
            if t.is_empty() {
                title_from_slug(&slug)
            } else {
                t
            }
        };
        games.push(make_game(GameInput {
            source_slug: slug.clone(),
            source_url: format!("{ORIGIN}/game/{slug}"),
            steam_app_id: None,
            title,
            image: str_field(&o, "imageurl"),
            hero_image: str_field(&o, "coverurl"),
            genres,
            developer: str_field(&o, "developer_name"),
            release_date: str_field(&o, "release_date"),
            added_at: opt(str_field(&o, "created_at")),
            updated_at: opt(str_field(&o, "updated_at")),
            version,
            size_text,
            nsfw: is_nsfw(&o),
            download_options: Vec::new(),
            ..Default::default()
        }));
    }
    games
}

fn apply_filters_call() -> Value {
    json!({ "method": "applyAllFilters", "params": [], "metadata": {} })
}

fn goto_page(page: i64) -> Value {
    json!({ "method": "gotoPage", "params": [page, "page"], "metadata": { "type": "model.live" } })
}

async fn do_browse(updates: Value, first_calls: Vec<Value>, limit: usize) -> Vec<SourceGame> {
    let session = match livewire_session().await {
        Some(s) => s,
        None => return Vec::new(),
    };
    let mut out = Vec::new();
    let mut snap = session.snapshot.clone();
    let mut page: i64 = 1;
    loop {
        if out.len() >= limit {
            break;
        }
        let calls = if page == 1 {
            first_calls.clone()
        } else {
            vec![goto_page(page)]
        };
        let up = if page == 1 { updates.clone() } else { json!({}) };
        let result = match livewire_commit(&session, up, &snap, calls).await {
            Some(r) => r,
            None => break,
        };
        snap = result.1;
        let cards = parse_listing_cards(&result.0);
        if cards.is_empty() {
            break;
        }
        let count = cards.len();
        out.extend(cards);
        if count < LIST_PAGE_SIZE {
            break;
        }
        if page > 14 {
            break;
        }
        page += 1;
    }
    out
}

fn browse_key(updates: &Value, methods: &[String], limit: usize) -> String {
    json!({ "u": updates, "c": methods, "limit": limit }).to_string()
}

async fn livewire_browse(updates: Value, first_calls: Vec<Value>, limit: usize) -> Vec<SourceGame> {
    let methods: Vec<String> = first_calls
        .iter()
        .filter_map(|c| c.get("method").and_then(|m| m.as_str()).map(String::from))
        .collect();
    let key = browse_key(&updates, &methods, limit);
    BROWSE
        .get_or(&key, || async {
            let games = do_browse(updates, first_calls, limit).await;
            if games.is_empty() {
                None
            } else {
                Some(games)
            }
        })
        .await
        .unwrap_or_default()
}

async fn livewire_genres() -> Option<GenreMap> {
    GENRES
        .get_or(|| async {
            let session = livewire_session().await?;
            let (html, _snap) =
                livewire_commit(&session, json!({ "filterOpen": true }), &session.snapshot, Vec::new())
                    .await?;
            let mut id_to_name: Vec<(String, String)> = Vec::new();
            let mut name_to_id: HashMap<String, String> = HashMap::new();
            let mut seen = HashSet::new();
            for cap in GENRE_RE.captures_iter(&html) {
                let id = cap[2].to_string();
                let name = decode_entities(cap[3].trim());
                if !id.is_empty() && !name.is_empty() && seen.insert(id.clone()) {
                    name_to_id.insert(name.to_lowercase(), id.clone());
                    id_to_name.push((id, name));
                }
            }
            if id_to_name.is_empty() {
                None
            } else {
                Some(GenreMap {
                    id_to_name,
                    name_to_id,
                })
            }
        })
        .await
}

fn listing_updates_for_sort(sort: &str) -> serde_json::Map<String, Value> {
    let mut m = serde_json::Map::new();
    if sort == "popular" {
        m.insert("selectedDownloadFilter".to_string(), json!("popular_all_time"));
    }
    m
}

pub fn capabilities() -> Capabilities {
    Capabilities {
        search: true,
        catalog: true,
        appid: false,
        bulk_browse: true,
        tags: true,
        release_date: true,
        size: true,
        sort: vec![
            "popular".to_string(),
            "latest".to_string(),
            "updated".to_string(),
            "title".to_string(),
        ],
    }
}

pub async fn query(params: &QueryParams) -> Vec<SourceGame> {
    let text = params.text.clone().unwrap_or_default();
    if !text.trim().is_empty() {
        return search(text.trim(), params.limit).await;
    }

    let sort = params.sort.clone().unwrap_or_default();
    let mut updates = listing_updates_for_sort(&sort);
    let mut first_calls: Vec<Value> = Vec::new();

    if !params.tags.is_empty() {
        let g = livewire_genres().await.unwrap_or_default();
        let mut ids: Vec<String> = Vec::new();
        for t in &params.tags {
            if let Some(id) = g.name_to_id.get(&t.to_lowercase()) {
                ids.push(id.clone());
            }
        }
        if ids.is_empty() {
            return Vec::new();
        }
        updates.insert("selectedGenres".to_string(), json!(ids));
        if params.tag_mode.as_deref() == Some("and") {
            updates.insert("exclusiveFilter".to_string(), json!(true));
        }
        first_calls.push(apply_filters_call());
    }

    if let (Some(min), Some(max)) = (params.min_year, params.max_year) {
        if min == max {
            updates.insert("selectedReleaseYear".to_string(), json!(min.to_string()));
            if first_calls.is_empty() {
                first_calls.push(apply_filters_call());
            }
        }
    }

    let filtering = !first_calls.is_empty()
        || params.min_year.is_some()
        || params.max_year.is_some()
        || params.min_size_bytes.is_some()
        || params.max_size_bytes.is_some();
    let fetch_limit = if filtering {
        (params.limit * 3).min(224)
    } else {
        params.limit
    };

    let mut games = livewire_browse(Value::Object(updates), first_calls, fetch_limit).await;
    if sort == "popular" {
        let base = games.len() as f64;
        for (i, g) in games.iter_mut().enumerate() {
            g.popularity = Some(base - i as f64);
        }
    }
    games
}

pub async fn search(q: &str, limit: usize) -> Vec<SourceGame> {
    let q = q.to_lowercase();
    let q = q.trim();
    if q.is_empty() {
        return Vec::new();
    }
    let slugs = all_slugs().await;
    let terms: Vec<&str> = q.split_whitespace().collect();
    slugs
        .into_iter()
        .filter(|s| {
            let hay = s.replace('-', " ");
            terms.iter().all(|t| hay.contains(t))
        })
        .take(limit)
        .map(|slug| {
            make_game(GameInput {
                source_url: format!("{ORIGIN}/game/{slug}"),
                title: clean_slug_title(&slug),
                source_slug: slug,
                ..Default::default()
            })
        })
        .collect()
}

pub async fn get_detail(slug: &str) -> Option<SourceGame> {
    let (status, text) = fetch_full(
        &format!("{ORIGIN}/game/{slug}"),
        FetchOpts {
            retries: Some(AK_RETRIES),
            ..Default::default()
        },
    )
    .await?;
    if !ok_status(status) {
        return None;
    }
    Some(parse_game_page(&text, slug))
}

pub async fn list_tags() -> Vec<String> {
    match livewire_genres().await {
        Some(g) => g.id_to_name.into_iter().map(|(_, name)| name).collect(),
        None => Vec::new(),
    }
}

pub async fn resolve_download(option: &DownloadOption) -> ResolveResult {
    let download_id = option.url.clone().unwrap_or_default().trim().to_string();
    if download_id.is_empty() || !download_id.chars().all(|c| c.is_ascii_digit()) {
        return ResolveResult {
            resolvable: false,
            open_url: Some(option.page_url.clone().unwrap_or_else(|| ORIGIN.to_string())),
            reason: Some("missing download id".to_string()),
            ..Default::default()
        };
    }
    let jar = Jar::new();
    let referer = option.page_url.clone().unwrap_or_else(|| ORIGIN.to_string());

    let mut h1 = HashMap::new();
    h1.insert("X-Requested-With".to_string(), "XMLHttpRequest".to_string());
    h1.insert("Referer".to_string(), referer.clone());
    let tok_json = match fetch_full(
        &format!("{ORIGIN}/csrf-token"),
        FetchOpts {
            headers: h1,
            jar: Some(jar.clone()),
            ..Default::default()
        },
    )
    .await
    {
        Some((status, text)) if ok_status(status) => serde_json::from_str::<Value>(&text).ok(),
        _ => None,
    };
    let token = tok_json
        .as_ref()
        .and_then(|j| j.get("token"))
        .and_then(|t| t.as_str())
        .filter(|s| !s.is_empty())
        .map(String::from);
    let token = match token {
        Some(t) => t,
        None => {
            return ResolveResult {
                resolvable: false,
                open_url: Some(referer),
                reason: Some("csrf token unavailable".to_string()),
                ..Default::default()
            }
        }
    };

    let mut h2 = HashMap::new();
    h2.insert("Content-Type".to_string(), "application/json".to_string());
    h2.insert("X-CSRF-TOKEN".to_string(), token);
    h2.insert("X-Requested-With".to_string(), "XMLHttpRequest".to_string());
    h2.insert("Referer".to_string(), referer.clone());
    h2.insert("Origin".to_string(), ORIGIN.to_string());
    let gen_body = serde_json::to_vec(&json!({ "g-recaptcha-response": "development-mode" }))
        .unwrap_or_default();
    let (gen_status, gen_text) = match fetch_full(
        &format!("{ORIGIN}/generate-download-url/{download_id}"),
        FetchOpts {
            method: Some("POST".to_string()),
            headers: h2,
            body: Some(gen_body),
            jar: Some(jar.clone()),
            ..Default::default()
        },
    )
    .await
    {
        Some(v) => v,
        None => {
            return ResolveResult {
                resolvable: false,
                open_url: Some(referer),
                reason: Some("generate failed".to_string()),
                ..Default::default()
            }
        }
    };
    let gen_json = serde_json::from_str::<Value>(&gen_text).unwrap_or(Value::Null);
    let success = gen_json.get("success").and_then(|v| v.as_bool()).unwrap_or(false);
    let download_url = gen_json
        .get("download_url")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    if !ok_status(gen_status) || !success || download_url.is_empty() {
        let reason = gen_json
            .get("error")
            .and_then(|v| v.as_str())
            .map(String::from)
            .unwrap_or_else(|| format!("generate failed ({gen_status})"));
        return ResolveResult {
            resolvable: false,
            open_url: Some(referer),
            reason: Some(reason),
            ..Default::default()
        };
    }

    let mut h3 = HashMap::new();
    h3.insert("Referer".to_string(), referer.clone());
    let (page_status, page_text) = match fetch_full(
        &download_url,
        FetchOpts {
            headers: h3,
            jar: Some(jar.clone()),
            ..Default::default()
        },
    )
    .await
    {
        Some(v) => v,
        None => {
            return ResolveResult {
                resolvable: false,
                open_url: Some(download_url),
                reason: Some("download page error".to_string()),
                ..Default::default()
            }
        }
    };
    if !ok_status(page_status) {
        return ResolveResult {
            resolvable: false,
            open_url: Some(download_url),
            reason: Some(format!("download page {page_status}")),
            ..Default::default()
        };
    }

    let encoded = first_match(&page_text, &DOWNLOAD_PAGE_RE);
    let direct = if encoded.is_empty() {
        String::new()
    } else {
        percent_encoding::percent_decode_str(&encoded)
            .decode_utf8()
            .map(|s| s.to_string())
            .unwrap_or_else(|_| encoded.clone())
    };
    if direct.is_empty() {
        return ResolveResult {
            resolvable: false,
            open_url: Some(download_url),
            reason: Some("no direct link in download page".to_string()),
            ..Default::default()
        };
    }

    let target = DownloadOption {
        url: Some(direct.clone()),
        ..Default::default()
    };
    let resolved = crate::sources::hosts::resolve_url(&target).await;
    if resolved.resolvable {
        return resolved;
    }
    let open_url = resolved.open_url.clone().or(Some(direct));
    ResolveResult { open_url, ..resolved }
}
