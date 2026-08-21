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
