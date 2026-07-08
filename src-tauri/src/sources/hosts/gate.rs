//! Slipgate-backed file hosts: links behind captchas, wait timers, or
//! js-only download pages that a plain HTTP resolver cannot clear. Each
//! domain maps to a Slipgate recipe name; the instance drives a real browser
//! and returns a direct url. Without a configured Slipgate these hosts stay
//! browser-only, with a reason pointing the user at Settings.
//!
//! mega.nz is deliberately absent: it serves AES-encrypted bytes, so a
//! direct url is useless without the client-side decryption the official
//! apps do — no resolver can help (see hosts::resolve_url).

use serde_json::json;

use crate::slipgate;
use crate::sources::ResolveResult;

pub struct GateHost {
    pub recipe: &'static str,
    /// What blocks a native resolver; shown when Slipgate is not configured.
    wall: &'static str,
}

const fn gh(recipe: &'static str, wall: &'static str) -> GateHost {
    GateHost { recipe, wall }
}

static TABLE: &[(&str, GateHost)] = &[
    ("megadb.net", gh("megadb", "js-gated link")),
    ("filecrypt.cc", gh("filecrypt", "captcha")),
    ("vikingfile.com", gh("vikingfile", "captcha")),
    ("vik1ngfile.site", gh("vikingfile", "captcha")),
    ("1fichier.com", gh("1fichier", "wait timer + captcha")),
    ("akirabox.com", gh("akirabox", "js-gated link")),
    ("qiwi.gg", gh("qiwi", "js-gated link")),
    ("datavaults.co", gh("datavaults", "captcha + wait timer")),
    ("filekeeper.net", gh("filekeeper", "js-gated link")),
    ("fileq.net", gh("fileq", "browser-only page")),
    ("mocha.my", gh("mocha", "browser-only page")),
    ("zerofs.link", gh("zerofs", "browser-only page")),
    ("fileditchfiles.me", gh("fileditch", "browser-only page")),
    ("fileditch.com", gh("fileditch", "browser-only page")),
];

/// `host == domain` or `host` is a subdomain of `domain`. No allocation.
fn domain_match(host: &str, domain: &str) -> bool {
    host == domain
        || (host.len() > domain.len()
            && host.ends_with(domain)
            && host.as_bytes()[host.len() - domain.len() - 1] == b'.')
}

fn entry_for(url: &str) -> Option<&'static GateHost> {
    let u = url::Url::parse(url).ok()?;
    let host = u.host_str()?.to_lowercase();
    TABLE
        .iter()
        .find(|(d, _)| domain_match(&host, d))
        .map(|(_, g)| g)
}

pub fn matches(url: &str) -> bool {
    entry_for(url).is_some()
}

/// Recipe name for `detect_host_type` (canonical name even for mirror
/// domains like vik1ngfile.site).
pub fn host_type(url: &str) -> Option<&'static str> {
    entry_for(url).map(|g| g.recipe)
}

fn not_resolvable(url: &str, reason: String) -> ResolveResult {
    ResolveResult {
        resolvable: false,
        open_url: Some(url.to_string()),
        reason: Some(reason),
        ..Default::default()
    }
}

pub async fn resolve(url: &str) -> ResolveResult {
    let Some(g) = entry_for(url) else {
        return not_resolvable(url, "not a Slipgate host".to_string());
    };
    let Some(cfg) = slipgate::cfg() else {
        return not_resolvable(
            url,
            format!(
                "{} ({}) — set a Slipgate URL in Settings to resolve in-app",
                g.recipe, g.wall
            ),
        );
    };
    match slipgate::resolve(&cfg, g.recipe, json!({ "url": url }), json!([])).await {
        Ok(link) => ResolveResult {
            resolvable: true,
            url: Some(link.url),
            file_name: link.file_name,
            size_bytes: link.size_bytes,
            headers: (!link.headers.is_empty()).then_some(link.headers),
            // Browser-minted urls are signed/session-bound; re-resolve on retry.
            ephemeral: true,
            ..Default::default()
        },
        Err(e) => not_resolvable(url, format!("Slipgate: {e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_domains_and_subdomains() {
        assert_eq!(host_type("https://megadb.net/abc123"), Some("megadb"));
        assert_eq!(host_type("https://www.filecrypt.cc/Container/X.html"), Some("filecrypt"));
        assert_eq!(host_type("https://vik1ngfile.site/f/xyz"), Some("vikingfile"));
        assert_eq!(host_type("https://1fichier.com/?abc"), Some("1fichier"));
        assert_eq!(host_type("https://qiwi.gg/file/x"), Some("qiwi"));
        assert_eq!(host_type("https://cdn.fileditch.com/x/y.7z"), Some("fileditch"));
    }

    #[test]
    fn rejects_lookalike_hosts() {
        assert!(!matches("https://notqiwi.gg.evil.com/file/x"));
        assert!(!matches("https://xmegadb.net/abc"));
        assert!(!matches("https://mega.nz/file/abc"));
        assert!(!matches("not a url"));
    }
}
