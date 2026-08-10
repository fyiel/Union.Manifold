use super::*;

fn stub(root: &std::path::Path, folder: &str, manifest: &Value) -> PathBuf {
    let dir = root.join(folder);
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(
        dir.join(MANIFEST_NAME),
        serde_json::to_string(manifest).unwrap(),
    )
    .unwrap();
    dir
}

#[test]
fn installing_delete_never_touches_an_installed_game_dir() {
    let _scan_guard = crate::library::SCAN_TEST_LOCK.lock();
    let tmp = tempfile::tempdir().unwrap();
    let dir = stub(
        tmp.path(),
        "precious",
        &json!({
            "appid": "steam-620",
            "installStatus": "installed",
        }),
    );
    std::fs::write(dir.join("game.exe"), "mz").unwrap();
    let roots = vec![tmp.path().to_path_buf()];
    remove_dir_unless_installed(&roots, "steam-620");
    assert!(dir.join("game.exe").is_file());
    assert!(dir.join(MANIFEST_NAME).is_file());
}

#[test]
fn installing_delete_removes_every_non_installed_status() {
    let _scan_guard = crate::library::SCAN_TEST_LOCK.lock();
    for status in [
        "installing",
        "queued",
        "paused",
        "downloaded",
        "extracting",
        "failed",
        "cancelled",
    ] {
        let tmp = tempfile::tempdir().unwrap();
        let dir = stub(
            tmp.path(),
            "partial",
            &json!({
                "appid": "steam-1",
                "installStatus": status,
            }),
        );
        let roots = vec![tmp.path().to_path_buf()];
        remove_dir_unless_installed(&roots, "steam-1");
        assert!(!dir.exists(), "status {status} should be deletable");
    }
}

#[test]
fn installing_delete_removes_dir_with_unreadable_manifest() {
    let _scan_guard = crate::library::SCAN_TEST_LOCK.lock();
    let tmp = tempfile::tempdir().unwrap();
    let dir = stub(
        tmp.path(),
        "broken",
        &json!({
            "appid": "steam-2",
            "installStatus": "installing",
        }),
    );
    let roots = vec![tmp.path().to_path_buf()];
    let found = find_dir(&roots, "steam-2");
    assert_eq!(found, Some(dir.clone()));
    std::fs::write(dir.join(MANIFEST_NAME), "{ corrupt").unwrap();
    remove_dir_unless_installed(&roots, "steam-2");
    assert!(!dir.exists());
}

#[test]
fn manifest_without_status_counts_as_installed_and_is_protected() {
    let _scan_guard = crate::library::SCAN_TEST_LOCK.lock();
    let tmp = tempfile::tempdir().unwrap();
    let dir = stub(tmp.path(), "legacy", &json!({ "appid": "old-1" }));
    let roots = vec![tmp.path().to_path_buf()];
    let listed = list_by(&roots, INSTALLED);
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0]["appid"], json!("old-1"));
    remove_dir_unless_installed(&roots, "old-1");
    assert!(
        !dir.exists(),
        "remove_dir_unless_installed reads the raw manifest which has no installStatus"
    );
}

#[test]
fn first_root_wins_when_same_appid_exists_in_two_roots() {
    let tmp = tempfile::tempdir().unwrap();
    let primary = tmp.path().join("primary");
    let legacy = tmp.path().join("legacy");
    let p = stub(
        &primary,
        "game",
        &json!({ "appid": "steam-3", "installStatus": "installed" }),
    );
    stub(
        &legacy,
        "game",
        &json!({ "appid": "steam-3", "installStatus": "installed" }),
    );
    let roots = vec![primary, legacy];
    assert_eq!(find_dir(&roots, "steam-3"), Some(p));
    assert_eq!(all_appids(&roots), vec!["steam-3".to_string()]);
}

#[test]
fn list_by_separates_installed_from_installing_statuses() {
    let tmp = tempfile::tempdir().unwrap();
    stub(
        tmp.path(),
        "done",
        &json!({ "appid": "a", "installStatus": "installed" }),
    );
    stub(
        tmp.path(),
        "busy",
        &json!({ "appid": "b", "installStatus": "extracting" }),
    );
    stub(
        tmp.path(),
        "dead",
        &json!({ "appid": "c", "installStatus": "failed" }),
    );
    let roots = vec![tmp.path().to_path_buf()];
    let installed = list_by(&roots, INSTALLED);
    let installing = list_by(&roots, INSTALLING);
    assert_eq!(installed.len(), 1);
    assert_eq!(installing.len(), 2);
    assert_eq!(appids_by(&roots, INSTALLED), vec!["a".to_string()]);
    assert!(Arc::ptr_eq(
        &load_all_cached(&roots),
        &load_all_cached(&roots)
    ));
}

#[test]
fn combined_library_lists_partition_one_snapshot() {
    let tmp = tempfile::tempdir().unwrap();
    stub(
        tmp.path(),
        "done",
        &json!({ "appid": "done", "installStatus": "installed" }),
    );
    stub(
        tmp.path(),
        "busy",
        &json!({ "appid": "busy", "installStatus": "extracting" }),
    );
    let roots = vec![tmp.path().to_path_buf()];
    let (installed, installing) = lists_by_status(&roots);
    assert_eq!(installed[0]["appid"], json!("done"));
    assert_eq!(installing[0]["appid"], json!("busy"));
}

#[test]
fn loaded_manifests_gain_folder_and_install_path_fields() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = stub(
        tmp.path(),
        "annotated",
        &json!({ "appid": "x", "installStatus": "installed" }),
    );
    let roots = vec![tmp.path().to_path_buf()];
    let v = get_by(&roots, "x", INSTALLED).unwrap();
    assert_eq!(v["folder"], json!(dir.to_string_lossy()));
    assert_eq!(v["installPath"], json!(dir.to_string_lossy()));
}

#[test]
fn dirs_without_manifest_are_invisible_to_the_library() {
    let tmp = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(tmp.path().join("random-folder")).unwrap();
    std::fs::write(tmp.path().join("loose-file.txt"), "x").unwrap();
    let roots = vec![tmp.path().to_path_buf()];
    assert!(all_appids(&roots).is_empty());
}

#[test]
#[ignore = "measurement helper; run explicitly with --ignored --nocapture"]
fn benchmark_large_library_scan_and_warm_lists() {
    let _scan_guard = crate::library::SCAN_TEST_LOCK.lock();
    let tmp = tempfile::tempdir().unwrap();
    for i in 0..2_000 {
        stub(
            tmp.path(),
            &format!("game-{i}"),
            &json!({
                "appid": format!("steam-{i}"),
                "installStatus": if i % 10 == 0 { "installing" } else { "installed" },
                "metadata": {
                    "name": format!("Synthetic game {i}"),
                    "image": format!("https://cdn.test/{i}/library_600x900.jpg"),
                    "description": "A representative installed game manifest used for repeatable scan measurements."
                }
            }),
        );
    }
    let roots = vec![tmp.path().to_path_buf()];
    invalidate_scan();

    let cold = std::time::Instant::now();
    assert_eq!(list_by(&roots, INSTALLED).len(), 1_800);
    let cold = cold.elapsed();
    let warm = std::time::Instant::now();
    assert_eq!(list_by(&roots, INSTALLING).len(), 200);
    let warm = warm.elapsed();

    eprintln!(
        "library_2000 cold_scan_ms={} warm_list_ms={}",
        cold.as_millis(),
        warm.as_micros() as f64 / 1_000.0,
    );
}
