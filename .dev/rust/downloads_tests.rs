use super::*;

fn part_row(
    id: &str,
    appid: &str,
    dir: &Path,
    status: &str,
    part_index: u64,
    part_total: u64,
) -> Download {
    Download {
        id: id.to_string(),
        appid: appid.to_string(),
        game_name: None,
        url: format!("https://host.test/{id}"),
        headers: None,
        filename: format!("{id}.rar"),
        save_path: dir.join(format!("{id}.rar")),
        installing_dir: dir.to_path_buf(),
        replace_dir: None,
        install_metadata: None,
        total_bytes: 100,
        received_bytes: 100,
        speed_bps: 0,
        eta_seconds: None,
        status: status.to_string(),
        error: None,
        gid: None,
        part_index: Some(part_index),
        part_total: Some(part_total),
        poll_failures: 0,
        last_manifest_write: Instant::now(),
    }
}

#[test]
fn multi_part_ready_counts_only_the_same_group() {
    let dir = std::path::Path::new("/dl/game");
    let mut by_id = HashMap::new();
    for i in 1..=3 {
        by_id.insert(
            format!("p{i}"),
            part_row(&format!("p{i}"), "app", dir, "completed", i, 4),
        );
    }
    // 3 of 4 parts done: not ready yet.
    let dl = part_row("p4", "app", dir, "downloading", 4, 4);
    assert!(!multi_part_ready(&by_id, &dl));

    // Same appid but different directory (update) rows must not count.
    let upd = std::path::Path::new("/dl/.updates/app");
    by_id.insert(
        "u1".to_string(),
        part_row("u1", "app", upd, "completed", 1, 4),
    );
    by_id.insert(
        "u2".to_string(),
        part_row("u2", "app", upd, "completed", 2, 4),
    );
    assert!(!multi_part_ready(&by_id, &dl), "cross-dir rows must not count");

    // A superseded 4-part group must not satisfy a new 2-part group.
    let mut older = by_id.clone();
    older.insert("p4".to_string(), part_row("p4", "app", dir, "completed", 4, 4));
    let new_dl = part_row("n1", "app", dir, "downloading", 1, 2);
    assert!(
        !multi_part_ready(&older, &new_dl),
        "different part_total must not count"
    );

    // Same appid, same dir, same part_total: the last part flips it ready.
    by_id.insert(
        "p4".to_string(),
        part_row("p4", "app", dir, "completed", 4, 4),
    );
    let dl = part_row("p4", "app", dir, "completed", 4, 4);
    assert!(multi_part_ready(&by_id, &dl));

    // A row still being downloaded must block readiness even when the count
    // is met: a superseded part that outlived the purge would otherwise flip
    // a fresh group's readiness while its own last part is still running.
    let mut in_flight = by_id.clone();
    in_flight.insert(
        "renegade".to_string(),
        part_row("renegade", "app", dir, "downloading", 4, 4),
    );
    assert!(
        !multi_part_ready(&in_flight, &dl),
        "any downloading/queued/paused row of the group blocks readiness"
    );

    // Non-part downloads never take the multi-part path.
    let single = Download {
        part_total: None,
        ..part_row("s1", "app", dir, "completed", 1, 1)
    };
    assert!(!multi_part_ready(&by_id, &single));
}

#[test]
fn superseded_rows_cover_exactly_the_previous_part_group() {
    let dir = std::path::Path::new("/dl/game");
    let upd = std::path::Path::new("/dl/.updates/app");
    let mut by_id = HashMap::new();
    by_id.insert(
        "old1".to_string(),
        part_row("old1", "app", dir, "completed", 1, 4),
    );
    by_id.insert(
        "old2".to_string(),
        part_row("old2", "app", dir, "completed", 2, 4),
    );
    by_id.insert(
        "oldFailed".to_string(),
        part_row("oldFailed", "app", dir, "failed", 3, 4),
    );
    by_id.insert(
        "otherApp".to_string(),
        part_row("otherApp", "other", dir, "completed", 1, 4),
    );
    by_id.insert(
        "updatePart".to_string(),
        part_row("updatePart", "app", upd, "completed", 1, 4),
    );
    let mut single = part_row("single", "app", dir, "completed", 1, 1);
    single.part_total = None;
    by_id.insert("single".to_string(), single);

    let rows = superseded_completed_rows(&by_id, "app", dir);
    let mut ids: Vec<&str> = rows.iter().map(|d| d.id.as_str()).collect();
    ids.sort_unstable();
    assert_eq!(ids, vec!["old1", "old2"], "only completed parts of the old group");
}

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
