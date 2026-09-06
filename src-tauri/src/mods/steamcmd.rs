use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::LazyLock;
use std::time::Duration;

use tokio::sync::mpsc::UnboundedSender;

use crate::paths::AppPaths;

const URL_LINUX: &str = "https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz";
const URL_WINDOWS: &str = "https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip";
const URL_MACOS: &str = "https://steamcdn-a.akamaihd.net/client/installer/steamcmd_osx.tar.gz";

const FIRST_RUN_TIMEOUT: Duration = Duration::from_secs(10 * 60);
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(15 * 60);

static LOCK: LazyLock<tokio::sync::Mutex<()>> = LazyLock::new(|| tokio::sync::Mutex::new(()));
static BOOTSTRAPPING: AtomicBool = AtomicBool::new(false);

fn dir(paths: &AppPaths) -> PathBuf {
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
        if let Some(bin) = crate::install::which_extractor() {
            return crate::install::run_libarchive(&bin, archive, out)
                .await
                .map_err(|e| e.to_string());
        }
        let tmp = out.join(".untar");
        crate::install::run_7z(archive, &tmp, |_| {})
            .await
            .map_err(|e| e.to_string())?;
        let tar = std::fs::read_dir(&tmp)
            .map_err(|e| format!("untar dir: {e}"))?
            .flatten()
            .map(|e| e.path())
            .find(|p| {
                p.extension()
                    .map(|e| e.eq_ignore_ascii_case("tar"))
                    .unwrap_or(false)
            })
            .ok_or("no .tar inside the steamcmd tarball")?;
        crate::install::run_7z(&tar, out, |_| {})
            .await
            .map_err(|e| e.to_string())?;
        std::fs::remove_dir_all(&tmp).ok();
        Ok(())
    } else {
        crate::install::run_7z(archive, out, |_| {})
            .await
            .map_err(|e| e.to_string())
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
    run_steamcmd(&d, exe, &["+quit"], FIRST_RUN_TIMEOUT).await?;
    Ok(())
}

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
    let args: Vec<String> = args.iter().map(|a| a.to_string()).collect();
    run_steamcmd_lines(cwd, exe, &args, timeout, |_| {}).await
}

/// Runs steamcmd, feeding each stdout line to `on_line` as it arrives so
/// callers can react to per-item download events mid-session. Returns the
/// combined stdout/stderr text for diagnostics.
async fn run_steamcmd_lines(
    cwd: &Path,
    exe: &Path,
    args: &[String],
    timeout: Duration,
    mut on_line: impl FnMut(&str) + Send,
) -> Result<String, String> {
    use tokio::io::AsyncBufReadExt;
    let mut cmd = tokio::process::Command::new(exe);
    cmd.args(args)
        .current_dir(cwd)
        .kill_on_drop(true)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    #[cfg(windows)]
    {
        cmd.creation_flags(windows_sys::Win32::System::Threading::CREATE_NO_WINDOW);
    }
    let mut child = cmd.spawn().map_err(|e| format!("steamcmd spawn: {e}"))?;
    let stdout = child.stdout.take().ok_or("steamcmd stdout pipe")?;
    let stderr = child.stderr.take().ok_or("steamcmd stderr pipe")?;
    let stderr_task = tokio::spawn(async move {
        let mut buf = String::new();
        tokio::io::AsyncReadExt::read_to_string(&mut tokio::io::BufReader::new(stderr), &mut buf)
            .await
            .ok();
        buf
    });
    let collected = tokio::time::timeout(timeout, async move {
        let mut collected = String::new();
        let mut lines = tokio::io::BufReader::new(stdout).lines();
        loop {
            match lines.next_line().await {
                Ok(Some(line)) => {
                    collected.push_str(&line);
                    collected.push('\n');
                    on_line(&line);
                }
                Ok(None) => break,
                Err(_) => break,
            }
        }
        let _ = child.wait().await;
        collected
    })
    .await
    .map_err(|_| "steamcmd timed out".to_string())?;
    let err_text = stderr_task.await.unwrap_or_default();
    Ok(format!("{collected}\n{err_text}"))
}

/// One workshop item finished inside a batched steamcmd session.
pub(crate) enum BatchEvent {
    Item { fid: u64, result: Result<PathBuf, String> },
}

