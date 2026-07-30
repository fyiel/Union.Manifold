use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use parking_lot::Mutex;
use tauri::webview::{DownloadEvent, NewWindowResponse};
use tauri::{AppHandle, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tokio::sync::oneshot;

use crate::sources::ResolveResult;

static WINDOW_ID: AtomicU64 = AtomicU64::new(0);
const VERIFY_TIMEOUT: Duration = Duration::from_secs(10 * 60);

pub fn matches(url: &str) -> bool {
    super::datanodes::matches(url) || super::datavaults::matches(url) || super::gate::matches(url)
}

pub async fn resolve(app: &AppHandle, page_url: &str, file_name: Option<String>) -> ResolveResult {
    let Ok(url) = page_url.parse() else {
        return unavailable(page_url, "invalid verification URL");
    };

    let label = format!(
        "download-verification-{}",
        WINDOW_ID.fetch_add(1, Ordering::Relaxed)
    );
    let (tx, rx) = oneshot::channel();
    let sender = Arc::new(Mutex::new(Some(tx)));
    let download_sender = Arc::clone(&sender);

    let window = match WebviewWindowBuilder::new(app, &label, WebviewUrl::External(url))
        .title("Complete download verification")
        .inner_size(1000.0, 760.0)
        .min_inner_size(640.0, 480.0)
        .center()
        .focused(true)
        .user_agent(crate::http::UA)
        .on_new_window(|_, _| NewWindowResponse::Deny)
        .on_download(move |_webview, event| match event {
            DownloadEvent::Requested { url, .. } if matches!(url.scheme(), "http" | "https") => {
                if let Some(sender) = download_sender.lock().take() {
                    let _ = sender.send(Some(url.to_string()));
                }
                false
            }
            _ => true,
        })
        .build()
    {
        Ok(window) => window,
        Err(error) => {
            return unavailable(
                page_url,
                &format!("could not open download verification: {error}"),
            )
        }
    };

    let close_sender = Arc::clone(&sender);
    window.on_window_event(move |event| {
        if matches!(
            event,
            WindowEvent::CloseRequested { .. } | WindowEvent::Destroyed
        ) {
            if let Some(sender) = close_sender.lock().take() {
                let _ = sender.send(None);
            }
        }
    });

    let captured = tokio::time::timeout(VERIFY_TIMEOUT, rx).await;
    let cookies = match &captured {
        Ok(Ok(Some(url))) => url
            .parse()
            .ok()
            .and_then(|url| window.cookies_for_url(url).ok())
            .unwrap_or_default()
            .into_iter()
            .map(|cookie| format!("{}={}", cookie.name(), cookie.value()))
            .collect::<Vec<_>>()
            .join("; "),
        _ => String::new(),
    };
    let _ = window.close();

    match captured {
        Ok(Ok(Some(url))) => {
            let mut headers = HashMap::from([
                ("User-Agent".to_string(), crate::http::UA.to_string()),
                ("Referer".to_string(), page_url.to_string()),
            ]);
            if !cookies.is_empty() {
                headers.insert("Cookie".to_string(), cookies);
            }
            ResolveResult {
                resolvable: true,
                url: Some(url),
                file_name,
                headers: Some(headers),
                ephemeral: true,
                ..Default::default()
            }
        }
        Ok(Ok(None)) => cancelled("download verification cancelled"),
        Ok(Err(_)) => cancelled("download verification closed"),
        Err(_) => cancelled("download verification timed out"),
    }
}

fn cancelled(reason: &str) -> ResolveResult {
    ResolveResult {
        resolvable: false,
        cancelled: true,
        reason: Some(reason.to_string()),
        ..Default::default()
    }
}

fn unavailable(url: &str, reason: &str) -> ResolveResult {
    ResolveResult {
        resolvable: false,
        open_url: Some(url.to_string()),
        reason: Some(reason.to_string()),
        ..Default::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_interactive_hosts() {
        assert!(matches("https://datanodes.to/abc123"));
        assert!(matches("https://datavaults.co/abc/game.rar"));
        assert!(matches("https://akirabox.com/abc/file"));
        assert!(matches("https://vikingfile.com/f/abc"));
        assert!(matches("https://megadb.net/abc"));
        assert!(matches("https://fileq.net/vault/abc/game.rar"));
        assert!(!matches("https://gofile.io/d/abc"));
    }
}
