use super::*;
use tempfile::tempdir;

fn write_file(p: &Path, content: &str) {
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).unwrap();
    }
    std::fs::write(p, content).unwrap();
}

#[test]
fn game_layout_forces_bepinex_for_the_farmer_was_replaced() {
    assert_eq!(game_layout(Some(2060160)), Some(ModLayout::BepInEx));
}

#[test]
fn game_layout_forces_mods_folder_for_noita() {
    assert_eq!(game_layout(Some(881100)), Some(ModLayout::ModsFolder));
}

#[test]
fn game_layout_leaves_unknown_games_to_detection() {
    assert_eq!(game_layout(Some(620)), None);
    assert_eq!(game_layout(None), None);
}

#[test]
fn strip_wrapper_unwraps_junk_versioned_folder() {
    let tmp = tempdir().unwrap();
    let staged = tmp.path().join("s");
    write_file(&staged.join("MyMod 1.2/MyMod.dll"), "dll");
    write_file(&staged.join("MyMod 1.2/readme.txt"), "hi");
    strip_wrapper_dir(&staged).unwrap();
    assert!(staged.join("MyMod.dll").is_file());
    assert!(staged.join("readme.txt").is_file());
    assert!(!staged.join("MyMod 1.2").exists());
}

#[test]
fn strip_wrapper_preserves_every_meaningful_dir_name() {
    for name in [
        "data", "BepInEx", "mods", "plugins", "patchers", "config", "core", "scripts", "content",
        "Data", "MODS",
    ] {
        let tmp = tempdir().unwrap();
        let staged = tmp.path().join("s");
        write_file(&staged.join(name).join("payload.txt"), "x");
        strip_wrapper_dir(&staged).unwrap();
        assert!(
            staged.join(name).join("payload.txt").is_file(),
            "{name} must survive"
        );
        assert!(
            !staged.join("payload.txt").exists(),
            "{name} must not be unwrapped"
        );
    }
}

#[test]
fn strip_wrapper_ignores_multiple_top_level_entries() {
    let tmp = tempdir().unwrap();
    let staged = tmp.path().join("s");
    write_file(&staged.join("A/x.txt"), "x");
    write_file(&staged.join("B/y.txt"), "y");
    strip_wrapper_dir(&staged).unwrap();
    assert!(staged.join("A/x.txt").is_file());
    assert!(staged.join("B/y.txt").is_file());
}

#[test]
fn strip_wrapper_ignores_single_top_level_file() {
    let tmp = tempdir().unwrap();
    let staged = tmp.path().join("s");
    write_file(&staged.join("lone.dll"), "x");
    strip_wrapper_dir(&staged).unwrap();
    assert!(staged.join("lone.dll").is_file());
}

#[test]
fn strip_wrapper_leaves_empty_wrapper_alone() {
    let tmp = tempdir().unwrap();
    let staged = tmp.path().join("s");
    std::fs::create_dir_all(staged.join("Empty Wrapper")).unwrap();
    strip_wrapper_dir(&staged).unwrap();
    assert!(staged.join("Empty Wrapper").is_dir());
}

#[test]
fn strip_wrapper_unwraps_nested_wrapper_only_one_level() {
    let tmp = tempdir().unwrap();
    let staged = tmp.path().join("s");
    write_file(&staged.join("Outer 2.0/Inner 2.0/mod.dll"), "x");
    strip_wrapper_dir(&staged).unwrap();
    assert!(staged.join("Inner 2.0/mod.dll").is_file());
    assert!(!staged.join("Outer 2.0").exists());
}

#[test]
fn bepinex_root_is_src_when_bepinex_dir_sits_at_top() {
    let tmp = tempdir().unwrap();
    let src = tmp.path().join("m");
    write_file(&src.join("BepInEx/plugins/a.dll"), "x");
    assert_eq!(bepinex_root(&src), src);
}

#[test]
fn bepinex_root_descends_past_thunderstore_meta_files() {
    let tmp = tempdir().unwrap();
    let src = tmp.path().join("m");
    write_file(&src.join("manifest.json"), "{}");
    write_file(&src.join("icon.png"), "png");
    write_file(&src.join("README.md"), "r");
    write_file(&src.join("Pack/BepInEx/plugins/a.dll"), "x");
    assert_eq!(bepinex_root(&src), src.join("Pack"));
}

#[test]
fn bepinex_root_falls_back_to_src_for_plain_payload() {
    let tmp = tempdir().unwrap();
    let src = tmp.path().join("m");
    write_file(&src.join("loose.dll"), "x");
    assert_eq!(bepinex_root(&src), src);
}

#[test]
fn loose_nexus_plugin_lands_in_bepinex_plugins_subfolder() {
    let tmp = tempdir().unwrap();
    let src = tmp.path().join("src");
    let dst = tmp.path().join("staged");
    write_file(&src.join("FarmerMod.dll"), "dll");
    write_file(&src.join("settings.json"), "{}");
    apply_bepinex_layout(&src, &dst, "Farmer Mod").unwrap();
    assert!(dst
        .join("BepInEx/plugins/Farmer Mod/FarmerMod.dll")
        .is_file());
    assert!(dst
        .join("BepInEx/plugins/Farmer Mod/settings.json")
        .is_file());
}

