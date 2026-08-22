mod achievements;
mod assets;
mod bins;
mod dialogs;
mod downloads;
mod error;
mod http;
mod import;
mod install;
mod launch;
mod library;
mod logging;
mod misc;
mod mods;
mod net;
mod notify;
mod paths;
mod perf;
mod repair;
mod resolver;
mod settings;
mod shortcuts;
mod slipgate;
mod slipgate_managed;
mod sources;
mod state;
mod storage;
mod system;
mod updater;
mod wand;
mod window_cmds;

/// End-to-end probe surface for the `dev-probes` example binary. Compiled
/// only with `--features dev-probes`; production builds never include it.
#[cfg(feature = "dev-probes")]
pub mod probes {
    use std::collections::HashMap;
    use std::path::PathBuf;
    use std::sync::Arc;

    use serde_json::{json, Value};
    use tauri::Manager;

    pub use crate::resolver::solve;

    fn manifest_dir() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
    }

    /// Boot diagnostics: where the sidecars, CA bundle and resources resolve
    /// to in this environment.
    pub fn boot_report(app: &tauri::AppHandle) -> Value {
        let resource_dir = app.path().resource_dir().ok();
        let resource_dir = resource_dir.unwrap_or_else(manifest_dir);
        let cacert = crate::bins::resolve_resource_file(&resource_dir, "cacert.pem");
        json!({
            "resourceDir": resource_dir.to_string_lossy(),
            "cacert": cacert.as_ref().map(|p| p.to_string_lossy()),
            "aria2c": crate::bins::resolve_sidecar("aria2c").as_ref().map(|p| p.to_string_lossy()),
            "sevenZip": crate::bins::resolve_sidecar("7z").as_ref().map(|p| p.to_string_lossy()),
        })
    }

    /// Resolve a download page natively (no webview solver), exactly as the
    /// renderer's first attempt does.
    pub async fn resolve_host(url: &str) -> Value {
        let option = crate::sources::schema::DownloadOption {
            url: Some(url.to_string()),
            ..Default::default()
        };
        let result = crate::sources::hosts::resolve_url(&option).await;
        json!({
            "resolvable": result.resolvable,
            "url": result.url,
            "fileName": result.file_name,
            "headers": result.headers,
            "reason": result.reason,
        })
    }

    /// The full production resolution path: native first, webview-solver
    /// escalation on gate failures, Slipgate fallback.
    pub async fn resolve_via(app: &tauri::AppHandle, url: &str) -> Value {
        let option = crate::sources::schema::DownloadOption {
            url: Some(url.to_string()),
            ..Default::default()
        };
        let result = crate::sources::hosts::resolve_url_via(app, &option).await;
        json!({
            "resolvable": result.resolvable,
            "url": result.url,
            "fileName": result.file_name,
            "headers": result.headers,
            "reason": result.reason,
        })
    }

    /// Run the webview solver against a page and return the raw outcome.
    pub async fn solve_report(app: &tauri::AppHandle, url: &str) -> Value {
        match solve(app, url).await {
            Ok(solved) => json!({
                "ok": true,
                "url": solved.url,
                "fileName": solved.file_name,
                "cookieHeader": solved.cookie_header,
                "userAgent": solved.user_agent,
            }),
            Err(e) => json!({ "ok": false, "error": e }),
        }
    }

    /// Find a fresh download-page URL of `host_type` from the live catalogs.
    pub async fn find_sample(host_type: &str) -> Option<String> {
        let params = crate::sources::QueryParams {
            limit: 60,
            ..Default::default()
        };
        for source in ["zeigames", "gamebounty"] {
            let games = match source {
                "zeigames" => crate::sources::adapters::zeigames::query(&params).await,
                _ => crate::sources::adapters::gamebounty::query(&params).await,
            }
            .unwrap_or_default();
            for game in games {
                let Some(detail) = (match source {
                    "zeigames" => {
                        crate::sources::adapters::zeigames::get_detail(&game.source_slug).await
                    }
                    _ => crate::sources::adapters::gamebounty::get_detail(&game.source_slug).await,
                }) else {
                    continue;
                };
                if let Some(option) = detail
                    .download_options
                    .iter()
                    .find(|o| o.host_type == host_type)
                {
                    return option.url.clone().or(option.page_url.clone());
                }
            }
        }
        None
    }

    /// Range-check a direct URL with optional headers; proves the link is a
    /// real downloadable file rather than an HTML page.
    pub async fn range_check(url: &str, headers: HashMap<String, String>) -> Value {
        let mut headers = headers;
        headers.insert("Range".to_string(), "bytes=0-0".to_string());
        let opts = crate::http::FetchOpts {
            headers,
            retries: Some(1),
            timeout: Some(std::time::Duration::from_secs(30)),
            ..Default::default()
        };
        match crate::http::fetch(url, &opts).await {
            Ok(resp) => {
                let status = resp.status().as_u16();
                let content_type = resp
                    .headers()
                    .get(reqwest::header::CONTENT_TYPE)
                    .and_then(|v| v.to_str().ok())
                    .unwrap_or("")
                    .to_string();
                json!({ "status": status, "contentType": content_type, "html": content_type.contains("text/html") })
            }
            Err(e) => json!({ "status": 0, "error": e.to_string() }),
        }
    }

    /// Full download-engine E2E: enqueue `url` through aria2 and wait for the
    /// file to land on disk.
    pub async fn download_e2e(
        app: &tauri::AppHandle,
        url: &str,
        filename: &str,
        headers: Option<HashMap<String, String>>,
    ) -> Value {
        let settings = Arc::new(crate::settings::SettingsStore::load(
            std::env::temp_dir().join("union-manifold-probe-settings.json"),
        ));
        let resource_dir = app.path().resource_dir().ok();
        let cacert =
            crate::downloads::aria2::resolve_ca_cert(resource_dir.or_else(|| Some(manifest_dir())));
        let aria2 = Arc::new(crate::downloads::aria2::Aria2Manager::new(cacert, None));
        let root = std::env::temp_dir().join("union-manifold-probe-downloads");
        let engine =
            crate::downloads::DownloadEngine::new(app.clone(), settings, root.clone(), aria2);
        let appid = "probe-appid";
        let req = crate::downloads::DownloadRequest {
            appid: appid.to_string(),
            id: format!("{appid}-1"),
            game_name: Some("Probe Game".to_string()),
            url: url.to_string(),
            filename: Some(filename.to_string()),
            total_bytes: 0,
            headers,
            part_index: None,
            part_total: None,
            update: false,
            install_metadata: None,
            preserve_existing: false,
        };
        if let Err(e) = engine.enqueue(req) {
            return json!({ "ok": false, "stage": "enqueue", "error": e.to_string() });
        }
        let save_path = root.join("Probe Game").join(filename);
        let started = std::time::Instant::now();
        loop {
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            let status = engine.active_status(appid);
            let downloading = status
                .get("downloading")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let size = std::fs::metadata(&save_path).map(|m| m.len()).unwrap_or(0);
            if !downloading && size > 0 {
                return json!({
                    "ok": true,
                    "path": save_path.to_string_lossy(),
                    "bytes": size,
                    "elapsedMs": started.elapsed().as_millis(),
                });
            }
            if started.elapsed() > std::time::Duration::from_secs(120) {
                return json!({
                    "ok": false,
                    "stage": "timeout",
                    "downloading": downloading,
                    "bytes": size,
                    "savePath": save_path.to_string_lossy(),
                });
            }
        }
    }

    /// Diagnose the session-page fetch behind datanodes token scraping.
    pub async fn page_check(url: &str, cookie: &str, ua: &str) -> Value {
        let mut headers = HashMap::new();
        if !cookie.is_empty() {
            headers.insert("Cookie".to_string(), cookie.to_string());
        }
        if !ua.is_empty() {
            headers.insert("User-Agent".to_string(), ua.to_string());
        }
        match crate::http::fetch(
            url,
            &crate::http::FetchOpts {
                headers,
                timeout: Some(std::time::Duration::from_secs(30)),
                ..Default::default()
            },
        )
        .await
        {
            Ok(resp) => {
                let status = resp.status().as_u16();
                let final_url = resp.url().to_string();
                let body = resp.text().await.unwrap_or_default();
                json!({
                    "status": status,
                    "finalUrl": final_url,
                    "len": body.len(),
                    "hasRand": body.contains("rand=\""),
                    "hasDlToken": body.contains("dl-token=\""),
                    "head": body.chars().take(200).collect::<String>(),
                })
            }
            Err(e) => json!({ "error": e.to_string() }),
        }
    }

    /// Smallest dependency-free, non-deprecated packages in a community,
    /// smallest first: real content but fast downloads for the E2E.
    pub async fn thunderstore_candidates(
        paths: &crate::paths::AppPaths,
        community: &str,
    ) -> Vec<(String, String)> {
        let Ok(packages) = crate::mods::thunderstore::load_packages(paths, community).await else {
            return Vec::new();
        };
        let mut cands: Vec<(u64, String, String)> = packages
            .iter()
            .filter(|p| !p.deprecated && !p.versions.is_empty())
            .filter_map(|p| {
                let v = p.versions.last()?;
                if !v.dependencies.is_empty() {
                    return None;
                }
                let size = v.size_bytes;
                if (2_000..=3_000_000).contains(&size) {
                    Some((size, p.full_name.clone(), v.version.clone()))
                } else {
                    None
                }
            })
            .collect();
        cands.sort();
        cands
            .into_iter()
            .map(|(_, full, ver)| (full, ver))
            .collect()
    }

    /// Mods subsystem end-to-end: fake installed game -> live Thunderstore
    /// package install -> deploy -> toggle -> undeploy, verifying config,
    /// staging, deployed files and the journal at every step.
    pub async fn mods_e2e(app: &tauri::AppHandle) -> Value {
        use crate::library;
        use crate::mods::{
            deploy_to, game_mods_dir, load_config, resolve_game_root, save_config, undeploy_from,
            GameMods,
        };
        use crate::state::AppState;
        use tauri::Manager;

        let appid = "steam-2060160"; // The Farmer Was Replaced: forced BepInEx
        let community = "riskofrain2";
        let full_name = "RiskofThunder-FixPlugin";
        let mut stages: Vec<Value> = Vec::new();
        fn push_stage(stages: &mut Vec<Value>, name: &str, ok: bool, detail: Value) -> bool {
            stages.push(json!({ "stage": name, "ok": ok, "detail": detail }));
            ok
        }

        // Isolated root + fake installed game.
        let root = std::env::temp_dir().join(format!("union-probe-mods-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let library_dir = root.join("library");
        let game_files = library_dir.join("Probe Game");
        std::fs::create_dir_all(&game_files).ok();
        std::fs::write(game_files.join("UnityPlayer.dll"), b"probe").ok();
        std::fs::write(
            game_files.join("installed.json"),
            json!({ "appid": appid, "name": "Probe Game", "installStatus": "downloaded" })
                .to_string(),
        )
        .ok();

        let paths = Arc::new(crate::paths::AppPaths::for_data_root(root.join("data")));
        let settings = Arc::new(crate::settings::SettingsStore::load(paths.settings_file()));
        settings.set(
            "downloadPath",
            json!(library_dir.to_string_lossy().to_string()),
        );
        if app.try_state::<AppState>().is_none() {
            let achievements =
                crate::achievements::AchievementService::new(paths.data_dir.join("a.json"));
            let aria2 = Arc::new(crate::downloads::aria2::Aria2Manager::new(None, None));
            let downloads = crate::downloads::DownloadEngine::new(
                app.clone(),
                settings.clone(),
                crate::paths::default_download_root(&paths.data_dir),
                aria2,
            );
            app.manage(AppState {
                paths: paths.clone(),
                settings: settings.clone(),
                sources: Arc::new(crate::sources::Registry::new(&[])),
                downloads,
                achievements,
            });
        }
        let state = app.state::<AppState>();
        let paths = state.paths.clone();

        // Seed config: forced BepInEx via title id.
        save_config(
            &paths,
            appid,
            &GameMods {
                steam_appid: Some(2060160),
                thunderstore_community: Some(community.to_string()),
                ..Default::default()
            },
        );

        // 1. Live install of a tiny dependency-free package, auto-picked
        // from the community index (catalog contents rotate constantly).
        let mods_dir = game_mods_dir(&paths, appid);
        let candidates = thunderstore_candidates(&paths, community).await;
        let mut full_name = full_name.to_string();
        let mut install_result: Result<usize, String> =
            Err("no candidate package surfaced".to_string());
        for (idx, (cand_full, cand_ver)) in candidates.iter().take(5).enumerate() {
            full_name = cand_full.clone();
            let attempt = match crate::mods::thunderstore::resolve_install(
                &paths, community, &full_name, cand_ver,
            )
            .await
            {
                Ok(resolved) => {
                    let n = resolved.len();
                    crate::mods::thunderstore::install_batch(
                        app,
                        appid,
                        &format!("thunderstore-{full_name}"),
                        full_name.rsplit('-').next().unwrap_or(full_name.as_str()),
                        &resolved,
                    )
                    .await
                    .map(|_| n)
                }
                Err(e) => Err(e),
            };
            match attempt {
                Ok(n) => {
                    install_result = Ok(n);
                    break;
                }
                Err(e) => {
                    stages.push(json!({
                        "stage": format!("install-attempt-{}", idx + 1),
                        "ok": false,
                        "detail": { "package": full_name, "error": e }
                    }));
                }
            }
        }
        match &install_result {
            Ok(n) => {
                push_stage(&mut stages, "install", true, json!({ "resolved": n }));
            }
            Err(e) => {
                push_stage(&mut stages, "install", false, json!(e.clone()));
            }
        }

        // 2. Config entry + staging on disk.
        let cfg_after_install = load_config(&paths, appid);
        let installed_id = format!("thunderstore-{full_name}");
        let staged_ok = cfg_after_install
            .mods
            .iter()
            .any(|m| m.id == installed_id && m.enabled)
            && mods_dir.join("staging").join(&installed_id).is_dir();
        push_stage(
            &mut stages,
            "config-and-staging",
            staged_ok,
            json!({
                "package": installed_id,
                "entries": cfg_after_install.mods.iter().map(|m| m.id.clone()).collect::<Vec<_>>(),
            }),
        );

        // Deploy target through the real library scan.
        let roots = library::scan_roots(&state);
        let target = library::game_files_dir(&roots, appid)
            .map(|base| resolve_game_root(&base))
            .unwrap_or_else(|| game_files.clone());

        // 3. Deploy: BepInEx tree must land in the game dir; journal written.
        let mut cfg = load_config(&paths, appid);
        let deploy_result = deploy_to(&mods_dir, &target, &cfg);
        let deployed_ok = deploy_result.is_ok() && {
            let plugins = target.join("BepInEx").join("plugins");
            std::fs::read_dir(&plugins)
                .map(|rd| rd.flatten().count() > 0)
                .unwrap_or(false)
        };
        push_stage(
            &mut stages,
            "deploy",
            deployed_ok,
            json!({
                "files": deploy_result.unwrap_or_default(),
                "target": target.to_string_lossy(),
            }),
        );

        // 4. Disable: deployed plugin files must disappear from the target.
        for m in cfg.mods.iter_mut() {
            m.enabled = false;
        }
        save_config(&paths, appid, &cfg);
        let _ = deploy_to(&mods_dir, &target, &cfg);
        let disabled_ok = !std::path::Path::new(&target)
            .join("BepInEx")
            .join("plugins")
            .read_dir()
            .map(|rd| rd.flatten().count() > 0)
            .unwrap_or(false);
        push_stage(&mut stages, "disable", disabled_ok, json!({}));

        // 5. Re-enable: files come back.
        for m in cfg.mods.iter_mut() {
            m.enabled = true;
        }
        save_config(&paths, appid, &cfg);
        let _ = deploy_to(&mods_dir, &target, &cfg);
        let reenabled_ok = std::path::Path::new(&target)
            .join("BepInEx")
            .join("plugins")
            .read_dir()
            .map(|rd| rd.flatten().count() > 0)
            .unwrap_or(false);
        push_stage(&mut stages, "re-enable", reenabled_ok, json!({}));

        // 6. Undeploy: journal cleared, no mod leftovers in the game dir.
        let undeploy_result = undeploy_from(&mods_dir, &target);
        let journal_empty = crate::mods::journal_is_empty(&mods_dir);
        let leftovers = std::path::Path::new(&target).join("BepInEx").exists();
        push_stage(
            &mut stages,
            "undeploy",
            undeploy_result.is_ok() && journal_empty && !leftovers,
            json!({
                "journalEmpty": journal_empty,
                "bepinexLeftover": leftovers,
            }),
        );

        // Cleanup probe artifacts.
        let _ = std::fs::remove_dir_all(&mods_dir);
        let _ = std::fs::remove_dir_all(&root);

        let all_ok = stages.iter().all(|s| s["ok"].as_bool().unwrap_or(false));
        json!({ "ok": all_ok, "stages": stages })
    }

    /// Workshop end-to-end: bootstrap SteamCMD from Valve's CDN, find a
    /// real workshop item on a title whose downloads allow anonymous
    /// SteamCMD, and pull it through the production download path.
    pub async fn workshop_e2e() -> Value {
        use crate::paths::AppPaths;
        let mut stages: Vec<Value> = Vec::new();

        let root = std::env::temp_dir().join(format!("union-probe-ws-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let paths = AppPaths::for_data_root(root.join("data"));

        // Project Zomboid and Don't Starve Together historically allow
        // anonymous SteamCMD downloads; try them in order.
        for appid in [108600u64, 322330u64] {
            let Some(item) = crate::mods::workshop::first_workshop_item(appid).await else {
                stages.push(json!({
                    "stage": format!("browse-{appid}"), "ok": false,
                    "detail": "no item surfaced on the public listing",
                }));
                continue;
            };
            let file_id: u64 = match item.parse() {
                Ok(v) => v,
                Err(_) => continue,
            };
            stages.push(json!({
                "stage": format!("browse-{appid}"), "ok": true,
                "detail": { "fileId": file_id },
            }));
            let started = std::time::Instant::now();
            match crate::mods::steamcmd::run_workshop_download(&paths, appid, file_id).await {
                Ok(content_dir) => {
                    let bytes = dir_size_quick(&content_dir);
                    stages.push(json!({
                        "stage": format!("download-{appid}"), "ok": true,
                        "detail": {
                            "contentDir": content_dir.to_string_lossy(),
                            "bytes": bytes,
                            "elapsedMs": started.elapsed().as_millis(),
                        },
                    }));
                    let _ = std::fs::remove_dir_all(&root);
                    return json!({ "ok": true, "stages": stages });
                }
                Err(e) => {
                    stages.push(json!({
                        "stage": format!("download-{appid}"), "ok": false,
                        "detail": e,
                    }));
                }
            }
        }
        let _ = std::fs::remove_dir_all(&root);
        json!({
            "ok": false,
            "stages": stages,
            "note": "anonymous SteamCMD downloads were refused by every tried title",
        })
    }

    fn dir_size_quick(dir: &std::path::Path) -> u64 {
        walkdir::WalkDir::new(dir)
            .into_iter()
            .filter_map(|e| e.ok())
            .filter_map(|e| e.metadata().ok())
            .filter(|m| m.is_file())
            .map(|m| m.len())
            .sum()
    }

    /// Settings persistence sweep over every app-level key.
    pub fn settings_sweep(path: PathBuf) -> Value {
        let store = Arc::new(crate::settings::SettingsStore::load(path.clone()));
        let cases: Vec<(&str, Value)> = vec![
            ("achievementNotifications", json!(false)),
            ("autoCheckUpdates", json!(false)),
            ("closeBehavior", json!("quit")),
            ("closeOnGameLaunch", json!(true)),
            ("disabledSources", json!(["gamebounty"])),
            ("downloadBandwidthLimitKBps", json!(1024)),
            ("downloadPath", json!("/tmp/probe-downloads")),
            ("hideTorrentSources", json!(true)),
            ("maxConcurrentDownloads", json!(5)),
            ("nexusApiKey", json!("probe-key")),
            ("onlineFixEnabled", json!(true)),
            ("proxyUrl", json!("http://127.0.0.1:8080")),
            ("slipgateKey", json!("probe-slipgate")),
            ("slipgateUrl", json!("http://127.0.0.1:1")),
            ("startMinimized", json!(true)),
            ("theme", json!("probe-theme")),
        ];
        for (key, value) in &cases {
            store.set(key, value.clone());
        }
        // Reload from disk: everything must survive the round trip.
        let reloaded = crate::settings::SettingsStore::load(path.clone());
        let mut failures = Vec::new();
        for (key, value) in &cases {
            if reloaded.get(key) != *value {
                failures.push((*key).to_string());
            }
        }
        // Null deletes.
        store.set("theme", Value::Null);
        let after_delete = crate::settings::SettingsStore::load(path).get("theme");
        if !after_delete.is_null() {
            failures.push("theme:null-delete".to_string());
        }
        json!({
            "checked": cases.len() + 1,
            "failures": failures,
            "ok": failures.is_empty(),
        })
    }
}

use std::sync::Arc;

use tauri::{Emitter, Manager};

use achievements::AchievementService;
use downloads::aria2::Aria2Manager;
use downloads::DownloadEngine;
use paths::{default_download_root, AppPaths};
use settings::SettingsStore;
use sources::Registry;
use state::AppState;

fn should_exit_main_window(downloading: usize, extracting: usize) -> bool {
    downloading == 0 && extracting == 0
}

const MAIN_TRAY_ID: &str = "main-tray";

pub(crate) fn hide_app_ui(app: &tauri::AppHandle) {
    if let Some(main) = app.get_webview_window("main") {
        main.hide().ok();
    }
    if let Some(tray) = app.tray_by_id(MAIN_TRAY_ID) {
        tray.set_visible(false).ok();
    }
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(tray) = app.tray_by_id(MAIN_TRAY_ID) {
        tray.set_visible(true).ok();
    }
    if let Some(main) = app.get_webview_window("main") {
        main.show().ok();
        main.unminimize().ok();
        main.set_focus().ok();
    }
}

fn emit_deep_link(app: &tauri::AppHandle, arg: &str) {
    let path = arg
        .split_once("://")
        .map(|(_, rest)| format!("/{}", rest.trim_start_matches('/')))
        .unwrap_or_else(|| arg.to_string());
    show_main_window(app);
    if let Some(main) = app.get_webview_window("main") {
        main.emit("uc:navigation-action", serde_json::json!({ "path": path }))
            .ok();
    }
}

fn install_panic_hook() {
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let msg = info
            .payload()
            .downcast_ref::<&str>()
            .copied()
            .or_else(|| info.payload().downcast_ref::<String>().map(String::as_str))
            .unwrap_or("<non-string panic payload>");
        let location = info
            .location()
            .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
            .unwrap_or_else(|| "<unknown>".to_string());
        let thread = std::thread::current();
        logging::write_line(
            "fatal",
            &format!(
                "panic on thread '{}' at {location}: {msg}",
                thread.name().unwrap_or("<unnamed>")
            ),
        );
        default_hook(info);
    }));
}

