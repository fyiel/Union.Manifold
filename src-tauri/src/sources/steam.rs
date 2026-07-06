use std::sync::LazyLock;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::http;

use super::metacache;
use super::schema::{normalize_title, UnifiedGame};

static APPID_CACHE: LazyLock<metacache::WriteBehind<Option<u64>>> =
    LazyLock::new(|| metacache::WriteBehind::load("steam-appids.json"));
static DETAILS_CACHE: LazyLock<metacache::WriteBehind<Option<StoreDetails>>> =
    LazyLock::new(|| metacache::WriteBehind::load("steam-details.json"));

#[derive(Clone, Default, Serialize, Deserialize)]
pub struct StoreDetails {
    pub description: String,
    pub genres: Vec<String>,
    pub release_year: Option<i32>,
    pub header_image: String,
    pub background: String,
    pub screenshots: Vec<String>,
    pub movies: Vec<Value>,
    pub req_minimum: String,
    pub req_recommended: String,
}

// Steam pc_requirements arrive as raw store HTML. Flatten to plain text while
// keeping line structure so the renderer never has to inject markup.
fn req_text(html: &str) -> String {
    static BREAKS: LazyLock<regex::Regex> =
        LazyLock::new(|| regex::Regex::new(r"(?i)<br\s*/?>|</li>|</p>").unwrap());
    BREAKS
        .replace_all(html, "\n")
        .split('\n')
        .map(http::strip_tags)
        .filter(|l| !l.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

pub async fn get_store_details(appid: u64) -> Option<StoreDetails> {
    if appid == 0 {
        return None;
    }
    if let Some(cached) = DETAILS_CACHE.get(&appid.to_string()) {
        return cached;
    }
    let url = format!("https://store.steampowered.com/api/appdetails?appids={appid}&l=en&cc=US");
    let json: Value = match http::get_json(&url).await {
        Ok(v) => v,
        Err(_) => return None,
    };
    // A well-formed appdetails response always carries the appid key (with a
    // `success` flag). A missing key means an unexpected/5xx body: bail WITHOUT
    // caching so a transient blip can't poison the details mapping.
    let entry = json.get(appid.to_string());
    if entry.is_none() {
        return None;
    }
    let data = entry
        .filter(|v| v.get("success").and_then(|s| s.as_bool()).unwrap_or(false))
        .and_then(|v| v.get("data"));
    let out = data.map(|d| {
        let date = d
            .get("release_date")
            .and_then(|r| r.get("date"))
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let str_of = |v: Option<&Value>| v.and_then(|x| x.as_str()).unwrap_or("").to_string();
        let reqs = d.get("pc_requirements").filter(|v| v.is_object());
        StoreDetails {
            description: http::strip_tags(
                d.get("short_description")
                    .or_else(|| d.get("about_the_game"))
                    .and_then(|v| v.as_str())
                    .unwrap_or(""),
            ),
            genres: d
                .get("genres")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|g| g.get("description").and_then(|v| v.as_str()).map(String::from))
                        .collect()
                })
                .unwrap_or_default(),
            release_year: super::schema::year_from(date),
            header_image: d.get("header_image").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            background: d
                .get("background_raw")
                .or_else(|| d.get("background"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            screenshots: d
                .get("screenshots")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|s| {
                            s.get("path_full")
                                .or_else(|| s.get("path_thumbnail"))
                                .and_then(|v| v.as_str())
                                .map(String::from)
                        })
                        .collect()
                })
                .unwrap_or_default(),
            movies: d
                .get("movies")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .map(|m| {
                            let nested = m.get("mp4").and_then(|v| v.get("max").or_else(|| v.get("480"))).and_then(|v| v.as_str());
                            let hls = m.get("hls_h264").and_then(|v| v.as_str());
                            let dash = m.get("dash_h264").and_then(|v| v.as_str());
                            let mp4 = nested.or(hls).or(dash).unwrap_or("").to_string();
                            json!({
                                "id": m.get("id").and_then(|v| v.as_u64()).unwrap_or(0),
                                "name": str_of(m.get("name")),
                                "thumbnail": str_of(m.get("thumbnail")),
                                "mp4": mp4,
                                "webm": str_of(
                                    m.get("webm")
                                        .and_then(|v| v.get("max").or_else(|| v.get("480")))
                                ),
                            })
                        })
                        .collect()
                })
                .unwrap_or_default(),
            req_minimum: req_text(&str_of(reqs.and_then(|r| r.get("minimum")))),
            req_recommended: req_text(&str_of(reqs.and_then(|r| r.get("recommended")))),
        }
    });
    // Write-behind: the details map grows to megabytes, so the insert only
    // mutates memory; the debounced metacache flush persists the file.
    DETAILS_CACHE.insert(appid.to_string(), out.clone());
    out
}

