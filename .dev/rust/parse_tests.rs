use super::*;

#[test]
fn finds_appid_in_steam_store_links() {
    assert_eq!(
        find_steam_app_id(
            r#"<a href="https://store.steampowered.com/app/620/Portal_2/">store</a>"#
        ),
        Some(620)
    );
}

#[test]
fn finds_appid_in_steamdb_links() {
    assert_eq!(
        find_steam_app_id("see https://steamdb.info/app/2060160/ for info"),
        Some(2060160)
    );
}

#[test]
fn finds_appid_in_json_and_attribute_styles() {
    assert_eq!(find_steam_app_id(r#"{"steamAppId": 881100}"#), Some(881100));
    assert_eq!(find_steam_app_id("steam_appid=440"), Some(440));
    assert_eq!(find_steam_app_id(r#"steam_id: "730""#), Some(730));
}

#[test]
fn finds_appid_in_cdn_apps_paths() {
    assert_eq!(
        find_steam_app_id("https://cdn.cloudflare.steamstatic.com/steam/apps/620/header.jpg"),
        Some(620)
    );
}

#[test]
fn earlier_pattern_wins_over_later_ones() {
    let text = "https://store.steampowered.com/app/620/ and /apps/999/";
    assert_eq!(find_steam_app_id(text), Some(620));
}

#[test]
fn returns_none_when_no_appid_present() {
    assert_eq!(
        find_steam_app_id("no steam ids here, just 12345 numbers"),
        None
    );
    assert_eq!(find_steam_app_id(""), None);
}
