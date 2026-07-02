use std::collections::{HashMap, HashSet};
use std::time::Duration;

use once_cell::sync::Lazy;
use regex::Regex;
use serde_json::Value;

use crate::http;
use crate::sources::cache::Cached;
use crate::sources::hosts;
use crate::sources::parse::find_steam_app_id;
use crate::sources::schema::{
    dedup_key_for, parse_size_to_bytes, to_epoch_ms, DownloadOption, SourceGame,
};
use crate::sources::steam;
use crate::sources::{Capabilities, QueryParams, ResolveResult};

const ID: &str = "steamrip";
const ORIGIN: &str = "https://steamrip.com";
const API: &str = "https://steamrip.com/wp-json/wp/v2";
const FIELDS: &str = "id,slug,link,title,content,date,modified,categories";
const SR_SEARCH_CONCURRENCY: usize = 6;

static VERSION_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\(\s*(?:v\.?\s*)?([\w.\-]+(?:\s*build\s*\d+)?)\s*\)\s*$").unwrap());
static V_STRIP_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)^v\.?\s*").unwrap());
static TITLE_SUFFIX_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\s*free\s+download\s*$").unwrap());
static P_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?is)<p[^>]*>(.*?)</p>").unwrap());
static BOILERPLATE_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)^(?:how to|click the|note:)").unwrap());
static SIZE1_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)(?:game\s*size|size)\s*[:\-]?\s*([\d.]+\s*(?:TB|GB|MB))").unwrap()
});
static SIZE2_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)([\d.]+\s*(?:TB|GB))\b").unwrap());
static ANCHOR_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r#"(?is)<a\b([^>]*)href="([^"]+)"([^>]*)>(.*?)</a>"#).unwrap());
static HTTP_PREFIX_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)^https?://").unwrap());
static FILE_HOSTS_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"(?i)(gofile\.io|bzzhr\.to|buzzheavier\.com|megadb\.net|datanodes\.to|1fichier\.com|akirabox\.com|pixeldrain\.com|mega\.nz|mediafire\.com|fileditch|filecrypt\.cc|qiwi\.gg)",
    )
    .unwrap()
});
static BUTTON_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)shortc-button|btn|download").unwrap());
static DOWNLOAD_TEXT_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)download").unwrap());
static EXCLUDE_HOST_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)steamrip\.com$|steampowered|steamstatic|youtu|discord|reddit|t\.me|patreon")
        .unwrap()
});
static STEAMRIP_HOST_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)steamrip\.com$").unwrap());
static SHARD_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"<loc>\s*([^<]*wp-sitemap-posts-post-\d+\.xml)\s*</loc>").unwrap());
static SITEMAP_SLUG_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"<loc>\s*https?://[^/]+/([^</]+)/?\s*</loc>").unwrap());
static STATIC_SKIP_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)^(?:about|contact|privacy|terms|dmca|faq|how-to|request)").unwrap());
static TRAILING_SLASH_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"/+$").unwrap());

#[derive(Clone, Default)]
struct Cats {
    by_id: HashMap<u64, (String, i64)>,
    by_name: HashMap<String, u64>,
}

static CATS: Lazy<Cached<Cats>> = Lazy::new(|| Cached::new(Duration::from_secs(6 * 60 * 60)));
static SLUGS: Lazy<Cached<Vec<String>>> =
    Lazy::new(|| Cached::new(Duration::from_secs(6 * 60 * 60)));

pub fn capabilities() -> Capabilities {
    Capabilities {
        search: true,
        catalog: true,
        appid: false,
        bulk_browse: true,
        tags: true,
        release_date: false,
        size: false,
        sort: vec!["latest".to_string(), "updated".to_string(), "title".to_string()],
    }
}

