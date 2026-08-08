use std::sync::LazyLock;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::http;

use super::metacache;

static SUMMARY_CACHE: LazyLock<metacache::WriteBehind<Option<ProtonDbSummary>>> =
    LazyLock::new(|| metacache::WriteBehind::load("protondb.json"));

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
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
    if let Some(cached) = SUMMARY_CACHE.get(&appid.to_string()) {
        return cached;
    }
    let url = format!("https://www.protondb.com/api/v1/reports/summaries/{appid}.json");
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
            Err(_) => return None,
        };
        let summary = serde_json::from_value::<ProtonDbSummary>(json).ok();
        summary.filter(|s| !s.tier.is_empty())
    } else {
        None
    };
    SUMMARY_CACHE.insert(appid.to_string(), out.clone());
    out
}
