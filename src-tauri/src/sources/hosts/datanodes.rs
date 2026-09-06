use super::not_resolvable;
use crate::http::{self, FetchOpts, Jar};
use crate::sources::ResolveResult;
use regex::Regex;
use std::collections::HashMap;
use std::sync::LazyLock;

static HOST_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)(^|\.)datanodes\.to$").unwrap());
static RAND_ATTR_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"rand="([^"]+)""#).unwrap());
static DL_TOKEN_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"dl-token="([^"]+)""#).unwrap());
static INPUT_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r#"(?is)<input\b[^>]*\bname=["']([^"']+)["'][^>]*\bvalue=["']([^"']*)["'][^>]*>"#,
    )
    .unwrap()
});
static COUNTDOWN_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"(?:countdown|:countdown)="(\d+)""#).unwrap());
static COMPONENT_NAME_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?is)<download-countdown\b[^>]*\bname=["']([^"']+)["']"#).unwrap()
});

const BOUNDARY: &str = "----UnionManifoldBoundary7kJ2xQ9vRt3mWp";

pub fn matches(url: &str) -> bool {
    super::host_matches(url, &HOST_RE)
}

fn file_code(url: &str) -> Option<String> {
    let u = url::Url::parse(url).ok()?;
    u.path_segments()?
        .find(|s| !s.is_empty())
        .map(|s| s.to_string())
}

fn multipart(fields: &[(&str, &str)], boundary: &str) -> Vec<u8> {
    let mut body = Vec::new();
    for (k, v) in fields {
        body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
        body.extend_from_slice(
            format!("Content-Disposition: form-data; name=\"{k}\"\r\n\r\n").as_bytes(),
        );
        body.extend_from_slice(v.as_bytes());
        body.extend_from_slice(b"\r\n");
    }
    body.extend_from_slice(format!("--{boundary}--\r\n").as_bytes());
    body
}
fn direct_url(encoded: &str) -> Option<String> {
    let decoded = percent_encoding::percent_decode_str(encoded)
        .decode_utf8()
        .ok()?;
    let parsed = url::Url::parse(&decoded).ok()?;
    matches!(parsed.scheme(), "http" | "https").then(|| parsed.to_string())
}

fn input_value(html: &str, name: &str) -> Option<String> {
    INPUT_RE
        .captures_iter(html)
        .filter_map(|captures| {
            (captures.get(1)?.as_str() == name)
                .then(|| http::decode_entities(captures.get(2).unwrap().as_str()))
        })
        .last()
}

fn component_name(html: &str) -> Option<String> {
    COMPONENT_NAME_RE
        .captures(html)
        .and_then(|captures| captures.get(1))
        .map(|value| http::decode_entities(value.as_str()))
}

fn has_captcha(html: &str) -> bool {
    html.contains(":has-captcha=\"true\"")
        || html.contains("has-captcha=\"true\"")
        || html.contains("g-recaptcha")
        || html.contains("cf-turnstile")
}

fn countdown_secs(html: &str) -> u64 {
    COUNTDOWN_RE
        .captures(html)
        .and_then(|captures| captures.get(1)?.as_str().parse().ok())
        .unwrap_or(0)
        .min(60)
}

fn form(fields: &[(&str, &str)]) -> Vec<u8> {
    let mut serializer = url::form_urlencoded::Serializer::new(String::new());
    for (key, value) in fields {
        serializer.append_pair(key, value);
    }
    serializer.finish().into_bytes()
}

fn direct_result(url: &str, direct: String, file_name: Option<String>) -> ResolveResult {
    ResolveResult {
        resolvable: true,
        url: Some(direct.clone()),
        file_name: file_name
            .or_else(|| super::last_segment(&direct))
            .or_else(|| super::last_segment(url)),
        ephemeral: true,
        ..Default::default()
    }
}

