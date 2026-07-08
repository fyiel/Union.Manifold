pub mod buzzheavier;
pub mod datanodes;
pub mod datavaults;
pub mod fileditch;
pub mod filekeeper;
pub mod gate;
#[cfg(test)]
mod installtest;
#[cfg(test)]
mod livetest;
pub mod dlproxy;
pub mod fuckingfast;
pub mod gofile;
pub mod mediafire;
pub mod pixeldrain;
pub mod rootz;

use crate::sources::schema::DownloadOption;
use crate::sources::ResolveResult;

fn hostname_of(url: &str) -> String {
    url::Url::parse(url)
        .ok()
        .and_then(|u| u.host_str().map(|s| s.to_lowercase()))
        .unwrap_or_default()
}

pub fn detect_host_type(url: &str) -> String {
    if pixeldrain::matches(url) {
        return "pixeldrain".to_string();
    }
    if buzzheavier::matches(url) {
        return "buzzheavier".to_string();
    }
    if dlproxy::matches(url) {
        return "dlproxy".to_string();
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
    if filekeeper::matches(url) {
        return "filekeeper".to_string();
    }
    if let Some(t) = gate::host_type(url) {
        return t.to_string();
    }
    let host = hostname_of(url);
    let base = host.strip_prefix("www.").unwrap_or(&host);
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
        || dlproxy::matches(url)
        || gofile::matches(url)
        || datanodes::matches(url)
        || fuckingfast::matches(url)
        || mediafire::matches(url)
        || rootz::matches(url)
        || datavaults::matches(url)
        || fileditch::matches(url)
        || filekeeper::matches(url)
        || (gate::matches(url) && crate::slipgate::cfg().is_some())
}

pub async fn resolve_url(option: &DownloadOption) -> ResolveResult {
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
    if dlproxy::matches(url) {
        return dlproxy::resolve(url).await;
    }
    if gofile::matches(url) {
        return gofile::resolve(url).await;
    }
    if datanodes::matches(url) {
        return datanodes::resolve(url).await;
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
        return datavaults::resolve(url).await;
    }
    if fileditch::matches(url) {
        return fileditch::resolve(url).await;
    }
    if filekeeper::matches(url) {
        return filekeeper::resolve(url).await;
    }
    if gate::matches(url) {
        return gate::resolve(url).await;
    }

    let host = hostname_of(url);
    let base = host.strip_prefix("www.").unwrap_or(&host);
    // mega serves AES-encrypted bytes; a direct url is useless without the
    // client-side decryption the official apps do. Browser only, always.
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
