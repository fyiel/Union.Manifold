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

async fn do_fetch(url: &str, method: &str, headers: HashMap<String, String>, body: Option<Vec<u8>>) -> Value {
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
            let bytes = resp.bytes().await.map(|b| b.to_vec()).unwrap_or_default();
            let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
            json!({
                "ok": (200..300).contains(&status),
                "status": status,
                "statusText": reason(status),
                "headers": header_pairs,
                "body": b64,
            })
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
    do_fetch(&join(&base_url, &path), &method, headers, body).await
}

#[tauri::command]
pub async fn auth_upload(base_url: String, path: String, payload: Value) -> Value {
    let method = payload.get("method").and_then(|v| v.as_str()).unwrap_or("POST").to_string();
    do_fetch(&join(&base_url, &path), &method, HashMap::new(), None).await
}
