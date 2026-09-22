
use std::collections::HashMap;
use std::sync::{Arc, LazyLock};
use std::time::{Duration, Instant};

use base64::Engine as _;
use parking_lot::Mutex;
use serde_json::{json, Value};
use tauri::webview::DownloadEvent;
use tauri::{AppHandle, Emitter, Manager, Url, WebviewUrl, WebviewWindowBuilder};

const WINDOW_LABEL: &str = "resolver";
const TICK_MS: u64 = 500;
const HIDDEN_BUDGET_MS: u128 = 15_000;
const INTERACTIVE_GRACE_MS: u128 = 6_000;
const OVERALL_BUDGET_MS: u128 = 150_000;
const SLOT_WAIT_MS: u128 = 120_000;
const CLEARANCE_TTL_MS: i64 = 20 * 60_000;
const PROBE_FRESHNESS_MS: i64 = 5_000;
const POST_CLEARANCE_GRACE_MS: u128 = 30_000;
const AUTO_CLICK_INTERVAL_MS: u128 = 4_000;

const PROBE_MARK: &str = "\u{200b}\u{e00d}UCR:";

#[derive(Debug, Default, Clone)]
pub struct Solved {
    pub url: Option<String>,
    pub file_name: Option<String>,
    pub cookie_header: Option<String>,
    pub user_agent: Option<String>,
}

impl Solved {
    pub fn headers(&self, referer: Option<&str>) -> HashMap<String, String> {
        let mut headers = HashMap::new();
        if let Some(ua) = &self.user_agent {
            headers.insert("User-Agent".to_string(), ua.clone());
        }
        if let Some(cookie) = &self.cookie_header {
            headers.insert("Cookie".to_string(), cookie.clone());
        }
        if let Some(referer) = referer {
            headers.insert("Referer".to_string(), referer.to_string());
        }
        headers
    }
}

#[derive(Default)]
struct Shared {
    captured: Mutex<Option<(String, Option<String>)>>,
    cancelled: Mutex<bool>,
    title: Mutex<Option<String>>,
}

impl Shared {
    fn cancel(&self) {
        *self.cancelled.lock() = true;
    }

    fn is_cancelled(&self) -> bool {
        *self.cancelled.lock()
    }

    fn take_captured(&self) -> Option<(String, Option<String>)> {
        self.captured.lock().take()
    }

    fn set_title(&self, title: String) {
        *self.title.lock() = Some(title);
    }

    fn take_title(&self) -> Option<String> {
        self.title.lock().take()
    }
}

static ACTIVE: Mutex<Option<Arc<Shared>>> = Mutex::new(None);

static HOST_SLOTS: LazyLock<Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

struct CachedClearance {
    cookie_header: String,
    user_agent: Option<String>,
    at_ms: i64,
}

static CLEARANCE_CACHE: LazyLock<Mutex<HashMap<String, CachedClearance>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

fn emit_status(app: &AppHandle, state: &str, host: &str, reason: Option<&str>) {
    app.emit(
        "uc:resolver-status",
        json!({ "state": state, "host": host, "reason": reason }),
    )
    .ok();
}

pub fn cached_clearance(host: &str) -> Option<(String, Option<String>)> {
    let cache = CLEARANCE_CACHE.lock();
    let entry = cache.get(host)?;
    if now_ms() - entry.at_ms > CLEARANCE_TTL_MS {
        return None;
    }
    Some((entry.cookie_header.clone(), entry.user_agent.clone()))
}

fn cache_clearance(host: &str, cookie_header: String, user_agent: Option<String>) {
    CLEARANCE_CACHE.lock().insert(
        host.to_string(),
        CachedClearance {
            cookie_header,
            user_agent,
            at_ms: now_ms(),
        },
    );
}

pub fn request_cancel(app: &AppHandle) {
    if let Some(shared) = ACTIVE.lock().clone() {
        shared.cancel();
    }
    if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
        window.destroy().ok();
    }
}

pub fn note_window_closed() {
    if let Some(shared) = ACTIVE.lock().clone() {
        shared.cancel();
    }
}


fn probe_js() -> String {
    probe_js_with(true)
}

fn probe_js_with(with_t: bool) -> String {
    let t_field = if with_t {
        ",t:!!document.querySelector('iframe[src*=\"challenges.cloudflare.com\"],iframe[src*=\"turnstile\"],.cf-turnstile,#challenge-form,#challenge-error-text,.g-recaptcha'),k:(function(){var e=document.querySelector('textarea[name=cf-turnstile-response]');return e?e.value.length:0})(),g:(function(){var e=document.querySelector('.cf-turnstile');if(!e)return null;var r=e.getBoundingClientRect();return [Math.round(r.x+r.width/2),Math.round(r.y+r.height/2),Math.round(r.width),Math.round(r.height)]})(),n:(function(){var t=document.body?document.body.innerText.slice(0,6000):'';return /file not found|has been removed|no longer available|link (has )?expired|invalid file|was deleted/i.test(t)})(),tok:(function(){var m=window.__ucKryoMint;return (m&&typeof m.token==='string')?m.token:''})(),key:(function(){var m=window.__ucKryoMint;return (m&&typeof m.key==='string')?m.key:''})()"
    } else {
        ""
    };
    format!(
        r#"(function(){{try{{var d={{h:location.href,r:document.readyState,c:document.cookie,u:navigator.userAgent{t_field},e:Date.now()}};document.title="{PROBE_MARK}"+btoa(unescape(encodeURIComponent(JSON.stringify(d))));}}catch(e){{}}}})()"#
    )
}

