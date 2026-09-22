pub mod buzzheavier;
pub mod datanodes;
pub mod datavaults;
pub mod filekeeper;
pub mod fuckingfast;
pub mod gate;
pub mod gofile;
#[cfg(test)]
mod installtest;
#[cfg(test)]
mod livetest;
pub mod mediafire;
pub mod numbered_st;
pub mod pixeldrain;
pub mod rootz;


use crate::sources::schema::DownloadOption;
use crate::sources::ResolveResult;
use serde_json::json;
use tauri::AppHandle;

fn hostname_of(url: &str) -> String {
    url::Url::parse(url)
        .ok()
        .and_then(|u| u.host_str().map(|s| s.to_lowercase()))
        .unwrap_or_default()
}

/// Map a URL to the Slipgate recipe key that can resolve it, for hosts whose
/// native resolver may hit a Cloudflare gate or interactive captcha.
fn slipgate_host(url: &str) -> Option<&'static str> {
    if datanodes::matches(url) {
        return Some("datanodes");
    }
    if datavaults::matches(url) {
        return Some("datavaults");
    }
    None
}

fn base_label(host: &str) -> &str {
    host.strip_prefix("www.").unwrap_or(host)
}

/// Last non-empty path segment of a URL, percent-decoded.
fn last_segment(url: &str) -> Option<String> {
    let u = url::Url::parse(url).ok()?;
    u.path_segments()?
        .rfind(|s| !s.is_empty())
        .map(|s| {
            percent_encoding::percent_decode_str(s)
                .decode_utf8_lossy()
                .to_string()
        })
}

/// Numeric API field tolerant of JSON number/string encodings.
fn num(v: Option<&serde_json::Value>) -> Option<u64> {
    let v = v?;
    let n = v
        .as_u64()
        .or_else(|| v.as_f64().map(|f| f as u64))
        .or_else(|| v.as_str().and_then(|s| s.parse::<f64>().ok()).map(|f| f as u64))?;
    (n != 0).then_some(n)
}

pub(crate) fn host_matches(url: &str, re: &regex::Regex) -> bool {
    url::Url::parse(url)
        .ok()
        .and_then(|u| u.host_str().map(|s| s.to_string()))
        .map(|h| re.is_match(&h))
        .unwrap_or(false)
}

pub(crate) fn not_resolvable(url: &str, reason: Option<&str>) -> ResolveResult {
    ResolveResult {
        resolvable: false,
        open_url: Some(url.to_string()),
        reason: reason.map(str::to_string),
        ..Default::default()
    }
}

pub fn detect_host_type(url: &str) -> String {
    if pixeldrain::matches(url) {
        return "pixeldrain".to_string();
    }
    if buzzheavier::matches(url) {
        return "buzzheavier".to_string();
    }
    if gofile::matches(url) {
        return "gofile".to_string();
    }
    if datanodes::matches(url) {
        return "datanodes".to_string();
    }
    if fuckingfast::matches(url) {
        return "fuckingfast".to_string();
    }
    if mediafire::matches(url) {
        return "mediafire".to_string();
    }
    if rootz::matches(url) {
        return "rootz".to_string();
    }
    if datavaults::matches(url) {
        return "datavaults".to_string();
    }
    if numbered_st::matches(url) {
        return "numbered-st".to_string();
    }
    if filekeeper::matches(url) {
        return "filekeeper".to_string();
    }
    if let Some(t) = gate::host_type(url) {
        return t.to_string();
    }
    let host = hostname_of(url);
    let base = base_label(&host);
    let label = base.split('.').next().unwrap_or("");
    if label.is_empty() {
        "unknown".to_string()
    } else {
        label.to_string()
    }
}

pub fn is_resolvable(url: &str) -> bool {
    pixeldrain::matches(url)
        || buzzheavier::matches(url)
        || gofile::matches(url)
        || datanodes::matches(url)
        || fuckingfast::matches(url)
        || mediafire::matches(url)
        || rootz::matches(url)
        || datavaults::matches(url)
        || filekeeper::matches(url)
        || numbered_st::matches(url)
        || gate::is_available(url)
}

pub async fn link_is_dead(url: &str) -> bool {
    if rootz::matches(url) {
        return rootz::is_dead(url).await;
    }
    if datanodes::matches(url) {
        return datanodes::is_dead(url).await;
    }
    let opts = crate::http::FetchOpts {
        retries: Some(1),
        timeout: Some(std::time::Duration::from_secs(6)),
        ..Default::default()
    };
    match crate::http::fetch(url, &opts).await {
        Ok(resp) => matches!(resp.status().as_u16(), 404 | 410),
        Err(_) => false,
    }
}

pub async fn resolve_url(option: &DownloadOption) -> ResolveResult {
    dispatch(None, option).await
}

pub async fn resolve_url_via(app: &AppHandle, option: &DownloadOption) -> ResolveResult {
    dispatch(Some(app), option).await
}

/// Whether this option can only be resolved by a real browser. `dl.kryo.to`
/// hides its signed link behind a Cloudflare Turnstile that an HTTP client
/// cannot pass, so the in-app browser mints the link from the game page.
fn needs_in_app_browser(option: &DownloadOption) -> bool {
    option.host_type.eq_ignore_ascii_case("kryo")
        || option
            .url
            .as_deref()
            .is_some_and(|u| hostname_of(u) == "dl.kryo.to")
}

/// Page the in-app browser opens: the adapter's own game page when it set one
/// (the page that carries the download button), otherwise the option's URL.
fn in_app_page<'a>(option: &'a DownloadOption, url: &'a str) -> &'a str {
    option.page_url.as_deref().unwrap_or(url)
}