async fn load_category_map() -> Cats {
    CATS.get_or(|| async {
        let url = format!("{API}/categories?per_page=100&_fields=id,name,count");
        let json: Value = http::get_json(&url).await.ok()?;
        let mut cats = Cats::default();
        if let Some(arr) = json.as_array() {
            for c in arr {
                let id = c.get("id").and_then(|v| v.as_u64());
                let name = c.get("name").and_then(|v| v.as_str());
                if let (Some(id), Some(name)) = (id, name) {
                    if id == 0 || name.is_empty() {
                        continue;
                    }
                    let count = c.get("count").and_then(|v| v.as_i64()).unwrap_or(0);
                    cats.by_id.insert(id, (name.to_string(), count));
                    cats.by_name.insert(name.to_lowercase(), id);
                }
            }
        }
        if cats.by_id.is_empty() {
            None
        } else {
            Some(cats)
        }
    })
    .await
    .unwrap_or_default()
}

async fn build_slugs() -> Vec<String> {
    let index_xml = http::get_text(&format!("{ORIGIN}/wp-sitemap.xml"))
        .await
        .unwrap_or_default();
    let mut shards: Vec<String> = SHARD_RE
        .captures_iter(&index_xml)
        .map(|c| c[1].trim().to_string())
        .collect();
    if shards.is_empty() {
        shards.push(format!("{ORIGIN}/wp-sitemap-posts-post-1.xml"));
    }
    let mut seen: HashSet<String> = HashSet::new();
    let mut ordered: Vec<String> = Vec::new();
    for shard in shards {
        let xml = match http::get_text(&shard).await {
            Ok(x) => x,
            Err(_) => continue,
        };
        for c in SITEMAP_SLUG_RE.captures_iter(&xml) {
            let slug = TRAILING_SLASH_RE.replace(&c[1], "").to_string();
            if slug.is_empty() || STATIC_SKIP_RE.is_match(&slug) {
                continue;
            }
            if seen.insert(slug.clone()) {
                ordered.push(slug);
            }
        }
    }
    ordered
}

async fn all_slugs() -> Vec<String> {
    SLUGS
        .get_or(|| async {
            let slugs = build_slugs().await;
            if slugs.is_empty() {
                None
            } else {
                Some(slugs)
            }
        })
        .await
        .unwrap_or_default()
}

fn steam_image(appid: u64, kind: &str) -> String {
    format!("https://shared.steamstatic.com/store_item_assets/steam/apps/{appid}/{kind}")
}

fn clean_title(rendered: &str) -> (String, String) {
    let mut t = http::decode_entities(rendered).trim().to_string();
    let mut version = String::new();
    let vmatch = VERSION_RE.captures(&t).and_then(|cap| {
        let g1 = cap.get(1)?.as_str().to_string();
        if g1.chars().any(|c| c.is_ascii_digit()) {
            Some((cap.get(0).unwrap().start(), g1))
        } else {
            None
        }
    });
    if let Some((start, g1)) = vmatch {
        version = V_STRIP_RE.replace(&g1, "").to_string();
        t = t[..start].trim().to_string();
    }
    t = TITLE_SUFFIX_RE.replace(&t, "").trim().to_string();
    (t, version)
}

fn blurb(content: &str) -> String {
    let mut paras: Vec<String> = Vec::new();
    for cap in P_RE.captures_iter(content) {
        if paras.len() >= 3 {
            break;
        }
        let text = http::strip_tags(&cap[1]);
        if !text.is_empty() && text.chars().count() > 30 && !BOILERPLATE_RE.is_match(&text) {
            paras.push(text);
        }
    }
    paras.join("\n\n").chars().take(800).collect()
}

fn find_size(content: &str) -> Option<u64> {
    let cap = SIZE1_RE
        .captures(content)
        .or_else(|| SIZE2_RE.captures(content))?;
    parse_size_to_bytes(cap.get(1)?.as_str())
}

