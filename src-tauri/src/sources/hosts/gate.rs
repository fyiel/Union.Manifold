use serde_json::json;

use super::not_resolvable;
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
    ("fileq.net", gh("fileq", "Cloudflare Turnstile")),
    ("mocha.my", gh("mocha", "browser-only page")),
    ("zerofs.link", gh("zerofs", "browser-only page")),
    (
        "fileditch.com",
        gh("fileditch", "WebAssembly proof-of-work page"),
    ),
    (
        "fileditchfiles.me",
        gh("fileditch", "WebAssembly proof-of-work page"),
    ),
    (
        "fileditchfiles.st",
        gh("fileditch", "WebAssembly proof-of-work page"),
    ),
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

/// Whether the resolver in use can resolve this host. A browser is the only
/// way past these walls and the recipe is what drives it, so a host whose
/// recipe the instance does not offer stays browser-only: offering it as an
/// in-app download only produces a failure after a pointless round trip.
pub fn is_available(url: &str) -> bool {
    match entry_for(url) {
        Some(g) => slipgate::recipe_available(g.recipe).unwrap_or(true),
        None => false,
    }
}

fn no_recipe_reason(g: &GateHost) -> String {
    format!(
        "{} - the resolver has no '{}' recipe",
        g.wall, g.recipe
    )
}

pub async fn resolve(url: &str) -> ResolveResult {
    let Some(g) = entry_for(url) else {
        return not_resolvable(url, Some("not a Slipgate host"));
    };
    if slipgate::recipe_available(g.recipe) == Some(false) {
        return not_resolvable(url, Some(&no_recipe_reason(g)));
    }
    let mut slipgate_error: Option<String> = None;
    if slipgate::cfg().is_some() {
        match slipgate::resolve_configured(g.recipe, url, json!({}), json!([])).await {
            Ok(link) if link.url.trim_end_matches('/') != url.trim_end_matches('/') => {
                return ResolveResult {
                    resolvable: true,
                    url: Some(link.url),
                    file_name: link.file_name,
                    size_bytes: link.size_bytes,
                    headers: (!link.headers.is_empty()).then_some(link.headers),
                    ephemeral: true,
                    ..Default::default()
                };
            }
            Ok(_) => {}
            Err(e) => slipgate_error = Some(e),
        }
    }
    not_resolvable(
        url,
        Some(&match slipgate_error {
            Some(e) => format!("Slipgate: {e}"),
            None => format!(
                "{} ({}) - the built-in resolver is unavailable",
                g.recipe, g.wall
            ),
        }),
    )
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
        assert_eq!(
            host_type("https://fileditchfiles.me/a/b/x.zip"),
            Some("fileditch")
        );
        assert_eq!(
            host_type("https://fileditchfiles.st/a/b/x.part1.rar"),
            Some("fileditch")
        );
        assert_eq!(host_type("https://fileditch.com/a/b/x.zip"), Some("fileditch"));
        assert_eq!(host_type("https://filekeeper.net/abc/x.zip"), None);
    }

    #[test]
    fn fileditch_is_browser_gated_now() {
        // The site hands out a WebAssembly proof-of-work page, so the wall is
        // named as such and the host is a gate host like the captcha ones.
        let wall = entry_for("https://fileditchfiles.st/a/b/x.rar")
            .expect("fileditch is a gate host")
            .wall;
        assert!(wall.contains("WebAssembly"), "wall was {wall}");
        assert!(!is_available("https://filekeeper.net/abc/x.zip"));
    }

    #[test]
    fn rejects_lookalike_hosts() {
        assert!(!matches("https://notqiwi.gg.evil.com/file/x"));
        assert!(!matches("https://xmegadb.net/abc"));
        assert!(!matches("https://mega.nz/file/abc"));
        assert!(!matches("not a url"));
    }
}
