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
mod net;
mod notify;
mod paths;
mod settings;
mod shortcuts;
mod sources;
mod state;
mod storage;
mod system;
mod updater;
mod window_cmds;

use std::sync::Arc;

use tauri::{Emitter, Manager};

use downloads::aria2::Aria2Manager;
use downloads::DownloadEngine;
use paths::{default_download_root, AppPaths};
use settings::SettingsStore;
use sources::Registry;
use state::AppState;

fn emit_deep_link(app: &tauri::AppHandle, arg: &str) {
    let path = arg
        .split_once("://")
        .map(|(_, rest)| format!("/{}", rest.trim_start_matches('/')))
        .unwrap_or_else(|| arg.to_string());
    if let Some(main) = app.get_webview_window("main") {
        main.set_focus().ok();
        main.emit("uc:navigation-action", serde_json::json!({ "path": path })).ok();
    }
}

/// With `panic = "abort"` in release, any panic on any thread kills the whole
/// process with nothing in our log — user reports become "the app closed
/// itself". Log the panic (message + location + thread) through the buffered
/// log before the abort so a crash is diagnosable from a bug report. Writes
/// before logging::init (early startup) are dropped by write_line, same as
/// every other pre-init log line.
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
            &format!("panic on thread '{}' at {location}: {msg}", thread.name().unwrap_or("<unnamed>")),
        );
        default_hook(info);
    }));
}

pub fn run() {
    install_panic_hook();
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(arg) = argv.iter().find(|a| a.contains("://")) {
                emit_deep_link(app, arg);
            } else if let Some(main) = app.get_webview_window("main") {
                main.set_focus().ok();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        .register_asynchronous_uri_scheme_protocol("uc-asset", |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            let uri = request.uri().to_string();
            tauri::async_runtime::spawn(async move {
                let (status, body, ct) = assets::respond(app, uri).await;
                let mut builder = tauri::http::Response::builder()
                    .status(status)
                    .header("Content-Type", ct)
                    .header("Access-Control-Allow-Origin", "*");
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
            let cacert = app.path().resource_dir().ok().map(|d| d.join("cacert.pem"));
            let aria2 = Arc::new(Aria2Manager::new(cacert));
            let disabled_sources: Vec<String> = settings
                .get("disabledSources")
                .as_array()
                .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
                .unwrap_or_default();
            let sources = Arc::new(Registry::new(&disabled_sources));
            let sources_warm = sources.clone();
            let default_root = default_download_root(&paths.data_dir);
            let downloads = DownloadEngine::new(handle.clone(), settings.clone(), default_root, aria2);
            app.manage(AppState {
                paths,
                settings,
                sources,
                downloads,
            });
            tauri::async_runtime::spawn(async move {
                sources::warm_catalog(&sources_warm).await;
            });
            build_tray(app)?;
            {
                let state: tauri::State<AppState> = app.state();
                if state.settings.get("startMinimized").as_bool().unwrap_or(false) {
                    if let Some(main) = app.get_webview_window("main") {
                        main.hide().ok();
                    }
                }
                if state.settings.get("autoCheckUpdates").as_bool().unwrap_or(true) {
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
            }
            #[cfg(target_os = "linux")]
            if let Some(main) = app.get_webview_window("main") {
                main.with_webview(|webview| {
                    use webkit2gtk::{SettingsExt, WebViewExt};
                    let wv = webview.inner();
                    if let Some(settings) = WebViewExt::settings(&wv) {
                        settings.set_enable_smooth_scrolling(true);
                    }
                })
                .ok();
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            settings::setting_get,
            settings::setting_set,
            settings::setting_clear_all,
            logging::log,
            window_cmds::window_minimize,
            window_cmds::window_maximize,
            window_cmds::window_close,
            window_cmds::window_is_maximized,
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
            system::download_show,
            sources::sources_list,
            sources::sources_set_enabled,
            sources::sources_query,
            sources::sources_search,
            sources::sources_catalog,
            sources::sources_detail,
            sources::sources_resolve,
            sources::sources_steam_art,
            sources::sources_steam_meta,
            sources::sources_protondb,
            sources::sources_tags,
            sources::sources_capabilities,
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
            downloads::download_path_set,
            install::install_from_archive,
            install::install_downloaded_archive,
            install::delete_archive_files,
            library::installed_list,
            library::installed_get,
            library::installing_list,
            library::installing_get,
            library::installed_save,
            library::installed_update_metadata,
            library::installing_status_set,
            library::installed_delete,
            library::installing_delete,
            library::installing_dismiss,
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
            storage::storage_summary,
            storage::storage_snapshot,
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
            misc::presence_heartbeat,
            misc::autostart_get,
            misc::autostart_set,
            dialogs::folder_pick,
            misc::system_notifications,
            net::auth_fetch,
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
                let (downloading, extracting) = state.downloads.busy_appids();
                if downloading > 0 || !extracting.is_empty() {
                    api.prevent_close();
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
                // Persist metacache inserts still inside the write-behind
                // debounce window so a quick browse-then-quit loses nothing.
                sources::metacache::flush_all();
                if let Some(state) = app.try_state::<AppState>() {
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

    let mut builder = TrayIconBuilder::new()
        .menu(&menu)
        .tooltip("Union.Manifold")
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => {
                if let Some(w) = app.get_webview_window("main") {
                    w.show().ok();
                    w.set_focus().ok();
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let tauri::tray::TrayIconEvent::Click { .. } = event {
                if let Some(w) = tray.app_handle().get_webview_window("main") {
                    w.show().ok();
                    w.set_focus().ok();
                }
            }
        });
    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }
    builder.build(app)?;
    Ok(())
}
