use std::collections::HashMap;
use std::sync::{Arc, LazyLock, Mutex};
use std::time::Duration;

use futures::stream::{self, StreamExt};
use rand::Rng;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use reqwest::redirect::Policy;
use reqwest::{Client, Response, StatusCode};

pub(crate) const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

static STEAMRIP_UA: LazyLock<String> = LazyLock::new(|| format!("{UA} Union.Manifold"));

fn base_headers() -> HeaderMap {
    let mut h = HeaderMap::new();
    h.insert(reqwest::header::USER_AGENT, HeaderValue::from_static(UA));
    h.insert(
        reqwest::header::ACCEPT,
        HeaderValue::from_static(
            "text/html,application/xhtml+xml,application/json,application/xml;q=0.9,*/*;q=0.8",
        ),
    );
    h.insert(
        reqwest::header::ACCEPT_LANGUAGE,
        HeaderValue::from_static("en-US,en;q=0.9"),
    );
    h
}

#[derive(Clone, Default)]
pub struct Jar(pub Arc<Mutex<HashMap<String, HashMap<String, String>>>>);

impl Jar {
    pub fn set(&self, host: &str, name: &str, value: &str) {
        self.0
            .lock()
            .unwrap()
            .entry(host.to_string())
            .or_default()
            .insert(name.to_string(), value.to_string());
    }

    pub fn header_for(&self, host: &str) -> Option<String> {
        let map = self.0.lock().unwrap();
        let jar = map.get(host)?;
        if jar.is_empty() {
            return None;
        }
        Some(
            jar.iter()
                .map(|(k, v)| format!("{k}={v}"))
                .collect::<Vec<_>>()
                .join("; "),
        )
    }

    pub fn store_from(&self, host: &str, resp: &Response) {
        let mut map = self.0.lock().unwrap();
        let jar = map.entry(host.to_string()).or_default();
        for hv in resp.headers().get_all(reqwest::header::SET_COOKIE).iter() {
            if let Ok(s) = hv.to_str() {
                if let Some(pair) = s.split(';').next() {
                    if let Some((k, v)) = pair.split_once('=') {
                        jar.insert(k.trim().to_string(), v.trim().to_string());
                    }
                }
            }
        }
    }
}

#[derive(Default)]
pub struct FetchOpts {
    pub method: Option<String>,
    pub headers: HashMap<String, String>,
    pub body: Option<Vec<u8>>,
    pub jar: Option<Jar>,
    pub manual_redirect: bool,
    pub retries: Option<u32>,
    pub timeout: Option<Duration>,
}

static PROXY: parking_lot::RwLock<Option<String>> = parking_lot::RwLock::new(None);

fn build_client(no_redirect: bool) -> Client {
    let mut b = Client::builder()
        .default_headers(base_headers())
        .timeout(Duration::from_secs(25))
        .redirect(if no_redirect {
            Policy::none()
        } else {
            Policy::limited(10)
        });
    if let Some(p) = PROXY.read().clone() {
        if let Ok(proxy) = reqwest::Proxy::all(&p) {
            b = b.proxy(proxy);
        }
    }
    b.build().expect("http client")
}

// Swappable so the proxy setting applies at runtime without a restart: fetch
// clones the current Arc<Client> per request (cheap) and `set_proxy` rebuilds.
static CLIENT: LazyLock<parking_lot::RwLock<Arc<Client>>> =
    LazyLock::new(|| parking_lot::RwLock::new(Arc::new(build_client(false))));

static CLIENT_NOREDIR: LazyLock<parking_lot::RwLock<Arc<Client>>> =
    LazyLock::new(|| parking_lot::RwLock::new(Arc::new(build_client(true))));

/// Route all outbound HTTP through `url` (or clear it with `None`) and rebuild
/// the shared clients so it applies to every subsequent request. Backs the
/// "tunnel connections through a proxy" setting.
pub fn set_proxy(url: Option<String>) {
    *PROXY.write() = url.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    *CLIENT.write() = Arc::new(build_client(false));
    *CLIENT_NOREDIR.write() = Arc::new(build_client(true));
}

fn should_retry(status: StatusCode) -> bool {
    status == StatusCode::TOO_MANY_REQUESTS || status.is_server_error()
}

async fn backoff(attempt: u32, retry_after: Option<u64>) {
    let base = (500u64 * (1u64 << attempt)).min(8000);
    let jitter = rand::thread_rng().gen_range(0..300);
    let mut wait = base + jitter;
    if let Some(ra) = retry_after {
        wait = wait.max((ra * 1000).min(15_000));
    }
    tokio::time::sleep(Duration::from_millis(wait)).await;
}

