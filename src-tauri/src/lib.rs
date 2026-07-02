mod assets;
mod bins;
mod dialogs;
mod downloads;
mod error;
mod http;
mod install;
mod launch;
mod library;
mod logging;
mod misc;
mod net;
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

pub fn run() {
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
        .register_asynchronous_uri_scheme_protocol("uc-asset", |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            let uri = request.uri().to_string();
            tauri::async_runtime::spawn(async move {
                let (status, body, ct) = assets::respond(app, uri).await;
                let resp = tauri::http::Response::builder()
                    .status(status)
                    .header("Content-Type", ct)
                    .header("Access-Control-Allow-Origin", "*")
                    .body(body)
                    .unwrap();
                responder.respond(resp);
            });
        })
        .setup(|app| {
            let handle = app.handle().clone();
            let paths = Arc::new(AppPaths::resolve(&handle)?);
            logging::init(paths.log_file());
            let settings = Arc::new(SettingsStore::load(paths.settings_file()));
            let cacert = app.path().resource_dir().ok().map(|d| d.join("cacert.pem"));
            let aria2 = Arc::new(Aria2Manager::new(cacert));
            let sources = Arc::new(Registry::new());
            let default_root = default_download_root(&paths.data_dir);
            let downloads = DownloadEngine::new(handle.clone(), settings.clone(), default_root, aria2);
            app.manage(AppState {
                paths,
                settings,
                sources,
                downloads,
            });
            build_tray(app)?;
            #[cfg(desktop)]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                app.deep_link().register_all().ok();
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            settings::setting_get,
            settings::setting_set,
            settings::setting_clear_all,
            logging::log,
            logging::logs_get,
            logging::logs_clear,
            logging::logs_open_folder,
            window_cmds::window_minimize,
            window_cmds::window_maximize,
            window_cmds::window_close,
            window_cmds::window_is_maximized,
            window_cmds::app_close_response,
            system::system_open_external,
            system::system_launch_steam,
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
            sources::sources_tags,
            sources::sources_capabilities,
            downloads::download_start,
            downloads::download_smart_start,
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
            downloads::disk_list,
            install::install_from_archive,
            install::install_downloaded_archive,
            install::delete_archive_files,
            library::installed_list,
            library::installed_get,
            library::installed_list_by_appid,
            library::installing_list,
            library::installing_get,
            library::installed_save,
            library::installed_update_metadata,
            library::installing_status_set,
            library::installed_delete,
            library::installing_delete,
            library::installing_dismiss,
            library::installed_backup_create,
            library::add_external_game,
            launch::game_exe_list,
            launch::game_subfolder_find,
            launch::game_exe_preflight,
            launch::game_exe_launch,
            launch::game_exe_running,
            launch::game_exe_running_list,
            launch::game_exe_quit,
            launch::linux::game_linux_config_get,
            launch::linux::game_linux_config_set,
            launch::linux::linux_check_tool,
            launch::linux::linux_get_steam_path,
            launch::linux::linux_detect_umu,
            launch::linux::linux_detect_wine,
            launch::linux::linux_detect_proton,
            storage::storage_precheck,
            storage::storage_summary,
            storage::storage_snapshot,
            assets::assets_size,
            assets::assets_clear,
            updater::check_for_updates,
            updater::get_update_status,
            updater::update_retry,
            updater::install_update,
            updater::get_version,
            updater::get_changelog,
            shortcuts::create_desktop_shortcut,
            shortcuts::delete_desktop_shortcut,
            dialogs::pick_external_game_folder,
            dialogs::download_path_pick,
            dialogs::pick_image,
            dialogs::browse_for_game_exe,
            dialogs::pick_archive_files,
            dialogs::linux_pick_binary,
            dialogs::linux_pick_prefix_dir,
            misc::theme_editor_open,
            misc::theme_editor_close,
            misc::theme_preview,
            misc::theme_preview_end,
            misc::presence_heartbeat,
            misc::system_notifications,
            misc::network_test,
            misc::settings_export,
            misc::settings_import,
            net::auth_fetch,
            net::auth_upload,
        ])
        .build(tauri::generate_context!())
        .expect("error building union.manifold")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
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
