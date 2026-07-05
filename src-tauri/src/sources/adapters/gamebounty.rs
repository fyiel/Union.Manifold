use std::sync::LazyLock;
use std::time::Duration;

use once_cell::sync::Lazy;
use regex::Regex;
use serde_json::Value;
use url::Url;

use crate::http::{self, FetchOpts};
use crate::sources::cache::{Cached, KeyedCache};
use crate::sources::hosts::{detect_host_type, is_resolvable};
use crate::sources::parse::{collect_next_flight, find_object_by_key, find_steam_app_id};
use crate::sources::schema::{self, DownloadOption, SourceGame};
use crate::sources::{Capabilities, QueryParams};

const ID: &str = "gamebounty";
const ORIGIN: &str = "https://gamebounty.world";
const SLUG_SUFFIX: &str = "-free-pc-download";
const CATALOG_WINDOW: usize = 60;

static SLUG_CACHE: Lazy<Cached<Vec<String>>> =
    Lazy::new(|| Cached::new(Duration::from_secs(60 * 60 * 6)));

static DETAIL_CACHE: Lazy<KeyedCache<SourceGame>> =
    Lazy::new(|| KeyedCache::new(Duration::from_secs(60 * 60 * 6)));

// Browse-level cache, matching the other adapters (ankergames BROWSE 5m,
// steamrip POSTS 600s): one entry per assembled listing so a Browse revisit
// skips the 60-slug detail fan-out entirely.
static BROWSE: LazyLock<KeyedCache<Vec<SourceGame>>> =
    LazyLock::new(|| KeyedCache::new(Duration::from_secs(600)));

static LOC_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"<loc>\s*([^<]+?)\s*</loc>").unwrap());

fn value_truthy(v: &Value) -> bool {
    match v {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().map(|f| f != 0.0 && !f.is_nan()).unwrap_or(false),
        Value::String(s) => !s.is_empty(),
        Value::Array(_) | Value::Object(_) => true,
    }
}

fn value_to_u64(v: &Value) -> Option<u64> {
    if let Some(n) = v.as_u64() {
        return Some(n);
    }
    if let Some(f) = v.as_f64() {
        if f.is_finite() && f > 0.0 {
            return Some(f as u64);
        }
    }
    if let Some(s) = v.as_str() {
        let t = s.trim();
        if let Ok(n) = t.parse::<u64>() {
            return Some(n);
        }
        if let Ok(f) = t.parse::<f64>() {
            if f.is_finite() && f > 0.0 {
                return Some(f as u64);
            }
        }
    }
    None
}

fn value_to_f64(v: &Value) -> Option<f64> {
    if let Some(f) = v.as_f64() {
        if f.is_finite() {
            return Some(f);
        }
    }
    if let Some(s) = v.as_str() {
        if let Ok(f) = s.trim().parse::<f64>() {
            if f.is_finite() {
                return Some(f);
            }
        }
    }
    None
}

fn truthy_string(v: &Value) -> Option<String> {
    match v {
        Value::String(s) if !s.is_empty() => Some(s.clone()),
        Value::Number(n) => {
            if n.as_f64().map(|f| f != 0.0 && !f.is_nan()).unwrap_or(false) {
                Some(n.to_string())
            } else {
                None
            }
        }
        Value::Bool(true) => Some("true".to_string()),
        _ => None,
    }
}

fn get_str(v: &Value, key: &str) -> Option<String> {
    v.get(key)
        .and_then(|x| x.as_str())
        .map(|s| s.to_string())
        .filter(|s| !s.is_empty())
}

fn epoch_from_value(v: Option<&Value>) -> Option<i64> {
    let v = v?;
    if let Some(n) = v.as_i64() {
        return Some(n);
    }
    if let Some(f) = v.as_f64() {
        if f.is_finite() {
            return Some(f as i64);
        }
    }
    if let Some(s) = v.as_str() {
        return schema::to_epoch_ms(s);
    }
    None
}

static HTML_TAG_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"<[^>]*>").unwrap());

