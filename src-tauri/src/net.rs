use std::collections::HashMap;

use base64::Engine;
use serde_json::{json, Value};

use crate::http::{self, FetchOpts};

fn join(base_url: &str, path: &str) -> String {
    if path.starts_with("http://") || path.starts_with("https://") {
        return path.to_string();
    }
    format!("{}/{}", base_url.trim_end_matches('/'), path.trim_start_matches('/'))
}

fn reason(status: u16) -> String {
    reqwest::StatusCode::from_u16(status)
        .ok()
        .and_then(|s| s.canonical_reason())
        .unwrap_or("")
        .to_string()
}

async fn do_fetch(
    url: &str,
    method: &str,
    headers: HashMap<String, String>,
    body: Option<Vec<u8>>,
    prefer_text: bool,
) -> Value {
    let opts = FetchOpts {
        method: Some(method.to_string()),
        headers,
        body,
        retries: Some(0),
        ..Default::default()
    };
    match http::fetch(url, &opts).await {
        Ok(resp) => {
            let status = resp.status().as_u16();
            let header_pairs: Vec<[String; 2]> = resp
                .headers()
                .iter()
                .filter_map(|(k, v)| v.to_str().ok().map(|val| [k.as_str().to_string(), val.to_string()]))
                .collect();
            // Textual payloads skip the base64 round-trip: the renderer used to
            // atob + per-char copy multi-MB JSON bodies on the main thread. Only
            // valid UTF-8 is sent as `bodyText` so bytes always round-trip
            // exactly; anything else keeps the base64 `body` fallback.
            let textual = prefer_text
                || resp
                    .headers()
                    .get(reqwest::header::CONTENT_TYPE)
                    .and_then(|v| v.to_str().ok())
                    .map(|ct| {
                        let mime = ct.split(';').next().unwrap_or("").trim().to_ascii_lowercase();
                        mime.starts_with("text/") || mime == "application/json" || mime.ends_with("+json")
                    })
                    .unwrap_or(false);
            let bytes = resp.bytes().await.map(|b| b.to_vec()).unwrap_or_default();
            let mut out = json!({
                "ok": (200..300).contains(&status),
                "status": status,
                "statusText": reason(status),
                "headers": header_pairs,
            });
            let (key, value) = if textual {
                match String::from_utf8(bytes) {
                    Ok(text) => ("bodyText", Value::String(text)),
                    Err(err) => (
                        "body",
                        Value::String(base64::engine::general_purpose::STANDARD.encode(err.into_bytes())),
                    ),
                }
            } else {
                (
                    "body",
                    Value::String(base64::engine::general_purpose::STANDARD.encode(&bytes)),
                )
            };
            out[key] = value;
            out
        }
        Err(_) => json!({
            "ok": false,
            "status": 0,
            "statusText": "fetch_failed",
            "headers": [],
            "body": "",
        }),
    }
}

#[tauri::command]
pub async fn auth_fetch(base_url: String, path: String, init: Option<Value>) -> Value {
    let init = init.unwrap_or_else(|| json!({}));
    let method = init.get("method").and_then(|v| v.as_str()).unwrap_or("GET").to_string();
    let headers: HashMap<String, String> = init
        .get("headers")
        .and_then(|h| h.as_object())
        .map(|m| {
            m.iter()
                .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
                .collect()
        })
        .unwrap_or_default();
    let body = init.get("body").and_then(|v| v.as_str()).map(|s| s.as_bytes().to_vec());
    // Callers may force text mode for content types the auto-detection misses.
    let prefer_text = init.get("preferText").and_then(|v| v.as_bool()).unwrap_or(false);
    do_fetch(&join(&base_url, &path), &method, headers, body, prefer_text).await
}
