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
fn wuchang_enabler_preserves_project_plague_at_game_root() {
    let tmp = tempdir().unwrap();
    let dir = tmp.path().join("mods");
    let target = tmp.path().join("game");
    let staged = dir.join("staging/nexus-3");
    write_file(
        &staged.join("Wuchang Mod Enabler/Project_Plague/Binaries/Win64/dsound.dll"),
        "loader",
    );
    write_file(&staged.join("README.txt"), "instructions");

    let plan = infer_deployment_plan_for_entry(
        &target,
        &staged,
        Some(WUCHANG_STEAM_APPID),
        "nexus",
        "3",
        "https://www.nexusmods.com/wuchangfallenfeathers/mods/3",
    );
    assert_eq!(plan.layout, ModLayout::WuchangEnabler);
    assert!(plan.deploy_prefix.is_empty());
    assert_eq!(plan.confidence, "high");
    apply_staging_layout(&staged, plan.layout, "Wuchang Mod Enabler", "nexus-3").unwrap();

    let cfg = GameMods {
        steam_appid: Some(WUCHANG_STEAM_APPID),
        mods: vec![ModEntry {
            id: "nexus-3".to_string(),
            enabled: true,
            ..Default::default()
        }],
        ..Default::default()
    };
    deploy_to(&dir, &target, &cfg).unwrap();

    assert!(target
        .join("Project_Plague/Binaries/Win64/dsound.dll")
        .is_file());
    assert!(!target.join("Binaries/Win64/dsound.dll").exists());
    assert!(!target.join("README.txt").exists());
}

#[test]
fn wuchang_migration_repairs_a_previously_stripped_enabler_tree() {
    let tmp = tempdir().unwrap();
    let staged = tmp.path().join("staging/nexus-3");
    write_file(&staged.join("Content/Paks/loader.pak"), "loader");

    let plan = infer_deployment_plan_for_entry(
        tmp.path(),
        &staged,
        Some(WUCHANG_STEAM_APPID),
        "nexus",
        "3",
        "https://www.nexusmods.com/wuchangfallenfeathers/mods/3",
    );
    assert_eq!(plan.layout, ModLayout::WuchangEnabler);
    apply_staging_layout(&staged, plan.layout, "Wuchang Mod Enabler", "nexus-3").unwrap();

    assert!(staged
        .join("Project_Plague/Content/Paks/loader.pak")
        .is_file());
    assert!(!staged.join("Content/Paks/loader.pak").exists());
}

#[test]
fn wuchang_regular_packages_always_use_project_plague_mods_folder() {
    for (source, file) in [
        ("UncensorMod_4_P.pak", "UncensorMod_4_P.pak"),
        ("Content/Paks/Visual_4_P.utoc", "Visual_4_P.utoc"),
        (
            "Download/Project_Plague/Content/Paks/Visual_4_P.ucas",
            "Visual_4_P.ucas",
        ),
    ] {
        let tmp = tempdir().unwrap();
        let dir = tmp.path().join("mods");
        let target = tmp.path().join("game");
        let staged = dir.join("staging/nexus-44");
        std::fs::create_dir_all(target.join("Wuchang/Content/Paks")).unwrap();
        write_file(&staged.join(source), "mod");

        let plan = infer_deployment_plan_for_entry(
            &target,
            &staged,
            Some(WUCHANG_STEAM_APPID),
            "nexus",
            "44",
            "https://www.nexusmods.com/wuchangfallenfeathers/mods/44",
        );
        assert_eq!(plan.layout, ModLayout::WuchangPackage);
        assert_eq!(plan.deploy_prefix, WUCHANG_MODS_PREFIX);
        assert_eq!(plan.confidence, "high");
        apply_staging_layout(&staged, plan.layout, "Uncensor Mod", "nexus-44").unwrap();

        let cfg = GameMods {
            steam_appid: Some(WUCHANG_STEAM_APPID),
            mods: vec![ModEntry {
                id: "nexus-44".to_string(),
                enabled: true,
                deploy_prefix: plan.deploy_prefix,
                ..Default::default()
            }],
            ..Default::default()
        };
        deploy_to(&dir, &target, &cfg).unwrap();

        assert!(target.join(WUCHANG_MODS_PREFIX).join(file).is_file());
        assert!(!target.join("Wuchang/Content/Paks/~mods").join(file).exists());
        assert!(!target.join("Project_Plague/Content/Paks").join(file).is_file());
    }
}