static AUTO_CLICK_LABEL_RE: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(
        r"^(?:continue to download|start download|download|download now|free download|generate direct link|generate link|get link|create download link|download\b.*)$",
    )
    .unwrap()
});

static AUTO_CLICK_LABEL_SKIP_RE: LazyLock<regex::Regex> =
    LazyLock::new(|| regex::Regex::new(r"^download the app\b").unwrap());

#[cfg(test)]
fn is_auto_click_label(text: &str) -> bool {
    let label = text.trim().to_lowercase();
    AUTO_CLICK_LABEL_RE.is_match(&label) && !AUTO_CLICK_LABEL_SKIP_RE.is_match(&label)
}

fn auto_click_js() -> String {
    // Mirrors is_auto_click_label: positive label rule, minus the skip rule.
    let label = serde_json::to_string(AUTO_CLICK_LABEL_RE.as_str()).unwrap_or_default();
    let skip = serde_json::to_string(AUTO_CLICK_LABEL_SKIP_RE.as_str()).unwrap_or_default();
    format!(
        r#"(function(){{try{{var ok=new RegExp({label}),no=new RegExp({skip});var c=document.querySelectorAll('button,a,[role=button]');for(var i=0;i<c.length;i++){{var el=c[i];if(el.offsetParent===null||el.disabled)continue;var t=(el.textContent||'').trim().toLowerCase();if(ok.test(t)&&!no.test(t)){{el.click();return;}}}}}}catch(e){{}}}})()"#
    )
}

#[derive(Debug, Clone, Default, serde::Deserialize, PartialEq, serde::Serialize)]
struct Probe {
    #[serde(default)]
    h: String,
    #[serde(default)]
    r: String,
    #[serde(default)]
    c: String,
    #[serde(default)]
    u: String,
    #[serde(default)]
    t: bool,
    #[serde(default)]
    n: bool,
    #[serde(default)]
    k: u64,
    #[serde(default)]
    g: Option<Vec<i64>>,
    /// Turnstile token the kryo mint published, if there is one.
    #[serde(default)]
    tok: String,
    /// Link key that token was minted for.
    #[serde(default)]
    key: String,
    #[serde(default)]
    e: i64,
}

fn decode_probe(title: &str) -> Option<Probe> {
    let encoded = title.strip_prefix(PROBE_MARK)?.trim();
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(encoded.as_bytes())
        .ok()?;
    serde_json::from_slice(&bytes).ok()
}

fn probe_fresh(probe: &Probe) -> bool {
    probe.e > 0 && now_ms() - probe.e <= PROBE_FRESHNESS_MS
}


static FILE_EXT_RE: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(r"(?i)\.(zip|rar|7z|001|iso|exe|bin|tar|gz|xz|zst|apk)([?#]|$)").unwrap()
});

static PAGE_HINT_RE: LazyLock<regex::Regex> =
    LazyLock::new(|| regex::Regex::new(r"(?i)\.(html?|php|aspx?|jsp)([?#]|$)").unwrap());

fn looks_like_direct_file(url: &str) -> bool {
    let path = url.split(['?', '#']).next().unwrap_or(url);
    FILE_EXT_RE.is_match(path) && !PAGE_HINT_RE.is_match(path)
}

fn file_name_from_url(url: &str) -> Option<String> {
    let parsed = url::Url::parse(url).ok()?;
    let segment = parsed.path_segments()?.rfind(|s| !s.is_empty())?;
    let decoded = percent_encoding::percent_decode_str(segment)
        .decode_utf8_lossy()
        .to_string();
    (!decoded.is_empty()).then_some(decoded)
}

