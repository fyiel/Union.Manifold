use std::collections::{HashMap, HashSet};
use std::sync::LazyLock;
use std::time::Duration;

use regex::Regex;

use super::hydralinks::HydraSource;
use crate::http;
use crate::sources::cache::KeyedCache;
use crate::sources::hosts;
use crate::sources::schema::{DownloadOption, SourceGame};
use crate::sources::{Capabilities, QueryParams};
use parking_lot::RwLock;

const ORIGIN: &str = "https://online-fix.me";
const DETAIL_TTL: Duration = Duration::from_secs(6 * 60 * 60);

static SRC: LazyLock<HydraSource> = LazyLock::new(|| {
    HydraSource::new(
        "onlinefix",
        ORIGIN,
        "https://hydralinks.cloud/sources/onlinefix.json",
    )
});

static DETAIL_CACHE: LazyLock<KeyedCache<SourceGame>> =
    LazyLock::new(|| KeyedCache::new(DETAIL_TTL));
static READY_CFG: LazyLock<RwLock<Option<crate::slipgate::Cfg>>> =
    LazyLock::new(|| RwLock::new(None));
static READINESS_REFRESH: LazyLock<tokio::sync::Mutex<()>> =
    LazyLock::new(|| tokio::sync::Mutex::new(()));

