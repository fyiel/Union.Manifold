pub mod buzzheavier;
pub mod datanodes;
pub mod datavaults;
pub mod fileditch;
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
    if fileditch::matches(url) {
        return Some("fileditch");
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
    if fileditch::matches(url) {
        return "fileditch".to_string();
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
        || fileditch::matches(url)
        || filekeeper::matches(url)
        || numbered_st::matches(url)
        || gate::matches(url)
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

async fn dispatch(_app: Option<&AppHandle>, option: &DownloadOption) -> ResolveResult {
    let url = option
        .url
        .as_deref()
        .or(option.page_url.as_deref())
        .unwrap_or("");

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
    if fileditch::matches(url) {
        result = Some(fileditch::resolve(url).await);
    }
    if numbered_st::matches(url) {
        return numbered_st::resolve(url).await;
    }
    if filekeeper::matches(url) {
        return filekeeper::resolve(url).await;
    }
    if gate::matches(url) {
        return gate::resolve(url).await;
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
                        Err(e) => not_resolvable(url, Some(&format!("Slipgate: {e}"))),
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
