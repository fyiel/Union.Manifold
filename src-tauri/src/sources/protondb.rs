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
    let out = match http::get_json::<Value>(&url).await {
        Ok(v) => {
            let str_field = |key: &str| {
                v.get(key)
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
                    score: v.get("score").and_then(|x| x.as_f64()).unwrap_or(0.0),
                    total: v.get("total").and_then(|x| x.as_u64()).unwrap_or(0),
                })
            }
        }
        Err(_) => None,
    };
    {
        let mut map = SUMMARY_CACHE.lock().unwrap();
        map.insert(appid.to_string(), out.clone());
        metacache::save("protondb.json", &map);
    }
    out
}