#[test]
fn wuchang_enabler_layout_requires_exact_nexus_identity() {
    let tmp = tempdir().unwrap();
    let staged = tmp.path().join("archive");
    write_file(
        &staged.join("Project_Plague/Content/Paks/ordinary.pak"),
        "mod",
    );

    for (provider, remote_id, page_url) in [
        (
            "nexus",
            "44",
            "https://www.nexusmods.com/wuchangfallenfeathers/mods/44",
        ),
        (
            "nexus",
            "3",
            "https://www.nexusmods.com/anothergame/mods/3",
        ),
        (
            "workshop",
            "3",
            "https://www.nexusmods.com/wuchangfallenfeathers/mods/3",
        ),
    ] {
        let plan = infer_deployment_plan_for_entry(
            tmp.path(),
            &staged,
            Some(WUCHANG_STEAM_APPID),
            provider,
            remote_id,
            page_url,
        );
        assert_eq!(plan.layout, ModLayout::WuchangPackage);
        assert_eq!(plan.deploy_prefix, WUCHANG_MODS_PREFIX);
    }
}

#[test]
fn wuchang_loader_registry_matches_the_steam_title() {
    let loaders = loader_compatibility(None, Some(WUCHANG_STEAM_APPID));
    let loader = loaders
        .iter()
        .find(|loader| loader.name == "Wuchang Mod Enabler")
        .unwrap();
    assert!(loader.compatible);
    assert!(loader.reason.contains("WUCHANG"));
}

