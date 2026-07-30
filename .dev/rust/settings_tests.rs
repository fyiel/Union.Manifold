use super::*;
use serde_json::json;

#[test]
fn missing_settings_file_yields_empty_store() {
    let tmp = tempfile::tempdir().unwrap();
    let store = SettingsStore::load(tmp.path().join("settings.json"));
    assert_eq!(store.get("anything"), Value::Null);
    assert_eq!(store.get_string("anything"), None);
}

#[test]
fn corrupt_settings_file_yields_empty_store_instead_of_crashing() {
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("settings.json");
    std::fs::write(&path, "{ definitely not json").unwrap();
    let store = SettingsStore::load(path);
    assert_eq!(store.get("key"), Value::Null);
}

#[test]
fn set_persists_to_disk_and_survives_reload() {
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("settings.json");
    let store = SettingsStore::load(path.clone());
    store.set("slipgateUrl", json!("https://gate.example"));
    store.set("disabledSources", json!(["gog", "empress"]));
    store.set("downloadBandwidthLimitKBps", json!(2048));

    let reloaded = SettingsStore::load(path);
    assert_eq!(
        reloaded.get_string("slipgateUrl").as_deref(),
        Some("https://gate.example")
    );
    assert_eq!(reloaded.get("disabledSources"), json!(["gog", "empress"]));
    assert_eq!(reloaded.get("downloadBandwidthLimitKBps"), json!(2048));
}

#[test]
fn setting_null_removes_the_key_from_disk() {
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("settings.json");
    let store = SettingsStore::load(path.clone());
    store.set("nexusApiKey", json!("secret"));
    store.set("nexusApiKey", Value::Null);
    assert_eq!(store.get("nexusApiKey"), Value::Null);
    let raw = std::fs::read_to_string(&path).unwrap();
    assert!(!raw.contains("nexusApiKey"));
    assert!(!raw.contains("secret"));
}

#[test]
fn get_string_rejects_non_string_values() {
    let tmp = tempfile::tempdir().unwrap();
    let store = SettingsStore::load(tmp.path().join("settings.json"));
    store.set("n", json!(5));
    assert_eq!(store.get_string("n"), None);
    store.set("s", json!("text"));
    assert_eq!(store.get_string("s").as_deref(), Some("text"));
}

#[test]
fn no_stray_tmp_file_remains_after_set() {
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("settings.json");
    let store = SettingsStore::load(path);
    store.set("k", json!("v"));
    assert!(!tmp.path().join("settings.json.tmp").exists());
}

#[test]
fn concurrent_library_activity_and_favorite_merges_preserve_both() {
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("settings.json");
    let store = Arc::new(SettingsStore::load(path.clone()));
    std::thread::scope(|scope| {
        let favorite_store = store.clone();
        scope.spawn(move || {
            favorite_store.merge_library_game_meta(
                "game-1",
                serde_json::Map::from_iter([("collections".to_string(), json!(["Favorites"]))]),
                0,
            );
        });
        let activity_store = store.clone();
        scope.spawn(move || {
            activity_store.merge_library_game_meta(
                "game-1",
                serde_json::Map::from_iter([("lastPlayedAt".to_string(), json!(1_000))]),
                90_000,
            );
        });
    });

    let entry = store.get("libraryGameMeta")["game-1"].clone();
    assert_eq!(entry["collections"], json!(["Favorites"]));
    assert_eq!(entry["lastPlayedAt"], json!(1_000));
    assert_eq!(entry["playTimeMs"], json!(90_000));
    assert_eq!(
        SettingsStore::load(path).get("libraryGameMeta")["game-1"],
        entry
    );
}
