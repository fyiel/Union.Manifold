use super::*;

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