pub async fn fetch(url: &str, opts: &FetchOpts) -> reqwest::Result<Response> {
    let client = if opts.manual_redirect {
        CLIENT_NOREDIR.read().clone()
    } else {
        CLIENT.read().clone()
    };
    let max = opts.retries.unwrap_or(2);
    let host = url::Url::parse(url)
        .ok()
        .and_then(|u| u.host_str().map(|s| s.to_string()));
    let is_steamrip = host
        .as_deref()
        .map(|h| h == "steamrip.com" || h.ends_with(".steamrip.com"))
        .unwrap_or(false);

    let mut last_err: Option<reqwest::Error> = None;
    for attempt in 0..=max {
        let method =
            reqwest::Method::from_bytes(opts.method.as_deref().unwrap_or("GET").as_bytes())
                .unwrap_or(reqwest::Method::GET);
        let mut req = client.request(method, url);
        for (k, v) in &opts.headers {
            if let (Ok(name), Ok(val)) = (
                HeaderName::from_bytes(k.as_bytes()),
                HeaderValue::from_str(v),
            ) {
                req = req.header(name, val);
            }
        }
        if is_steamrip
            && !opts
                .headers
                .keys()
                .any(|k| k.eq_ignore_ascii_case("user-agent"))
        {
            req = req.header(reqwest::header::USER_AGENT, STEAMRIP_UA.as_str());
        }
        if let (Some(jar), Some(host)) = (&opts.jar, &host) {
            if let Some(cookie) = jar.header_for(host) {
                req = req.header(reqwest::header::COOKIE, cookie);
            }
        }
        if let Some(body) = &opts.body {
            req = req.body(body.clone());
        }
        if let Some(t) = opts.timeout {
            req = req.timeout(t);
        }

        match req.send().await {
            Ok(resp) => {
                if let (Some(jar), Some(host)) = (&opts.jar, &host) {
                    jar.store_from(host, &resp);
                }
                let status = resp.status();
                if should_retry(status) && attempt < max {
                    let retry_after = resp
                        .headers()
                        .get(reqwest::header::RETRY_AFTER)
                        .and_then(|v| v.to_str().ok())
                        .and_then(|s| s.parse::<u64>().ok());
                    backoff(attempt, retry_after).await;
                    continue;
                }
                return Ok(resp);
            }
            Err(e) => {
                last_err = Some(e);
                if attempt < max {
                    backoff(attempt, None).await;
                    continue;
                }
            }
        }
    }
    Err(last_err.unwrap())
}

pub async fn get_text(url: &str) -> reqwest::Result<String> {
    fetch(url, &FetchOpts::default()).await?.text().await
}

pub async fn get_json<T: serde::de::DeserializeOwned>(url: &str) -> reqwest::Result<T> {
    fetch(url, &FetchOpts::default()).await?.json::<T>().await
}

pub async fn map_limit<I, T, F, Fut, R>(items: I, limit: usize, f: F) -> Vec<R>
where
    I: IntoIterator<Item = T>,
    F: Fn(T) -> Fut,
    Fut: std::future::Future<Output = Option<R>>,
{
    stream::iter(items)
        .map(f)
        .buffered(limit.max(1))
        .filter_map(|x| async move { x })
        .collect()
        .await
}

pub fn decode_entities(s: &str) -> String {
    if !s.contains('&') {
        return s.to_string();
    }
    ENTITY_RE
        .replace_all(s, |cap: &regex::Captures| {
            let ent = &cap[0];
            let inner = &ent[1..ent.len() - 1];
            if let Some(num) = inner.strip_prefix('#') {
                let code =
                    if let Some(hex) = num.strip_prefix('x').or_else(|| num.strip_prefix('X')) {
                        u32::from_str_radix(hex, 16).ok()
                    } else {
                        num.parse::<u32>().ok()
                    };
                return code
                    .and_then(char::from_u32)
                    .map(String::from)
                    .unwrap_or_else(|| ent.to_string());
            }
            match inner {
                "amp" => "&",
                "lt" => "<",
                "gt" => ">",
                "quot" => "\"",
                "apos" => "'",
                "nbsp" => " ",
                "mdash" => "\u{2014}",
                "ndash" => "\u{2013}",
                "hellip" => "\u{2026}",
                "rsquo" => "\u{2019}",
                "lsquo" => "\u{2018}",
                "reg" => "\u{00ae}",
                "trade" => "\u{2122}",
                "copy" => "\u{00a9}",
                _ => return ent.to_string(),
            }
            .to_string()
        })
        .to_string()
}

static ENTITY_RE: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(r"&(?:#(?:[xX][0-9a-fA-F]{1,6}|[0-9]{1,7})|[a-zA-Z]+);").unwrap()
});

static TAG_RE: LazyLock<regex::Regex> = LazyLock::new(|| regex::Regex::new(r"(?s)<[^>]*>").unwrap());

pub fn strip_tags(s: &str) -> String {
    decode_entities(&TAG_RE.replace_all(s, " "))
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn t_decode_entities_no_double_decode() {
        assert_eq!(decode_entities("&amp;lt;"), "&lt;");
    }

    #[test]
    fn t_decode_entities_named() {
        assert_eq!(decode_entities("&lt;"), "<");
        assert_eq!(decode_entities("&gt;"), ">");
        assert_eq!(decode_entities("&amp;"), "&");
    }

    #[test]
    fn t_decode_entities_mixed_string() {
        assert_eq!(
            decode_entities("Tom &amp; Jerry &lt;3&gt;"),
            "Tom & Jerry <3>"
        );
    }

    #[test]
    fn t_decode_entities_numeric() {
        assert_eq!(decode_entities("&#65;"), "A");
        assert_eq!(decode_entities("&#x41;"), "A");
    }

    #[test]
    fn t_decode_entities_no_double_decode_numeric() {
        assert_eq!(decode_entities("&amp;#65;"), "&#65;");
        assert_eq!(decode_entities("&bogus;"), "&bogus;");
    }
}
