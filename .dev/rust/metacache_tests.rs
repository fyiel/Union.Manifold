use super::*;

#[test]
fn metacache_round_trips_keyed_maps_after_init() {
    assert_eq!(file_path("pre-init.json"), None);
    let tmp = tempfile::tempdir().unwrap();
    init(tmp.path().to_path_buf());

    let mut map: HashMap<String, Option<u64>> = HashMap::new();
    map.insert("the farmer was replaced".to_string(), Some(2060160));
    map.insert("unknown game".to_string(), None);
    save("dev-appids.json", &map);

    let loaded: HashMap<String, Option<u64>> = load("dev-appids.json");
    assert_eq!(loaded.get("the farmer was replaced"), Some(&Some(2060160)));
    assert_eq!(loaded.get("unknown game"), Some(&None));

    let missing: HashMap<String, Option<u64>> = load("never-written.json");
    assert!(missing.is_empty());

    let p = file_path("dev-appids.json").unwrap();
    assert!(p.is_file());
    std::fs::write(&p, "corrupt {").unwrap();
    let corrupt: HashMap<String, Option<u64>> = load("dev-appids.json");
    assert!(
        corrupt.is_empty(),
        "corrupt cache degrades to empty, never panics"
    );
}
