// Runtime-bootstrapped SteamCMD in data_dir/steamcmd: downloaded on first
// workshop install, self-updated once, then reused for anonymous
// workshop_download_item runs. A single tokio Mutex serializes bootstrap and
// every run — SteamCMD cannot share its install dir between processes.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::LazyLock;
use std::time::Duration;

use crate::paths::AppPaths;

const URL_LINUX: &str = "https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz";
const URL_WINDOWS: &str = "https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip";
const URL_MACOS: &str = "https://steamcdn-a.akamaihd.net/client/installer/steamcmd_osx.tar.gz";

const FIRST_RUN_TIMEOUT: Duration = Duration::from_secs(10 * 60);
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(15 * 60);

static LOCK: LazyLock<tokio::sync::Mutex<()>> = LazyLock::new(|| tokio::sync::Mutex::new(()));
static BOOTSTRAPPING: AtomicBool = AtomicBool::new(false);

pub(crate) fn dir(paths: &AppPaths) -> PathBuf {
    paths.data_dir.join("steamcmd")
}

fn exe_path(paths: &AppPaths) -> PathBuf {
    let d = dir(paths);
    if cfg!(windows) {
        d.join("steamcmd.exe")
    } else {
        d.join("steamcmd.sh")
    }
}

pub(crate) fn status(paths: &AppPaths) -> &'static str {
    if BOOTSTRAPPING.load(Ordering::Acquire) {
        "bootstrapping"
    } else if exe_path(paths).is_file() {
        "ready"
    } else {
        "absent"
    }
}

async fn extract_archive(archive: &Path, out: &Path) -> Result<(), String> {
    let name = archive
        .file_name()
        .map(|n| n.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if name.ends_with(".tar.gz") || name.ends_with(".tgz") {
        // System tar/bsdtar auto-detects compression and preserves the unix
        // permission bits the scripts need; the 7z two-pass is the fallback.
        if let Some(bin) = crate::install::which_extractor() {
            return crate::install::run_libarchive(&bin, archive, out)
                .await
                .map_err(|e| e.to_string());
        }
        let tmp = out.join(".untar");
        crate::install::run_7z(archive, &tmp, |_| {}).await.map_err(|e| e.to_string())?;
        let tar = std::fs::read_dir(&tmp)
            .map_err(|e| format!("untar dir: {e}"))?
            .flatten()
            .map(|e| e.path())
            .find(|p| {
                p.extension().map(|e| e.eq_ignore_ascii_case("tar")).unwrap_or(false)
            })
            .ok_or("no .tar inside the steamcmd tarball")?;
        crate::install::run_7z(&tar, out, |_| {}).await.map_err(|e| e.to_string())?;
        std::fs::remove_dir_all(&tmp).ok();
        Ok(())
    } else {
        crate::install::run_7z(archive, out, |_| {}).await.map_err(|e| e.to_string())
    }
}

async fn bootstrap(paths: &AppPaths, exe: &Path) -> Result<(), String> {
    let d = dir(paths);
    std::fs::create_dir_all(&d).map_err(|e| format!("steamcmd dir: {e}"))?;
    let (url, fname) = if cfg!(windows) {
        (URL_WINDOWS, "steamcmd.zip")
    } else if cfg!(target_os = "macos") {
        (URL_MACOS, "steamcmd_osx.tar.gz")
    } else {
        (URL_LINUX, "steamcmd_linux.tar.gz")
    };
    let archive = d.join(fname);
    super::download_to_file(url, &archive, Default::default(), |_| {}).await?;
    let extracted = extract_archive(&archive, &d).await;
    std::fs::remove_file(&archive).ok();
    extracted?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        for p in [
            d.join("steamcmd.sh"),
            d.join("steamcmd"),
            d.join("linux32/steamcmd"),
            d.join("osx32/steamcmd"),
        ] {
            if p.is_file() {
                std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o755)).ok();
            }
        }
    }
    if !exe.is_file() {
        return Err("steamcmd archive did not contain the expected executable".to_string());
    }
    // First run lets steamcmd pull its own update before we ask it to work.
    // Exit status is intentionally ignored: self-update exits non-zero on
    // some platforms even when it succeeded.
    run_steamcmd(&d, exe, &["+quit"], FIRST_RUN_TIMEOUT).await?;
    Ok(())
}

/// Bootstrap if needed. Caller must hold LOCK.
async fn ensure_ready_locked(paths: &AppPaths) -> Result<PathBuf, String> {
    let exe = exe_path(paths);
    if exe.is_file() {
        return Ok(exe);
    }
    BOOTSTRAPPING.store(true, Ordering::Release);
    let out = bootstrap(paths, &exe).await;
    BOOTSTRAPPING.store(false, Ordering::Release);
    out.map(|_| exe)
}

async fn run_steamcmd(
    cwd: &Path,
    exe: &Path,
    args: &[&str],
    timeout: Duration,
) -> Result<String, String> {
    let mut cmd = tokio::process::Command::new(exe);
    cmd.args(args)
        .current_dir(cwd)
        .kill_on_drop(true)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    let out = tokio::time::timeout(timeout, cmd.output())
        .await
        .map_err(|_| "steamcmd timed out".to_string())?
        .map_err(|e| format!("steamcmd spawn: {e}"))?;
    Ok(format!(
        "{}\n{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    ))
}

/// Download one workshop item anonymously; returns the content directory
/// (<steamcmd>/steamapps/workshop/content/<appid>/<fileid>/).
pub(crate) async fn run_workshop_download(
    paths: &AppPaths,
    steam_appid: u64,
    file_id: u64,
) -> Result<PathBuf, String> {
    let _g = LOCK.lock().await;
    let exe = ensure_ready_locked(paths).await?;
    let d = dir(paths);
    let appid_s = steam_appid.to_string();
    let fid_s = file_id.to_string();
    let args = [
        "+login",
        "anonymous",
        "+workshop_download_item",
        appid_s.as_str(),
        fid_s.as_str(),
        "validate",
        "+quit",
    ];
    let text = run_steamcmd(&d, &exe, &args, DOWNLOAD_TIMEOUT).await?;
    let content = d
        .join("steamapps/workshop/content")
        .join(&appid_s)
        .join(&fid_s);
    if content.is_dir() && text.contains("Success. Downloaded item") {
        return Ok(content);
    }
    if text.contains("No subscription") || text.contains("Failure") || text.contains("Access Denied") {
        return Err(
            "This item requires a Steam account that owns this game — anonymous SteamCMD download was refused"
                .to_string(),
        );
    }
    if content.is_dir() {
        // Some steamcmd builds phrase success differently; trust the files.
        return Ok(content);
    }
    let tail: Vec<&str> = text
        .lines()
        .rev()
        .filter(|l| !l.trim().is_empty())
        .take(4)
        .collect();
    let tail: Vec<&str> = tail.into_iter().rev().collect();
    Err(format!("steamcmd download failed: {}", tail.join(" | ")))
}
