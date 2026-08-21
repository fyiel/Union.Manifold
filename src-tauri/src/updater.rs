use serde_json::{json, Value};
#[cfg(target_os = "linux")]
use tauri::Manager;
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

/// POSIX single-quote escaping for paths interpolated into `sh -c` commands
/// (the pacman updater is Linux-only).
#[cfg(target_os = "linux")]
fn shell_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
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

    // The version comes from the plugin-verified update manifest, but the
    // URL and file name interpolate it: only accept plain version shapes.
    if !new_version
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '+' | '-'))
    {
        return Err("refusing to install: invalid version string".to_string());
    }

    // Package names follow the build host arch (see build-arch-pkg.sh);
    // releases currently only publish x86_64 packages, so on other arches
    // the download fails with a clear http 404 and the manual-install hint.
    let arch = if cfg!(target_arch = "aarch64") {
        "aarch64"
    } else {
        "x86_64"
    };
    let pkg_name = format!("union-manifold-{new_version}-1-{arch}.pkg.tar.zst");
    let base = format!(
        "https://github.com/fyiel/Union.Manifold/releases/download/v{new_version}/{pkg_name}"
    );
    let dir = std::env::temp_dir();
    let pkg_path = dir.join(&pkg_name);
    let sig_path = dir.join(format!("{pkg_name}.sig"));

    // Fetch the detached PGP signature first so pacman can verify the
    // package against the user's imported key; never install an unsigned
    // package.
    let sig = crate::http::fetch(
        &format!("{base}.sig"),
        &crate::http::FetchOpts {
            timeout: Some(std::time::Duration::from_secs(60)),
            ..Default::default()
        },
    )
    .await
    .map_err(|e| format!("signature download failed: {e}"))?;
    if !sig.status().is_success() {
        return Err(format!(
            "signature download failed: http {}. install manually: sudo pacman -U {}",
            sig.status(),
            base
        ));
    }
    let sig_bytes = sig
        .bytes()
        .await
        .map_err(|e| format!("signature download failed: {e}"))?;
    std::fs::write(&sig_path, &sig_bytes).map_err(|e| format!("write signature: {e}"))?;

    let mut resp = crate::http::fetch(
        &base,
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

    // The package is signed by the project key (468871A04436AAAC). pacman
    // only installs packages signed by locally trusted keys, so import and
    // locally sign the bundled key first — one pkexec prompt covers key setup
    // and the install. Idempotent: re-adding and re-signing an already
    // trusted key is a no-op. If the bundled key is missing, fall back to the
    // bare install so the pacman error (with its manual-trust hint below)
    // surfaces instead of a confusing key-setup failure.
    let key_path = app
        .path()
        .resource_dir()
        .ok()
        .and_then(|d| crate::bins::resolve_resource_file(&d, "union-manifold-signing-key.asc"));
    let setup = match &key_path {
        Some(key) => format!(
            "set -e; pacman-key --add {} && pacman-key --lsign-key 468871A04436AAAC && pacman -U --noconfirm {}",
            shell_quote(&key.to_string_lossy()),
            shell_quote(&pkg_path.to_string_lossy()),
        ),
        None => format!("pacman -U --noconfirm {}", shell_quote(&pkg_path.to_string_lossy())),
    };

    let child = tokio::process::Command::new("pkexec")
        .arg("sh")
        .arg("-c")
        .arg(&setup)
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
        std::fs::remove_file(&sig_path).ok();
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
        code => {
            let hint_key = key_path.as_ref().map(|p| p.to_string_lossy().to_string()).or_else(|| {
                app.path().resource_dir().ok().map(|d| d.join("union-manifold-signing-key.asc").to_string_lossy().to_string())
            });
            let trust_hint = if detail.contains("key") || detail.contains("keyring") {
                match hint_key {
                    Some(key) => format!(
                        " (pacman does not trust the signing key — the app normally imports it automatically; to fix manually: sudo pacman-key --add {} && sudo pacman-key --lsign-key 468871A04436AAAC)",
                        shell_quote(&key)
                    ),
                    None => String::new(),
                }
            } else {
                String::new()
            };
            Err(format!(
                "pacman failed (exit {code:?}){trust_hint}{}. install manually: sudo pacman -U {}",
                if detail.is_empty() { String::new() } else { format!(": {detail}") },
                pkg_path.display()
            ))
        }
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

#[cfg(test)]
mod tests {
    #[cfg(target_os = "linux")]
    use super::shell_quote;

    // POSIX single-quote semantics only apply where sh exists.
    #[cfg(target_os = "linux")]
    #[test]
    fn shell_quote_round_trips_adversarial_paths() {
        for path in [
            "/tmp/union-manifold-3.6.1-1-x86_64.pkg.tar.zst",
            "/tmp/it's a dir/$(whoami);`id` & pkg.tar.zst",
            "a'b'c",
            "plain",
            "trailing\\",
        ] {
            let quoted = shell_quote(path);
            let echo = std::process::Command::new("sh")
                .arg("-c")
                .arg(format!("printf %s {}", quoted))
                .output()
                .expect("sh available");
            assert_eq!(
                String::from_utf8_lossy(&echo.stdout),
                path,
                "round-trip failed for {path:?}"
            );
        }
    }
}