async fn resolve_in_app_browser(
    app: Option<&AppHandle>,
    option: &DownloadOption,
    url: &str,
) -> ResolveResult {
    let Some(app) = app else {
        return not_resolvable(url, Some("Kryo - this host needs the in-app browser"));
    };
    let page = in_app_page(option, url);
    match crate::resolver::solve_target(app, page, option.url.as_deref()).await {
        Ok(solved) if solved.url.is_some() => {
            let headers = solved.headers(Some(page));
            ResolveResult {
                resolvable: true,
                url: solved.url,
                file_name: solved.file_name,
                headers: Some(headers),
                ephemeral: true,
                ..Default::default()
            }
        }
        Ok(_) => not_resolvable(
            url,
            Some("Kryo - the in-app browser did not produce a download"),
        ),
        Err(e) => not_resolvable(url, Some(&format!("Kryo: {e}"))),
    }
}

async fn dispatch(app: Option<&AppHandle>, option: &DownloadOption) -> ResolveResult {
    let url = option
        .url
        .as_deref()
        .or(option.page_url.as_deref())
        .unwrap_or("");

    if needs_in_app_browser(option) {
        return resolve_in_app_browser(app, option, url).await;
    }

    if pixeldrain::matches(url) {
        return pixeldrain::resolve(url).await;
    }
    if buzzheavier::matches(url) {
        return buzzheavier::resolve(url).await;
    }
    if gofile::matches(url) {
        return gofile::resolve(url).await;
    }
    let mut result: Option<ResolveResult> = None;
    if datanodes::matches(url) {
        result = Some(datanodes::resolve(url).await);
    }
    if fuckingfast::matches(url) {
        return fuckingfast::resolve(url).await;
    }
    if mediafire::matches(url) {
        return mediafire::resolve(url).await;
    }
    if rootz::matches(url) {
        return rootz::resolve(url).await;
    }
    if datavaults::matches(url) {
        result = Some(datavaults::resolve(url).await);
    }
    if numbered_st::matches(url) {
        return numbered_st::resolve(url).await;
    }
    if filekeeper::matches(url) {
        return filekeeper::resolve(url).await;
    }
    if gate::matches(url) {
        return gate::resolve(app, url).await;
    }

    if let Some(r) = result {
        if r.resolvable {
            return r;
        }

        if let Some(host) = slipgate_host(url) {
            match crate::slipgate::cfg() {
                Some(_) => {
                    return match crate::slipgate::resolve_configured(
                        host,
                        url,
                        json!({}),
                        json!([]),
                    )
                    .await
                    {
                        Ok(link) => ResolveResult {
                            resolvable: true,
                            url: Some(link.url),
                            file_name: link.file_name,
                            size_bytes: link.size_bytes,
                            headers: (!link.headers.is_empty()).then_some(link.headers),
                            ephemeral: true,
                            ..Default::default()
                        },
                        Err(e) => not_resolvable(
                            url,
                            Some(&match r.reason.as_deref() {
                                Some(reason) if !reason.is_empty() => {
                                    format!("{reason}; Slipgate: {e}")
                                }
                                _ => format!("Slipgate: {e}"),
                            }),
                        ),
                    };
                }
                None => {
                    return not_resolvable(
                        url,
                        Some(&format!(
                            "{} - the built-in resolver is unavailable",
                            r.reason.as_deref().unwrap_or("host could not be resolved")
                        )),
                    );
                }
            }
        }
        return r;
    }

    let host = hostname_of(url);
    let base = base_label(&host);
    let reason = if base == "mega.nz" {
        "mega (encrypted transfer \u{2014} browser only)".to_string()
    } else {
        format!("unsupported host: {host}")
    };

    ResolveResult {
        resolvable: false,
        open_url: Some(url.to_string()),
        reason: Some(reason),
        ..Default::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn option(host_type: &str, url: &str, page_url: Option<&str>) -> DownloadOption {
        DownloadOption {
            host_type: host_type.to_string(),
            url: Some(url.to_string()),
            page_url: page_url.map(str::to_string),
            ..Default::default()
        }
    }

    #[test]
    fn kryo_own_host_opens_its_game_page() {
        let opt = option(
            "kryo",
            "https://dl.kryo.to/#abcdef",
            Some("https://kryo.to/game/foo"),
        );
        assert!(needs_in_app_browser(&opt));
        let url = opt.url.as_deref().unwrap_or("");
        assert_eq!(in_app_page(&opt, url), "https://kryo.to/game/foo");
    }

    #[test]
    fn kryo_host_type_is_recognized_without_a_matching_url() {
        let opt = option("kryo", "https://kryo.to/game/foo", None);
        assert!(needs_in_app_browser(&opt));
    }

    #[test]
    fn dl_kryo_to_url_is_recognized_without_the_adapter_label() {
        let opt = option("", "https://dl.kryo.to/#abcdef", None);
        assert!(needs_in_app_browser(&opt));
        let url = opt.url.as_deref().unwrap_or("");
        assert_eq!(in_app_page(&opt, url), "https://dl.kryo.to/#abcdef");
    }

    #[test]
    fn other_hosts_are_not_in_app_browser_hosts() {
        assert!(!needs_in_app_browser(&option(
            "steamrip",
            "https://steamrip.com/foo/",
            None
        )));
        // A lookalike domain must not be mistaken for the fileyard.
        assert!(!needs_in_app_browser(&option(
            "buzzheavier",
            "https://dl.kryo.to.evil.com/x",
            None
        )));
    }
}