fn extract_download_options(content: &str) -> Vec<DownloadOption> {
    let mut options: Vec<DownloadOption> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    for cap in ANCHOR_RE.captures_iter(content) {
        let attrs = format!("{} {}", &cap[1], &cap[3]);
        let url = http::decode_entities(&cap[2]).trim().to_string();
        if !HTTP_PREFIX_RE.is_match(&url) || seen.contains(&url) {
            continue;
        }
        let host = match url::Url::parse(&url)
            .ok()
            .and_then(|u| u.host_str().map(|s| s.to_lowercase()))
        {
            Some(h) => h,
            None => continue,
        };
        let inner_text = http::strip_tags(&cap[4]);
        let is_button = BUTTON_RE.is_match(&attrs) || DOWNLOAD_TEXT_RE.is_match(&inner_text);
        if !FILE_HOSTS_RE.is_match(&host) && !(is_button && !STEAMRIP_HOST_RE.is_match(&host)) {
            continue;
        }
        if EXCLUDE_HOST_RE.is_match(&host) {
            continue;
        }
        let host_type = hosts::detect_host_type(&url);
        let resolvable = hosts::is_resolvable(&url);
        seen.insert(url.clone());
        options.push(DownloadOption {
            label: host_type.clone(),
            host_type,
            url: Some(url),
            resolvable,
            ..Default::default()
        });
    }
    options.sort_by(|a, b| (b.resolvable as u8).cmp(&(a.resolvable as u8)));
    options
}