fn cookie_header_from(cookies: &[tauri::webview::Cookie<'static>]) -> Option<String> {
    if cookies.is_empty() {
        return None;
    }
    let header = cookies
        .iter()
        .map(|c| format!("{}={}", c.name(), c.value()))
        .collect::<Vec<_>>()
        .join("; ");
    (!header.is_empty()).then_some(header)
}

fn clearance_cookie(cookies: &[tauri::webview::Cookie<'static>]) -> bool {
    cookies.iter().any(|c| c.name() == "cf_clearance")
}


#[derive(Debug, PartialEq, Eq)]
pub enum Escalation {
    StayHidden,
    Show,
}

pub fn escalation_action(
    escalated: bool,
    elapsed_ms: u128,
    interactive_for_ms: Option<u128>,
) -> Escalation {
    if escalated {
        return Escalation::StayHidden;
    }
    let due = match interactive_for_ms {
        Some(ms) => ms >= INTERACTIVE_GRACE_MS,
        None => elapsed_ms >= HIDDEN_BUDGET_MS,
    };
    if due {
        Escalation::Show
    } else {
        Escalation::StayHidden
    }
}


/// Cloudflare Turnstile sitekey the kryo.to fileyard mints links with, and the
/// endpoint that trades a token for a signed URL.
const KRYO_SITEKEY: &str = "0x4AAAAAAEvSoubw7GSa0IWS";
const KRYO_RESOLVE_URL: &str = "https://dl.kryo.to/api/resolve";
const KRYO_LINK_PREFIX: &str = "https://dl.kryo.to/";
const KRYO_TURNSTILE_SCRIPT: &str =
    "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const KRYO_MINT_ATTEMPTS: u32 = 3;
const KRYO_TOKEN_TIMEOUT_MS: u64 = 20_000;
const KRYO_SCRIPT_WAIT_MS: u64 = 10_000;
const KRYO_RESOLVE_TIMEOUT_SECS: u64 = 30;

/// `encodeURIComponent`'s escape set, so the fileyard reads the key out of the
/// query exactly as it does for its own page.
const KRYO_KEY_ENCODE: &percent_encoding::AsciiSet = &percent_encoding::NON_ALPHANUMERIC
    .remove(b'-')
    .remove(b'_')
    .remove(b'.')
    .remove(b'!')
    .remove(b'~')
    .remove(b'*')
    .remove(b'\'')
    .remove(b'(')
    .remove(b')');

/// Script that mints the signed `dl.kryo.to` link from inside the page context.
///
/// Turnstile only issues a token to a real page, so the token is minted here:
/// the link key comes from the target fragment when we already know it,
/// otherwise from the game's own API payload, and the pair is published on
/// `window.__ucKryoMint` for the app to pick up through the probe channel. The
/// page cannot trade the token for the signed URL itself — every cross-origin
/// POST to `dl.kryo.to` fails its preflight — so the app makes that request.
///
/// Runs at most once per page (page-side flag) and up to `KRYO_MINT_ATTEMPTS`
/// times; when every attempt fails the page is left alone so the existing
/// escalation can surface it for a human click.
const KRYO_MINT_TEMPLATE: &str = r##"(function(){
if (window.__ucKryoMintRun) return;
window.__ucKryoMintRun = true;
var SITEKEY = "__SITEKEY__";
var LINK = "__LINK__";
var TS_SCRIPT = "__TURNSTILE_SCRIPT__";
var MAX = __MAX__;
var TOKEN_TIMEOUT = __TOKEN_TIMEOUT__;
var SCRIPT_WAIT = __SCRIPT_WAIT__;
var tries = 0;
function resolveKey(cb){__KEY_BODY__}
function loadTurnstile(cb){
  if (window.turnstile && window.turnstile.render) { cb(); return; }
  if (!document.getElementById('uc-kryo-ts')) {
    var s = document.createElement('script');
    s.id = 'uc-kryo-ts';
    s.async = true;
    s.src = TS_SCRIPT;
    (document.head || document.documentElement).appendChild(s);
  }
  var waited = 0;
  var timer = setInterval(function(){
    waited += 250;
    if (window.turnstile && window.turnstile.render) { clearInterval(timer); cb(); }
    else if (waited >= SCRIPT_WAIT) { clearInterval(timer); cb(); }
  }, 250);
}
function mintToken(cb){
  var stale = document.getElementById('uc-kryo-slot');
  if (stale && stale.parentNode) stale.parentNode.removeChild(stale);
  var slot = document.createElement('div');
  slot.id = 'uc-kryo-slot';
  slot.style.display = 'none';
  (document.body || document.documentElement).appendChild(slot);
  var settled = false;
  var timer = setTimeout(function(){ done(null); }, TOKEN_TIMEOUT);
  function done(token){ if (settled) return; settled = true; clearTimeout(timer); cb(token || null); }
  try {
    var id = window.turnstile.render(slot, {
      sitekey: SITEKEY,
      size: 'invisible',
      appearance: 'interaction-only',
      retry: 'never',
      callback: function(token){ done(token); },
      'error-callback': function(){ done(null); },
      'timeout-callback': function(){ done(null); }
    });
    window.turnstile.execute(id);
  } catch (e) { done(null); }
}
function publish(key, token){
  window.__ucKryoMint = { token: token, key: key };
}
function retry(){ if (tries < MAX) setTimeout(attempt, 500); }
function attempt(){
  tries++;
  resolveKey(function(key){
    if (!key) { retry(); return; }
    loadTurnstile(function(){
      if (!(window.turnstile && window.turnstile.render)) { retry(); return; }
      mintToken(function(token){
        if (!token) { retry(); return; }
        publish(key, token);
      });
    });
  });
}
setTimeout(attempt, 400);
})()"##;

