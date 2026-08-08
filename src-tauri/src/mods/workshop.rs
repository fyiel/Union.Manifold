use std::collections::{HashMap, HashSet};
use std::sync::LazyLock;

use regex::Regex;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, State};

use crate::http;
use crate::state::AppState;

use super::{
    emit_progress, finalize_install, fold, load_config, save_config, steamcmd, urlenc, InstallSpec,
};

const PAGE_SIZE: usize = 30;

fn workshop_page_url(file_id: &str) -> String {
    format!("https://steamcommunity.com/sharedfiles/filedetails/?id={file_id}")
}

pub(crate) async fn detect_workshop_support(steam_appid: u64) -> Option<bool> {
    if steam_appid == 0 {
        return Some(false);
    }
    let url = format!(
        "https://store.steampowered.com/api/appdetails?appids={steam_appid}&filters=categories&l=en&cc=US"
    );
    let v: Value = http::get_json(&url).await.ok()?;
    let entry = v.get(steam_appid.to_string())?;
    if !entry
        .get("success")
        .and_then(|s| s.as_bool())
        .unwrap_or(false)
    {
        return Some(false);
    }
    let has = entry
        .pointer("/data/categories")
        .and_then(|c| c.as_array())
        .map(|arr| {
            arr.iter().any(|c| {
                c.get("id").and_then(|i| i.as_u64()) == Some(30)
                    || c.get("description").and_then(|d| d.as_str()) == Some("Steam Workshop")
            })
        })
        .unwrap_or(false);
    Some(has)
}

static ID_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"filedetails/\?id=(\d+)").unwrap());
static TITLE_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"class="workshopItemTitle[^"]*"[^>]*>([^<]*)<"#).unwrap());
static IMG_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"<img[^>]+src="([^"]+)""#).unwrap());
static AUTHOR_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r#"class="workshopItemAuthorName[^"]*"[^>]*>\s*(?:by)?(?:&nbsp;|\s)*(?:<a[^>]*>)?([^<]+)"#,
    )
    .unwrap()
});

fn parse_browse(html: &str) -> Vec<Value> {
    let mut out = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    for segment in html.split(r#"class="workshopItem""#).skip(1) {
        let Some(id) = ID_RE.captures(segment).map(|c| c[1].to_string()) else {
            continue;
        };
        if !seen.insert(id.clone()) {
            continue;
        }
        let name = TITLE_RE
            .captures(segment)
            .map(|c| http::decode_entities(c[1].trim()))
            .unwrap_or_default();
        let picture = IMG_RE.captures(segment).map(|c| c[1].to_string());
        let author = AUTHOR_RE
            .captures(segment)
            .map(|c| http::decode_entities(c[1].trim()))
            .unwrap_or_default();
        out.push(browse_item(id.clone(), name, author, picture));
    }
    out
}

static NEW_ITEM_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"filedetails/\?id=(\d+)"[^>]*>\s*<img[^>]+src="([^"]+)"[^>]*alt="([^"]*)""#)
        .unwrap()
});
static NEW_TOTAL_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"\\"workshopNumbers\\":\{\\"total\\":(\d+)"#).unwrap());

fn parse_browse_new(html: &str) -> Vec<Value> {
    let mut out = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    for cap in NEW_ITEM_RE.captures_iter(html) {
        let id = cap[1].to_string();
        if !seen.insert(id.clone()) {
            continue;
        }
        out.push(browse_item(
            id.clone(),
            http::decode_entities(cap[3].trim()),
            String::new(),
            Some(cap[2].to_string()),
        ));
    }
    out
}


fn browse_item(id: String, name: String, author: String, picture: Option<String>) -> Value {
    json!({
        "remoteId": id,
        "name": name,
        "author": author,
        "picture": picture,
        "pageUrl": workshop_page_url(&id),
    })
}

fn parse_browse_total(html: &str) -> Option<u64> {
    NEW_TOTAL_RE
        .captures(html)
        .and_then(|c| c[1].parse::<u64>().ok())
}

fn browse_sort(sort: &str) -> &str {
    match sort {
        "subscribers" => "totaluniquesubscribers",
        "trend" | "mostrecent" | "lastupdated" | "toprated" => sort,
        _ => "trend",
    }
}

