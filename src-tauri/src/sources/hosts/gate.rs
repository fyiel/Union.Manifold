use serde_json::json;

use crate::slipgate;
use crate::sources::ResolveResult;

pub struct GateHost {
    pub recipe: &'static str,
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
    (
        "fileq.net",
        gh("fileq", "Cloudflare Turnstile \u{2014} browser only"),
    ),
    ("mocha.my", gh("mocha", "browser-only page")),
    ("zerofs.link", gh("zerofs", "browser-only page")),
];

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
    match slipgate::resolve(&cfg, g.recipe, url, json!({}), json!([])).await {
        Ok(link) if link.url.trim_end_matches('/') != url.trim_end_matches('/') => ResolveResult {
            resolvable: true,
            url: Some(link.url),
            file_name: link.file_name,
            size_bytes: link.size_bytes,
            headers: (!link.headers.is_empty()).then_some(link.headers),
            ephemeral: true,
            ..Default::default()
        },
        Ok(_) => not_resolvable(
            url,
            format!(
                "{} returned the host page instead of a direct download",
                g.recipe
            ),
        ),
        Err(e) => not_resolvable(url, format!("Slipgate: {e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_domains_and_subdomains() {
        assert_eq!(host_type("https://megadb.net/abc123"), Some("megadb"));
        assert_eq!(
            host_type("https://www.filecrypt.cc/Container/X.html"),
            Some("filecrypt")
        );
        assert_eq!(
            host_type("https://vik1ngfile.site/f/xyz"),
            Some("vikingfile")
        );
        assert_eq!(host_type("https://1fichier.com/?abc"), Some("1fichier"));
        assert_eq!(host_type("https://qiwi.gg/file/x"), Some("qiwi"));
        assert_eq!(host_type("https://fileq.net/abc.html"), Some("fileq"));
        assert_eq!(host_type("https://fileditchfiles.me/a/b/x.zip"), None);
        assert_eq!(host_type("https://filekeeper.net/abc/x.zip"), None);
    }

    #[test]
    fn rejects_lookalike_hosts() {
        assert!(!matches("https://notqiwi.gg.evil.com/file/x"));
        assert!(!matches("https://xmegadb.net/abc"));
        assert!(!matches("https://mega.nz/file/abc"));
        assert!(!matches("not a url"));
    }
}