/// Key lookup used when the adapter gave no `dl.kryo.to` link: read the game's
/// own API payload and take the first fileyard link's fragment.
const KRYO_API_KEY_BODY: &str = r##"fetch('/api/games/' + __SLUG__, { headers: { accept: 'application/json' } })
    .then(function(r){ return r.json(); })
    .then(function(d){
      var hits = [];
      (function walk(o){
        if (!o || typeof o !== 'object') return;
        if (Object.prototype.toString.call(o) === '[object Array]') {
          for (var i = 0; i < o.length; i++) walk(o[i]);
          return;
        }
        if (typeof o.url === 'string' && (o.host === 'Kryo' || o.url.indexOf(LINK) === 0)) hits.push(o.url);
        for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) walk(o[k]);
      })(d);
      for (var i = 0; i < hits.length; i++) {
        var hash = '';
        try { hash = new URL(hits[i]).hash || ''; }
        catch (e) { var parts = hits[i].split('#'); hash = parts.length > 1 ? '#' + parts[1] : ''; }
        var key = hash.replace(/^#/, '');
        if (key) { cb(key); return; }
      }
      cb(null);
    })
    .catch(function(){ cb(null); });"##;

#[derive(Debug, PartialEq, Eq)]
enum KryoKey {
    /// Fragment of the `dl.kryo.to` link the adapter already knows.
    Target(String),
    /// Game slug whose `/api/games/<slug>` payload names the key.
    Slug(String),
}

fn is_kryo_page_host(host: &str) -> bool {
    let host = host.trim().trim_end_matches('.').to_ascii_lowercase();
    host.strip_prefix("www.").unwrap_or(host.as_str()) == "kryo.to"
}

/// Link key carried by a `https://dl.kryo.to/#lt/…` target, when there is one.
fn kryo_key_from_target(target: &str) -> Option<String> {
    let parsed = url::Url::parse(target.trim()).ok()?;
    if !parsed.host_str()?.eq_ignore_ascii_case("dl.kryo.to") {
        return None;
    }
    let key = percent_encoding::percent_decode_str(parsed.fragment()?)
        .decode_utf8_lossy()
        .trim()
        .to_string();
    (!key.is_empty()).then_some(key)
}

/// Game slug of `https://kryo.to/game/<slug>`.
fn kryo_slug(path: &str) -> Option<String> {
    let mut segments = path.split('/').filter(|s| !s.is_empty());
    if !segments.next()?.eq_ignore_ascii_case("game") {
        return None;
    }
    let slug = percent_encoding::percent_decode_str(segments.next()?)
        .decode_utf8_lossy()
        .to_string();
    (!slug.is_empty()).then_some(slug)
}

/// Where the mint should get its link key from, on the fileyard's game page.
fn kryo_key_source(page_host: &str, page_path: &str, target: Option<&str>) -> Option<KryoKey> {
    if !is_kryo_page_host(page_host) {
        return None;
    }
    if let Some(key) = target.and_then(kryo_key_from_target) {
        return Some(KryoKey::Target(key));
    }
    kryo_slug(page_path).map(KryoKey::Slug)
}

fn js_string_literal(value: &str) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "\"\"".to_string())
}

fn kryo_mint_js(source: &KryoKey) -> String {
    let key_body = match source {
        KryoKey::Target(key) => format!("cb({});", js_string_literal(key)),
        KryoKey::Slug(slug) => KRYO_API_KEY_BODY.replace("__SLUG__", &js_string_literal(slug)),
    };
    KRYO_MINT_TEMPLATE
        .replace("__SITEKEY__", KRYO_SITEKEY)
        .replace("__LINK__", KRYO_LINK_PREFIX)
        .replace("__TURNSTILE_SCRIPT__", KRYO_TURNSTILE_SCRIPT)
        .replace("__MAX__", &KRYO_MINT_ATTEMPTS.to_string())
        .replace("__TOKEN_TIMEOUT__", &KRYO_TOKEN_TIMEOUT_MS.to_string())
        .replace("__SCRIPT_WAIT__", &KRYO_SCRIPT_WAIT_MS.to_string())
        .replace("__KEY_BODY__", &key_body)
}

/// Signed URL carried by a `/api/resolve` body: errors and malformed bodies
/// carry none.
fn kryo_resolve_url(body: &str) -> Option<String> {
    let parsed: Value = serde_json::from_str(body).ok()?;
    let url = parsed.get("url")?.as_str()?.trim();
    if url.is_empty() {
        None
    } else {
        Some(url.to_string())
    }
}

