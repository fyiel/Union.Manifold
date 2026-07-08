//! FileDitch native resolver.
//!
//! A FileDitch file page (`fileditchfiles.me/<a>/<b>/<name>`) is an HTML landing
//! page that embeds the real, signed direct link on a sibling CDN host
//! (`freakingfileditch.me/...?md5=<sig>&expires=<ts>`). No gate, no captcha — the
//! resolver just fetches the page and lifts that signed URL out.

use std::sync::LazyLock;
use std::time::Duration;

use regex::Regex;

use crate::http::{self, FetchOpts};
use crate::sources::ResolveResult;

static HOST_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)(^|\.)(fileditchfiles\.me|fileditch\.com)$").unwrap());
// The signed CDN link: any *fileditch* host, an archive/installer extension, and
// the md5 signature query the landing page hands out.
static SIGNED_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r#"(?i)https?://[a-z0-9.-]*fileditch[a-z0-9.-]*/[^\s"'<>]+?\.(?:zip|rar|7z|exe|bin|iso)\?md5=[^\s"'<>&]+(?:&(?:amp;)?expires=\d+)?"#,
    )
    .unwrap()
});

pub fn matches(url: &str) -> bool {
    url::Url::parse(url)
        .ok()
        .and_then(|u| u.host_str().map(|s| s.to_string()))
        .map(|h| HOST_RE.is_match(&h))
        .unwrap_or(false)
}

fn not_resolvable(url: &str, reason: &str) -> ResolveResult {
    ResolveResult {
        resolvable: false,
        open_url: Some(url.to_string()),
        reason: Some(reason.to_string()),
        ..Default::default()
    }
}

pub async fn resolve(url: &str) -> ResolveResult {
    let html = match http::fetch(
        url,
        &FetchOpts { timeout: Some(Duration::from_secs(30)), ..Default::default() },
    )
    .await
    {
        Ok(r) => r.text().await.unwrap_or_default(),
        Err(_) => return not_resolvable(url, "fileditch request failed"),
    };
    match SIGNED_RE.find(&html) {
        Some(m) => {
            let direct = http::decode_entities(m.as_str());
            let file_name = url
                .rsplit('/')
                .next()
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string());
            ResolveResult {
                resolvable: true,
                url: Some(direct),
                file_name,
                // Signed with an `expires` timestamp; re-resolve on a later retry.
                ephemeral: true,
                ..Default::default()
            }
        }
        None => not_resolvable(url, "fileditch link not found on page"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_hosts() {
        assert!(matches("https://fileditchfiles.me/alpha13/abc/game.zip"));
        assert!(matches("https://fileditch.com/x"));
        assert!(!matches("https://notfileditch.com.evil.com/x"));
    }

    #[test]
    fn extracts_signed_link() {
        let html = r#"<a href="https://freakingfileditch.me/alpha13/2054b6/game.zip?md5=j6BNFuBlR1faXVG50DfApw&amp;expires=1783484468">dl</a>"#;
        let m = SIGNED_RE.find(html).map(|m| http::decode_entities(m.as_str()));
        assert_eq!(
            m.as_deref(),
            Some("https://freakingfileditch.me/alpha13/2054b6/game.zip?md5=j6BNFuBlR1faXVG50DfApw&expires=1783484468")
        );
    }
}