fn trend_days(browsesort: &str, period: &str) -> Option<i64> {
    if browsesort != "trend" {
        return None;
    }
    Some(match period {
        "7" => 7,
        "28" => 30,
        _ => -1,
    })
}

fn browse_url(
    steam_appid: u64,
    browsesort: &str,
    days: Option<i64>,
    page: u32,
    query: &str,
) -> String {
    let days_part = match days {
        Some(d) => format!("&days={d}"),
        None => String::new(),
    };
    format!(
        "https://steamcommunity.com/workshop/browse/?appid={steam_appid}&browsesort={browsesort}&section=readytouseitems{days_part}&p={page}&searchtext={}",
        urlenc(query.trim())
    )
}

#[tauri::command]
pub async fn workshop_browse(
    steam_appid: u64,
    sort: String,
    period: String,
    page: u32,
    query: String,
) -> Result<Value, String> {
    let res = async {
        let browsesort = browse_sort(&sort);
        let days = trend_days(browsesort, &period);
        let page = page.max(1);
        let url = browse_url(steam_appid, browsesort, days, page, &query);
        let html = http::get_text(&url)
            .await
            .map_err(|e| format!("workshop browse: {e}"))?;
        let (items, has_more) = if html.contains(r#"class="workshopItem""#) {
            let items = parse_browse(&html);
            let has_more = items.len() >= PAGE_SIZE;
            (items, has_more)
        } else {
            let items = parse_browse_new(&html);
            let has_more = match parse_browse_total(&html) {
                Some(total) => (page as u64) * (PAGE_SIZE as u64) < total,
                None => items.len() >= PAGE_SIZE,
            };
            (items, has_more)
        };
        Ok(json!({ "ok": true, "items": items, "hasMore": has_more }))
    }
    .await;
    Ok(fold(res))
}

pub(crate) async fn fetch_details(ids: &[String]) -> Result<Vec<Value>, String> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let mut body = format!("itemcount={}", ids.len());
    for (i, id) in ids.iter().enumerate() {
        body.push_str(&format!("&publishedfileids%5B{i}%5D={}", urlenc(id)));
    }
    let mut headers = HashMap::new();
    headers.insert(
        "Content-Type".to_string(),
        "application/x-www-form-urlencoded".to_string(),
    );
    let opts = http::FetchOpts {
        method: Some("POST".to_string()),
        headers,
        body: Some(body.into_bytes()),
        ..Default::default()
    };
    let resp = http::fetch(
        "https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/",
        &opts,
    )
    .await
    .map_err(|e| format!("workshop details: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("workshop details: HTTP {}", resp.status()));
    }
    let v: Value = resp
        .json()
        .await
        .map_err(|e| format!("workshop details parse: {e}"))?;
    let details = v
        .pointer("/response/publishedfiledetails")
        .and_then(|d| d.as_array())
        .cloned()
        .unwrap_or_default();
    Ok(details
        .iter()
        .filter_map(|d| {
            if d.get("result").and_then(|r| r.as_u64()).unwrap_or(0) != 1 {
                return None;
            }
            let id = d.get("publishedfileid").and_then(|v| {
                v.as_str()
                    .map(String::from)
                    .or_else(|| v.as_u64().map(|n| n.to_string()))
            })?;
            Some(json!({
                "remoteId": id,
                "name": d.get("title").and_then(|v| v.as_str()).unwrap_or(""),
                "description": d.get("description").and_then(|v| v.as_str()).unwrap_or(""),
                "previewUrl": d.get("preview_url").and_then(|v| v.as_str()),
            }))
        })
        .collect())
}

#[tauri::command]
pub async fn workshop_install(
    app: AppHandle,
    state: State<'_, AppState>,
    appid: String,
    steam_appid: u64,
    published_file_id: String,
) -> Result<Value, String> {
    let res = async {
        let fid: u64 = published_file_id
            .parse()
            .map_err(|_| format!("bad publishedfileid {published_file_id}"))?;
        if steam_appid == 0 {
            return Err("no Steam appid known for this game".to_string());
        }
        {
            let mut cfg = load_config(&state.paths, &appid);
            if cfg.steam_appid != Some(steam_appid) {
                cfg.steam_appid = Some(steam_appid);
                save_config(&state.paths, &appid, &cfg);
            }
        }
        tauri::async_runtime::spawn(run_workshop_install(
            app.clone(),
            appid.clone(),
            steam_appid,
            fid,
        ));
        Ok(json!({ "ok": true, "started": true }))
    }
    .await;
    Ok(fold(res))
}