/// Downloads several workshop items in a single steamcmd session: one
/// process start and anonymous login covers every item. Each finished item
/// (success or per-item failure) is reported through `events` as soon as
/// steamcmd prints its result line.
pub(crate) async fn run_workshop_download_batch(
    paths: &AppPaths,
    steam_appid: u64,
    file_ids: &[u64],
    events: UnboundedSender<BatchEvent>,
) -> Result<(), String> {
    let _g = LOCK.lock().await;
    let exe = ensure_ready_locked(paths).await?;
    let d = dir(paths);
    run_batch_in_dir(&d, &exe, steam_appid, file_ids, events).await
}

async fn run_batch_in_dir(
    d: &Path,
    exe: &Path,
    steam_appid: u64,
    file_ids: &[u64],
    events: UnboundedSender<BatchEvent>,
) -> Result<(), String> {
    let appid_s = steam_appid.to_string();
    let mut args: Vec<String> = vec!["+login".to_string(), "anonymous".to_string()];
    for fid in file_ids {
        args.push("+workshop_download_item".to_string());
        args.push(appid_s.clone());
        args.push(fid.to_string());
        args.push("validate".to_string());
    }
    args.push("+quit".to_string());

    let timeout = DOWNLOAD_TIMEOUT * file_ids.len().max(1) as u32;
    let mut seen: HashSet<u64> = HashSet::new();
    let text = run_steamcmd_lines(d, exe, &args, timeout, |line| {
        if let Some((fid, path)) = parse_item_success(line).filter(|(_, p)| dir_has_content(p)) {
            seen.insert(fid);
            events
                .send(BatchEvent::Item {
                    fid,
                    result: Ok(path),
                })
                .ok();
        } else if let Some((fid, reason)) = parse_item_failure(line) {
            seen.insert(fid);
            events
                .send(BatchEvent::Item {
                    fid,
                    result: Err(item_error(&reason)),
                })
                .ok();
        }
    })
    .await?;

    // Items steamcmd never reported on (e.g. the session died mid-batch):
    // trust the on-disk content dir, otherwise report a generic failure.
    for fid in file_ids {
        if seen.contains(fid) {
            continue;
        }
        let computed = d
            .join("steamapps/workshop/content")
            .join(&appid_s)
            .join(fid.to_string());
        let result = if dir_has_content(&computed) {
            Ok(computed)
        } else {
            Err(download_error(&text))
        };
        events.send(BatchEvent::Item { fid: *fid, result }).ok();
    }
    Ok(())
}

fn parse_item_success(line: &str) -> Option<(u64, PathBuf)> {
    let start = line.find("Success. Downloaded item ")?;
    let after = &line[start..];
    let fid: u64 = after["Success. Downloaded item ".len()..]
        .split_whitespace()
        .next()?
        .parse()
        .ok()?;
    let path = reported_content_dir(after)?;
    Some((fid, path))
}

fn parse_item_failure(line: &str) -> Option<(u64, String)> {
    let start = line.find("Download item ")?;
    let after = &line[start + "Download item ".len()..];
    if !after.contains("failed") {
        return None;
    }
    let fid: u64 = after.split_whitespace().next()?.parse().ok()?;
    let open = after.find('(')?;
    let close = after[open..].find(')')? + open;
    let reason = after[open + 1..close].trim().to_string();
    (!reason.is_empty()).then_some((fid, reason))
}

fn item_error(reason: &str) -> String {
    if reason.contains("No subscription")
        || reason.contains("Access Denied")
        || reason.contains("Failure")
    {
        "This item requires a Steam account that owns this game — anonymous SteamCMD download was refused"
            .to_string()
    } else {
        format!("steamcmd download failed: {reason}")
    }
}

fn download_error(text: &str) -> String {
    if text.contains("No subscription")
        || text.contains("Failure")
        || text.contains("Access Denied")
    {
        return "This item requires a Steam account that owns this game — anonymous SteamCMD download was refused"
            .to_string();
    }
    let tail: Vec<&str> = text
        .lines()
        .rev()
        .filter(|l| !l.trim().is_empty())
        .take(4)
        .collect();
    let tail: Vec<&str> = tail.into_iter().rev().collect();
    format!("steamcmd download failed: {}", tail.join(" | "))
}

fn reported_content_dir(text: &str) -> Option<PathBuf> {
    let after = &text[text.find("Downloaded item")?..];
    let open = after.find('"')? + 1;
    let close = after[open..].find('"')? + open;
    let path = after[open..close].trim();
    (!path.is_empty()).then(|| PathBuf::from(path))
}

