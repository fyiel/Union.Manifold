use std::collections::HashMap;
use std::sync::Mutex;

use once_cell::sync::Lazy;
use serde_json::{json, Value};

use crate::http;

use super::schema::{normalize_title, UnifiedGame};

static APPID_CACHE: Lazy<Mutex<HashMap<String, Option<u64>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));
static DETAILS_CACHE: Lazy<Mutex<HashMap<u64, Option<StoreDetails>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

#[derive(Clone, Default)]
pub struct StoreDetails {
    pub description: String,
    pub genres: Vec<String>,
    pub release_year: Option<i32>,
    pub header_image: String,
    pub background: String,
    pub screenshots: Vec<String>,
}

pub async fn get_store_details(appid: u64) -> Option<StoreDetails> {
    if appid == 0 {
        return None;
    }
    if let Some(cached) = DETAILS_CACHE.lock().unwrap().get(&appid).cloned() {
        return cached;
    }
    let url = format!("https://store.steampowered.com/api/appdetails?appids={appid}&l=en&cc=US");
    let json: Value = match http::get_json(&url).await {
        Ok(v) => v,
        Err(_) => return None,
    };
    let data = json
        .get(appid.to_string())
        .filter(|v| v.get("success").and_then(|s| s.as_bool()).unwrap_or(false))
        .and_then(|v| v.get("data"));
    let out = data.map(|d| {
        let date = d
            .get("release_date")
            .and_then(|r| r.get("date"))
            .and_then(|v| v.as_str())
            .unwrap_or("");
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
        }
    });
    DETAILS_CACHE.lock().unwrap().insert(appid, out.clone());
    out
}

pub async fn search_app_id(title: &str) -> Option<u64> {
    let norm = normalize_title(title);
    if norm.is_empty() {
        return None;
    }
    if let Some(cached) = APPID_CACHE.lock().unwrap().get(&norm).cloned() {
        return cached;
    }
    let url = format!(
        "https://store.steampowered.com/api/storesearch/?term={}&cc=US&l=en",
        urlencoding(&norm)
    );
    let mut appid = None;
    if let Ok(json) = http::get_json::<Value>(&url).await {
        if let Some(items) = json.get("items").and_then(|v| v.as_array()) {
            let exact = items.iter().find(|it| {
                it.get("name")
                    .and_then(|v| v.as_str())
                    .map(|n| normalize_title(n) == norm)
                    .unwrap_or(false)
            });
            let pick = exact.or_else(|| items.first());
            appid = pick
                .and_then(|p| p.get("id"))
                .and_then(|v| v.as_u64())
                .filter(|id| *id > 0);
        }
    }
    APPID_CACHE.lock().unwrap().insert(norm, appid);
    appid
}

pub async fn steam_art(appid: u64) -> Value {
    if let Some(d) = get_store_details(appid).await {
        return json!({ "header": d.header_image, "background": d.background });
    }
    json!({ "header": "", "background": "" })
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
