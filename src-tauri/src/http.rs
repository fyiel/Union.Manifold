use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures::stream::{self, StreamExt};
use once_cell::sync::Lazy;
use rand::Rng;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use reqwest::redirect::Policy;
use reqwest::{Client, Response, StatusCode};

const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

fn base_headers() -> HeaderMap {
    let mut h = HeaderMap::new();
    h.insert(reqwest::header::USER_AGENT, HeaderValue::from_static(UA));
    h.insert(
        reqwest::header::ACCEPT,
        HeaderValue::from_static("text/html,application/xhtml+xml,application/json,application/xml;q=0.9,*/*;q=0.8"),
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
    pub fn new() -> Self {
        Jar(Arc::new(Mutex::new(HashMap::new())))
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

static CLIENT: Lazy<Client> = Lazy::new(|| {
    Client::builder()
        .redirect(Policy::limited(10))
        .default_headers(base_headers())
        .timeout(Duration::from_secs(25))
        .build()
        .expect("http client")
});

static CLIENT_NOREDIR: Lazy<Client> = Lazy::new(|| {
    Client::builder()
        .redirect(Policy::none())
        .default_headers(base_headers())
        .timeout(Duration::from_secs(25))
        .build()
        .expect("http client noredir")
});

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
        &*CLIENT_NOREDIR
    } else {
        &*CLIENT
    };
    let max = opts.retries.unwrap_or(2);
    let host = url::Url::parse(url)
        .ok()
        .and_then(|u| u.host_str().map(|s| s.to_string()));

    let mut last_err: Option<reqwest::Error> = None;
    for attempt in 0..=max {
        let method = reqwest::Method::from_bytes(
            opts.method.as_deref().unwrap_or("GET").as_bytes(),
        )
        .unwrap_or(reqwest::Method::GET);
        let mut req = client.request(method, url);
        for (k, v) in &opts.headers {
            if let (Ok(name), Ok(val)) = (HeaderName::from_bytes(k.as_bytes()), HeaderValue::from_str(v)) {
                req = req.header(name, val);
            }
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
    let mut out = s.to_string();
    for (from, to) in [
        ("&amp;", "&"),
        ("&lt;", "<"),
        ("&gt;", ">"),
        ("&quot;", "\""),
        ("&#039;", "'"),
        ("&#39;", "'"),
        ("&apos;", "'"),
        ("&nbsp;", " "),
        ("&mdash;", "\u{2014}"),
        ("&ndash;", "\u{2013}"),
        ("&hellip;", "\u{2026}"),
        ("&rsquo;", "\u{2019}"),
        ("&lsquo;", "\u{2018}"),
        ("&reg;", "\u{00ae}"),
        ("&trade;", "\u{2122}"),
        ("&copy;", "\u{00a9}"),
    ] {
        out = out.replace(from, to);
    }
    out
}

static TAG_RE: Lazy<regex::Regex> = Lazy::new(|| regex::Regex::new(r"(?s)<[^>]*>").unwrap());

pub fn strip_tags(s: &str) -> String {
    decode_entities(&TAG_RE.replace_all(s, " "))
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}
