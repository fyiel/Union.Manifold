use std::collections::HashMap;
use std::fmt::Write as _;
use std::sync::LazyLock;
use std::time::Duration;

use regex::Regex;
use sha2::{Digest, Sha256};

use crate::http::{self, FetchOpts};
use crate::sources::ResolveResult;
use super::not_resolvable;

static HOST_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)(^|\.)(fileditchfiles\.(?:me|st)|fileditch\.(?:com|st))$").unwrap()
});
static SIGNED_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r#"(?i)https?://[a-z0-9.-]*fileditch[a-z0-9.-]*/[^\s"'<>]+?\.(?:zip|rar|7z|exe|bin|iso)\?md5=[^\s"'<>&]+(?:&(?:amp;)?expires=\d+)?"#,
    )
    .unwrap()
});
static INPUT_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?is)<input\b[^>]*\bname=["']([^"']+)["'][^>]*\bvalue=["']([^"']*)["'][^>]*>"#)
        .unwrap()
});
static JOINED_URL_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?s)var\s+[A-Za-z_$][A-Za-z0-9_$]*\s*=\s*(\[[^;]+?\])\.join\(\s*["']{2}\s*\)"#)
        .unwrap()
});

pub fn matches(url: &str) -> bool {
    super::host_matches(url, &HOST_RE)
}

fn origin(url: &str) -> Option<String> {
    let mut parsed = url::Url::parse(url).ok()?;
    parsed.set_path("/");
    parsed.set_query(None);
    parsed.set_fragment(None);
    Some(parsed.to_string())
}

fn file_name(url: &str) -> Option<String> {
    super::last_segment(url)
}
#[derive(Debug)]
struct PowChallenge {
    original_referrer: String,
    challenge: String,
    timestamp: String,
    difficulty: u32,
    signature: String,
}

fn input_value(html: &str, name: &str) -> Option<String> {
    INPUT_RE.captures_iter(html).find_map(|captures| {
        (captures.get(1)?.as_str() == name)
            .then(|| http::decode_entities(captures.get(2).unwrap().as_str()))
    })
}

fn pow_challenge(html: &str) -> Option<PowChallenge> {
    let difficulty = input_value(html, "pow_diff")?.parse().ok()?;
    let challenge = PowChallenge {
        original_referrer: input_value(html, "orig_ref").unwrap_or_default(),
        challenge: input_value(html, "pow_challenge")?,
        timestamp: input_value(html, "pow_ts")?,
        difficulty,
        signature: input_value(html, "pow_sig")?,
    };
    (difficulty <= 24).then_some(challenge)
}

fn has_leading_zero_bits(hash: &[u8], bits: u32) -> bool {
    let whole_bytes = (bits / 8) as usize;
    let remaining_bits = bits % 8;
    hash[..whole_bytes].iter().all(|byte| *byte == 0)
        && (remaining_bits == 0 || hash[whole_bytes] & (0xff << (8 - remaining_bits)) == 0)
}

fn solve_pow(challenge: &str, difficulty: u32) -> Option<u64> {
    if difficulty > 24 {
        return None;
    }
    let mut input = String::with_capacity(challenge.len() + 22);
    input.push_str(challenge);
    input.push(':');
    let prefix_len = input.len();
    for nonce in 0..=u64::MAX {
        input.truncate(prefix_len);
        write!(&mut input, "{nonce}").ok()?;
        if has_leading_zero_bits(&Sha256::digest(input.as_bytes()), difficulty) {
            return Some(nonce);
        }
    }
    None
}

fn pow_body(challenge: &PowChallenge, nonce: u64) -> Vec<u8> {
    let mut form = url::form_urlencoded::Serializer::new(String::new());
    form.append_pair("orig_ref", &challenge.original_referrer);
    form.append_pair("pow_challenge", &challenge.challenge);
    form.append_pair("pow_ts", &challenge.timestamp);
    form.append_pair("pow_diff", &challenge.difficulty.to_string());
    form.append_pair("pow_sig", &challenge.signature);
    form.append_pair("pow_nonce", &nonce.to_string());
    form.finish().into_bytes()
}

fn signed_url(html: &str) -> Option<String> {
    if let Some(found) = SIGNED_RE.find(html) {
        return Some(http::decode_entities(found.as_str()));
    }
    JOINED_URL_RE.captures_iter(html).find_map(|captures| {
        let parts: Vec<String> = serde_json::from_str(captures.get(1)?.as_str()).ok()?;
        let candidate = parts.concat();
        SIGNED_RE.is_match(&candidate).then_some(candidate)
    })
}

