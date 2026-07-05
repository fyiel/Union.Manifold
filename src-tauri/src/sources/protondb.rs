use std::collections::HashMap;
use std::sync::Mutex;

use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::http;

use super::metacache;

static SUMMARY_CACHE: Lazy<Mutex<HashMap<String, Option<ProtonDbSummary>>>> =
    Lazy::new(|| Mutex::new(metacache::load("protondb.json")));

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProtonDbSummary {
    pub tier: String,
    pub trending_tier: String,
    pub best_reported_tier: String,
    pub confidence: String,
    pub score: f64,
    pub total: u64,
}

pub async fn summary(appid: u64) -> Option<ProtonDbSummary> {
    if appid == 0 {
        return None;
    }
    if let Some(cached) = SUMMARY_CACHE.lock().unwrap().get(&appid.to_string()).cloned() {
        return cached;
    }
    let url = format!("https://www.protondb.com/api/v1/reports/summaries/{appid}.json");
    // Only a DEFINITIVE HTTP response is cacheable: 2xx (real data / empty tier
    // == no reports) or 404 (no reports). A transport error or 5xx must NOT
    // poison the cache (it has no TTL), so bail without writing.
    let resp = match http::fetch(&url, &http::FetchOpts::default()).await {
        Ok(r) => r,
        Err(_) => return None,
    };
    let status = resp.status();
    if !status.is_success() && status.as_u16() != 404 {
        return None;
    }
    let out = if status.is_success() {
        let json = match resp.json::<Value>().await {
            Ok(v) => v,
            // 2xx but unparseable body: treat as transient, don't cache.
            Err(_) => return None,
        };
        let str_field = |key: &str| {
            json.get(key)
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .to_string()
        };
        let tier = str_field("tier");
        if tier.is_empty() {
            None
        } else {
            Some(ProtonDbSummary {
                tier,
                trending_tier: str_field("trendingTier"),
                best_reported_tier: str_field("bestReportedTier"),
                confidence: str_field("confidence"),
                score: json.get("score").and_then(|x| x.as_f64()).unwrap_or(0.0),
                total: json.get("total").and_then(|x| x.as_u64()).unwrap_or(0),
            })
        }
    } else {
        // 404: definitive "no reports".
        None
    };
    let snapshot = {
        let mut map = SUMMARY_CACHE.lock().unwrap();
        map.insert(appid.to_string(), out.clone());
        map.clone()
    };
    metacache::save_async("protondb.json", snapshot).await;
    out
}