/// Trade the page-minted Turnstile token for the signed `dl.kryo.to` URL.
///
/// The page cannot do this itself: every cross-origin POST to `dl.kryo.to`
/// fails its preflight, so the request is made here instead. The token is
/// single-use and domain-bound to the page, not to the caller, so a plain HTTP
/// client redeems it fine.
async fn kryo_post_resolve(key: &str, token: &str) -> Option<String> {
    let url = format!(
        "{KRYO_RESOLVE_URL}?key={}",
        percent_encoding::utf8_percent_encode(key, KRYO_KEY_ENCODE)
    );
    let mut headers = HashMap::new();
    headers.insert("Content-Type".to_string(), "application/json".to_string());
    let body = serde_json::to_vec(&json!({ "turnstileToken": token })).ok()?;
    let resp = crate::http::fetch(
        &url,
        &crate::http::FetchOpts {
            method: Some("POST".to_string()),
            headers,
            body: Some(body),
            retries: Some(0),
            timeout: Some(Duration::from_secs(KRYO_RESOLVE_TIMEOUT_SECS)),
            ..Default::default()
        },
    )
    .await
    .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    kryo_resolve_url(&resp.text().await.ok()?)
}

pub async fn solve(app: &AppHandle, page_url: &str) -> Result<Solved, String> {
    solve_target(app, page_url, None).await
}

/// Solve `page_url`, using `target` (the option's own link) for hosts whose
/// signed URL can only be minted from a fragment or API payload already known.
pub async fn solve_target(
    app: &AppHandle,
    page_url: &str,
    target: Option<&str>,
) -> Result<Solved, String> {
    let (parsed, host) = parse_solve_url(page_url)?;

    if let Some((cookie_header, user_agent)) = cached_clearance(&host) {
        return Ok(Solved {
            cookie_header: Some(cookie_header),
            user_agent,
            ..Default::default()
        });
    }

    let slot = acquire_slot(&host).await?;

    if let Some((cookie_header, user_agent)) = cached_clearance(&host) {
        drop(slot);
        return Ok(Solved {
            cookie_header: Some(cookie_header),
            user_agent,
            ..Default::default()
        });
    }

    let result = drive(app, parsed, &host, target).await;
    drop(slot);
    result
}

fn parse_solve_url(page_url: &str) -> Result<(Url, String), String> {
    let parsed: Url = page_url
        .parse()
        .map_err(|_| "solver: invalid url".to_string())?;
    if parsed.scheme() != "https" && parsed.scheme() != "http" {
        return Err("solver: only http(s) urls can be solved".to_string());
    }
    let host = parsed
        .host_str()
        .map(|h| h.to_lowercase())
        .ok_or_else(|| "solver: url has no host".to_string())?;
    Ok((parsed, host))
}

async fn acquire_slot(host: &str) -> Result<tokio::sync::OwnedMutexGuard<()>, String> {
    let slot = HOST_SLOTS
        .lock()
        .entry(host.to_string())
        .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
        .clone();
    match tokio::time::timeout(
        Duration::from_millis(SLOT_WAIT_MS as u64),
        slot.clone().lock_owned(),
    )
    .await
    {
        Ok(guard) => Ok(guard),
        Err(_) => Err("another verification is still running".to_string()),
    }
}