fn strip_html(s: &str) -> String {
    HTML_TAG_RE
        .replace_all(s, " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn title_from_slug(slug: &str) -> String {
    let base = slug.strip_suffix(SLUG_SUFFIX).unwrap_or(slug);
    base.replace('-', " ")
        .split_whitespace()
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

fn steam_image(appid: u64, kind: &str) -> String {
    format!("https://shared.steamstatic.com/store_item_assets/steam/apps/{appid}/{kind}")
}

async fn all_slugs() -> Option<Vec<String>> {
    SLUG_CACHE
        .get_or(|| async {
            let text = http::get_text(&format!("{ORIGIN}/sitemap.xml"))
                .await
                .ok()?;
            let mut slugs = Vec::new();
            for caps in LOC_RE.captures_iter(&text) {
                let raw = caps.get(1).map(|m| m.as_str().trim()).unwrap_or("");
                if raw.is_empty() {
                    continue;
                }
                if let Ok(u) = Url::parse(raw) {
                    if u.host_str()
                        .map(|h| h.ends_with("gamebounty.world"))
                        .unwrap_or(false)
                    {
                        let path = u.path().trim_matches('/');
                        if path.ends_with(SLUG_SUFFIX) {
                            slugs.push(path.to_string());
                        }
                    }
                }
            }
            if slugs.is_empty() {
                None
            } else {
                Some(slugs)
            }
        })
        .await
}

fn mirrors_to_options(container: Option<&Value>) -> Vec<DownloadOption> {
    let container = match container {
        Some(c) => c,
        None => return Vec::new(),
    };
    let data = container
        .get("data")
        .filter(|d| value_truthy(d))
        .unwrap_or(container);

    let data_name = get_str(data, "name");
    let data_size_human = get_str(data, "size_human");
    let data_size_bytes = data
        .get("size_bytes")
        .and_then(value_to_u64)
        .filter(|n| *n > 0);

    let mirrors = data
        .get("mirrors")
        .and_then(|m| m.as_array())
        .cloned()
        .unwrap_or_default();

    let mut options = Vec::new();
    for mirror in &mirrors {
        let mirror_name = get_str(mirror, "name");
        let links = mirror
            .get("links")
            .and_then(|l| l.as_array())
            .cloned()
            .unwrap_or_default();
        for link in &links {
            let url = match get_str(link, "url") {
                Some(u) => u,
                None => continue,
            };
            let host_type = detect_host_type(&url);
            let file_name = get_str(link, "file_name").or_else(|| data_name.clone());
            let link_size = get_str(link, "file_size");
            let size_bytes = link_size
                .as_deref()
                .or(data_size_human.as_deref())
                .and_then(schema::parse_size_to_bytes)
                .or(data_size_bytes);
            let size_text = link_size.clone().or_else(|| data_size_human.clone());
            let resolvable = is_resolvable(&url);
            options.push(DownloadOption {
                label: mirror_name.clone().unwrap_or_else(|| host_type.clone()),
                host_type,
                url: Some(url),
                page_url: None,
                file_name,
                size_bytes,
                size_text: size_text.filter(|s| !s.is_empty()),
                resolvable,
            });
        }
    }
    options.sort_by(|a, b| b.resolvable.cmp(&a.resolvable));
    options
}

fn parse_game_page(html: &str, slug: &str) -> Option<SourceGame> {
    let flight = collect_next_flight(html);
    // No "post" object means the page didn't render the game payload (a transient
    // render/fetch failure). Return None so get_detail doesn't cache an empty
    // slug-title for 6h.
    let post = find_object_by_key(&flight, "post")?;

    let appid = if post.get("appid").map(value_truthy).unwrap_or(false) {
        post.get("appid").and_then(value_to_u64).filter(|n| *n > 0)
    } else {
        find_steam_app_id(html)
    };

    let download_options = mirrors_to_options(post.get("container"));

    let image = get_str(&post, "library_capsule")
        .or_else(|| get_str(&post, "banner"))
        .or_else(|| appid.map(|id| steam_image(id, "library_600x900.jpg")));

    let hero_image = get_str(&post, "library_hero")
        .or_else(|| appid.map(|id| steam_image(id, "library_hero.jpg")));

    let title = post
        .get("title")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| title_from_slug(slug));

    let description = get_str(&post, "mini_description").or_else(|| {
        post.get("description")
            .and_then(|d| d.as_str())
            .map(strip_html)
            .filter(|s| !s.is_empty())
    });

    let genres = post
        .get("genres")
        .and_then(|g| g.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|x| x.as_str())
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    let developer = get_str(&post, "developer");
    let release_date = get_str(&post, "release_date");
    let release_year = release_date.as_deref().and_then(schema::year_from);

    let added_at = epoch_from_value(post.get("created_at"));
    let updated_raw = post
        .get("updated_at")
        .filter(|v| value_truthy(v))
        .or_else(|| post.get("edited_at").filter(|v| value_truthy(v)));
    let updated_at = epoch_from_value(updated_raw);

    let popularity = post
        .get("view_count")
        .and_then(value_to_f64)
        .filter(|n| *n != 0.0)
        .or_else(|| {
            post.get("down_count")
                .and_then(value_to_f64)
                .filter(|n| *n != 0.0)
        });

    let version = post
        .get("version")
        .and_then(truthy_string)
        .or_else(|| post.get("build_id").and_then(truthy_string));

    let cdata = post.get("container").and_then(|c| c.get("data"));
    let size_human = cdata.and_then(|d| get_str(d, "size_human"));
    let size_bytes = size_human
        .as_deref()
        .and_then(schema::parse_size_to_bytes)
        .or_else(|| {
            cdata
                .and_then(|d| d.get("size_bytes"))
                .and_then(value_to_u64)
                .filter(|n| *n > 0)
        });

    let nsfw = post.get("is_nsfw").map(value_truthy).unwrap_or(false);

    Some(SourceGame {
        source_id: ID.to_string(),
        source_slug: slug.to_string(),
        source_url: format!("{ORIGIN}/{slug}"),
        steam_app_id: appid,
        dedup_key: schema::dedup_key_for(appid, &title),
        title,
        description,
        image,
        hero_image,
        genres,
        developer,
        release_date,
        release_year,
        added_at,
        updated_at,
        popularity,
        version,
        size_bytes,
        size_text: size_human,
        nsfw,
        download_options,
    })
}

pub fn capabilities() -> Capabilities {
    Capabilities {
        search: true,
        catalog: true,
        appid: true,
        bulk_browse: true,
        tags: true,
        release_date: true,
        size: true,
        sort: ["popular", "latest", "updated", "title"]
            .iter()
            .map(|s| s.to_string())
            .collect(),
    }
}

pub async fn query(params: &QueryParams) -> Option<Vec<SourceGame>> {
    let limit = params.limit;
    if let Some(text) = params.text.as_deref() {
        let text = text.trim();
        if !text.is_empty() {
            // search() returns empty both for "no matches" and for a sitemap
            // hard-fail; only cache non-empty results so a transient failure
            // can't pin an empty listing for the whole TTL. (Re-running a
            // genuinely empty search is a scan over the cached slug list.)
            let key = format!("s|{}|{limit}", text.to_lowercase());
            let cached = BROWSE
                .get_or(&key, || async move {
                    let out = search(text, limit).await;
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
    let key = format!("c|{limit}");
    BROWSE
        .get_or(&key, || async move {
            // None => the sitemap fetch hard-failed (no slugs, not even
            // stale): don't cache, so the next browse retries (get_or serves
            // a stale listing here if it has one, like the other adapters).
            let slugs = match all_slugs().await {
                Some(s) => s,
                None => {
                    crate::logging::write_line("warn", "gamebounty sitemap yielded no slugs");
                    return None;
                }
            };
            // Cap the per-fill catalog window well below POOL_SIZE: one page
            // fetch per slug up to POOL_SIZE (300) is slow and fragile.
            let end = limit.min(CATALOG_WINDOW).min(slugs.len());
            let window: Vec<String> = slugs[..end].to_vec();
            Some(http::map_limit(window, 8, |slug| async move { get_detail(&slug).await }).await)
        })
        .await
}

pub async fn search(q: &str, limit: usize) -> Vec<SourceGame> {
    let q = q.to_lowercase();
    let q = q.trim();
    if q.is_empty() {
        return Vec::new();
    }
    let slugs = all_slugs().await.unwrap_or_default();
    let terms: Vec<&str> = q.split_whitespace().collect();
    let mut scored = Vec::new();
    for slug in &slugs {
        let hay = slug.replace(SLUG_SUFFIX, "").replace('-', " ");
        if terms.iter().all(|t| hay.contains(t)) {
            scored.push(slug.clone());
        }
    }
    let top: Vec<String> = scored.into_iter().take(limit).collect();
    http::map_limit(top, 8, |slug| async move { get_detail(&slug).await }).await
}

pub async fn get_detail(slug: &str) -> Option<SourceGame> {
    let path = if slug.ends_with(SLUG_SUFFIX) {
        slug.to_string()
    } else {
        format!("{slug}{SLUG_SUFFIX}")
    };
    let key = path.clone();
    DETAIL_CACHE
        .get_or(&key, || async move {
            let url = format!("{ORIGIN}/{path}");
            let resp = http::fetch(&url, &FetchOpts::default()).await.ok()?;
            if !resp.status().is_success() {
                return None;
            }
            let text = resp.text().await.ok()?;
            parse_game_page(&text, &path)
        })
        .await
}

