use serde_json::json;

use super::not_resolvable;
use crate::slipgate;
use crate::sources::ResolveResult;
use tauri::AppHandle;

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

pub async fn resolve(url: &str) -> ResolveResult {
    resolve_inner(url, None).await
}

pub async fn resolve_via(app: &AppHandle, url: &str) -> ResolveResult {
    resolve_inner(url, Some(app)).await
}

async fn resolve_inner(url: &str, app: Option<&AppHandle>) -> ResolveResult {
    let Some(g) = entry_for(url) else {
        return not_resolvable(url, Some("not a Slipgate host"));
    };
    let mut slipgate_error: Option<String> = None;
    if let Some(cfg) = slipgate::cfg() {
        match slipgate::resolve(&cfg, g.recipe, url, json!({}), json!([])).await {
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
    let Some(app) = app else {
        return not_resolvable(
            url,
            Some(&match slipgate_error {
                Some(e) => format!("Slipgate: {e}"),
                None => format!(
                    "{} ({}) — set a Slipgate URL in Settings to resolve in-app",
                    g.recipe, g.wall
                ),
            }),
        );
    };
    match crate::resolver::solve(app, url).await {
        Ok(solved) => {
            let extra = solved.headers(Some(url));
            if let Some(direct) = solved.url {
                return ResolveResult {
                    resolvable: true,
                    url: Some(direct),
                    file_name: solved.file_name,
                    headers: (!extra.is_empty()).then_some(extra),
                    ephemeral: true,
                    ..Default::default()
                };
            }
            if let Ok(resp) = crate::http::fetch(
                url,
                &crate::http::FetchOpts {
                    headers: extra.clone(),
                    ..Default::default()
                },
            )
            .await
            {
                let body = resp.text().await.unwrap_or_default();
                if let Some(link) = super::scan_direct_link(&crate::http::decode_entities(&body)) {
                    return ResolveResult {
                        resolvable: true,
                        url: Some(link),
                        headers: Some(extra),
                        ephemeral: true,
                        ..Default::default()
                    };
                }
            }
            not_resolvable(
                url,
                Some(&format!(
                    "{} verification passed but no direct download was exposed",
                    g.recipe
                )),
            )
        }
        Err(e) => not_resolvable(url, Some(&format!("verification failed: {e}"))),
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