fn resolved(url: String, original_url: &str, headers: HashMap<String, String>) -> ResolveResult {
    ResolveResult {
        resolvable: true,
        file_name: file_name(&url).or_else(|| file_name(original_url)),
        ephemeral: url.contains("md5=") || url.contains("expires="),
        url: Some(url),
        headers: Some(headers),
        ..Default::default()
    }
}

pub async fn resolve(url: &str) -> ResolveResult {
    let referer = origin(url).unwrap_or_else(|| "https://fileditch.com/".to_string());
    let headers = HashMap::from([("Referer".to_string(), referer.clone())]);
    let jar = http::Jar::default();
    let resp = match http::fetch(
        url,
        &FetchOpts {
            headers: headers.clone(),
            jar: Some(jar.clone()),
            timeout: Some(Duration::from_secs(30)),
            ..Default::default()
        },
    )
    .await
    {
        Ok(r) => r,
        Err(_) => return not_resolvable(url, Some("fileditch request failed")),
    };
    if !resp.status().is_success() {
        return not_resolvable(
            url, Some(&format!("fileditch returned {}", resp.status().as_u16())),
        );
    }

    let response_url = resp.url().to_string();
    let content_type = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !content_type.contains("html") {
        return resolved(response_url, url, headers);
    }

    let html = resp.text().await.unwrap_or_default();
    if let Some(direct) = signed_url(&html) {
        return resolved(direct, url, headers);
    }
    let challenge = match pow_challenge(&html) {
        Some(challenge) => challenge,
        None => return not_resolvable(url, Some("fileditch download challenge not found")),
    };
    let pow_input = challenge.challenge.clone();
    let difficulty = challenge.difficulty;
    let nonce = match tokio::task::spawn_blocking(move || solve_pow(&pow_input, difficulty)).await {
        Ok(Some(nonce)) => nonce,
        _ => return not_resolvable(url, Some("fileditch proof-of-work challenge failed")),
    };

    let mut post_headers = headers.clone();
    post_headers.insert(
        "Content-Type".to_string(),
        "application/x-www-form-urlencoded".to_string(),
    );
    post_headers.insert(
        "Origin".to_string(),
        referer.trim_end_matches('/').to_string(),
    );
    post_headers.insert("Referer".to_string(), url.to_string());
    let resp = match http::fetch(
        url,
        &FetchOpts {
            method: Some("POST".to_string()),
            headers: post_headers,
            body: Some(pow_body(&challenge, nonce)),
            jar: Some(jar),
            timeout: Some(Duration::from_secs(30)),
            ..Default::default()
        },
    )
    .await
    {
        Ok(r) => r,
        Err(_) => return not_resolvable(url, Some("fileditch challenge submission failed")),
    };
    if !resp.status().is_success() {
        return not_resolvable(
            url, Some(&format!("fileditch challenge returned {}", resp.status().as_u16())),
        );
    }

    let response_url = resp.url().to_string();
    let content_type = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !content_type.contains("html") {
        return resolved(response_url, url, headers);
    }
    let html = resp.text().await.unwrap_or_default();
    match signed_url(&html) {
        Some(direct) => resolved(direct, url, headers),
        None => not_resolvable(url, Some("fileditch signed download link not found")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_hosts() {
        assert!(matches("https://fileditchfiles.me/alpha13/abc/game.zip"));
        assert!(matches("https://fileditchfiles.st/beta16/abc/game.zip"));
        assert!(matches("https://files.fileditch.st/alpha13/abc/game.zip"));
        assert!(matches("https://fileditch.com/x"));
        assert!(!matches("https://notfileditch.com.evil.com/x"));
    }

    #[test]
    fn extracts_signed_link() {
        let html = r#"<a href="https://freakingfileditch.me/alpha13/2054b6/game.zip?md5=j6BNFuBlR1faXVG50DfApw&amp;expires=1783484468">dl</a>"#;
        assert_eq!(
            signed_url(html).as_deref(),
            Some("https://freakingfileditch.me/alpha13/2054b6/game.zip?md5=j6BNFuBlR1faXVG50DfApw&expires=1783484468")
        );
    }

    #[test]
    fn extracts_obfuscated_signed_link() {
        let html = r#"<script>var u = ["https:\/\/betaup.fre","akingfileditch.me\/beta16\/abc\/game.rar?md5=x","&expires=1784620053"].join("");</script>"#;
        assert_eq!(
            signed_url(html).as_deref(),
            Some(
                "https://betaup.freakingfileditch.me/beta16/abc/game.rar?md5=x&expires=1784620053"
            )
        );
    }

    #[test]
    fn solves_proof_of_work() {
        let nonce = solve_pow("challenge", 12).unwrap();
        let digest = Sha256::digest(format!("challenge:{nonce}").as_bytes());
        assert!(has_leading_zero_bits(&digest, 12));
    }
}
