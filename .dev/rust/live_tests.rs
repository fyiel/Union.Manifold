use super::*;
use std::collections::HashMap;
use std::time::Duration;

use crate::http::{self, FetchOpts};
use crate::sources::schema::DownloadOption;

#[tokio::test]
#[ignore]
async fn live_steam_search_finds_the_farmer_was_replaced() {
    let id = steam::search_app_id("The Farmer Was Replaced").await;
    assert_eq!(id, Some(2060160));
}

#[tokio::test]
#[ignore]
async fn live_steam_store_details_for_portal_2() {
    let d = steam::get_store_details(620).await.expect("store details");
    assert!(d.name.to_lowercase().contains("portal"));
}

#[tokio::test]
#[ignore]
async fn live_protondb_summary_for_portal_2() {
    let s = protondb::summary(620).await.expect("protondb summary");
    assert!(!s.tier.is_empty());
}

async fn current_gamebounty_options() -> HashMap<String, DownloadOption> {
    let targets = ["datanodes", "fileditch", "gofile"];
    let games = adapters::gamebounty::query(&QueryParams {
        limit: 30,
        ..Default::default()
    })
    .await
    .expect("GameBounty catalog");
    let mut options = HashMap::new();
    for game in games.into_iter().take(30) {
        let Some(detail) = adapters::gamebounty::get_detail(&game.source_slug).await else {
            continue;
        };
        for option in detail.download_options {
            if targets.contains(&option.host_type.as_str()) {
                options.entry(option.host_type.clone()).or_insert(option);
            }
        }
        if options.len() == targets.len() {
            break;
        }
    }
    options
}

async fn verify_direct_file(host: &str, result: &ResolveResult) {
    let direct = result
        .url
        .as_deref()
        .or_else(|| result.files.as_ref()?.first().map(|file| file.url.as_str()))
        .expect("direct file URL");
    let mut headers = result.headers.clone().unwrap_or_default();
    headers.insert("Range".to_string(), "bytes=0-0".to_string());
    let response = http::fetch(
        direct,
        &FetchOpts {
            headers,
            retries: Some(1),
            timeout: Some(Duration::from_secs(30)),
            ..Default::default()
        },
    )
    .await
    .expect("direct file request");
    let status = response.status();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    eprintln!("{host}: status={status} content-type={content_type} url={direct}");
    assert!(status.is_success(), "{host}: status {status}");
    assert!(!content_type.contains("text/html"), "{host}: HTML response");
}

#[tokio::test]
#[ignore]
async fn live_gamebounty_datanodes_fileditch_and_gofile() {
    let options = current_gamebounty_options().await;
    for host in ["datanodes", "fileditch", "gofile"] {
        let option = options
            .get(host)
            .unwrap_or_else(|| panic!("no current {host} mirror"));
        let result = hosts::resolve_url(option).await;
        assert!(
            result.resolvable,
            "{host}: {}",
            result.reason.as_deref().unwrap_or("not resolvable")
        );
        verify_direct_file(host, &result).await;
    }
}
