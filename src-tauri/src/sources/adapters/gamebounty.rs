use std::sync::LazyLock;
use std::time::Duration;

use serde_json::Value;

use crate::http::{self, FetchOpts};
use crate::sources::cache::{Cached, KeyedCache};
use crate::sources::hosts::{detect_host_type, is_resolvable};
use crate::sources::parse::find_steam_app_id;
use crate::sources::schema::{self, DownloadOption, SourceGame};
use crate::sources::{Capabilities, QueryParams};

const ID: &str = "gamebounty";
const ORIGIN: &str = "https://gamebounty.world";
const API: &str = "https://api.gamebounty.world";
const SLUG_SUFFIX: &str = "-free-pc-download";
const PAGE_SIZE: usize = 100;
const MAX_PAGES: usize = 80;

static CATALOG: LazyLock<Cached<Vec<Value>>> =
    LazyLock::new(|| Cached::new(Duration::from_secs(60 * 30)));

static DETAIL_CACHE: LazyLock<KeyedCache<SourceGame>> =
    LazyLock::new(|| KeyedCache::new(Duration::from_secs(60 * 60 * 6)));

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


async fn fetch_data(url: &str) -> Option<Value> {
    let resp = http::fetch(url, &FetchOpts::default()).await.ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let json: Value = resp.json().await.ok()?;
    if json.get("success").and_then(|v| v.as_bool()) == Some(false) {
        return None;
    }
    json.get("data").cloned()
}

async fn catalog_snapshot() -> Option<Vec<Value>> {
    CATALOG
        .get_or(|| async {
            let mut all: Vec<Value> = Vec::new();
            for page in 1..=MAX_PAGES {
                let url = format!("{API}/api/posts?sort=newest&limit={PAGE_SIZE}&page={page}");
                let batch = match fetch_data(&url).await {
                    Some(Value::Array(arr)) => arr,
                    _ => break,
                };
                let got = batch.len();
                all.extend(batch);
                if got < PAGE_SIZE {
                    break;
                }
            }
            if all.is_empty() {
                None
            } else {
                Some(all)
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
                size_bytes,
                size_text: size_text.filter(|s| !s.is_empty()),
                resolvable,
            });
        }
    }
    options.sort_by_key(|x| std::cmp::Reverse(x.resolvable));
    options
}

fn post_to_game(post: &Value) -> Option<SourceGame> {
    let slug = get_str(post, "slug")?;
    let title = get_str(post, "title").unwrap_or_else(|| slug.replace('-', " "));

    let appid = post
        .get("appid")
        .and_then(value_to_u64)
        .filter(|n| *n > 0)
        .or_else(|| {
            get_str(post, "banner")
                .as_deref()
                .and_then(find_steam_app_id)
        })
        .or_else(|| {
            get_str(post, "library_capsule")
                .as_deref()
                .and_then(find_steam_app_id)
        });

    let image = get_str(post, "library_capsule")
        .or_else(|| get_str(post, "banner"))
        .or_else(|| appid.map(|id| crate::sources::steam::steam_image(id, "library_600x900.jpg")));
    let hero_image = get_str(post, "library_hero")
        .or_else(|| appid.map(|id| crate::sources::steam::steam_image(id, "library_hero.jpg")));

    let description = get_str(post, "mini_description")
        .or_else(|| {
            post.get("description")
                .and_then(|d| d.as_str())
                .map(http::strip_tags)
        })
        .map(|s| http::decode_entities(&s).trim().to_string())
        .filter(|s| !s.is_empty());

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

    let developer = get_str(post, "developer");
    let release_date = get_str(post, "release_date");
    let release_year = release_date.as_deref().and_then(schema::year_from);

    let added_at = epoch_from_value(post.get("created_at"));
    let updated_raw = post
        .get("updated_at")
        .filter(|v| value_truthy(v))
        .or_else(|| post.get("edited_at").filter(|v| value_truthy(v)));
    let updated_at = epoch_from_value(updated_raw);

    let version = get_str(post, "version").or_else(|| get_str(post, "build_id"));

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


    Some(SourceGame {
        source_id: ID.to_string(),
        source_slug: slug.clone(),
        source_url: format!("{ORIGIN}/{slug}{SLUG_SUFFIX}"),
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
        version,
        size_bytes,
        size_text: size_human,
        download_options: mirrors_to_options(post.get("container")),
        direct: false,
        normalized_title: String::new(),
    })
}

pub fn capabilities() -> Capabilities {
    Capabilities {
        search: true,
        catalog: true,
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
    let snapshot = catalog_snapshot().await?;
    let mut games: Vec<SourceGame> = snapshot.iter().filter_map(post_to_game).collect();
    if let Some(text) = params.text.as_deref() {
        let q = text.trim().to_lowercase();
        if !q.is_empty() {
            let terms: Vec<&str> = q.split_whitespace().collect();
            games.retain(|g| {
                let hay = g.title.to_lowercase();
                terms.iter().all(|t| hay.contains(t))
            });
        }
    }
    Some(games)
}

pub async fn search(q: &str, limit: usize) -> Vec<SourceGame> {
    let q = q.trim().to_lowercase();
    if q.is_empty() {
        return Vec::new();
    }
    let snapshot = match catalog_snapshot().await {
        Some(s) => s,
        None => return Vec::new(),
    };
    let terms: Vec<&str> = q.split_whitespace().collect();
    snapshot
        .iter()
        .filter(|post| {
            let title = post
                .get("title")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_lowercase();
            !title.is_empty() && terms.iter().all(|t| title.contains(t))
        })
        .take(limit)
        .filter_map(post_to_game)
        .collect()
}

pub async fn get_detail(slug: &str) -> Option<SourceGame> {
    let slug = slug.trim();
    let slug = slug.strip_suffix(SLUG_SUFFIX).unwrap_or(slug).to_string();
    if slug.is_empty() {
        return None;
    }
    let key = slug.clone();
    DETAIL_CACHE
        .get_or(&key, || async move {
            let url = format!("{API}/api/posts/{slug}");
            let data = fetch_data(&url).await?;
            if !data.is_object() {
                return None;
            }
            post_to_game(&data)
        })
        .await
}