async fn drive(
    app: &AppHandle,
    page_url: Url,
    host: &str,
    target: Option<&str>,
) -> Result<Solved, String> {
    let kryo_page = is_kryo_page_host(host);
    let mint = target
        .and_then(|target| kryo_key_source(host, page_url.path(), Some(target)))
        .map(|source| kryo_mint_js(&source));
    let trace = std::env::var("UNION_SOLVER_TRACE").is_ok();
    let start_visible = std::env::var("UNION_SOLVER_VISIBLE").is_ok();
    if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
        window.destroy().ok();
        for _ in 0..100 {
            if app.get_webview_window(WINDOW_LABEL).is_none() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    }

    let shared = Arc::new(Shared::default());
    *ACTIVE.lock() = Some(shared.clone());
    if trace {
        println!("SOLVER_TRACE session start url={page_url}");
    }
    emit_status(app, "solving", host, None);

    let capture_shared = shared.clone();
    let nav_shared = shared.clone();
    let title_shared = shared.clone();
    let nav_page_url = page_url.to_string();
    let builder =
        WebviewWindowBuilder::new(app, WINDOW_LABEL, WebviewUrl::External(page_url.clone()))
            .title("Union.Manifold — security check")
            .inner_size(920.0, 720.0)
            .min_inner_size(420.0, 320.0)
            .resizable(true)
            .center()
            .visible(start_visible)
            .focused(false)
            .decorations(true)
            .on_document_title_changed(move |_webview, title| {
                title_shared.set_title(title);
            })
            .on_download(move |_webview, event| {
                if let DownloadEvent::Requested { url, destination } = event {
                    let name = destination
                        .file_name()
                        .map(|s| s.to_string_lossy().to_string())
                        .filter(|s| !s.is_empty());
                    *capture_shared.captured.lock() = Some((url.to_string(), name));
                }
                false
            })
            .on_navigation(move |url| {
                if url.as_str().trim_end_matches('/') == nav_page_url.trim_end_matches('/') {
                    return true;
                }
                if looks_like_direct_file(url.as_str()) {
                    let name = file_name_from_url(url.as_str());
                    *nav_shared.captured.lock() = Some((url.to_string(), name));
                    return false;
                }
                true
            })
            .initialization_script(probe_js_with(false));

    #[cfg(windows)]
    let builder = builder.additional_browser_args(
        "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,CalculateNativeWinOcclusion",
    );

    let window = match builder.build() {
        Ok(window) => window,
        Err(e) => {
            *ACTIVE.lock() = None;
            emit_status(
                app,
                "failed",
                host,
                Some("could not open the solver window"),
            );
            return Err(format!("solver window failed: {e}"));
        }
    };

    let started = Instant::now();
    let mut escalated = false;
    let mut user_agent: Option<String> = None;
    let mut clearance_at: Option<Instant> = None;
    let mut page = PageState::default();
    let mut referer_retried = false;
    let mut mint_injected = false;
    let mut kryo_posted = false;

    #[derive(Default)]
    struct PageState {
        interactive_since: Option<Instant>,
        not_found: bool,
        href: Option<String>,
        ready: bool,
        /// Turnstile token the page minted, with the key it was minted for.
        token: Option<String>,
        key: Option<String>,
    }

    fn ingest_title(
        trace: bool,
        started: Instant,
        shared: &Shared,
        user_agent: &mut Option<String>,
        page: &mut PageState,
    ) {
        if let Some(title) = shared.take_title() {
            if let Some(probe) = decode_probe(&title).filter(probe_fresh) {
                if trace {
                    println!(
                        "SOLVER_TRACE +{}ms href={} ready={} interactive={} token={} box={:?}",
                        started.elapsed().as_millis(),
                        probe.h,
                        probe.r,
                        probe.t,
                        probe.k,
                        probe.g
                    );
                }
                if !probe.u.is_empty() && user_agent.is_none() {
                    *user_agent = Some(probe.u);
                }
                page.interactive_since = if probe.t {
                    Some(page.interactive_since.unwrap_or_else(Instant::now))
                } else {
                    None
                };
                page.not_found = probe.n;
                page.href = Some(probe.h);
                page.ready = probe.r == "complete";
                page.token = (!probe.tok.is_empty()).then_some(probe.tok);
                page.key = (!probe.key.is_empty()).then_some(probe.key);
            }
        }
    }

    async fn grab_user_agent(
        window: &tauri::WebviewWindow,
        shared: &Shared,
        user_agent: &mut Option<String>,
    ) {
        if user_agent.is_some() {
            return;
        }
        for _ in 0..4 {
            let _ = window.eval(probe_js().as_str());
            tokio::time::sleep(Duration::from_millis(300)).await;
            ingest_title(
                false,
                Instant::now(),
                shared,
                user_agent,
                &mut PageState::default(),
            );
            if user_agent.is_some() {
                return;
            }
        }
    }

    let outcome = loop {
        tokio::time::sleep(Duration::from_millis(TICK_MS)).await;

        if shared.is_cancelled() {
            break Err("cancelled".to_string());
        }
        if app.get_webview_window(WINDOW_LABEL).is_none() {
            shared.cancel();
            break Err("cancelled".to_string());
        }

        ingest_title(trace, started, &shared, &mut user_agent, &mut page);

        if !referer_retried {
            if let Some(href) = page.href.as_deref() {
                if href.contains("/error?e=Referrer") {
                    referer_retried = true;
                    if trace {
                        println!(
                            "SOLVER_TRACE +{}ms referer wall detected; same-origin re-navigation",
                            started.elapsed().as_millis()
                        );
                    }
                    let js = format!(
                        "location.assign({})",
                        serde_json::to_string(page_url.as_str()).unwrap_or_default()
                    );
                    window.eval(&js).ok();
                }
            }
        }

        if page.not_found && clearance_at.is_none() && started.elapsed().as_millis() > 5_000 {
            break Err("link appears dead or expired".to_string());
        }

        if let Some((url, name)) = shared.take_captured() {
            if trace {
                println!(
                    "SOLVER_TRACE +{}ms captured {url}",
                    started.elapsed().as_millis()
                );
            }
            grab_user_agent(&window, &shared, &mut user_agent).await;
            let cookies = window
                .cookies_for_url(page_url.clone())
                .ok()
                .unwrap_or_default();
            let cookie_header = cookie_header_from(&cookies);
            if let Some(header) = &cookie_header {
                cache_clearance(host, header.clone(), user_agent.clone());
            }
            break Ok(Solved {
                url: Some(url),
                file_name: name,
                cookie_header,
                user_agent,
            });
        }

        let cookies = window
            .cookies_for_url(page_url.clone())
            .ok()
            .unwrap_or_default();
        if clearance_cookie(&cookies) {
            match clearance_at {
                None => {
                    if trace {
                        println!(
                            "SOLVER_TRACE +{}ms clearance present; grace {}ms",
                            started.elapsed().as_millis(),
                            POST_CLEARANCE_GRACE_MS
                        );
                    }
                    clearance_at = Some(Instant::now())
                }
                Some(at) => {
                    if at.elapsed().as_millis() >= POST_CLEARANCE_GRACE_MS {
                        grab_user_agent(&window, &shared, &mut user_agent).await;
                        let cookie_header = cookie_header_from(&cookies);
                        if let Some(header) = &cookie_header {
                            cache_clearance(host, header.clone(), user_agent.clone());
                        }
                        break Ok(Solved {
                            cookie_header,
                            user_agent,
                            ..Default::default()
                        });
                    }
                }
            }
        }

        if started.elapsed().as_millis() >= OVERALL_BUDGET_MS {
            break Err("verification did not complete in time".to_string());
        }

        if window.eval(probe_js().as_str()).is_ok() {
            tokio::time::sleep(Duration::from_millis(TICK_MS / 2)).await;
            ingest_title(trace, started, &shared, &mut user_agent, &mut page);
        }

        // The page mints the Turnstile token but cannot redeem it: every
        // cross-origin POST to `dl.kryo.to` fails its preflight, so the trade
        // happens here. A failed trade is not worth retrying — the token is
        // single use — so the loop carries on and lets the escalation surface
        // the page for a human click.
        if kryo_page && !kryo_posted {
            if let (Some(key), Some(token)) = (page.key.clone(), page.token.clone()) {
                kryo_posted = true;
                if trace {
                    println!(
                        "SOLVER_TRACE +{}ms kryo resolve key={key}",
                        started.elapsed().as_millis()
                    );
                }
                if let Some(url) = kryo_post_resolve(&key, &token).await {
                    grab_user_agent(&window, &shared, &mut user_agent).await;
                    let cookies = window
                        .cookies_for_url(page_url.clone())
                        .ok()
                        .unwrap_or_default();
                    let cookie_header = cookie_header_from(&cookies);
                    if let Some(header) = &cookie_header {
                        cache_clearance(host, header.clone(), user_agent.clone());
                    }
                    break Ok(Solved {
                        url: Some(url),
                        cookie_header,
                        user_agent,
                        ..Default::default()
                    });
                }
            }
        }

        if let Some(js) = mint.as_deref() {
            if !mint_injected && page.href.is_some() {
                mint_injected = true;
                if trace {
                    println!(
                        "SOLVER_TRACE +{}ms kryo mint injected",
                        started.elapsed().as_millis()
                    );
                }
                window.eval(js).ok();
            }
        }

        if !kryo_page
            && page.ready
            && started.elapsed().as_millis() / AUTO_CLICK_INTERVAL_MS
                != started
                    .elapsed()
                    .as_millis()
                    .saturating_sub(TICK_MS as u128)
                    / AUTO_CLICK_INTERVAL_MS
        {
            let _ = window.eval(auto_click_js().as_str());
        }

        let interactive_overdue = page
            .interactive_since
            .is_some_and(|t| t.elapsed().as_millis() >= INTERACTIVE_GRACE_MS);
        let due = escalation_action(
            escalated,
            started.elapsed().as_millis(),
            page.interactive_since.map(|t| t.elapsed().as_millis()),
        ) == Escalation::Show;
        if due && (clearance_at.is_none() || interactive_overdue) {
            window.show().ok();
            window.set_focus().ok();
            escalated = true;
            emit_status(app, "interactive", host, None);
        }
    };

    window.destroy().ok();
    *ACTIVE.lock() = None;

    match &outcome {
        Ok(solved) => {
            let state = if solved.url.is_some() {
                "captured"
            } else {
                "cleared"
            };
            emit_status(app, state, host, None);
        }
        Err(reason) => {
            let state = if reason == "cancelled" {
                "cancelled"
            } else {
                "failed"
            };
            emit_status(app, state, host, Some(reason));
        }
    }

    outcome
}