pub async fn search_app_id(title: &str) -> Option<u64> {
    let norm = normalize_title(title);
    if norm.is_empty() {
        return None;
    }
    if let Some(cached) = APPID_CACHE.get(&norm) {
        return cached;
    }
    let url = format!(
        "https://store.steampowered.com/api/storesearch/?term={}&cc=US&l=en",
        urlencoding(&norm)
    );
    let mut appid = None;
    let mut definitive = false;
    if let Ok(json) = http::get_json::<Value>(&url).await {
        if let Some(items) = json.get("items").and_then(|v| v.as_array()) {
            // A parseable response with an items array is a definitive answer
            // (an empty list means "no such app"), so it is safe to cache.
            definitive = true;
            // Require an exact normalized-title match; a fuzzy first-item pick
            // assigns wrong art/ProtonDB, wrong merges, and gets persisted.
            appid = items
                .iter()
                .find(|it| {
                    it.get("name")
                        .and_then(|v| v.as_str())
                        .map(|n| normalize_title(n) == norm)
                        .unwrap_or(false)
                })
                .and_then(|p| p.get("id"))
                .and_then(|v| v.as_u64())
                .filter(|id| *id > 0);
        }
    }
    // Only persist a negative result on a definitive not-found; a transport or
    // 5xx blip must not poison the title->appid mapping (it has no TTL).
    if definitive {
        APPID_CACHE.insert(norm, appid);
    }
    appid
}

pub async fn steam_art(appid: u64) -> Value {
    if let Some(d) = get_store_details(appid).await {
        return json!({ "header": d.header_image, "background": d.background });
    }
    json!({ "header": "", "background": "" })
}

// The predictable vertical capsule exists for most games but 404s for many
// newer/indie titles whose art moved to hashed store_item_assets URLs (e.g.
// appid 3694480). Probe it; on a miss fall back to the store API's real header
// image, then to the guess as a last resort.
pub fn capsule_url(appid: u64) -> String {
    format!("https://cdn.cloudflare.steamstatic.com/steam/apps/{appid}/library_600x900.jpg")
}

pub async fn resolve_cover(appid: u64) -> String {
    let capsule = capsule_url(appid);
    let opts = crate::http::FetchOpts {
        retries: Some(0),
        timeout: Some(std::time::Duration::from_secs(6)),
        ..Default::default()
    };
    if let Ok(resp) = crate::http::fetch(&capsule, &opts).await {
        if resp.status().is_success() {
            return capsule;
        }
    }
    if let Some(d) = get_store_details(appid).await {
        if !d.header_image.is_empty() {
            return d.header_image;
        }
    }
    capsule
}

pub async fn steam_meta(appid: u64) -> Value {
    if let Some(d) = get_store_details(appid).await {
        return json!({
            "screenshots": d.screenshots,
            "movies": d.movies,
            "requirements": { "minimum": d.req_minimum, "recommended": d.req_recommended },
        });
    }
    json!({
        "screenshots": [],
        "movies": [],
        "requirements": { "minimum": "", "recommended": "" },
    })
}

pub async fn enrich(game: &mut UnifiedGame) {
    let appid = match game.steam_app_id {
        Some(id) if id > 0 => id,
        _ => return,
    };
    let details = match get_store_details(appid).await {
        Some(d) => d,
        None => return,
    };
    if game.description.as_ref().map(|d| d.len() < 24).unwrap_or(true) && !details.description.is_empty() {
        game.description = Some(details.description);
    }
    if game.genres.is_empty() {
        game.genres = details.genres;
    }
    if game.release_year.is_none() {
        game.release_year = details.release_year;
    }
    if game.hero_image.is_none() && !details.background.is_empty() {
        game.hero_image = Some(details.background);
    }
}

fn urlencoding(s: &str) -> String {
    percent_encoding::utf8_percent_encode(s, percent_encoding::NON_ALPHANUMERIC).to_string()
}