#[test]
fn mewgenics_uses_launch_time_modpaths() {
    let tmp = tempdir().unwrap();
    let target = tmp.path().join("game");
    let staged = tmp.path().join("stage");
    write_file(&target.join("Mewgenics.exe"), "exe");
    write_file(&staged.join("data/items.gon.patch"), "patch");

    let plan = infer_deployment_plan(&target, &staged, Some(MEWGENICS_STEAM_APPID));
    assert_eq!(plan.layout, ModLayout::Raw);
    assert!(plan.deploy_prefix.is_empty());
    assert_eq!(plan.confidence, "high");
    assert!(plan.reason.contains("-modpaths"));
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

#[test]
fn requiem_lua_archive_deploys_to_reframework_autorun() {
    let tmp = tempdir().unwrap();
    let dir = tmp.path().join("mods");
    let target = tmp.path().join("game");
    let staged = dir.join("staging").join("nexus-322");
    write_file(&staged.join("more_ammo.lua"), "return true");

    let plan = infer_deployment_plan(&target, &staged, Some(RESIDENT_EVIL_REQUIEM_STEAM_APPID));
    assert_eq!(plan.layout, ModLayout::Raw);
    assert_eq!(plan.deploy_prefix, "reframework/autorun");
    assert_eq!(plan.confidence, "high");
    apply_staging_layout(&staged, plan.layout, "More Ammo", "nexus-322").unwrap();

    let cfg = GameMods {
        mods: vec![ModEntry {
            id: "nexus-322".to_string(),
            enabled: true,
            deploy_prefix: plan.deploy_prefix,
            ..Default::default()
        }],
        ..Default::default()
    };
    deploy_to(&dir, &target, &cfg).unwrap();

    assert!(target.join("reframework/autorun/more_ammo.lua").is_file());
    assert!(!target.join("more_ammo.lua").exists());
}

#[test]
fn wrapped_reframework_tree_keeps_its_game_relative_root() {
    let tmp = tempdir().unwrap();
    let dir = tmp.path().join("mods");
    let target = tmp.path().join("game");
    let staged = dir.join("staging").join("nexus-322");
    write_file(
        &staged.join("reframework/autorun/more_ammo.lua"),
        "return true",
    );

    let plan = infer_deployment_plan(&target, &staged, Some(RESIDENT_EVIL_REQUIEM_STEAM_APPID));
    assert_eq!(plan.layout, ModLayout::Raw);
    assert!(plan.deploy_prefix.is_empty());
    apply_staging_layout(&staged, plan.layout, "More Ammo", "nexus-322").unwrap();
    assert!(staged.join("reframework/autorun/more_ammo.lua").is_file());

    let cfg = GameMods {
        mods: vec![ModEntry {
            id: "nexus-322".to_string(),
            enabled: true,
            ..Default::default()
        }],
        ..Default::default()
    };
    deploy_to(&dir, &target, &cfg).unwrap();

    assert!(target.join("reframework/autorun/more_ammo.lua").is_file());
    assert!(!target.join("autorun/more_ammo.lua").exists());
}

#[test]
fn melonloader_manifest_folder_is_preserved_inside_mods() {
    let tmp = tempdir().unwrap();
    let dir = tmp.path().join("mods");
    let target = tmp.path().join("game");
    std::fs::create_dir_all(target.join("MelonLoader")).unwrap();
    let staged = dir.join("staging").join("nexus-9");
    write_file(&staged.join("AutoAttack/manifest.json"), "{}");
    write_file(&staged.join("AutoAttack/AutoAttack.dll"), "assembly");

    let plan = infer_deployment_plan(&target, &staged, None);
    assert_eq!(plan.layout, ModLayout::MelonLoader);
    assert_eq!(plan.deploy_prefix, "Mods");
    assert_eq!(plan.confidence, "high");
    apply_staging_layout(&staged, plan.layout, "AutoAttack", "nexus-9").unwrap();

    let cfg = GameMods {
        mods: vec![ModEntry {
            id: "nexus-9".to_string(),
            enabled: true,
            deploy_prefix: plan.deploy_prefix,
            ..Default::default()
        }],
        ..Default::default()
    };
    deploy_to(&dir, &target, &cfg).unwrap();

    assert!(target.join("Mods/AutoAttack/manifest.json").is_file());
    assert!(target.join("Mods/AutoAttack/AutoAttack.dll").is_file());
    assert!(!target.join("Mods/AutoAttack.dll").exists());
}

#[test]
fn everything_is_crab_routes_melonloader_package_before_loader_first_run() {
    let tmp = tempdir().unwrap();
    let target = tmp.path().join("game");
    let staged = tmp.path().join("archive");
    write_file(&staged.join("AutoAttack/manifest.json"), "{}");
    write_file(&staged.join("AutoAttack/AutoAttack.dll"), "assembly");

    let plan = infer_deployment_plan(&target, &staged, Some(EVERYTHING_IS_CRAB_STEAM_APPID));

    assert_eq!(plan.layout, ModLayout::MelonLoader);
    assert_eq!(plan.deploy_prefix, "Mods");
    assert_eq!(plan.confidence, "high");
}

#[test]
fn fluffy_style_natives_tree_is_not_treated_as_a_wrapper() {
    let tmp = tempdir().unwrap();
    let dir = tmp.path().join("mods");
    let target = tmp.path().join("game");
    let staged = dir.join("staging").join("nexus-1");
    write_file(&staged.join("natives/stm/example.user.2"), "asset");

    let plan = infer_deployment_plan(&target, &staged, Some(RESIDENT_EVIL_REQUIEM_STEAM_APPID));
    assert_eq!(plan.layout, ModLayout::Raw);
    assert!(plan.deploy_prefix.is_empty());
    assert_eq!(plan.confidence, "high");
    apply_staging_layout(&staged, plan.layout, "Loose Files", "nexus-1").unwrap();

    let cfg = GameMods {
        mods: vec![ModEntry {
            id: "nexus-1".to_string(),
            enabled: true,
            ..Default::default()
        }],
        ..Default::default()
    };
    deploy_to(&dir, &target, &cfg).unwrap();

    assert!(target.join("natives/stm/example.user.2").is_file());
    assert!(!target.join("stm/example.user.2").exists());
}

#[test]
fn loader_registry_matches_official_title_ids() {
    let me3 = loader_compatibility(None, Some(1_245_620));
    assert!(
        me3.iter()
            .find(|loader| loader.name == "Mod Engine 3")
            .unwrap()
            .compatible
    );
    assert!(
        !me3.iter()
            .find(|loader| loader.name == "Lenny's Mod Loader")
            .unwrap()
            .compatible
    );

    let lenny = loader_compatibility(None, Some(1_174_180));
    let loader = lenny
        .iter()
        .find(|loader| loader.name == "Lenny's Mod Loader")
        .unwrap();
    assert!(loader.compatible);
    assert!(loader.reason.contains("Red Dead Redemption 2"));
}

#[test]
fn loader_registry_detects_unity_and_re_engine_files() {
    let tmp = tempdir().unwrap();
    let unity = tmp.path().join("unity");
    write_file(&unity.join("UnityPlayer.dll"), "runtime");
    write_file(&unity.join("Example_Data/globalgamemanagers"), "data");
    let unity_loaders = loader_compatibility(Some(&unity), None);
    assert!(
        unity_loaders
            .iter()
            .find(|loader| loader.name == "MelonLoader")
            .unwrap()
            .compatible
    );

    let re_engine = tmp.path().join("re-engine");
    write_file(&re_engine.join("re_chunk_000.pak"), "pak");
    let fluffy_loaders = loader_compatibility(Some(&re_engine), None);
    assert!(
        fluffy_loaders
            .iter()
            .find(|loader| loader.name == "Fluffy Mod Manager")
            .unwrap()
            .compatible
    );

    let elden_ring = tmp.path().join("elden-ring");
    write_file(&elden_ring.join("eldenring.exe"), "game");
    let mod_engine_loaders = loader_compatibility(Some(&elden_ring), None);
    assert!(
        mod_engine_loaders
            .iter()
            .find(|loader| loader.name == "Mod Engine 3")
            .unwrap()
            .compatible
    );

    let red_dead = tmp.path().join("red-dead");
    write_file(&red_dead.join("RDR2.exe"), "game");
    let lenny_loaders = loader_compatibility(Some(&red_dead), None);
    let lenny = lenny_loaders
        .iter()
        .find(|loader| loader.name == "Lenny's Mod Loader")
        .unwrap();
    assert!(lenny.compatible);
    assert!(lenny.reason.contains("Red Dead Redemption 2"));
}

#[test]
fn mod_engine_package_deploys_with_generated_profile() {
    let tmp = tempdir().unwrap();
    let dir = tmp.path().join("mods");
    let target = tmp.path().join("game");
    write_file(&target.join("eldenring.exe"), "game");
    let staged = dir.join("staging/nexus-77");
    write_file(&staged.join("Archive/mod/parts/example.dcx"), "asset");
    write_file(&staged.join("Archive/natives/example.dll"), "native");
    write_file(&staged.join("Archive/modengine2_launcher.exe"), "bootstrap");

    let plan = infer_deployment_plan(&target, &staged, None);
    assert_eq!(plan.layout, ModLayout::ModEngine3);
    assert_eq!(plan.deploy_prefix, MOD_ENGINE_DEPLOY_ROOT);
    apply_staging_layout(&staged, plan.layout, "Example", "nexus-77").unwrap();

    let cfg = GameMods {
        mods: vec![ModEntry {
            id: "nexus-77".to_string(),
            enabled: true,
            deploy_prefix: plan.deploy_prefix,
            ..Default::default()
        }],
        ..Default::default()
    };
    deploy_to(&dir, &target, &cfg).unwrap();

    assert!(target
        .join(".union-manifold-me3/nexus-77/mod/parts/example.dcx")
        .is_file());
    assert!(target
        .join(".union-manifold-me3/nexus-77/natives/example.dll")
        .is_file());
    assert!(!target
        .join(".union-manifold-me3/nexus-77/mod/modengine2_launcher.exe")
        .exists());
    let profile = std::fs::read_to_string(target.join(MOD_ENGINE_PROFILE)).unwrap();
    assert!(profile.contains("game = \"eldenring\""));
    assert!(profile.contains(".union-manifold-me3/nexus-77/mod"));
    assert!(profile.contains(".union-manifold-me3/nexus-77/natives/example.dll"));

    let disabled = GameMods::default();
    deploy_to(&dir, &target, &disabled).unwrap();
    assert!(!target.join(MOD_ENGINE_PROFILE).exists());
    assert!(!target.join(MOD_ENGINE_DEPLOY_ROOT).exists());
}

#[test]
fn lenny_package_keeps_its_mod_folder_under_lml() {
    let tmp = tempdir().unwrap();
    let dir = tmp.path().join("mods");
    let target = tmp.path().join("game");
    let staged = dir.join("staging/nexus-12");
    write_file(&staged.join("Example LML/install.xml"), "<install />");
    write_file(&staged.join("Example LML/stream/model.ymt"), "asset");

    let plan = infer_deployment_plan(&target, &staged, Some(1_174_180));
    assert_eq!(plan.layout, ModLayout::Lenny);
    assert_eq!(plan.deploy_prefix, "lml");
    apply_staging_layout(&staged, plan.layout, "Example LML", "nexus-12").unwrap();

    let cfg = GameMods {
        mods: vec![ModEntry {
            id: "nexus-12".to_string(),
            enabled: true,
            deploy_prefix: plan.deploy_prefix,
            ..Default::default()
        }],
        ..Default::default()
    };
    deploy_to(&dir, &target, &cfg).unwrap();
    assert!(target.join("lml/Example LML/install.xml").is_file());
    assert!(target.join("lml/Example LML/stream/model.ymt").is_file());
}

#[test]
fn unwrapped_lenny_package_gets_a_stable_mod_folder() {
    let tmp = tempdir().unwrap();
    let staged = tmp.path().join("archive");
    write_file(&staged.join("install.xml"), "<install />");
    write_file(&staged.join("replace/example.dat"), "asset");

    apply_lenny_layout(&staged, "My Mod").unwrap();

    assert!(staged.join("My Mod/install.xml").is_file());
    assert!(staged.join("My Mod/replace/example.dat").is_file());
}

#[test]
fn fluffy_package_drops_manager_metadata_before_deploy() {
    let tmp = tempdir().unwrap();
    let dir = tmp.path().join("mods");
    let target = tmp.path().join("game");
    write_file(&target.join("re_chunk_000.pak"), "game");
    let staged = dir.join("staging/nexus-44");
    write_file(&staged.join("Fluffy Mod/modinfo.ini"), "name=Example");
    write_file(&staged.join("Fluffy Mod/screenshot.png"), "preview");
    write_file(
        &staged.join("Fluffy Mod/natives/stm/example.user.2"),
        "asset",
    );

    let plan = infer_deployment_plan(&target, &staged, None);
    assert_eq!(plan.layout, ModLayout::Fluffy);
    apply_staging_layout(&staged, plan.layout, "Fluffy Mod", "nexus-44").unwrap();
    assert!(!staged.join("modinfo.ini").exists());
    assert!(!staged.join("screenshot.png").exists());

    let cfg = GameMods {
        mods: vec![ModEntry {
            id: "nexus-44".to_string(),
            enabled: true,
            ..Default::default()
        }],
        ..Default::default()
    };
    deploy_to(&dir, &target, &cfg).unwrap();
    assert!(target.join("natives/stm/example.user.2").is_file());
    assert!(!target.join("modinfo.ini").exists());
}

fn mk_entry(id: &str) -> ModEntry {
    ModEntry {
        id: id.to_string(),
        provider: "test".to_string(),
        remote_id: id.to_string(),
        name: id.to_string(),
        enabled: true,
        ..Default::default()
    }
}

fn mk_cfg(entries: Vec<ModEntry>) -> GameMods {
    GameMods {
        appid: "g1".to_string(),
        deploy_target: "Data".to_string(),
        mods: entries,
        ..Default::default()
    }
}

#[test]
fn deploy_to_rolls_back_game_dir_and_journal_on_mid_deploy_failure() {
    let tmp = tempdir().unwrap();
    let game_dir = tmp.path().join("game");
    let target = game_dir.join("Data");
    let staging = game_dir.join("staging");
    write_file(&staging.join("mod1/file.txt"), "v1");

    let one = mk_cfg(vec![mk_entry("mod1")]);
    assert_eq!(deploy_to(&game_dir, &target, &one).unwrap(), 1);
    assert_eq!(
        std::fs::read_to_string(target.join("file.txt")).unwrap(),
        "v1"
    );

    write_file(&staging.join("mod2/deep/c.txt"), "v2");
    write_file(&target.join("deep"), "blocker");
    let two = mk_cfg(vec![mk_entry("mod1"), mk_entry("mod2")]);
    assert!(deploy_to(&game_dir, &target, &two).is_err());

    assert_eq!(
        std::fs::read_to_string(target.join("file.txt")).unwrap(),
        "v1"
    );
    assert_eq!(
        std::fs::read_to_string(target.join("deep")).unwrap(),
        "blocker"
    );
    assert!(!target.join("c.txt").exists());
    let journal = load_journal(&game_dir);
    assert_eq!(journal.files.len(), 1);

    undeploy_from(&game_dir, &target).unwrap();
    assert!(!target.join("file.txt").exists());
    assert!(load_journal(&game_dir).files.is_empty());
}

#[test]
fn deploy_to_restores_backed_up_original_when_a_later_file_fails() {
    let tmp = tempdir().unwrap();
    let game_dir = tmp.path().join("game");
    let target = game_dir.join("Data");
    let staging = game_dir.join("staging");
    write_file(&staging.join("mod1/a.txt"), "mod");
    write_file(&target.join("a.txt"), "original");
    write_file(&staging.join("mod1/deep/b.txt"), "mod");
    write_file(&target.join("deep"), "blocker");

    let one = mk_cfg(vec![mk_entry("mod1")]);
    assert!(deploy_to(&game_dir, &target, &one).is_err());

    assert_eq!(
        std::fs::read_to_string(target.join("a.txt")).unwrap(),
        "original"
    );
    assert_eq!(
        std::fs::read_to_string(target.join("deep")).unwrap(),
        "blocker"
    );
    assert!(!game_dir.join("backup/a.txt").exists());
    assert!(load_journal(&game_dir).files.is_empty());
}

#[test]
fn undeploy_from_keeps_file_when_claimed_backup_is_missing() {
    let tmp = tempdir().unwrap();
    let game_dir = tmp.path().join("game");
    let target = game_dir.join("Data");
    write_file(&target.join("file.txt"), "original");

    let mut j = Journal::default();
    j.files.insert(
        "file.txt".to_string(),
        JournalEntry {
            backup: Some("file.txt".to_string()),
        },
    );
    save_journal(&game_dir, &j).unwrap();

    undeploy_from(&game_dir, &target).unwrap();
    assert_eq!(
        std::fs::read_to_string(target.join("file.txt")).unwrap(),
        "original"
    );
    assert!(load_journal(&game_dir).files.is_empty());
}

#[test]
fn disable_path_keeps_unbacked_file_when_backup_is_missing() {
    let tmp = tempdir().unwrap();
    let game_dir = tmp.path().join("game");
    let target = game_dir.join("Data");
    write_file(&target.join("file.txt"), "original");

    let mut j = Journal::default();
    j.files.insert(
        "file.txt".to_string(),
        JournalEntry {
            backup: Some("file.txt".to_string()),
        },
    );
    save_journal(&game_dir, &j).unwrap();

    let none = mk_cfg(vec![]);
    assert!(deploy_to(&game_dir, &target, &none).is_ok());
    assert_eq!(
        std::fs::read_to_string(target.join("file.txt")).unwrap(),
        "original"
    );
    assert!(load_journal(&game_dir).files.is_empty());
}

#[test]
fn failed_deploy_reconciles_journal_after_restored_stale_file() {
    let tmp = tempdir().unwrap();
    let game_dir = tmp.path().join("game");
    let target = game_dir.join("Data");
    let staging = game_dir.join("staging");
    write_file(&staging.join("mod1/deep/c.txt"), "mod");
    write_file(&target.join("deep/c.txt"), "original");

    let one = mk_cfg(vec![mk_entry("mod1")]);
    assert_eq!(deploy_to(&game_dir, &target, &one).unwrap(), 1);
    assert_eq!(
        std::fs::read_to_string(target.join("deep/c.txt")).unwrap(),
        "mod"
    );

    write_file(&staging.join("mod2/blocked/b.txt"), "mod2");
    write_file(&target.join("blocked"), "blocker");
    let two = mk_cfg(vec![mk_entry("mod2")]);
    assert!(deploy_to(&game_dir, &target, &two).is_err());

    assert_eq!(
        std::fs::read_to_string(target.join("deep/c.txt")).unwrap(),
        "original"
    );
    assert!(!game_dir.join("backup/deep/c.txt").exists());
    assert!(load_journal(&game_dir).files.is_empty());

    undeploy_from(&game_dir, &target).unwrap();
    assert_eq!(
        std::fs::read_to_string(target.join("deep/c.txt")).unwrap(),
        "original"
    );
}

#[test]
fn retry_deploy_preserves_unbacked_original_when_claimed_backup_missing() {
    let tmp = tempdir().unwrap();
    let game_dir = tmp.path().join("game");
    let target = game_dir.join("Data");
    let staging = game_dir.join("staging");
    write_file(&target.join("file.txt"), "original");
    write_file(&staging.join("mod1/file.txt"), "mod");

    let mut j = Journal::default();
    j.files.insert(
        "file.txt".to_string(),
        JournalEntry {
            backup: Some("file.txt".to_string()),
        },
    );
    save_journal(&game_dir, &j).unwrap();

    let one = mk_cfg(vec![mk_entry("mod1")]);
    assert_eq!(deploy_to(&game_dir, &target, &one).unwrap(), 1);
    assert_eq!(
        std::fs::read_to_string(target.join("file.txt")).unwrap(),
        "mod"
    );
    assert_eq!(
        std::fs::read_to_string(game_dir.join("backup/file.txt")).unwrap(),
        "original"
    );

    undeploy_from(&game_dir, &target).unwrap();
    assert_eq!(
        std::fs::read_to_string(target.join("file.txt")).unwrap(),
        "original"
    );
}

#[test]
fn failed_deploy_drops_deleted_backup_less_stale_entry() {
    let tmp = tempdir().unwrap();
    let game_dir = tmp.path().join("game");
    let target = game_dir.join("Data");
    let staging = game_dir.join("staging");
    write_file(&staging.join("mod1/file.txt"), "mod");
    write_file(&staging.join("mod2/blocked/b.txt"), "mod2");

    let one = mk_cfg(vec![mk_entry("mod1")]);
    assert_eq!(deploy_to(&game_dir, &target, &one).unwrap(), 1);
    assert!(target.join("file.txt").is_file());

    write_file(&target.join("blocked"), "blocker");
    let two = mk_cfg(vec![mk_entry("mod2")]);
    assert!(deploy_to(&game_dir, &target, &two).is_err());

    assert!(!target.join("file.txt").exists());
    assert!(load_journal(&game_dir).files.is_empty());
}

#[test]
fn stale_restore_rename_failure_leaves_disk_matching_journal() {
    let tmp = tempdir().unwrap();
    let game_dir = tmp.path().join("game");
    let target = game_dir.join("Data");
    let staging = game_dir.join("staging");
    write_file(&staging.join("mod1/deep/c.txt"), "mod");
    write_file(&target.join("deep/c.txt"), "original");

    let one = mk_cfg(vec![mk_entry("mod1")]);
    assert_eq!(deploy_to(&game_dir, &target, &one).unwrap(), 1);

    std::fs::remove_file(target.join("deep/c.txt")).unwrap();
    std::fs::create_dir_all(target.join("deep/c.txt")).unwrap();
    let none = mk_cfg(vec![]);
    assert!(deploy_to(&game_dir, &target, &none).is_err());

    assert!(target.join("deep/c.txt").is_dir());
    assert_eq!(
        std::fs::read_to_string(game_dir.join("backup/deep/c.txt")).unwrap(),
        "original"
    );
    let journal = load_journal(&game_dir);
    assert_eq!(journal.files.len(), 1);
    assert!(journal.files["deep/c.txt"].backup.is_some());

    std::fs::remove_dir_all(target.join("deep/c.txt")).unwrap();
    undeploy_from(&game_dir, &target).unwrap();
    assert_eq!(
        std::fs::read_to_string(target.join("deep/c.txt")).unwrap(),
        "original"
    );
}

#[test]
fn redeploy_over_existing_file_claims_backup_in_journal() {
    let tmp = tempdir().unwrap();
    let game_dir = tmp.path().join("game");
    let target = game_dir.join("Data");
    let staging = game_dir.join("staging");
    write_file(&staging.join("mod1/file.txt"), "mod-value");

    let one = mk_cfg(vec![mk_entry("mod1")]);
    assert_eq!(deploy_to(&game_dir, &target, &one).unwrap(), 1);
    assert!(load_journal(&game_dir).files["file.txt"].backup.is_none());
    // Warm the verified-comparison cache before simulating a user edit.
    assert_eq!(deploy_to(&game_dir, &target, &one).unwrap(), 1);

    // A same-second rewrite can keep the mtime stamp (coarse filesystem
    // granularity), so make the user edit differ in size: the length gate in
    // same_file is hit deterministically regardless of timestamp resolution.
    write_file(&target.join("file.txt"), "user-edited-file");
    assert_eq!(deploy_to(&game_dir, &target, &one).unwrap(), 1);
    assert_eq!(
        std::fs::read_to_string(target.join("file.txt")).unwrap(),
        "mod-value"
    );
    assert_eq!(
        load_journal(&game_dir).files["file.txt"].backup.as_deref(),
        Some("file.txt")
    );
    assert_eq!(
        std::fs::read_to_string(game_dir.join("backup/file.txt")).unwrap(),
        "user-edited-file"
    );

    undeploy_from(&game_dir, &target).unwrap();
    assert_eq!(
        std::fs::read_to_string(target.join("file.txt")).unwrap(),
        "user-edited-file"
    );
}

#[test]
fn unchanged_redeploy_does_not_rewrite_target_or_journal() {
    let tmp = tempdir().unwrap();
    let game_dir = tmp.path().join("game");
    let target = game_dir.join("Data");
    write_file(&game_dir.join("staging/mod1/file.txt"), "mod");

    let cfg = mk_cfg(vec![mk_entry("mod1")]);
    assert_eq!(deploy_to(&game_dir, &target, &cfg).unwrap(), 1);
    let target_modified = std::fs::metadata(target.join("file.txt"))
        .unwrap()
        .modified()
        .unwrap();
    let journal_modified = std::fs::metadata(journal_path(&game_dir))
        .unwrap()
        .modified()
        .unwrap();

    std::thread::sleep(std::time::Duration::from_millis(25));
    assert_eq!(deploy_to(&game_dir, &target, &cfg).unwrap(), 1);
    assert_eq!(
        std::fs::metadata(target.join("file.txt"))
            .unwrap()
            .modified()
            .unwrap(),
        target_modified
    );
    assert_eq!(
        std::fs::metadata(journal_path(&game_dir))
            .unwrap()
            .modified()
            .unwrap(),
        journal_modified
    );
}

#[test]
fn verified_comparison_detects_same_size_staging_changes() {
    let tmp = tempdir().unwrap();
    let game_dir = tmp.path().join("game");
    let target = game_dir.join("Data");
    let staged = game_dir.join("staging/mod1/file.txt");
    write_file(&staged, "old");

    let cfg = mk_cfg(vec![mk_entry("mod1")]);
    assert_eq!(deploy_to(&game_dir, &target, &cfg).unwrap(), 1);
    assert_eq!(deploy_to(&game_dir, &target, &cfg).unwrap(), 1);

    std::thread::sleep(std::time::Duration::from_millis(25));
    write_file(&staged, "new");
    assert_eq!(deploy_to(&game_dir, &target, &cfg).unwrap(), 1);
    assert_eq!(
        std::fs::read_to_string(target.join("file.txt")).unwrap(),
        "new"
    );
}

#[test]
fn download_progress_is_rate_limited_but_completion_is_immediate() {
    assert!(!should_emit_download_progress(
        Some(20),
        Some(21),
        std::time::Duration::from_millis(199)
    ));
    assert!(should_emit_download_progress(
        Some(20),
        Some(21),
        std::time::Duration::from_millis(200)
    ));
    assert!(should_emit_download_progress(
        Some(99),
        Some(100),
        std::time::Duration::ZERO
    ));
}

#[test]
fn completed_provider_discovery_does_not_repeat_local_snapshots() {
    let mut cfg = GameMods {
        steam_appid: Some(620),
        workshop_supported: Some(false),
        thunderstore_checked: true,
        ..Default::default()
    };
    assert!(discovery_needed_for(&cfg, true));
    cfg.nexus_domain_checked = true;
    assert!(!discovery_needed_for(&cfg, true));
}

#[test]
fn discovery_identity_uses_at_most_one_manifest_snapshot() {
    let calls = std::cell::Cell::new(0);
    let metadata = local_game_metadata_with("custom-game", true, || {
        calls.set(calls.get() + 1);
        Some(json!({
            "appid": "custom-game",
            "metadata": { "name": "Portal 2", "steamAppId": 620 }
        }))
    });
    assert_eq!(metadata.title.as_deref(), Some("Portal 2"));
    assert_eq!(metadata.steam_appid, Some(620));
    assert_eq!(calls.get(), 1);

    let keyed = local_game_metadata_with("steam-620", false, || {
        panic!("a Steam-keyed game does not need a manifest snapshot")
    });
    assert_eq!(keyed.steam_appid, Some(620));
    assert!(keyed.title.is_none());
}

#[test]
#[ignore = "manual representative deployment benchmark"]
fn benchmark_large_tree_noop_redeploy() {
    const FILES: usize = 512;
    const FILE_BYTES: usize = 128 * 1024;

    let tmp = tempdir().unwrap();
    let game_dir = tmp.path().join("mods");
    let target = tmp.path().join("game");
    let staged = game_dir.join("staging/large-mod");
    let mut payload = vec![0x5a; FILE_BYTES];
    for index in 0..FILES {
        payload[0] = index as u8;
        let path = staged.join(format!("chunk-{}/file-{index}.bin", index % 16));
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, &payload).unwrap();
    }
    let cfg = mk_cfg(vec![mk_entry("large-mod")]);
    assert_eq!(deploy_to(&game_dir, &target, &cfg).unwrap(), FILES);

    reset_comparison_metrics();
    let first = std::time::Instant::now();
    assert_eq!(deploy_to(&game_dir, &target, &cfg).unwrap(), FILES);
    let first = first.elapsed();
    let first_bytes = comparison_bytes_read();
    COMPARISON_BYTES_READ.store(0, std::sync::atomic::Ordering::Relaxed);
    let second = std::time::Instant::now();
    assert_eq!(deploy_to(&game_dir, &target, &cfg).unwrap(), FILES);
    let second = second.elapsed();
    let second_bytes = comparison_bytes_read();

    eprintln!(
        "large-tree no-op: files={FILES} bytes={} first_ms={} first_read={} second_ms={} second_read={}",
        FILES * FILE_BYTES,
        first.as_millis(),
        first_bytes,
        second.as_millis(),
        second_bytes
    );
    assert_eq!(first_bytes, 2 * (FILES * FILE_BYTES) as u64);
    assert_eq!(second_bytes, 0);
}
