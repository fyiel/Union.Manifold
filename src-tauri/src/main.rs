#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(target_os = "linux")]
    {
        if std::env::var_os("WAYLAND_DISPLAY").is_some()
            && std::env::var_os("WEBKIT_DISABLE_COMPOSITING_MODE").is_none()
        {
            std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
        }
        let nvidia_ish = std::path::Path::new("/sys/module/nvidia").exists()
            || std::env::var("GBM_BACKEND").is_ok_and(|v| v.contains("nvidia"))
            || std::env::var("__GLX_VENDOR_LIBRARY_NAME").is_ok_and(|v| v.contains("nvidia"));
        if nvidia_ish && std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
    }
    union_manifold_lib::run();
}