static RESULT_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?i)href="(https://online-fix\.me/(?:[a-z0-9_-]+/)*\d+-[a-z0-9-]+\.html)""#)
        .unwrap()
});
static ANCHOR_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"(?is)<a\b[^>]*href="([^"]+)"[^>]*>(.*?)</a>"#).unwrap());
static DL_HOST_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)(online-fix\.me:\d+|mega\.nz|gofile|pixeldrain|buzzheavier|datanodes|fuckingfast|mediafire|1fichier|datavaults|fileditch|filekeeper|rootz|\.torrent|^magnet:)").unwrap()
});
static UPLOADS_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?i)href="(https://uploads\.online-fix\.me:\d+/uploads/[^"]+/)""#).unwrap()
});
static DIR_RAR_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"(?i)href="([^"]+\.rar)""#).unwrap());

pub fn capabilities() -> Capabilities {
    super::hydralinks::capabilities()
}

pub async fn query(_params: &QueryParams) -> Option<Vec<SourceGame>> {
    SRC.query().await
}

pub async fn search(q: &str, limit: usize) -> Vec<SourceGame> {
    SRC.search(q, limit).await
}

pub fn is_ready() -> bool {
    let Some(cfg) = crate::slipgate::cfg() else {
        return false;
    };
    READY_CFG.read().as_ref() == Some(&cfg)
}

pub fn invalidate() {
    *READY_CFG.write() = None;
}

async fn refresh_readiness() -> Option<usize> {
    let _guard = READINESS_REFRESH.lock().await;
    invalidate();
    let cfg = crate::slipgate::cfg()?;
    let key = cfg.key.as_deref().unwrap_or("");
    let (catalog, health) =
        tokio::join!(SRC.refresh_live(), crate::slipgate::health(&cfg.base, key),);
    let ready = catalog.is_some()
        && health
            .as_ref()
            .map(crate::slipgate::fetch_usable)
            .unwrap_or(false);
    if ready {
        *READY_CFG.write() = Some(cfg);
        catalog
    } else {
        None
    }
}

pub async fn refresh() -> Option<usize> {
    refresh_readiness().await
}

pub async fn prime() -> bool {
    refresh_readiness().await.is_some()
}

pub async fn get_detail(slug: &str) -> Option<SourceGame> {
    let key = slug.trim_matches('/').to_string();
    let lookup = key.clone();
    DETAIL_CACHE
        .get_or(&key, || async move {
            let mut game = SRC.get_detail(&lookup).await?;
            if let Some(scraped) = scrape_downloads(&game.title).await {
                let mut opts = scraped;
                for m in std::mem::take(&mut game.download_options) {
                    if !opts
                        .iter()
                        .any(|o| o.url == m.url && o.page_url == m.page_url)
                    {
                        opts.push(m);
                    }
                }
                game.download_options = opts;
            }
            Some(game)
        })
        .await
}

async fn scrape_downloads(title: &str) -> Option<Vec<DownloadOption>> {
    let page = resolve_game_page(title).await?;
    let html = fetch_page(&page).await?;
    let opts = parse_downloads(&html);
    if opts.is_empty() {
        None
    } else {
        Some(opts)
    }
}

async fn resolve_game_page(title: &str) -> Option<String> {
    let q = percent_encoding::utf8_percent_encode(title, percent_encoding::NON_ALPHANUMERIC);
    let url = format!("{ORIGIN}/index.php?do=search&subaction=search&story={q}");
    let html = fetch_page(&url).await?;
    let want = squash(title);
    if want.is_empty() {
        return None;
    }
    RESULT_RE
        .captures_iter(&html)
        .map(|cap| cap[1].to_string())
        .find(|link| squash(link).contains(&want))
}

pub async fn repair_url(title: &str) -> Option<String> {
    let page = resolve_game_page(title).await?;
    let html = fetch_page(&page).await?;
    let base = UPLOADS_RE.captures(&html)?.get(1)?.as_str().to_string();
    let repair_dir = format!("{base}Fix%20Repair/");
    let listing = fetch_uploads(&repair_dir).await?;
    let file = DIR_RAR_RE.captures(&listing)?.get(1)?.as_str().to_string();
    if file.starts_with("http") {
        Some(file)
    } else {
        Some(format!("{repair_dir}{file}"))
    }
}

async fn fetch_page(url: &str) -> Option<String> {
    if let Ok(html) = http::get_text(url).await {
        if html.len() > 2000 && !html.contains("Just a moment") {
            return Some(html);
        }
    }
    let cfg = crate::slipgate::cfg()?;
    crate::slipgate::fetch(&cfg, url, Duration::from_secs(60))
        .await
        .ok()
}

async fn fetch_uploads(url: &str) -> Option<String> {
    let opts = http::FetchOpts {
        headers: HashMap::from([("Referer".to_string(), format!("{ORIGIN}/"))]),
        ..Default::default()
    };
    let resp = http::fetch(url, &opts).await.ok()?;
    if !resp.status().is_success() {
        return None;
    }
    resp.text().await.ok()
}

fn parse_downloads(html: &str) -> Vec<DownloadOption> {
    let mut options: Vec<DownloadOption> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    for cap in ANCHOR_RE.captures_iter(html) {
        let url = http::decode_entities(cap[1].trim());
        if !DL_HOST_RE.is_match(&url) || !seen.insert(url.clone()) {
            continue;
        }
        options.push(classify(&url));
    }
    options.sort_by(|a, b| (b.resolvable as u8).cmp(&(a.resolvable as u8)));
    options
}

fn classify(url: &str) -> DownloadOption {
    let lower = url.to_lowercase();
    if lower.starts_with("magnet:") {
        return DownloadOption {
            label: "torrent (magnet)".to_string(),
            host_type: "magnet".to_string(),
            url: Some(url.to_string()),
            resolvable: false,
            ..Default::default()
        };
    }
    if lower.ends_with(".torrent") {
        return DownloadOption {
            label: "torrent (file)".to_string(),
            host_type: "torrent".to_string(),
            url: Some(url.to_string()),
            resolvable: false,
            ..Default::default()
        };
    }
    if lower.contains("online-fix.me:") {
        let label = if lower.contains("hosters.") {
            "Online-Fix Hosters"
        } else if lower.contains("drive.") {
            "Online-Fix Drive"
        } else if lower.contains("uploads.") {
            "Online-Fix Server"
        } else {
            "Online-Fix"
        };
        return DownloadOption {
            label: label.to_string(),
            host_type: "online-fix".to_string(),
            page_url: Some(url.to_string()),
            resolvable: false,
            ..Default::default()
        };
    }
    let host_type = hosts::detect_host_type(url);
    let resolvable = hosts::is_resolvable(url);
    DownloadOption {
        label: host_type.clone(),
        host_type,
        url: Some(url.to_string()),
        resolvable,
        ..Default::default()
    }
}

fn squash(s: &str) -> String {
    s.chars()
        .filter(|c| c.is_alphanumeric())
        .flat_map(|c| c.to_lowercase())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const GAME_PAGE: &str = r#"<a target="_blank" href="https://online-fix.me/programs/16217-faq-po-saytu.html">FAQ</a>
<a target="_blank" href="https://hosters.online-fix.me:2053/Dead%20or%20Alive%206%20Last%20Round" class="btn btn-success btn-small">Hosters</a><br /><br />
<a target="_blank" href="https://drive.online-fix.me:2053/Dead%20or%20Alive%206%20Last%20Round" class="btn btn-success btn-small">Drive</a><br /><br />
<a target="_blank" href="https://uploads.online-fix.me:2053/uploads/Dead%20or%20Alive%206%20Last%20Round/" class="btn btn-success btn-small">Server</a>"#;

    #[test]
    fn parse_downloads_extracts_mirrors_and_drops_nav_link() {
        let opts = parse_downloads(GAME_PAGE);
        assert_eq!(opts.len(), 3);

        let expected = [
            (
                "Online-Fix Hosters",
                "https://hosters.online-fix.me:2053/Dead%20or%20Alive%206%20Last%20Round",
            ),
            (
                "Online-Fix Drive",
                "https://drive.online-fix.me:2053/Dead%20or%20Alive%206%20Last%20Round",
            ),
            (
                "Online-Fix Server",
                "https://uploads.online-fix.me:2053/uploads/Dead%20or%20Alive%206%20Last%20Round/",
            ),
        ];
        for (opt, (label, page_url)) in opts.iter().zip(expected) {
            assert_eq!(opt.label, label);
            assert_eq!(opt.host_type, "online-fix");
            assert_eq!(opt.page_url.as_deref(), Some(page_url));
            assert_eq!(opt.url, None);
            assert!(!opt.resolvable);
        }
    }

    #[test]
    fn parse_downloads_dedups_identical_hrefs() {
        let html = r#"<a href="https://hosters.online-fix.me:2053/Game">A</a>
<a href="https://hosters.online-fix.me:2053/Game">B</a>"#;
        let opts = parse_downloads(html);
        assert_eq!(opts.len(), 1);
        assert_eq!(opts[0].label, "Online-Fix Hosters");
        assert_eq!(opts[0].host_type, "online-fix");
    }

    #[test]
    fn parse_downloads_sorts_resolvable_first() {
        let html = r#"<a href="https://uploads.online-fix.me:2053/Game/">OF</a>
<a href="https://mega.nz/file/abc123#key">Mega</a>
<a href="https://gofile.io/d/abc123">Gofile</a>"#;
        let opts = parse_downloads(html);
        assert_eq!(opts.len(), 3);

        assert_eq!(opts[0].host_type, "gofile");
        assert_eq!(opts[0].url.as_deref(), Some("https://gofile.io/d/abc123"));
        assert!(opts[0].resolvable);

        let mega = opts
            .iter()
            .find(|o| o.host_type == "mega")
            .expect("mega option present");
        assert_eq!(mega.url.as_deref(), Some("https://mega.nz/file/abc123#key"));
        assert!(!mega.resolvable);
        assert_eq!(mega.page_url, None);
    }

    #[test]
    fn classify_maps_hosts_to_types_and_labels() {
        let magnet = classify("magnet:?xt=urn:btih:DEADBEEF");
        assert_eq!(magnet.host_type, "magnet");
        assert_eq!(magnet.label, "torrent (magnet)");
        assert_eq!(magnet.url.as_deref(), Some("magnet:?xt=urn:btih:DEADBEEF"));
        assert!(!magnet.resolvable);

        let torrent = classify("https://example.com/game.torrent");
        assert_eq!(torrent.host_type, "torrent");
        assert_eq!(torrent.label, "torrent (file)");
        assert_eq!(
            torrent.url.as_deref(),
            Some("https://example.com/game.torrent")
        );
        assert!(!torrent.resolvable);

        let hosters = classify("https://hosters.online-fix.me:2053/Game");
        assert_eq!(hosters.host_type, "online-fix");
        assert_eq!(hosters.label, "Online-Fix Hosters");
        assert_eq!(
            hosters.page_url.as_deref(),
            Some("https://hosters.online-fix.me:2053/Game")
        );
        assert_eq!(hosters.url, None);

        let drive = classify("https://drive.online-fix.me:2053/Game");
        assert_eq!(drive.label, "Online-Fix Drive");
        assert_eq!(
            drive.page_url.as_deref(),
            Some("https://drive.online-fix.me:2053/Game")
        );
        assert_eq!(drive.url, None);

        let server = classify("https://uploads.online-fix.me:2053/uploads/Game/");
        assert_eq!(server.label, "Online-Fix Server");
        assert_eq!(
            server.page_url.as_deref(),
            Some("https://uploads.online-fix.me:2053/uploads/Game/")
        );
        assert_eq!(server.url, None);
    }

    #[test]
    fn squash_strips_punctuation_and_lowercases() {
        assert_eq!(
            squash("Dead or Alive 6: Last Round!"),
            "deadoralive6lastround"
        );
        assert_eq!(squash("Marvel's Spider-Man"), "marvelsspiderman");
    }
}