fn dir_has_content(p: &Path) -> bool {
    std::fs::read_dir(p)
        .map(|mut it| it.next().is_some())
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_reported_path_with_ansi() {
        let line = "\u{1b}[0mDownloading item 3440115864 ...\u{1b}[0m | \u{1b}[0mSuccess. Downloaded item 3440115864 to \"/home/yop/.local/share/Steam/steamapps/workshop/content/881100/3440115864\" (709 bytes) \u{1b}[0mUnloading Steam API...";
        assert_eq!(
            reported_content_dir(line),
            Some(PathBuf::from(
                "/home/yop/.local/share/Steam/steamapps/workshop/content/881100/3440115864"
            ))
        );
        assert_eq!(reported_content_dir("nothing to see"), None);
    }

    #[test]
    fn parses_item_success_from_batch_line() {
        // Real steamcmd batch output glues the success line and the next
        // item's "Downloading item" notice onto one physical line.
        let line = "\u{1b}[0mSuccess. Downloaded item 3796688140 to \"/home/yop/.local/share/Steam/steamapps/workshop/content/294100/3796688140\" (366151 bytes) \u{1b}[0mDownloading item 3771536321 ...\u{1b}[0m";
        assert_eq!(
            parse_item_success(line),
            Some((
                3796688140,
                PathBuf::from(
                    "/home/yop/.local/share/Steam/steamapps/workshop/content/294100/3796688140"
                )
            ))
        );
        assert_eq!(parse_item_success("\u{1b}[0mDownloading item 3771536321 ..."), None);
    }

    #[test]
    fn parses_item_failure_reason() {
        let line = "\u{1b}[0mERROR! Download item 99999999999 failed (File Not Found).\u{1b}[0mUnloading Steam API...";
        assert_eq!(
            parse_item_failure(line),
            Some((99999999999, "File Not Found".to_string()))
        );
        let sub = "ERROR! Download item 123 failed (No subscription).";
        assert_eq!(
            parse_item_failure(sub),
            Some((123, "No subscription".to_string()))
        );
        assert_eq!(parse_item_failure("Downloading item 123 ..."), None);
        assert_eq!(parse_item_failure("Success. Downloaded item 1 to \"/x\" (2 bytes)"), None);
    }

    #[test]
    fn maps_item_error_reasons() {
        assert!(item_error("No subscription").contains("requires a Steam account"));
        assert!(item_error("Access Denied").contains("requires a Steam account"));
        assert_eq!(
            item_error("File Not Found"),
            "steamcmd download failed: File Not Found"
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn batch_session_reports_each_item() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("steamcmd");
        std::fs::create_dir_all(&dir).unwrap();
        // A fake steamcmd that emits the exact line shapes observed from the
        // real client: one success per item, one failure, all mid-stream.
        let script = r#"#!/bin/sh
while [ $# -gt 0 ]; do
  if [ "$1" = "+workshop_download_item" ]; then
    appid="$2"; fid="$3"
    if [ "$fid" = "999" ]; then
      printf 'ERROR! Download item %s failed (File Not Found).\n' "$fid"
    else
      out="steamapps/workshop/content/$appid/$fid"
      mkdir -p "$out"
      echo x > "$out/file.txt"
      printf 'Downloading item %s ...\nSuccess. Downloaded item %s to "%s/%s" (1 bytes)\n' "$fid" "$fid" "$PWD" "$out"
    fi
    shift 4
  else
    shift
  fi
done
"#;
        let exe = dir.join("fake-steamcmd.sh");
        std::fs::write(&exe, script).unwrap();
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&exe, std::fs::Permissions::from_mode(0o755)).unwrap();
        }

        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
        run_batch_in_dir(&dir, &exe, 294100, &[111, 999, 222], tx)
            .await
            .unwrap();

        let mut outcomes = std::collections::HashMap::new();
        while let Ok(BatchEvent::Item { fid, result }) = rx.try_recv() {
            outcomes.insert(fid, result);
        }
        assert_eq!(outcomes.len(), 3);
        let ok111 = outcomes[&111].as_ref().unwrap();
        assert!(ok111.join("file.txt").is_file());
        assert!(outcomes[&222].as_ref().unwrap().join("file.txt").is_file());
        let err999 = outcomes[&999].as_ref().unwrap_err();
        assert_eq!(err999, "steamcmd download failed: File Not Found");
    }
}