#[test]
fn plugin_shipping_bepinex_subdirs_maps_them_into_bepinex_tree() {
    let tmp = tempdir().unwrap();
    let src = tmp.path().join("src");
    let dst = tmp.path().join("staged");
    write_file(&src.join("plugins/Mod.dll"), "x");
    write_file(&src.join("Config/mod.cfg"), "c");
    write_file(&src.join("extras/notes.txt"), "n");
    apply_bepinex_layout(&src, &dst, "MyMod").unwrap();
    assert!(dst.join("BepInEx/plugins/Mod.dll").is_file());
    assert!(dst.join("BepInEx/config/mod.cfg").is_file());
    assert!(dst.join("BepInEx/plugins/MyMod/extras/notes.txt").is_file());
}

#[test]
fn full_bepinex_pack_deploys_to_game_root_not_plugins() {
    let tmp = tempdir().unwrap();
    let src = tmp.path().join("src");
    let dst = tmp.path().join("staged");
    write_file(&src.join("BepInEx/core/BepInEx.dll"), "core");
    write_file(&src.join("winhttp.dll"), "shim");
    write_file(&src.join("doorstop_config.ini"), "ini");
    apply_bepinex_layout(&src, &dst, "BepInExPack").unwrap();
    assert!(dst.join("BepInEx/core/BepInEx.dll").is_file());
    assert!(dst.join("winhttp.dll").is_file());
    assert!(dst.join("doorstop_config.ini").is_file());
    assert!(!dst.join("BepInEx/plugins/BepInExPack").exists());
}

#[test]
fn wrapped_bepinex_pack_behind_meta_files_still_reaches_game_root() {
    let tmp = tempdir().unwrap();
    let src = tmp.path().join("src");
    let dst = tmp.path().join("staged");
    write_file(&src.join("manifest.json"), "{}");
    write_file(&src.join("BepInExPack/BepInEx/core/BepInEx.dll"), "core");
    write_file(&src.join("BepInExPack/winhttp.dll"), "shim");
    apply_bepinex_layout(&src, &dst, "whatever").unwrap();
    assert!(dst.join("BepInEx/core/BepInEx.dll").is_file());
    assert!(dst.join("winhttp.dll").is_file());
}

#[test]
fn relativize_target_accepts_subfolder_of_game_dir() {
    let tmp = tempdir().unwrap();
    let base = tmp.path().join("game");
    let picked = base.join("Data").join("Mods");
    std::fs::create_dir_all(&picked).unwrap();
    assert_eq!(relativize_target(&base, &picked).unwrap(), "Data/Mods");
}

#[test]
fn relativize_target_of_game_dir_itself_is_empty() {
    let tmp = tempdir().unwrap();
    let base = tmp.path().join("game");
    std::fs::create_dir_all(&base).unwrap();
    assert_eq!(relativize_target(&base, &base).unwrap(), "");
}

#[test]
fn relativize_target_rejects_folder_outside_game_dir() {
    let tmp = tempdir().unwrap();
    let base = tmp.path().join("game");
    let outside = tmp.path().join("elsewhere");
    std::fs::create_dir_all(&base).unwrap();
    std::fs::create_dir_all(&outside).unwrap();
    let err = relativize_target(&base, &outside).unwrap_err();
    assert!(err.contains("inside the game directory"));
}

#[cfg(unix)]
#[test]
fn relativize_target_resolves_symlinked_paths_before_comparing() {
    let tmp = tempdir().unwrap();
    let base = tmp.path().join("game");
    let sub = base.join("Mods");
    std::fs::create_dir_all(&sub).unwrap();
    let link = tmp.path().join("link");
    std::os::unix::fs::symlink(&base, &link).unwrap();
    assert_eq!(relativize_target(&link, &sub).unwrap(), "Mods");
}

#[test]
fn deployed_wrapper_fix_end_to_end_junk_folder_no_longer_reaches_game_dir() {
    let tmp = tempdir().unwrap();
    let dir = tmp.path().join("m");
    let target = tmp.path().join("game");
    std::fs::create_dir_all(&target).unwrap();
    let staged = dir.join("staging").join("nexus-9");
    write_file(&staged.join("SomeMod v1.3/mod.xml"), "x");
    strip_wrapper_dir(&staged).unwrap();
    let cfg = GameMods {
        mods: vec![ModEntry {
            id: "nexus-9".to_string(),
            enabled: true,
            ..Default::default()
        }],
        ..Default::default()
    };
    deploy_to(&dir, &target, &cfg).unwrap();
    assert!(target.join("mod.xml").is_file());
    assert!(!target.join("SomeMod v1.3").exists());
}