fn build_game(post: &Value, appid: Option<u64>, cats: &Cats) -> SourceGame {
    let content = post
        .get("content")
        .and_then(|c| c.get("rendered"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let title_rendered = post
        .get("title")
        .and_then(|c| c.get("rendered"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let (title, version) = clean_title(title_rendered);
    let final_appid = appid
        .or_else(|| find_steam_app_id(content))
        .filter(|v| *v > 0);
    let slug = post
        .get("slug")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let source_url = post
        .get("link")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .unwrap_or_else(|| format!("{ORIGIN}/{slug}/"));
    let cat_ids: Vec<u64> = post
        .get("categories")
        .and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|x| x.as_u64()).collect())
        .unwrap_or_default();
    let genres: Vec<String> = cat_ids
        .iter()
        .filter_map(|id| cats.by_id.get(id).map(|(n, _)| n.clone()))
        .collect();
    let description = {
        let b = blurb(content);
        if b.is_empty() {
            None
        } else {
            Some(b)
        }
    };
    let image = final_appid.map(|id| steam_image(id, "library_600x900.jpg"));
    let hero_image = final_appid.map(|id| steam_image(id, "library_hero.jpg"));
    let added_at = post
        .get("date")
        .and_then(|v| v.as_str())
        .and_then(to_epoch_ms);
    let updated_at = post
        .get("modified")
        .and_then(|v| v.as_str())
        .and_then(to_epoch_ms);
    let version = if version.is_empty() {
        None
    } else {
        Some(version)
    };
    SourceGame {
        source_id: ID.to_string(),
        source_slug: slug,
        source_url,
        steam_app_id: final_appid,
        dedup_key: dedup_key_for(final_appid, &title),
        title,
        description,
        image,
        hero_image,
        genres,
        developer: None,
        release_date: None,
        release_year: None,
        added_at,
        updated_at,
        popularity: None,
        version,
        size_bytes: find_size(content),
        size_text: None,
        nsfw: false,
        download_options: extract_download_options(content),
    }
}

fn posts_to_games(json: &Value, appid: Option<u64>, cats: &Cats) -> Vec<SourceGame> {
    match json.as_array() {
        Some(arr) => arr
            .iter()
            .map(|p| build_game(p, appid, cats))
            .filter(|g| !g.title.is_empty())
            .collect(),
        None => Vec::new(),
    }
}

fn orderby_for(sort: &str, has_text: bool) -> &'static str {
    match sort {
        "latest" => "date",
        "updated" => "modified",
        "title" => "title",
        "relevance" => "relevance",
        _ => {
            if has_text {
                "relevance"
            } else {
                "date"
            }
        }
    }
}

fn enc(s: &str) -> String {
    percent_encoding::utf8_percent_encode(s, percent_encoding::NON_ALPHANUMERIC).to_string()
}

pub async fn query(params: &QueryParams) -> Vec<SourceGame> {
    let cats = load_category_map().await;
    let per_page = params.limit.min(100);
    let text = params.text.as_deref().unwrap_or("").trim();
    let mut url = format!("{API}/posts?per_page={per_page}&_fields={FIELDS}");
    if !text.is_empty() {
        url.push_str(&format!("&search={}", enc(text)));
    }
    let cat_ids: Vec<String> = params
        .tags
        .iter()
        .filter_map(|t| cats.by_name.get(&t.to_lowercase()).map(|id| id.to_string()))
        .collect();
    if !cat_ids.is_empty() {
        url.push_str(&format!("&categories={}", cat_ids.join(",")));
    }
    let orderby = orderby_for(params.sort.as_deref().unwrap_or(""), !text.is_empty());
    url.push_str(&format!("&orderby={orderby}&order=desc"));
    let json: Value = match http::get_json(&url).await {
        Ok(v) => v,
        Err(_) => return Vec::new(),
    };
    posts_to_games(&json, None, &cats)
}

pub async fn search(q: &str, limit: usize) -> Vec<SourceGame> {
    let lowered = q.to_lowercase();
    let q = lowered.trim();
    if q.is_empty() {
        return Vec::new();
    }
    let terms: Vec<String> = q.split_whitespace().map(|s| s.to_string()).collect();
    let matches: Vec<String> = all_slugs()
        .await
        .into_iter()
        .filter(|s| {
            let hay = format!(" {} ", s.replace('-', " "));
            terms.iter().all(|t| hay.contains(t.as_str()))
        })
        .take(limit)
        .collect();
    if !matches.is_empty() {
        return http::map_limit(matches, SR_SEARCH_CONCURRENCY, |slug| async move {
            get_detail(&slug).await
        })
        .await;
    }
    let cats = load_category_map().await;
    let url = format!(
        "{API}/posts?search={}&per_page={}&_fields={FIELDS}",
        enc(q),
        limit
    );
    let json: Value = match http::get_json(&url).await {
        Ok(v) => v,
        Err(_) => return Vec::new(),
    };
    let games = posts_to_games(&json, None, &cats);
    let titled: Vec<SourceGame> = games
        .iter()
        .filter(|g| {
            let lt = g.title.to_lowercase();
            terms.iter().all(|t| lt.contains(t.as_str()))
        })
        .cloned()
        .collect();
    if titled.is_empty() {
        games
    } else {
        titled
    }
}

pub async fn get_detail(slug: &str) -> Option<SourceGame> {
    let clean = slug.trim_matches('/').to_string();
    let cats = load_category_map().await;
    let url = format!("{API}/posts?slug={}&_fields={FIELDS}", enc(&clean));
    let json: Value = http::get_json(&url).await.ok()?;
    let post = json.as_array().and_then(|a| a.first())?;
    let content = post
        .get("content")
        .and_then(|c| c.get("rendered"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let mut appid = find_steam_app_id(content);
    if appid.is_none() {
        let title_rendered = post
            .get("title")
            .and_then(|c| c.get("rendered"))
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let (title, _) = clean_title(title_rendered);
        appid = steam::search_app_id(&title).await;
    }
    Some(build_game(post, appid, &cats))
}

pub async fn list_tags() -> Vec<String> {
    let cats = load_category_map().await;
    let mut items: Vec<(String, i64)> = cats.by_id.values().cloned().collect();
    items.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    items.into_iter().map(|(name, _)| name).collect()
}

pub async fn resolve_download(_option: &DownloadOption) -> ResolveResult {
    ResolveResult::default()
}
