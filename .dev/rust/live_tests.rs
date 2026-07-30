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
async fn live_steamrip_query_finds_ballionaire() {
    let games = adapters::steamrip::query(&QueryParams {
        text: Some("Ballionaire".to_string()),
        limit: 50,
        ..Default::default()
    })
    .await
    .expect("SteamRIP catalog");
    assert!(games.iter().any(|game| game.title == "Ballionaire"));
}

#[tokio::test]
#[ignore]
async fn live_zeigames_query_returns_current_downloads() {
    let games = adapters::zeigames::query(&QueryParams {
        limit: 10,
        ..Default::default()
    })
    .await
    .expect("ZeiGames catalog");
    let game = games.first().expect("current ZeiGames topic");
    let detail = adapters::zeigames::get_detail(&game.source_slug)
        .await
        .expect("current ZeiGames detail");
    assert_eq!(detail.source_id, "zeigames");
    assert!(detail.source_url.starts_with("https://zeigames.com/topic/"));
    assert!(!detail.download_options.is_empty());
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
        eprintln!("{host}: page={:?}", option.url);
        if hosts::interactive::matches(option.url.as_deref().unwrap_or("")) {
            eprintln!("{host}: in-app verification window");
            continue;
        }
        let result = hosts::resolve_url(option).await;
        assert!(
            result.resolvable,
            "{host}: {}",
            result.reason.as_deref().unwrap_or("not resolvable")
        );
        verify_direct_file(host, &result).await;
    }
}

#[tokio::test]
#[ignore]
async fn live_every_source_returns_current_games() {
    let params = QueryParams {
        limit: 10,
        ..Default::default()
    };
    let mut total = 0;
    let mut representatives = Vec::new();
    let mut host_types = std::collections::BTreeSet::new();
    for source in SOURCES {
        let games = tokio::time::timeout(
            Duration::from_secs(120),
            adapter_query(source.id, &params),
        )
        .await
        .unwrap_or_else(|_| panic!("{} catalog timed out", source.name))
        .unwrap_or_else(|| panic!("{} catalog unavailable", source.name));
        eprintln!("{}: {} current games", source.name, games.len());
        assert!(!games.is_empty(), "{} returned no current games", source.name);
        let mut source_representatives = 0;
        for game in games.iter().take(8) {
            let detail = tokio::time::timeout(
                Duration::from_secs(120),
                adapter_detail(source.id, &game.source_slug),
            )
            .await
            .unwrap_or_else(|_| panic!("{} detail timed out for {}", source.name, game.title));
            let Some(detail) = detail else { continue };
            if detail.download_options.is_empty() {
                continue;
            }
            eprintln!(
                "{} sample: {} [{}]",
                source.name,
                detail.title,
                detail
                    .download_options
                    .iter()
                    .map(|option| option.host_type.as_str())
                    .collect::<Vec<_>>()
                    .join(", ")
            );
            host_types.extend(
                detail
                    .download_options
                    .iter()
                    .map(|option| option.host_type.clone()),
            );
            representatives.push((source.id, detail));
            source_representatives += 1;
            if source_representatives == 2 {
                break;
            }
        }
        assert!(
            source_representatives > 0,
            "{} returned no current game with download options",
            source.name
        );
        total += games.len();
    }
    assert!(
        representatives.len() >= 10,
        "expected ten representative games, got {}",
        representatives.len()
    );
    eprintln!(
        "representative games: {}",
        representatives[..10]
            .iter()
            .map(|(_, game)| game.title.as_str())
            .collect::<Vec<_>>()
            .join(", ")
    );
    let mut options_by_host = HashMap::new();
    for (source_id, game) in &representatives {
        for option in &game.download_options {
            options_by_host
                .entry(option.host_type.clone())
                .or_insert_with(|| ((*source_id).to_string(), option.clone()));
        }
    }
    for (host, (source_id, option)) in &options_by_host {
        let page_url = option
            .url
            .as_deref()
            .or(option.page_url.as_deref())
            .unwrap_or("");
        if host == "magnet" {
            assert!(page_url.starts_with("magnet:"));
            eprintln!("{host}: external torrent client fallback");
            continue;
        }
        if hosts::interactive::matches(page_url) {
            eprintln!("{host}: in-app verification window");
            continue;
        }
        let result = tokio::time::timeout(
            Duration::from_secs(240),
            adapter_resolve(source_id, option),
        )
        .await
        .unwrap_or_else(|_| panic!("{host} resolution timed out"));
        if result.resolvable {
            verify_direct_file(host, &result).await;
        } else {
            assert!(
                result.open_url.is_some(),
                "{host}: neither direct download nor browser fallback"
            );
            eprintln!(
                "{host}: browser fallback ({})",
                result.reason.as_deref().unwrap_or("not directly resolvable")
            );
        }
    }
    eprintln!("observed hosts: {}", host_types.into_iter().collect::<Vec<_>>().join(", "));
    assert!(
        representatives.len() >= 10,
        "expected ten representative games with download options, got {}",
        representatives.len()
    );
    assert!(total >= 10, "expected at least ten current games, got {total}");
}

#[tokio::test]
#[ignore]
async fn live_current_akirabox_uses_verification() {
    let games = adapters::zeigames::query(&QueryParams {
        limit: 10,
        ..Default::default()
    })
    .await
    .expect("ZeiGames catalog");
    for game in games.iter().take(20) {
        let Some(detail) = adapters::zeigames::get_detail(&game.source_slug).await else {
            continue;
        };
        let Some(option) = detail
            .download_options
            .iter()
            .find(|option| option.host_type == "akirabox")
        else {
            continue;
        };
        let page_url = option.url.as_deref().expect("akirabox page url");
        assert!(hosts::interactive::matches(page_url));
        let result = hosts::resolve_url(option).await;
        assert!(!result.resolvable);
        assert_eq!(result.open_url.as_deref(), Some(page_url));
        return;
    }
    panic!("no current akirabox mirror");
}
