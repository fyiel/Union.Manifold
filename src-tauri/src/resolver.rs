
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
        ",t:!!document.querySelector('iframe[src*=\"challenges.cloudflare.com\"],iframe[src*=\"turnstile\"],.cf-turnstile,#challenge-form,#challenge-error-text,.g-recaptcha'),k:(function(){var e=document.querySelector('textarea[name=cf-turnstile-response]');return e?e.value.length:0})(),g:(function(){var e=document.querySelector('.cf-turnstile');if(!e)return null;var r=e.getBoundingClientRect();return [Math.round(r.x+r.width/2),Math.round(r.y+r.height/2),Math.round(r.width),Math.round(r.height)]})(),n:(function(){var t=document.body?document.body.innerText.slice(0,6000):'';return /file not found|has been removed|no longer available|link (has )?expired|invalid file|was deleted/i.test(t)})()"
    } else {
        ""
    };
    format!(
        r#"(function(){{try{{var d={{h:location.href,r:document.readyState,c:document.cookie,u:navigator.userAgent{t_field},e:Date.now()}};document.title="{PROBE_MARK}"+btoa(unescape(encodeURIComponent(JSON.stringify(d))));}}catch(e){{}}}})()"#
    )
}

fn auto_click_js() -> String {
    r#"(function(){try{var c=document.querySelectorAll('button,a,[role=button]');for(var i=0;i<c.length;i++){var el=c[i];if(el.offsetParent===null)continue;var t=(el.textContent||'').trim().toLowerCase();if(/^(start download|download|download now|free download|generate direct link|generate link|get link|create download link)$/.test(t)){el.click();return;}}}catch(e){}})()"#
        .to_string()
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


pub async fn solve(app: &AppHandle, page_url: &str) -> Result<Solved, String> {
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

    let result = drive(app, parsed, &host).await;
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

async fn drive(app: &AppHandle, page_url: Url, host: &str) -> Result<Solved, String> {
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
    let mut interactive_since: Option<Instant> = None;
    let mut user_agent: Option<String> = None;
    let mut clearance_at: Option<Instant> = None;
    let mut last_not_found = false;
    let mut last_href: Option<String> = None;
    let mut referer_retried = false;

    fn ingest_title(
        trace: bool,
        started: Instant,
        shared: &Shared,
        user_agent: &mut Option<String>,
        interactive_since: &mut Option<Instant>,
        not_found: &mut bool,
        href: &mut Option<String>,
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
                *interactive_since = if probe.t {
                    Some(interactive_since.unwrap_or_else(Instant::now))
                } else {
                    None
                };
                *not_found = probe.n;
                *href = Some(probe.h);
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
                &mut None,
                &mut false,
                &mut None,
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

        ingest_title(
            trace,
            started,
            &shared,
            &mut user_agent,
            &mut interactive_since,
            &mut last_not_found,
            &mut last_href,
        );

        if !referer_retried {
            if let Some(href) = last_href.as_deref() {
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

        if last_not_found && clearance_at.is_none() && started.elapsed().as_millis() > 5_000 {
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
            ingest_title(
                trace,
                started,
                &shared,
                &mut user_agent,
                &mut interactive_since,
                &mut last_not_found,
                &mut last_href,
            );
        }

        let nudging = clearance_at.is_some() || escalated;
        if nudging
            && started.elapsed().as_millis() / AUTO_CLICK_INTERVAL_MS
                != started
                    .elapsed()
                    .as_millis()
                    .saturating_sub(TICK_MS as u128)
                    / AUTO_CLICK_INTERVAL_MS
        {
            let _ = window.eval(auto_click_js().as_str());
        }

        let interactive_overdue = interactive_since
            .is_some_and(|t| t.elapsed().as_millis() >= INTERACTIVE_GRACE_MS);
        let due = escalation_action(
            escalated,
            started.elapsed().as_millis(),
            interactive_since.map(|t| t.elapsed().as_millis()),
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