// WebKitGTK wheel scrolling is discrete by default: each notch is one jump,
// which reads as "chunky". The JS shim in renderer/src/lib/wheel-smooth.ts
// (gated to Linux in main.tsx) converts ticks into an animated glide, so the
// native enable-smooth-scrolling flag stays OFF — enabling both made them
// fight each other (double-applied deltas, stutter during resizes).
#[cfg(target_os = "linux")]
pub(crate) fn enable_smooth_scrolling(_window: &tauri::WebviewWindow) {}

#[cfg(not(target_os = "linux"))]
pub(crate) fn enable_smooth_scrolling(_window: &tauri::WebviewWindow) {}

pub fn run() {
    install_panic_hook();
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(arg) = argv.iter().find(|a| a.contains("://")) {
                if arg.starts_with("nxm://") {
                    mods::nexus::handle_nxm(app, arg);
                } else if arg.starts_with("wemod://oauth") {
                    show_main_window(app);
                    wand::handle_deep_link(app, arg);
                } else {
                    emit_deep_link(app, arg);
                }
            } else {
                show_main_window(app);
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .register_asynchronous_uri_scheme_protocol("uc-asset", |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            let uri = request.uri().to_string();
            let origin = request
                .headers()
                .get("origin")
                .and_then(|value| value.to_str().ok())
                .map(str::to_string);
            tauri::async_runtime::spawn(async move {
                let (status, body, ct) = assets::respond(app, uri).await;
                let mut builder = tauri::http::Response::builder()
                    .status(status)
                    .header("Content-Type", ct);
                // Only the app's own webview origins may read responses, so
                // a compromised page hosted anywhere else cannot exfiltrate
                // files through this protocol.
                if let Some(origin) = origin.as_deref() {
                    if origin == "tauri://localhost" || origin == "http://tauri.localhost" {
                        builder = builder.header("Access-Control-Allow-Origin", origin);
                    }
                }
                if status == 200 {
                    builder = builder.header("Cache-Control", "public, max-age=604800, immutable");
                }
                responder.respond(builder.body(body).unwrap());
            });
        })
        .setup(|app| {
            let handle = app.handle().clone();
            let paths = Arc::new(AppPaths::resolve(&handle)?);
            sources::metacache::init(paths.data_dir.join("metadata"));
            logging::init(paths.log_file());
            let settings = Arc::new(SettingsStore::load(paths.settings_file()));
            slipgate::init(settings.clone());
            crate::settings::init(settings.clone());
            // Migrate the legacy disabledSources entry for Online-Fix (it used
            // to be lumped with the torrent-only sources) into the dedicated
            // onlineFixEnabled toggle before the registry is built.
            if settings.get("onlineFixEnabled").is_null() {
                let was_disabled = crate::settings::legacy_onlinefix_disabled(&settings);
                settings.set("onlineFixEnabled", serde_json::json!(!was_disabled));
            }
            crate::http::set_proxy(settings.get_string("proxyUrl"));
            let cacert = crate::downloads::aria2::resolve_ca_cert(app.path().resource_dir().ok());
            let aria2 = Arc::new(Aria2Manager::new(cacert, settings.get_string("proxyUrl")));
            let disabled_sources: Vec<String> = settings
                .get("disabledSources")
                .as_array()
                .map(|a| {
                    a.iter()
                        .filter_map(|v| v.as_str().map(String::from))
                        .map(|id| {
                            if id == "rexagames" {
                                "zeigames".to_string()
                            } else {
                                id
                            }
                        })
                        .collect()
                })
                .unwrap_or_default();
            let sources = Arc::new(Registry::new(&disabled_sources));
            let default_root = default_download_root(&paths.data_dir);
            let downloads =
                DownloadEngine::new(handle.clone(), settings.clone(), default_root, aria2);
            let achievements = AchievementService::new(paths.data_dir.join("achievements.json"));
            let managed_paths = paths.clone();
            let managed_settings = settings.clone();
            app.manage(AppState {
                paths,
                settings,
                sources,
                downloads,
                achievements,
            });
            let managed_handle = handle.clone();
            tauri::async_runtime::spawn(async move {
                slipgate_managed::autostart(managed_handle, managed_paths, managed_settings).await;
            });
            let hydra_handle = handle.clone();
            tauri::async_runtime::spawn(async move {
                sources::warm_hydralinks(hydra_handle).await;
            });
            build_tray(app)?;
            if let Some(window) = app.get_webview_window("main") {
                enable_smooth_scrolling(&window);
            }
            {
                let state: tauri::State<AppState> = app.state();
                let start_minimized = state
                    .settings
                    .get("startMinimized")
                    .as_bool()
                    .unwrap_or(false);
                if start_minimized {
                    if let Some(main) = app.get_webview_window("main") {
                        main.hide().ok();
                    }
                } else {
                    show_main_window(&handle);
                }
                if state
                    .settings
                    .get("autoCheckUpdates")
                    .as_bool()
                    .unwrap_or(true)
                {
                    let handle2 = handle.clone();
                    tauri::async_runtime::spawn(async move {
                        tokio::time::sleep(std::time::Duration::from_secs(20)).await;
                        updater::notify_if_update_available(&handle2).await;
                    });
                }
            }
            #[cfg(desktop)]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                app.deep_link().register_all().ok();
                let nxm_handle = handle.clone();
                app.deep_link().on_open_url(move |event| {
                    for url in event.urls() {
                        let s = url.to_string();
                        if s.starts_with("nxm://") {
                            mods::nexus::handle_nxm(&nxm_handle, &s);
                        } else if s.starts_with("wemod://oauth") {
                            show_main_window(&nxm_handle);
                            wand::handle_deep_link(&nxm_handle, &s);
                        } else {
                            emit_deep_link(&nxm_handle, &s);
                        }
                    }
                });
            }
            #[cfg(target_os = "linux")]
            if let Some(main) = app.get_webview_window("main") {
                // No native set_enable_smooth_scrolling here: the renderer's
                // wheel shim (wheel-smooth.ts, Linux-gated in main.tsx) owns
                // smoothing; enabling the WebKitGTK flag on top made both
                // animate the same deltas and fight each other.
                let _ = main;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            settings::setting_get,
            settings::setting_set,
            settings::setting_merge_library_game_meta,
            logging::log,
            window_cmds::window_minimize,
            window_cmds::window_maximize,
            window_cmds::window_close,
            window_cmds::app_close_response,
            system::system_open_external,
            system::system_launch_steam,
            system::steam_game_run,
            import::import_exe,
            import::import_set_steam_appid,
            import::custom_image_import,
            import::steam_library_scan,
            import::steam_library_import,
            system::download_open,
            achievements::achievements_list,
            achievements::achievements_toast_hide,
            achievements::achievements_toast_pull,
            achievements::achievements_test_notification,
            sources::sources_list,
            sources::sources_set_enabled,
            sources::sources_onlinefix_status,
            sources::sources_onlinefix_set_enabled,
            sources::sources_query,
            sources::sources_cancel,
            sources::sources_search,
            wand::wand_lookup,
            wand::wand_launch,
            wand::wand_auth_begin,
            wand::wand_disconnect,
            wand::wand_trainer,
            wand::wand_control,
            wand::wand_stop,
            sources::sources_detail,
            sources::sources_resolve,
            sources::sources_steam_art,
            sources::sources_steam_meta,
            sources::sources_protondb,
            sources::sources_capabilities,
            sources::sources_refresh,
            downloads::download_start,
            downloads::download_pause,
            downloads::download_resume,
            downloads::download_cancel,
            downloads::download_active_status,
            downloads::downloads_state_load,
            downloads::downloads_state_save,
            downloads::catalog_state_load,
            downloads::catalog_state_save,
            downloads::download_path_get,
            install::install_from_archive,
            install::install_downloaded_archive,
            install::delete_archive_files,
            repair::onlinefix_repair,
            library::installing_get,
            library::library_list,
            library::installed_list,
            library::installed_appids,
            library::installed_get,
            library::installing_list,
            library::installed_save,
            library::installed_update_metadata,
            library::installing_status_set,
            library::installed_delete,
            library::installing_delete,
            launch::game_exe_list,
            launch::game_subfolder_find,
            launch::game_exe_preflight,
            launch::game_exe_launch,
            launch::game_exe_running_list,
            launch::game_exe_quit,
            launch::linux::game_linux_config_get,
            launch::linux::game_linux_config_set,
            launch::linux::linux_detect_proton,
            storage::storage_precheck,
            assets::assets_size,
            assets::assets_clear,
            updater::check_for_updates,
            updater::install_update,
            updater::get_version,
            shortcuts::create_desktop_shortcut,
            shortcuts::delete_desktop_shortcut,
            dialogs::download_path_pick,
            dialogs::pick_image,
            dialogs::browse_for_game_exe,
            dialogs::pick_archive_files,
            dialogs::archive_files_stat,
            dialogs::linux_pick_binary,
            dialogs::linux_pick_prefix_dir,
            misc::theme_editor_open,
            misc::theme_editor_close,
            misc::theme_preview,
            misc::theme_preview_end,
            misc::autostart_get,
            misc::autostart_set,
            dialogs::folder_pick,
            net::auth_fetch,
            mods::mods_game_get,
            mods::mods_game_set,
            mods::mods_deploy_target_pick,
            mods::mods_toggle,
            mods::mods_reorder,
            mods::mods_uninstall,
            mods::mods_deploy,
            mods::mods_undeploy,
            mods::mods_open_folder,
            mods::nexus::nexus_validate,
            mods::nexus::nexus_search,
            mods::nexus::nexus_browse,
            mods::nexus::nexus_mod_files,
            mods::nexus::nexus_install,
            mods::nexus::slipgate_check,
            resolver::resolver_solve_start,
            resolver::resolver_solve_cancel,
            slipgate_managed::managed_slipgate_status,
            slipgate_managed::managed_slipgate_install,
            slipgate_managed::managed_slipgate_start,
            slipgate_managed::managed_slipgate_stop,
            slipgate_managed::managed_slipgate_update,
            slipgate_managed::managed_slipgate_uninstall,
            mods::workshop::workshop_browse,
            perf::perf_enabled,
            perf::perf_dump,
            mods::workshop::workshop_install,
            mods::workshop::workshop_status,
            mods::thunderstore::thunderstore_communities,
            mods::thunderstore::thunderstore_browse,
            mods::thunderstore::thunderstore_versions,
            mods::thunderstore::thunderstore_install,
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                // The solver window closing (user dismissed the challenge)
                // cancels the active solve; the poll loop notices and unwinds.
                if window.label() == "resolver" {
                    resolver::note_window_closed();
                    return;
                }
            }
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() != "main" {
                    return;
                }
                let state = window.app_handle().state::<AppState>();
                if state.settings.get_string("closeBehavior").as_deref() != Some("quit") {
                    api.prevent_close();
                    window.hide().ok();
                    return;
                }
                api.prevent_close();
                let (downloading, extracting) = state.downloads.busy_appids();
                if should_exit_main_window(downloading, extracting.len()) {
                    window.app_handle().exit(0);
                } else {
                    window
                        .emit(
                            "uc:app-close-requested",
                            serde_json::json!({
                                "mode": "quit",
                                "extractionCount": extracting.len(),
                                "downloadCount": downloading,
                                "appids": extracting,
                            }),
                        )
                        .ok();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error building union.manifold")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                sources::metacache::flush_all();
                if let Some(state) = app.try_state::<AppState>() {
                    achievements::stop_all(&state);
                    state.downloads.aria2().stop();
                }
            }
        });
}

fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    use tauri::menu::{MenuBuilder, MenuItemBuilder};
    use tauri::tray::TrayIconBuilder;

    let show = MenuItemBuilder::with_id("show", "Show Union.Manifold").build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
    let menu = MenuBuilder::new(app).items(&[&show, &quit]).build()?;

    let mut builder = TrayIconBuilder::with_id(MAIN_TRAY_ID)
        .menu(&menu)
        .tooltip("Union.Manifold")
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => {
                show_main_window(app);
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let tauri::tray::TrayIconEvent::Click { .. } = event {
                show_main_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }
    builder.build(app)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::should_exit_main_window;

    #[test]
    fn quit_close_exits_without_active_downloads() {
        assert!(should_exit_main_window(0, 0));
        assert!(!should_exit_main_window(1, 0));
        assert!(!should_exit_main_window(0, 1));
    }
}
