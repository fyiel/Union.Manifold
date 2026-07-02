pub mod buzzheavier;
pub mod datanodes;
pub mod dlproxy;
pub mod fuckingfast;
pub mod gofile;
pub mod mediafire;
pub mod pixeldrain;
pub mod rootz;

use crate::sources::schema::DownloadOption;
use crate::sources::ResolveResult;
use once_cell::sync::Lazy;
use std::collections::HashMap;

static KNOWN_UNRESOLVABLE: Lazy<HashMap<&'static str, &'static str>> = Lazy::new(|| {
    let mut m = HashMap::new();
    m.insert("megadb.net", "megadb (resolver pending)");
    m.insert("filecrypt.cc", "filecrypt (captcha \u{2014} browser only)");
    m.insert("www.filecrypt.cc", "filecrypt (captcha \u{2014} browser only)");
    m.insert("fileq.net", "fileq (browser only)");
    m.insert("mocha.my", "mocha (browser only)");
    m.insert("zerofs.link", "zerofs (browser only)");
    m.insert("fileditchfiles.me", "fileditch (browser only)");
    m
});

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

    let host = hostname_of(url);
    let reason = KNOWN_UNRESOLVABLE
        .get(host.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| format!("unsupported host: {host}"));

    ResolveResult {
        resolvable: false,
        open_url: Some(url.to_string()),
        reason: Some(reason),
        ..Default::default()
    }
}