async fn run_workshop_install(app: AppHandle, appid: String, steam_appid: u64, fid: u64) {
    let detail = fetch_details(&[fid.to_string()])
        .await
        .ok()
        .and_then(|items| items.into_iter().next());
    let name = detail
        .as_ref()
        .and_then(|d| d.get("name").and_then(|n| n.as_str()).map(String::from))
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| format!("Workshop item {fid}"));

    let mod_id = format!("workshop-{fid}");
    if let Err(e) =
        workshop_install_inner(&app, &appid, steam_appid, fid, &name, detail.as_ref()).await
    {
        emit_progress(&app, &appid, &mod_id, &name, "error", None, Some(&e));
    }
}

async fn workshop_install_inner(
    app: &AppHandle,
    appid: &str,
    steam_appid: u64,
    fid: u64,
    name: &str,
    detail: Option<&Value>,
) -> Result<(), String> {
    let state = app.state::<AppState>();
    let mod_id = format!("workshop-{fid}");

    emit_progress(app, appid, &mod_id, name, "downloading", None, None);
    let content = steamcmd::run_workshop_download(&state.paths, steam_appid, fid).await?;

    emit_progress(app, appid, &mod_id, name, "installing", None, None);
    let summary = detail
        .and_then(|d| d.get("description").and_then(|s| s.as_str()))
        .map(|s| {
            let mut t: String = s.chars().take(400).collect();
            if t.len() < s.len() {
                t.push('…');
            }
            t
        });
    let spec = InstallSpec {
        appid: appid.to_string(),
        provider: "workshop".to_string(),
        remote_id: fid.to_string(),
        file_id: None,
        name: name.to_string(),
        version: String::new(),
        author: String::new(),
        picture: detail
            .and_then(|d| d.get("previewUrl").and_then(|p| p.as_str()))
            .map(String::from),
        summary,
        page_url: workshop_page_url(&fid.to_string()),
    };
    finalize_install(app, &spec, &content, false).await?;
    std::fs::remove_dir_all(&content).ok();
    emit_progress(app, appid, &mod_id, name, "done", Some(100), None);
    Ok(())
}

