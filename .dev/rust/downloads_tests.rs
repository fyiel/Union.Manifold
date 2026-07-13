use super::*;

#[test]
fn prune_drops_rows_whose_install_folder_is_gone() {
    let tmp = tempfile::tempdir().unwrap();
    let alive_dir = tmp.path().join("alive-game");
    std::fs::create_dir_all(&alive_dir).unwrap();
    let mut v = json!([
        { "id": "a", "savePath": alive_dir.join("part1.rar").to_string_lossy() },
        { "id": "b", "savePath": tmp.path().join("deleted-game/part1.rar").to_string_lossy() },
    ]);
    let dropped = prune_dead_downloads(&mut v);
    assert_eq!(dropped, 1);
    let arr = v.as_array().unwrap();
    assert_eq!(arr.len(), 1);
    assert_eq!(arr[0]["id"], json!("a"));
}

#[test]
fn prune_keeps_rows_without_save_path() {
    let mut v = json!([
        { "id": "a" },
        { "id": "b", "savePath": "" },
        { "id": "c", "savePath": null },
    ]);
    assert_eq!(prune_dead_downloads(&mut v), 0);
    assert_eq!(v.as_array().unwrap().len(), 3);
}

#[test]
fn prune_is_a_noop_on_non_array_state() {
    let mut v = json!({ "not": "an array" });
    assert_eq!(prune_dead_downloads(&mut v), 0);
    let mut n = Value::Null;
    assert_eq!(prune_dead_downloads(&mut n), 0);
}

#[test]
fn prune_drops_relative_save_paths_whose_empty_parent_never_exists() {
    let mut v = json!([{ "id": "a", "savePath": "relative.rar" }]);
    assert_eq!(prune_dead_downloads(&mut v), 1);
    let mut abs = json!([{ "id": "b", "savePath": "/definitely-not-a-real-dir/part.rar" }]);
    assert_eq!(prune_dead_downloads(&mut abs), 1);
}

#[test]
fn safe_folder_name_strips_path_hostile_characters() {
    assert_eq!(safe_folder_name("Portal 2"), "Portal 2");
    assert!(!safe_folder_name("a/b\\c:d*e?f\"g<h>i|j")
        .contains(['/', '\\', ':', '*', '?', '"', '<', '>', '|']));
    assert!(!safe_folder_name("").is_empty());
    assert!(!safe_folder_name("...").contains('/'));
}

#[test]
fn write_json_atomic_round_trips_and_overwrites() {
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("state.json");
    write_json_atomic(&path, &json!([{ "id": 1 }])).unwrap();
    write_json_atomic(&path, &json!([{ "id": 2 }])).unwrap();
    let read: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
    assert_eq!(read, json!([{ "id": 2 }]));
    let leftovers: Vec<_> = std::fs::read_dir(tmp.path())
        .unwrap()
        .flatten()
        .filter(|e| e.file_name() != "state.json")
        .collect();
    assert!(leftovers.is_empty(), "no tmp files left behind");
}