#[tauri::command]
pub async fn resolver_solve_start(app: AppHandle, url: String) -> Value {
    match solve(&app, &url).await {
        Ok(solved) => json!({
            "ok": true,
            "url": solved.url,
            "fileName": solved.file_name,
            "headers": solved.headers(None),
        }),
        Err(e) => json!({ "ok": false, "error": e }),
    }
}

#[tauri::command]
pub async fn resolver_solve_cancel(app: AppHandle) -> Value {
    request_cancel(&app);
    json!({ "ok": true })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn auto_click_matches_download_controls_only() {
        assert!(is_auto_click_label("Download · 19.7 GBFirst press is an ad!"));
        assert!(is_auto_click_label("Download"));
        assert!(!is_auto_click_label("VikingFile Mirror"));
        assert!(!is_auto_click_label("Pixeldrain Mirror"));
        assert!(!is_auto_click_label("Download the app"));
    }

    #[test]
    fn kryo_page_host_check_accepts_only_the_game_site() {
        assert!(is_kryo_page_host("kryo.to"));
        assert!(is_kryo_page_host("www.kryo.to"));
        assert!(is_kryo_page_host("KRYO.TO."));
        assert!(!is_kryo_page_host("dl.kryo.to"));
        assert!(!is_kryo_page_host("kryo.to.evil.com"));
        assert!(!is_kryo_page_host(""));
    }

    #[test]
    fn kryo_slug_comes_from_the_game_path() {
        assert_eq!(
            kryo_slug("/game/persona-3-reload").as_deref(),
            Some("persona-3-reload")
        );
        assert_eq!(kryo_slug("/game/"), None);
        assert_eq!(kryo_slug("/"), None);
        assert_eq!(kryo_slug("/browse/persona-3-reload"), None);
    }

    #[test]
    fn kryo_target_fragment_supplies_the_link_key() {
        assert_eq!(
            kryo_key_from_target("https://dl.kryo.to/#lt/ltZ3hyxD1BN6Wet2.7z").as_deref(),
            Some("lt/ltZ3hyxD1BN6Wet2.7z")
        );
        assert_eq!(kryo_key_from_target("https://dl.kryo.to/"), None);
        assert_eq!(
            kryo_key_from_target("https://kryo.to/game/foo#lt/abc.7z"),
            None
        );
        assert_eq!(kryo_key_from_target("not a url"), None);
    }

    #[test]
    fn kryo_key_source_prefers_the_target_and_falls_back_to_the_games_api() {
        assert_eq!(
            kryo_key_source(
                "kryo.to",
                "/game/persona-3-reload",
                Some("https://dl.kryo.to/#lt/ltZ3hyxD1BN6Wet2.7z")
            ),
            Some(KryoKey::Target("lt/ltZ3hyxD1BN6Wet2.7z".to_string()))
        );
        // A `dl.kryo.to` target with no fragment carries no key: the page's own
        // game API names it instead.
        assert_eq!(
            kryo_key_source(
                "www.kryo.to",
                "/game/persona-3-reload",
                Some("https://dl.kryo.to/")
            ),
            Some(KryoKey::Slug("persona-3-reload".to_string()))
        );
        assert_eq!(
            kryo_key_source("kryo.to", "/game/persona-3-reload", None),
            Some(KryoKey::Slug("persona-3-reload".to_string()))
        );
        // Any other page host keeps the generic solver behaviour.
        assert_eq!(
            kryo_key_source("dl.kryo.to", "/", Some("https://dl.kryo.to/#lt/abc.7z")),
            None
        );
    }

    #[test]
    fn kryo_mint_js_embeds_each_site_parameter_once() {
        let js = kryo_mint_js(&KryoKey::Slug("persona-3-reload".to_string()));
        assert_eq!(js.matches(KRYO_SITEKEY).count(), 1);
        assert_eq!(js.matches(KRYO_TURNSTILE_SCRIPT).count(), 1);
        assert!(js.contains(r#"fetch('/api/games/' + "persona-3-reload""#));

        let js = kryo_mint_js(&KryoKey::Target("lt/ltZ3hyxD1BN6Wet2.7z".to_string()));
        assert!(js.contains(r#"cb("lt/ltZ3hyxD1BN6Wet2.7z")"#));
        assert_eq!(js.matches(KRYO_SITEKEY).count(), 1);
    }

    #[test]
    fn kryo_mint_js_publishes_the_pair_instead_of_calling_the_fileyard() {
        let js = kryo_mint_js(&KryoKey::Target("lt/ltZ3hyxD1BN6Wet2.7z".to_string()));
        // The page must not call the fileyard: the token reaches `dl.kryo.to`
        // from a Rust POST, because the page's own cross-origin request fails.
        assert!(!js.contains(KRYO_RESOLVE_URL));
        assert!(!js.contains("window.location"));
        assert!(js.contains("window.__ucKryoMint = { token: token, key: key }"));
    }

    #[test]
    fn kryo_resolve_body_yields_the_signed_url_only_when_it_has_one() {
        assert_eq!(
            kryo_resolve_url(r#"{"url":"https://dl.kryo.to/d/x"}"#).as_deref(),
            Some("https://dl.kryo.to/d/x")
        );
        assert_eq!(kryo_resolve_url(r#"{"error":"unauthorized"}"#), None);
        assert_eq!(kryo_resolve_url("<html>bad gateway</html>"), None);
        assert_eq!(kryo_resolve_url(r#"{"url":""}"#), None);
    }
}