#[tauri::command(async)]
pub fn workshop_status(state: State<'_, AppState>) -> Value {
    json!({ "ok": true, "steamcmd": steamcmd::status(&state.paths) })
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE: &str = r#"
<div class="workshopBrowseItems">
<div class="workshopItem">
    <a href="https://steamcommunity.com/sharedfiles/filedetails/?id=111222333&searchtext=" class="ugc item_link">
    <div class="workshopItemPreviewHolder " id="sharedfile_111222333">
        <img class="workshopItemPreviewImage" src="https://images.example/preview1.jpg">
    </div>
    </a>
    <div class="workshopItemTitle ellipsis">First &amp; Best Mod</div>
    <div class="workshopItemAuthorName ellipsis">by&nbsp;<a href="https://steamcommunity.com/id/someone">AuthorOne</a></div>
</div>
<div class="workshopItem">
    <a href="https://steamcommunity.com/sharedfiles/filedetails/?id=444555666" class="ugc item_link">
    <div class="workshopItemPreviewHolder " id="sharedfile_444555666">
        <img class="workshopItemPreviewImage" src="https://images.example/preview2.jpg">
    </div>
    </a>
    <div class="workshopItemTitle ellipsis">Second Mod</div>
    <div class="workshopItemAuthorName ellipsis">by <a href="https://steamcommunity.com/id/two">AuthorTwo</a></div>
</div>
</div>
"#;

    #[test]
    fn parses_browse_items() {
        let items = parse_browse(FIXTURE);
        assert_eq!(items.len(), 2);
        assert_eq!(items[0]["remoteId"], "111222333");
        assert_eq!(items[0]["name"], "First & Best Mod");
        assert_eq!(items[0]["author"], "AuthorOne");
        assert_eq!(items[0]["picture"], "https://images.example/preview1.jpg");
        assert_eq!(
            items[0]["pageUrl"],
            "https://steamcommunity.com/sharedfiles/filedetails/?id=111222333"
        );
        assert_eq!(items[1]["remoteId"], "444555666");
        assert_eq!(items[1]["author"], "AuthorTwo");
    }

    #[test]
    fn browse_parse_survives_junk() {
        assert!(parse_browse("").is_empty());
        assert!(parse_browse("<html><body>no items here</body></html>").is_empty());
        let junk = r#"<div class="workshopItem"><div class="workshopItemTitle">orphan</div></div>"#;
        assert!(parse_browse(junk).is_empty());
    }

    const FIXTURE_NEW: &str = r##"
<div class="jsbOFi7I2qw- Panel">
<a href="https://steamcommunity.com/sharedfiles/filedetails/?id=3754840387" class="xQ1LsPqGEbw-"><img src="https://images.steamusercontent.com/ugc/18293799384924/?ima=fit&impolicy=Letterbox" alt="Misstall&#x27;s Medicine And Combat Drugs" loading="lazy" class=""/></a>
<a href="https://steamcommunity.com/sharedfiles/filedetails/?id=2222333444" class="xQ1LsPqGEbw-">
<img src="https://images.steamusercontent.com/ugc/9988776655/?ima=fit" alt="Plain Title" loading="lazy"/></a>
</div>
<script>window.SSR = {"loaderData":"{\"workshopNumbers\":{\"total\":56856,\"other\":1}}"};</script>
"##;

    #[test]
    fn parses_new_layout_items() {
        assert!(
            !FIXTURE_NEW.contains(r#"class="workshopItem""#),
            "fixture must not trip the old-layout detector"
        );
        let items = parse_browse_new(FIXTURE_NEW);
        assert_eq!(items.len(), 2);
        assert_eq!(items[0]["remoteId"], "3754840387");
        assert_eq!(items[0]["name"], "Misstall's Medicine And Combat Drugs");
        assert_eq!(items[0]["author"], "");
        assert_eq!(
            items[0]["picture"],
            "https://images.steamusercontent.com/ugc/18293799384924/?ima=fit&impolicy=Letterbox"
        );
        assert_eq!(
            items[0]["pageUrl"],
            "https://steamcommunity.com/sharedfiles/filedetails/?id=3754840387"
        );
        assert_eq!(items[1]["remoteId"], "2222333444");
        assert_eq!(items[1]["name"], "Plain Title");

        assert_eq!(parse_browse_total(FIXTURE_NEW), Some(56856));
        assert_eq!(parse_browse_total("<html>no blob</html>"), None);
        assert!(parse_browse(FIXTURE_NEW).is_empty());
    }

    #[test]
    fn maps_sort_to_browsesort() {
        assert_eq!(browse_sort("trend"), "trend");
        assert_eq!(browse_sort("mostrecent"), "mostrecent");
        assert_eq!(browse_sort("lastupdated"), "lastupdated");
        assert_eq!(browse_sort("subscribers"), "totaluniquesubscribers");
        assert_eq!(browse_sort("toprated"), "toprated");
        assert_eq!(browse_sort("bogus"), "trend");
    }

    #[test]
    fn days_window_is_trend_only() {
        assert_eq!(trend_days("trend", "all"), Some(-1));
        assert_eq!(trend_days("trend", "7"), Some(7));
        assert_eq!(trend_days("trend", "28"), Some(30));
        assert_eq!(trend_days("trend", ""), Some(-1));
        assert_eq!(trend_days("mostrecent", "7"), None);
        assert_eq!(trend_days("totaluniquesubscribers", "28"), None);
        assert_eq!(trend_days("lastupdated", "all"), None);
    }

    #[test]
    fn builds_browse_url() {
        let u = browse_url(294100, "trend", Some(7), 2, "cool mod");
        assert_eq!(
            u,
            "https://steamcommunity.com/workshop/browse/?appid=294100&browsesort=trend&section=readytouseitems&days=7&p=2&searchtext=cool%20mod"
        );
        let n = browse_url(294100, "mostrecent", None, 1, "");
        assert_eq!(
            n,
            "https://steamcommunity.com/workshop/browse/?appid=294100&browsesort=mostrecent&section=readytouseitems&p=1&searchtext="
        );
        let a = browse_url(107410, "trend", Some(-1), 1, "");
        assert_eq!(
            a,
            "https://steamcommunity.com/workshop/browse/?appid=107410&browsesort=trend&section=readytouseitems&days=-1&p=1&searchtext="
        );
    }
}
