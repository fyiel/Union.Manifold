use std::sync::LazyLock;
use std::time::Duration;

use base64::Engine;
use serde_json::Value;

use crate::http::{self, FetchOpts};
use crate::sources::cache::{Cached, KeyedCache};
use crate::sources::hosts::{detect_host_type, is_resolvable, link_is_dead};
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

/// GameBounty wraps mirror links in a redirect proxy:
/// `https://api.gamebounty.world/api/dl/{slug}/{base64(real url)}`. Host
/// detection and resolution need the real URL, so unwrap the proxy locally.
/// Anything that does not decode stays as-is — the proxy 307s to the page,
/// so the browser fallback still works.
fn unwrap_link_url(url: String) -> String {
    let Ok(parsed) = url::Url::parse(&url) else {
        return url;
    };
    let host = parsed.host_str().unwrap_or("");
    if !host.eq_ignore_ascii_case("api.gamebounty.world") {
        return url;
    }
    let Some(rest) = parsed.path().strip_prefix("/api/dl/") else {
        return url;
    };
    let Some((_slug, payload)) = rest.split_once('/') else {
        return url;
    };
    let payload = percent_encoding::percent_decode_str(payload.trim_end_matches('/'))
        .decode_utf8_lossy()
        .trim_end_matches('=')
        .to_string();
    let decoded = base64::engine::general_purpose::STANDARD_NO_PAD
        .decode(&payload)
        .or_else(|_| base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(&payload))
        .ok()
        .and_then(|bytes| String::from_utf8(bytes).ok());
    match decoded {
        Some(real) if real.starts_with("http") => real,
        _ => url,
    }
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
        let mut urls: Vec<String> = Vec::new();
        for link in &links {
            if let Some(url) = get_str(link, "url") {
                let url = unwrap_link_url(url);
                if !urls.contains(&url) {
                    urls.push(url);
                }
            }
        }
        if urls.is_empty() {
            continue;
        }
        // A mirror with several links is one game split into parts: every
        // link must download before extraction can start. Group them into a
        // single option carrying the remaining part URLs.
        let multi = urls.len() > 1;
        let host_type = detect_host_type(&urls[0]);
        let label = mirror_name.unwrap_or_else(|| host_type.clone());
        let label = if multi {
            format!("{label} ({} parts)", urls.len())
        } else {
            label
        };
        // Parts carry no per-link sizes in the API, so the container's
        // aggregate size is the honest number for a multi-part mirror.
        let link_size = get_str(&links[0], "file_size");
        let size_bytes = if multi {
            data_size_bytes
                .or_else(|| data_size_human.as_deref().and_then(schema::parse_size_to_bytes))
        } else {
            link_size
                .as_deref()
                .or(data_size_human.as_deref())
                .and_then(schema::parse_size_to_bytes)
                .or(data_size_bytes)
        };
        let size_text = if multi {
            data_size_human.clone()
        } else {
            link_size.clone().or_else(|| data_size_human.clone())
        };
        options.push(DownloadOption {
            label,
            host_type,
            url: Some(urls[0].clone()),
            page_url: None,
            size_bytes,
            size_text: size_text.filter(|s| !s.is_empty()),
            resolvable: urls.iter().any(|u| is_resolvable(u)),
            parts: if multi { urls[1..].to_vec() } else { Vec::new() },
        });
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


    let source_url = format!("{ORIGIN}/{slug}{SLUG_SUFFIX}");
    // Fallbacks open the game's source page — where every mirror is listed —
    // never a bare part URL, which is useless once a link has rotted.
    let mut download_options = mirrors_to_options(post.get("container"));
    for option in &mut download_options {
        option.page_url = Some(source_url.clone());
    }

    Some(SourceGame {
        source_id: ID.to_string(),
        source_slug: slug.clone(),
        source_url,
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
        download_options,
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

/// GameBounty containers accumulate every host ever used, including delisted
/// ones whose stale links rot (auto-deleted); the site hides those mirrors
/// server-side, but the public API exposes no liveness signal. Probe every
/// part URL and drop a mirror when any part is definitively dead — a partial
/// archive set cannot extract, and one dead part makes the whole mirror
/// useless. Inconclusive probes keep the mirror: listing a dead link is bad,
/// hiding a working one is worse.
async fn prune_dead_mirrors(options: Vec<DownloadOption>) -> Vec<DownloadOption> {
    let mut probes: Vec<(usize, String)> = Vec::new();
    for (i, option) in options.iter().enumerate() {
        for url in option.url.iter().chain(option.parts.iter()) {
            probes.push((i, url.clone()));
        }
    }
    let dead: std::collections::HashSet<usize> = http::map_limit(probes, 8, |(i, url)| async move {
        Some((i, link_is_dead(&url).await))
    })
    .await
    .into_iter()
    .filter(|(_, dead)| *dead)
    .map(|(i, _)| i)
    .collect();
    if dead.is_empty() {
        return options;
    }
    options
        .into_iter()
        .enumerate()
        .filter(|(i, _)| !dead.contains(i))
        .map(|(_, option)| option)
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
            let mut game = post_to_game(&data)?;
            game.download_options = prune_dead_mirrors(game.download_options).await;
            Some(game)
        })
        .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn container(mirrors: Value) -> Value {
        json!({
            "data": {
                "name": "game",
                "size_human": "65.0 GB",
                "size_bytes": 69793218560_u64,
                "mirrors": mirrors,
            }
        })
    }

    #[test]
    fn single_link_mirror_stays_one_option_without_parts() {
        let options = mirrors_to_options(Some(&container(json!([
            { "name": "pixeldrain.com", "links": [
                { "url": "https://pixeldrain.com/u/AbCdEf" },
            ] },
        ]))));
        assert_eq!(options.len(), 1);
        assert_eq!(options[0].label, "pixeldrain.com");
        assert_eq!(options[0].url.as_deref(), Some("https://pixeldrain.com/u/AbCdEf"));
        assert!(options[0].parts.is_empty());
        assert_eq!(options[0].size_bytes, Some(69793218560));
        assert_eq!(options[0].size_text.as_deref(), Some("65.0 GB"));
    }

    #[test]
    fn multi_link_mirror_groups_into_one_option_with_parts_in_order() {
        let options = mirrors_to_options(Some(&container(json!([
            { "name": "gofile.io", "links": [
                { "url": "https://gofile.io/d/AAAA" },
                { "url": "https://gofile.io/d/BBBB" },
                { "url": "https://gofile.io/d/CCCC" },
            ] },
        ]))));
        assert_eq!(options.len(), 1);
        assert_eq!(options[0].label, "gofile.io (3 parts)");
        assert_eq!(options[0].url.as_deref(), Some("https://gofile.io/d/AAAA"));
        assert_eq!(
            options[0].parts,
            vec![
                "https://gofile.io/d/BBBB".to_string(),
                "https://gofile.io/d/CCCC".to_string(),
            ]
        );
        assert_eq!(options[0].host_type, "gofile");
        assert_eq!(options[0].size_bytes, Some(69793218560));
        assert_eq!(options[0].size_text.as_deref(), Some("65.0 GB"));
        assert!(options[0].resolvable);
    }

    #[test]
    fn duplicate_links_are_deduped_preserving_first_position() {
        let options = mirrors_to_options(Some(&container(json!([
            { "name": "pixeldrain.com", "links": [
                { "url": "https://pixeldrain.com/u/AAAA" },
                { "url": "https://pixeldrain.com/u/AAAA" },
                { "url": "https://pixeldrain.com/u/BBBB" },
            ] },
        ]))));
        assert_eq!(options.len(), 1, "duplicate links stay one mirror");
        assert_eq!(options[0].label, "pixeldrain.com (2 parts)");
        assert_eq!(options[0].url.as_deref(), Some("https://pixeldrain.com/u/AAAA"));
        assert_eq!(
            options[0].parts,
            vec!["https://pixeldrain.com/u/BBBB".to_string()]
        );
    }

    #[test]
    fn mirrors_without_links_or_urls_are_skipped() {
        let options = mirrors_to_options(Some(&container(json!([
            { "name": "empty.io", "links": [] },
            { "name": "dead.io", "links": [{ "id": "1", "status": "unknown" }] },
        ]))));
        assert!(options.is_empty());
    }

    #[test]
    fn null_container_yields_no_options() {
        assert!(mirrors_to_options(None).is_empty());
    }

    #[test]
    fn mixed_mirrors_keep_separate_options_with_aggregate_sizes() {
        let options = mirrors_to_options(Some(&container(json!([
            { "name": "fileditchfiles.me", "links": [
                { "url": "https://fileditchfiles.me/f/A.part1.rar" },
                { "url": "https://fileditchfiles.me/f/A.part2.rar" },
            ] },
            { "name": "0853.st", "links": [
                { "url": "https://0853.st/X.rar" },
            ] },
        ]))));
        assert_eq!(options.len(), 2);
        let multi = options.iter().find(|o| !o.parts.is_empty()).unwrap();
        assert_eq!(multi.label, "fileditchfiles.me (2 parts)");
        assert_eq!(multi.url.as_deref(), Some("https://fileditchfiles.me/f/A.part1.rar"));
        assert_eq!(multi.parts, vec!["https://fileditchfiles.me/f/A.part2.rar".to_string()]);
        let single = options.iter().find(|o| o.parts.is_empty()).unwrap();
        assert_eq!(single.label, "0853.st");
        assert_eq!(single.size_bytes, Some(69793218560));
    }

    fn proxied(slug: &str, url: &str) -> String {
        let payload = base64::engine::general_purpose::STANDARD_NO_PAD.encode(url);
        format!("https://api.gamebounty.world/api/dl/{slug}/{payload}")
    }

    #[test]
    fn proxied_links_unwrap_to_the_real_host_urls() {
        let options = mirrors_to_options(Some(&container(json!([
            { "name": "gofile.io", "links": [
                { "url": proxied("some-game", "https://gofile.io/d/AAAA") },
                { "url": proxied("some-game", "https://gofile.io/d/BBBB") },
            ] },
        ]))));
        assert_eq!(options.len(), 1);
        assert_eq!(options[0].label, "gofile.io (2 parts)");
        assert_eq!(options[0].host_type, "gofile");
        assert_eq!(options[0].url.as_deref(), Some("https://gofile.io/d/AAAA"));
        assert_eq!(options[0].parts, vec!["https://gofile.io/d/BBBB".to_string()]);
        assert!(options[0].resolvable);
    }

    #[test]
    fn proxied_single_link_unwraps_and_stays_one_option() {
        let options = mirrors_to_options(Some(&container(json!([
            { "name": "pixeldrain.com", "links": [
                { "url": proxied("some-game", "https://pixeldrain.com/u/AbCdEf") },
            ] },
        ]))));
        assert_eq!(options.len(), 1);
        assert_eq!(options[0].url.as_deref(), Some("https://pixeldrain.com/u/AbCdEf"));
        assert_eq!(options[0].host_type, "pixeldrain");
        assert!(options[0].parts.is_empty());
        assert!(options[0].resolvable);
    }

    #[test]
    fn undecodable_proxy_payloads_fall_through_untouched() {
        let broken = "https://api.gamebounty.world/api/dl/some-game/!!!not-base64!!!";
        let options = mirrors_to_options(Some(&container(json!([
            { "name": "gofile.io", "links": [{ "url": broken }] },
        ]))));
        assert_eq!(options.len(), 1);
        assert_eq!(options[0].url.as_deref(), Some(broken));
        assert!(!options[0].resolvable);
    }
}