pub async fn is_dead(url: &str) -> bool {
    let Some(code) = file_code(url) else {
        return true;
    };
    let response = http::fetch(
        url,
        &FetchOpts {
            headers: HashMap::from([(
                "Cookie".to_string(),
                format!("file_code={code}; lang=english"),
            )]),
            retries: Some(1),
            timeout: Some(std::time::Duration::from_secs(6)),
            ..Default::default()
        },
    )
    .await;
    match response {
        Ok(response) => matches!(response.status().as_u16(), 404 | 410),
        Err(_) => false,
    }
}

pub async fn resolve(url: &str) -> ResolveResult {
    resolve_with(url, &HashMap::new()).await
}

pub async fn resolve_with(url: &str, extra: &HashMap<String, String>) -> ResolveResult {
    let code = match file_code(url) {
        Some(c) => c,
        None => return not_resolvable(url, Some("datanodes link has no file code")),
    };

    let host = "datanodes.to";
    let jar = Jar::default();
    for (key, value) in extra {
        if key.eq_ignore_ascii_case("cookie") {
            for pair in value.split(';') {
                if let Some((name, val)) = pair.split_once('=') {
                    jar.set(host, name.trim(), val.trim());
                }
            }
        }
    }
    jar.set(host, "lang", "english");
    jar.set(host, "file_code", &code);

    let mut page_headers = HashMap::new();
    for (key, value) in extra {
        if key.eq_ignore_ascii_case("user-agent") {
            page_headers.insert(key.clone(), value.clone());
        }
    }
    if let Some(cookie) = jar.header_for(host) {
        page_headers.insert("Cookie".to_string(), cookie);
    }
    let page = match http::fetch(
        url,
        &FetchOpts {
            headers: page_headers,
            timeout: Some(std::time::Duration::from_secs(30)),
            ..Default::default()
        },
    )
    .await
    {
        Ok(response) if response.status().is_success() => {
            response.text().await.unwrap_or_default()
        }
        Ok(response) => {
            return not_resolvable(
                url,
                Some(&format!("datanodes returned {}", response.status().as_u16())),
            )
        }
        Err(_) => return not_resolvable(url, Some("datanodes request failed")),
    };

    let mut file_name = input_value(&page, "fname").or_else(|| component_name(&page));
    let mut rand = RAND_ATTR_RE
        .captures(&page)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string());
    let mut dl_token = DL_TOKEN_RE
        .captures(&page)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string());
    let mut stage_page = page;

    if rand.is_none() || dl_token.is_none() {
        let fname = match file_name.clone() {
            Some(fname) if !fname.is_empty() && fname != "Download" => fname,
            _ => return not_resolvable(url, Some("datanodes page has no file name")),
        };
        let mut headers = HashMap::from([
            (
                "Content-Type".to_string(),
                "application/x-www-form-urlencoded".to_string(),
            ),
            ("Referer".to_string(), url.to_string()),
            ("Origin".to_string(), "https://datanodes.to".to_string()),
        ]);
        for (key, value) in extra {
            if !key.eq_ignore_ascii_case("cookie")
                && !key.eq_ignore_ascii_case("referer")
                && !key.eq_ignore_ascii_case("origin")
            {
                headers.insert(key.clone(), value.clone());
            }
        }
        let body = form(&[
            ("op", "download1"),
            ("usr_login", ""),
            ("id", code.as_str()),
            ("fname", fname.as_str()),
            ("referer", ""),
            ("method_free", "Free Download >>"),
        ]);
        stage_page = match http::fetch(
            "https://datanodes.to/download",
            &FetchOpts {
                method: Some("POST".to_string()),
                headers,
                body: Some(body),
                jar: Some(jar.clone()),
                timeout: Some(std::time::Duration::from_secs(30)),
                ..Default::default()
            },
        )
        .await
        {
            Ok(response) if response.status().is_success() => {
                response.text().await.unwrap_or_default()
            }
            Ok(response) => {
                return not_resolvable(
                    url,
                    Some(&format!(
                        "datanodes download1 returned {}",
                        response.status().as_u16()
                    )),
                )
            }
            Err(_) => return not_resolvable(url, Some("datanodes download1 failed")),
        };
        file_name = component_name(&stage_page).or_else(|| input_value(&stage_page, "fname"));
        rand = RAND_ATTR_RE
            .captures(&stage_page)
            .and_then(|c| c.get(1))
            .map(|m| m.as_str().to_string());
        dl_token = DL_TOKEN_RE
            .captures(&stage_page)
            .and_then(|c| c.get(1))
            .map(|m| m.as_str().to_string());
        if has_captcha(&stage_page) {
            return not_resolvable(url, Some("datanodes requires interactive verification"));
        }
        let wait = countdown_secs(&stage_page);
        if wait > 0 {
            tokio::time::sleep(std::time::Duration::from_secs(wait)).await;
        }
    }

    if std::env::var("UNION_SOLVER_TRACE").is_ok() {
        eprintln!(
            "DATANODES_DEBUG page_len={} has_rand={} has_dl_token={} header_keys={:?}",
            stage_page.len(),
            rand.is_some(),
            dl_token.is_some(),
            extra.keys().collect::<Vec<_>>()
        );
    }
    let (rand, dl_token) = match (rand, dl_token) {
        (Some(rand), Some(dl_token)) => (rand, dl_token),
        _ => return not_resolvable(url, Some("datanodes page did not expose download tokens")),
    };
    if has_captcha(&stage_page) {
        return not_resolvable(url, Some("datanodes requires interactive verification"));
    }

    let fields: Vec<(&str, &str)> = vec![
        ("op", "download2"),
        ("id", code.as_str()),
        ("rand", rand.as_str()),
        ("referer", url),
        ("method_free", "Free Download >>"),
        ("method_premium", ""),
        ("g_captch__a", "1"),
        ("dl_token", dl_token.as_str()),
    ];
    let body = multipart(&fields, BOUNDARY);

    let mut headers = HashMap::new();
    headers.insert(
        "Content-Type".to_string(),
        format!("multipart/form-data; boundary={BOUNDARY}"),
    );
    headers.insert(
        "Referer".to_string(),
        "https://datanodes.to/download".to_string(),
    );
    headers.insert("Origin".to_string(), "https://datanodes.to".to_string());
    headers.insert("X-Dn-Dl".to_string(), "1".to_string());
    for (key, value) in extra {
        if !key.eq_ignore_ascii_case("cookie")
            && !key.eq_ignore_ascii_case("referer")
            && !key.eq_ignore_ascii_case("origin")
        {
            headers.insert(key.clone(), value.clone());
        }
    }

    let resp = match http::fetch(
        "https://datanodes.to/download",
        &FetchOpts {
            method: Some("POST".to_string()),
            headers,
            body: Some(body),
            jar: Some(jar),
            manual_redirect: true,
            timeout: Some(std::time::Duration::from_secs(30)),
            ..Default::default()
        },
    )
    .await
    {
        Ok(response) => response,
        Err(_) => return not_resolvable(url, Some("datanodes request failed")),
    };
    let status = resp.status();
    let location = resp
        .headers()
        .get(reqwest::header::LOCATION)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let body = resp.text().await.unwrap_or_default();
    if std::env::var("UNION_SOLVER_TRACE").is_ok() {
        eprintln!(
            "DATANODES_DEBUG post status={} location={:?} body_head={:?}",
            status.as_u16(),
            location,
            body.chars().take(200).collect::<String>()
        );
    }
    if !status.is_success() {
        return not_resolvable(
            url,
            Some(&format!("datanodes returned {}", status.as_u16())),
        );
    }
    if let Some(direct) = location.and_then(|location| direct_url(&location)) {
        return direct_result(url, direct, file_name);
    }
    let json = match serde_json::from_str::<serde_json::Value>(&body) {
        Ok(json) => json,
        Err(_) => return not_resolvable(url, Some("datanodes returned no json")),
    };
    match json
        .get("url")
        .and_then(|value| value.as_str())
        .and_then(direct_url)
    {
        Some(direct) => direct_result(url, direct, file_name),
        None => not_resolvable(url, Some("no datanodes download url")),
    }
}
