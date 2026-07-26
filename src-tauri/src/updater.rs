use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tauri_plugin_updater::UpdaterExt;

fn version(app: &AppHandle) -> String {
    app.package_info().version.to_string()
}

fn status(
    app: &AppHandle,
    state: &str,
    available: bool,
    new_version: Option<String>,
    error: Option<String>,
) -> Value {
    json!({
        "enabled": true,
        "state": state,
        "currentVersion": version(app),
        "version": new_version,
        "available": available,
        "downloaded": false,
        "progress": 0,
        "error": error,
        "checkedAt": crate::downloads::now_ms(),
    })
}

fn emit_progress(app: &AppHandle, phase: &str, received: u64, total: Option<u64>) {
    app.emit(
        "uc:update-progress",
        json!({
            "phase": phase,
            "received": received,
            "total": total,
        }),
    )
    .ok();
}

#[tauri::command]
pub async fn check_for_updates(app: AppHandle) -> Value {
    let updater = match app.updater() {
        Ok(u) => u,
        Err(e) => return status(&app, "error", false, None, Some(e.to_string())),
    };
    match updater.check().await {
        Ok(Some(update)) => status(&app, "available", true, Some(update.version.clone()), None),
        Ok(None) => status(&app, "not-available", false, None, None),
        Err(e) => status(&app, "error", false, None, Some(e.to_string())),
    }
}

#[cfg(target_os = "linux")]
fn is_pacman_install() -> bool {
    std::env::var_os("APPIMAGE").is_none() && std::path::Path::new("/usr/bin/pacman").exists()
}

#[cfg(target_os = "linux")]
async fn install_via_pacman(app: &AppHandle, new_version: &str) -> Result<(), String> {
    use std::io::Write;

    let url = format!(
        "https://github.com/fyiel/Union.Manifold/releases/download/v{new_version}/union-manifold-{new_version}-1-x86_64.pkg.tar.zst"
    );
    let mut resp = crate::http::fetch(
        &url,
        &crate::http::FetchOpts {
            timeout: Some(std::time::Duration::from_secs(300)),
            ..Default::default()
        },
    )
    .await
    .map_err(|e| format!("download failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("download failed: http {}", resp.status()));
    }
    let total = resp.content_length();

    let dir = std::env::temp_dir();
    let pkg_path = dir.join(format!("union-manifold-{new_version}-1-x86_64.pkg.tar.zst"));
    let mut file = std::fs::File::create(&pkg_path).map_err(|e| format!("write package: {e}"))?;
    let mut received: u64 = 0;
    let mut last_emit: u64 = 0;
    while let Some(chunk) = resp
        .chunk()
        .await
        .map_err(|e| format!("download failed: {e}"))?
    {
        file.write_all(&chunk)
            .map_err(|e| format!("write package: {e}"))?;
        received += chunk.len() as u64;
        if received - last_emit >= 512 * 1024 {
            last_emit = received;
            emit_progress(app, "downloading", received, total);
        }
    }
    file.flush().ok();
    drop(file);
    emit_progress(app, "installing", received, total);

    let child = tokio::process::Command::new("pkexec")
        .arg("pacman")
        .arg("-U")
        .arg("--noconfirm")
        .arg(&pkg_path)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| {
            format!(
                "pkexec not available: {e}. install manually: sudo pacman -U {}",
                pkg_path.display()
            )
        })?;

    let out = match tokio::time::timeout(
        std::time::Duration::from_secs(300),
        child.wait_with_output(),
    )
    .await
    {
        Ok(Ok(out)) => out,
        Ok(Err(e)) => {
            return Err(format!(
                "pkexec failed: {e}. install manually: sudo pacman -U {}",
                pkg_path.display()
            ));
        }
        Err(_) => {
            return Err(format!(
                "update timed out waiting for authorization. install manually: sudo pacman -U {}",
                pkg_path.display()
            ));
        }
    };
    if out.status.success() {
        std::fs::remove_file(&pkg_path).ok();
        return Ok(());
    }
    let detail: String = String::from_utf8_lossy(&out.stderr)
        .trim()
        .chars()
        .take(300)
        .collect();
    match out.status.code() {
        Some(126) | Some(127) => Err(format!(
            "authorization unavailable — is a polkit agent running? install manually: sudo pacman -U {}",
            pkg_path.display()
        )),
        code => Err(format!(
            "pacman failed (exit {code:?}){}. install manually: sudo pacman -U {}",
            if detail.is_empty() { String::new() } else { format!(": {detail}") },
            pkg_path.display()
        )),
    }
}

#[tauri::command]
pub async fn install_update(app: AppHandle) -> Value {
    let updater = match app.updater() {
        Ok(u) => u,
        Err(e) => return json!({ "ok": false, "error": e.to_string() }),
    };
    let update = match updater.check().await {
        Ok(Some(u)) => u,
        Ok(None) => return json!({ "ok": false, "error": "no update available" }),
        Err(e) => return json!({ "ok": false, "error": e.to_string() }),
    };

    #[cfg(target_os = "linux")]
    if is_pacman_install() {
        return match install_via_pacman(&app, &update.version).await {
            Ok(()) => {
                app.restart();
            }
            Err(e) => json!({ "ok": false, "error": e }),
        };
    }

    let progress_app = app.clone();
    let mut received: u64 = 0;
    let mut last_emit: u64 = 0;
    let install_app = app.clone();
    match update
        .download_and_install(
            move |chunk, total| {
                received += chunk as u64;
                if received - last_emit >= 512 * 1024 {
                    last_emit = received;
                    emit_progress(&progress_app, "downloading", received, total);
                }
            },
            move || {
                emit_progress(&install_app, "installing", 0, None);
            },
        )
        .await
    {
        Ok(_) => {
            app.restart();
        }
        Err(e) => json!({ "ok": false, "error": e.to_string() }),
    }
}

#[tauri::command]
pub fn get_version(app: AppHandle) -> String {
    version(&app)
}

pub async fn notify_if_update_available(app: &AppHandle) {
    let updater = match app.updater() {
        Ok(u) => u,
        Err(_) => return,
    };
    if let Ok(Some(update)) = updater.check().await {
        app.emit("uc:update-available", json!({ "version": update.version }))
            .ok();
        crate::notify::send(
            app,
            "Update available",
            &format!(
                "Union.Manifold {} is ready to install from Settings",
                update.version
            ),
        );
    }
}
