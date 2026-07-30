#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(target_os = "linux")]
    {
        let appimage = std::env::var_os("APPIMAGE").is_some();
        if appimage && std::env::var_os("WEBKIT_EXEC_PATH").is_none() {
            if let Some(appdir) = std::env::var_os("APPDIR") {
                let appdir = std::path::PathBuf::from(appdir);
                for relative in [
                    "usr/lib/webkit2gtk-4.1",
                    "usr/lib/x86_64-linux-gnu/webkit2gtk-4.1",
                    "usr/libexec/webkit2gtk-4.1",
                ] {
                    let candidate = appdir.join(relative);
                    if candidate.join("WebKitWebProcess").is_file() {
                        std::env::set_var("WEBKIT_EXEC_PATH", candidate);
                        break;
                    }
                }
            }
        }
        let wayland = std::env::var_os("WAYLAND_DISPLAY").is_some();
        if wayland && std::env::var_os("WEBKIT_DISABLE_COMPOSITING_MODE").is_none() {
            std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
        }
        let nvidia_ish = std::path::Path::new("/sys/module/nvidia").exists()
            || std::env::var("GBM_BACKEND").is_ok_and(|v| v.contains("nvidia"))
            || std::env::var("__GLX_VENDOR_LIBRARY_NAME").is_ok_and(|v| v.contains("nvidia"));
        if (nvidia_ish || (appimage && wayland))
            && std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none()
        {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
    }
    union_manifold_lib::run();
}
