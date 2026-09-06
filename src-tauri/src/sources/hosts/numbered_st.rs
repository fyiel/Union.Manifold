use std::sync::LazyLock;

use regex::Regex;

use super::not_resolvable;
use crate::http::{self, FetchOpts};
use crate::sources::ResolveResult;

static HOST_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)^\d{4}\.st$").unwrap());

pub fn matches(url: &str) -> bool {
    super::host_matches(url, &HOST_RE)
}

fn absolute_redirect(base: &str, location: &str) -> Option<String> {
    let url = url::Url::parse(base).ok()?.join(location).ok()?;
    matches!(url.scheme(), "http" | "https").then(|| url.to_string())
}

fn resolved(original_url: &str, direct_url: String) -> ResolveResult {
    ResolveResult {
        resolvable: true,
        url: Some(direct_url.clone()),
        file_name: super::last_segment(&direct_url).or_else(|| super::last_segment(original_url)),
        ephemeral: direct_url.contains('?'),
        ..Default::default()
    }
}

pub async fn resolve(url: &str) -> ResolveResult {
    let response = match http::fetch(
        url,
        &FetchOpts {
            manual_redirect: true,
            timeout: Some(std::time::Duration::from_secs(20)),
            ..Default::default()
        },
    )
    .await
    {
        Ok(response) => response,
        Err(_) => return not_resolvable(url, Some("numbered .st request failed")),
    };

    if response.status().is_redirection() {
        let direct = response
            .headers()
            .get(reqwest::header::LOCATION)
            .and_then(|value| value.to_str().ok())
            .and_then(|location| absolute_redirect(url, location));
        return match direct {
            Some(direct) => resolved(url, direct),
            None => not_resolvable(url, Some("numbered .st returned no download location")),
        };
    }

    if response.status().is_success() {
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("")
            .to_ascii_lowercase();
        if !content_type.contains("html") {
            return resolved(url, url.to_string());
        }
    }

    not_resolvable(
        url,
        Some(&format!("numbered .st returned {}", response.status().as_u16())),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_numbered_st_hosts_only() {
        assert!(matches("https://0807.st/UqGbHGcw.rar"));
        assert!(matches("https://0853.st/X.rar"));
        assert!(!matches("https://cdn.0807.st/X.rar"));
        assert!(!matches("https://0807.st.evil.com/X.rar"));
        assert!(!matches("https://807.st/X.rar"));
    }

    #[test]
    fn joins_relative_and_absolute_redirects() {
        assert_eq!(
            absolute_redirect("https://0807.st/file.rar", "/cdn/file.rar")
                .as_deref(),
            Some("https://0807.st/cdn/file.rar")
        );
        assert_eq!(
            absolute_redirect("https://0807.st/file.rar", "https://cdn.0807.st/file.rar")
                .as_deref(),
            Some("https://cdn.0807.st/file.rar")
        );
        assert_eq!(
            absolute_redirect("https://0807.st/file.rar", "javascript:alert(1)")
                .as_deref(),
            None
        );
    }
}
