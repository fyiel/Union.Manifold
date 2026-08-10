use crate::http::{self, FetchOpts};
use crate::install;
use crate::sources::adapters;
use crate::sources::schema::{DownloadOption, SourceGame};
use crate::sources::{QueryParams, ResolveResult};
use futures::StreamExt;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use tokio::io::AsyncWriteExt;

fn env(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|s| !s.is_empty())
}

fn sanitize(s: &str) -> String {
    let clean: String = s
        .chars()
        .map(|c| match c {
            'a'..='z' | 'A'..='Z' | '0'..='9' | '.' | '-' | '_' | ' ' | '(' | ')' | '[' | ']' => c,
            _ => '_',
        })
        .collect();
    let trimmed = clean.trim().trim_matches('.').trim();
    if trimmed.is_empty() {
        "file".to_string()
    } else {
        trimmed.chars().take(120).collect()
    }
}

fn name_for(url: &str, given: &Option<String>, idx: usize) -> String {
    if let Some(g) = given.as_deref().filter(|s| !s.trim().is_empty()) {
        return sanitize(g);
    }
    let path = url.split(['?', '#']).next().unwrap_or(url);
    let seg = path.rsplit('/').find(|s| !s.is_empty()).unwrap_or("");
    let decoded = percent_encoding::percent_decode_str(seg)
        .decode_utf8_lossy()
        .to_string();
    if decoded.trim().is_empty() {
        format!("part{idx}.bin")
    } else {
        sanitize(&decoded)
    }
}

async fn source_games(source: &str, query: Option<&str>, limit: usize) -> Vec<SourceGame> {
    let params = QueryParams {
        text: query.map(|s| s.to_string()),
        limit,
        ..Default::default()
    };
    match source {
        "unioncrax" => adapters::unioncrax::query(&params)
            .await
            .unwrap_or_default(),
        "gamebounty" => adapters::gamebounty::query(&params)
            .await
            .unwrap_or_default(),
        "zeigames" => adapters::zeigames::query(&params).await.unwrap_or_default(),
        _ => adapters::steamrip::query(&params).await.unwrap_or_default(),
    }
}

async fn detail_of(source: &str, slug: &str) -> Option<SourceGame> {
    match source {
        "unioncrax" => adapters::unioncrax::get_detail(slug).await,
        "gamebounty" => adapters::gamebounty::get_detail(slug).await,
        "zeigames" => adapters::zeigames::get_detail(slug).await,
        _ => adapters::steamrip::get_detail(slug).await,
    }
}

async fn resolve_any(source: &str, opt: &DownloadOption) -> ResolveResult {
    crate::sources::adapter_resolve(source, opt).await
}

async fn download_to(
    url: &str,
    headers: &Option<HashMap<String, String>>,
    dest: &Path,
    max_bytes: u64,
) -> Result<u64, String> {
    let opts = FetchOpts {
        headers: headers.clone().unwrap_or_default(),
        retries: Some(2),
        timeout: Some(Duration::from_secs(3 * 3600)),
        ..Default::default()
    };
    let resp = http::fetch(url, &opts)
        .await
        .map_err(|e| format!("fetch error {e}"))?;
    let status = resp.status();
    if !status.is_success() {
        return Err(format!("http {}", status.as_u16()));
    }
    if let Some(len) = resp
        .headers()
        .get(reqwest::header::CONTENT_LENGTH)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse::<u64>().ok())
    {
        if len > max_bytes {
            return Err(format!("too big ({len} > cap {max_bytes})"));
        }
    }
    let ct = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_lowercase();
    if ct.contains("text/html") {
        return Err(format!("html response (ct={ct})"));
    }
    let mut file = tokio::fs::File::create(dest)
        .await
        .map_err(|e| format!("create {e}"))?;
    let mut stream = resp.bytes_stream();
    let mut total = 0u64;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("stream {e}"))?;
        total += chunk.len() as u64;
        if total > max_bytes + 300_000_000 {
            return Err(format!("exceeded cap mid-stream ({total})"));
        }
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("write {e}"))?;
    }
    file.flush().await.ok();
    Ok(total)
}

fn verify_extracted(dir: &Path) -> (u64, usize, Vec<String>) {
    let mut files = 0usize;
    let mut bytes = 0u64;
    let mut samples = Vec::new();
    for e in walkdir::WalkDir::new(dir).into_iter().flatten() {
        if e.file_type().is_file() {
            files += 1;
            bytes += e.metadata().map(|m| m.len()).unwrap_or(0);
            if samples.len() < 10 {
                let rel = e
                    .path()
                    .strip_prefix(dir)
                    .unwrap_or(e.path())
                    .to_string_lossy()
                    .to_string();
                samples.push(rel);
            }
        }
    }
    (bytes, files, samples)
}

#[cfg(target_os = "linux")]
fn find_proton() -> Option<String> {
    if let Some(p) = env("UM_PROTON") {
        if Path::new(&p).is_file() {
            return Some(p);
        }
    }
    let home = std::env::var("HOME").ok()?;
    let roots = [".local/share/Steam", ".steam/steam", ".steam/root"];
    let names = [
        "Proton 10.0",
        "Proton - Experimental",
        "Proton 9.0 (Beta)",
        "Proton 8.0",
    ];
    for r in roots {
        for n in names {
            let p = format!("{home}/{r}/steamapps/common/{n}/proton");
            if Path::new(&p).is_file() {
                return Some(p);
            }
        }
    }
    None
}

#[cfg(target_os = "linux")]
fn kill_by_compat(compat: &Path) {
    let script = format!(
        "for p in /proc/[0-9]*; do grep -qa 'STEAM_COMPAT_DATA_PATH={}' \"$p/environ\" 2>/dev/null && kill -9 \"${{p##*/}}\" 2>/dev/null; done",
        compat.display()
    );
    let _ = std::process::Command::new("bash")
        .arg("-c")
        .arg(script)
        .status();
}

#[cfg(target_os = "linux")]
fn pick_exe(dir: &Path) -> Option<PathBuf> {
    const SKIP: &[&str] = &[
        "unins",
        "vcredist",
        "vc_redist",
        "dxsetup",
        "dxwebsetup",
        "dotnet",
        "ndp",
        "crashhandler",
        "notification_helper",
        "python",
        "redist",
        "directx",
        "oalinst",
        "setup",
        "cleanup",
        "touchup",
        "config",
        "launcher_installer",
        "handler",
        "activation",
        "physx",
        "systemsoftware",
        "msiexec",
        "dotnetfx",
        "xnafx",
        "prereq",
        "install",
        "eula",
    ];
    let mut best: Option<(u64, PathBuf)> = None;
    for e in walkdir::WalkDir::new(dir).into_iter().flatten() {
        if !e.file_type().is_file() {
            continue;
        }
        let name = e.file_name().to_string_lossy().to_lowercase();
        if !name.ends_with(".exe") {
            continue;
        }
        if SKIP.iter().any(|s| name.contains(s)) {
            continue;
        }
        let size = e.metadata().map(|m| m.len()).unwrap_or(0);
        if best.as_ref().map(|(b, _)| size > *b).unwrap_or(true) {
            best = Some((size, e.path().to_path_buf()));
        }
    }
    best.map(|(_, p)| p)
}

#[cfg(not(target_os = "linux"))]
fn launch_game(_install_dir: &Path, _out: &Path, _appid: &str, _secs: u64) -> (bool, String) {
    (false, "proton launch is linux only, skipped".to_string())
}

#[cfg(target_os = "linux")]
fn launch_game(install_dir: &Path, out: &Path, appid: &str, secs: u64) -> (bool, String) {
    use std::os::unix::process::CommandExt;
    let proton = match find_proton() {
        Some(p) => p,
        None => return (false, "no proton install found".to_string()),
    };
    let exe = match pick_exe(install_dir) {
        Some(e) => e,
        None => return (false, "no launchable .exe found".to_string()),
    };
    let exe_str = exe.to_string_lossy().to_string();
    let plan = match crate::launch::linux::plan_launch(
        &serde_json::json!({}),
        None,
        Some(proton.clone()),
        out,
        appid,
        &exe_str,
    ) {
        Ok(p) => p,
        Err(e) => return (false, format!("launch plan failed: {e}")),
    };
    if !plan.command.contains("proton") {
        return (
            false,
            format!("launch plan did not choose proton (cmd={})", plan.command),
        );
    }
    let exe_dir = exe.parent().unwrap_or(install_dir);
    let log_path = out.join("__launch.log");
    let log = match std::fs::File::create(&log_path) {
        Ok(f) => f,
        Err(e) => return (false, format!("log create {e}")),
    };
    let log2 = match log.try_clone() {
        Ok(f) => f,
        Err(e) => return (false, format!("log clone {e}")),
    };
    let has_systemd = std::env::var("PATH")
        .ok()
        .map(|path| {
            path.split(':')
                .any(|d| Path::new(d).join("systemd-run").is_file())
        })
        .unwrap_or(false);
    let unit = format!(
        "um-launch-{}-{}",
        std::process::id(),
        sanitize(appid).replace(' ', "-")
    );
    let mut cmd = if has_systemd {
        let mut c = std::process::Command::new("systemd-run");
        c.arg("--user")
            .arg("--scope")
            .arg("--collect")
            .arg("--quiet")
            .arg(format!("--unit={unit}"))
            .arg("--")
            .arg(&plan.command)
            .args(&plan.args);
        c
    } else {
        let mut c = std::process::Command::new(&plan.command);
        c.args(&plan.args);
        c
    };
    cmd.current_dir(exe_dir)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::from(log))
        .stderr(std::process::Stdio::from(log2));
    for (k, v) in &plan.envs {
        cmd.env(k, v);
    }
    if !has_systemd {
        cmd.process_group(0);
    }
    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => return (false, format!("spawn {e}")),
    };
    let pid = child.id();
    let deadline = Instant::now() + Duration::from_secs(secs);
    let (launched, note) = loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let code = status.code();
                let pfx = out.join("compatdata").join(appid).join("pfx").is_dir();
                break (
                    pfx && code == Some(0),
                    format!("exited early code={code:?} prefixBuilt={pfx}"),
                );
            }
            Ok(None) => {
                if Instant::now() >= deadline {
                    let pfx = out.join("compatdata").join(appid).join("pfx").is_dir();
                    break (
                        true,
                        format!("still running after {secs}s prefixBuilt={pfx}"),
                    );
                }
                std::thread::sleep(Duration::from_millis(500));
            }
            Err(e) => break (false, format!("wait error {e}")),
        }
    };
    let compat = out.join("compatdata").join(appid);
    if has_systemd {
        let scope = format!("{unit}.scope");
        let _ = std::process::Command::new("systemctl")
            .args(["--user", "kill", "--signal=SIGKILL", &scope])
            .status();
        let _ = std::process::Command::new("systemctl")
            .args(["--user", "stop", &scope])
            .status();
    } else {
        let gid = format!("-{pid}");
        let _ = std::process::Command::new("kill")
            .arg("-TERM")
            .arg(&gid)
            .status();
        kill_by_compat(&compat);
        std::thread::sleep(Duration::from_millis(1500));
        let _ = std::process::Command::new("kill")
            .arg("-KILL")
            .arg(&gid)
            .status();
    }
    kill_by_compat(&compat);
    let _ = std::process::Command::new("kill")
        .arg("-KILL")
        .arg(pid.to_string())
        .status();
    let _ = child.wait();
    let tail = std::fs::read_to_string(&log_path)
        .ok()
        .map(|s| {
            s.lines()
                .rev()
                .take(4)
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .collect::<Vec<_>>()
                .join(" | ")
        })
        .unwrap_or_default();
    let exe_name = exe
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    (launched, format!("exe={exe_name} {note} log[{tail}]"))
}

#[tokio::test]
#[ignore]
async fn install_one_game() {
    let source = env("UM_SOURCE").unwrap_or_else(|| "steamrip".to_string());
    let query = env("UM_QUERY");
    let host_pref = env("UM_HOST");
    let max_gb: f64 = env("UM_MAX_GB").and_then(|s| s.parse().ok()).unwrap_or(5.0);
    let out = PathBuf::from(env("UM_OUT").unwrap_or_else(|| "/tmp/um_install".to_string()));
    let keep = env("UM_KEEP").is_some();
    let do_launch = env("UM_LAUNCH").is_some();
    let launch_secs: u64 = env("UM_LAUNCH_SECS")
        .and_then(|s| s.parse().ok())
        .unwrap_or(30);
    let skip: usize = env("UM_SKIP").and_then(|s| s.parse().ok()).unwrap_or(0);
    let max_bytes = (max_gb * 1_000_000_000.0) as u64;

    eprintln!(
        "== install probe source={source} host={host_pref:?} query={query:?} maxGB={max_gb} out={} ==",
        out.display()
    );
    let games = source_games(&source, query.as_deref(), 60).await;
    eprintln!("catalog returned {} games", games.len());

    let mut tried = 0usize;
    let mut eligible = 0usize;
    for g in &games {
        let detail_holder;
        let gg: &SourceGame = if g.download_options.is_empty() {
            detail_holder = detail_of(&source, &g.source_slug).await;
            match detail_holder.as_ref() {
                Some(d) => d,
                None => continue,
            }
        } else {
            g
        };
        let opt = gg.download_options.iter().find(|o| {
            o.resolvable
                && host_pref
                    .as_deref()
                    .map(|h| o.host_type == h)
                    .unwrap_or(true)
        });
        let opt = match opt {
            Some(o) => o,
            None => continue,
        };
        if let Some(sz) = gg.size_bytes {
            if sz > max_bytes {
                continue;
            }
        }
        eligible += 1;
        if eligible <= skip {
            continue;
        }
        if tried >= 8 {
            break;
        }
        tried += 1;

        eprintln!(
            "\n-- try #{tried} [{}] \"{}\" host={} size={:?} ({:?}) --",
            gg.source_id, gg.title, opt.host_type, gg.size_bytes, gg.size_text
        );
        let r = resolve_any(&source, opt).await;
        if !r.resolvable {
            eprintln!("   resolve soft-fail: {:?}", r.reason);
            continue;
        }

        type Target = (String, Option<HashMap<String, String>>, String);
        let mut targets: Vec<Target> = Vec::new();
        if let Some(files) = &r.files {
            for (i, f) in files.iter().enumerate() {
                targets.push((
                    f.url.clone(),
                    r.headers.clone(),
                    name_for(&f.url, &f.file_name, i),
                ));
            }
        } else if let Some(u) = &r.url {
            targets.push((u.clone(), r.headers.clone(), name_for(u, &r.file_name, 0)));
        }
        if targets.is_empty() {
            eprintln!("   resolved but no urls");
            continue;
        }
        eprintln!("   resolved {} file(s)", targets.len());

        let game_dir = out.join("installing").join(sanitize(&gg.title));
        let install_dir = out.join("installed").join(sanitize(&gg.title));
        let _ = std::fs::remove_dir_all(&game_dir);
        let _ = std::fs::remove_dir_all(&install_dir);
        tokio::fs::create_dir_all(&game_dir).await.ok();

        let t0 = Instant::now();
        let mut dl_bytes = 0u64;
        let mut first: Option<PathBuf> = None;
        let mut dl_ok = true;
        for (url, hdrs, fname) in &targets {
            let dest = game_dir.join(fname);
            eprintln!("   GET {url}");
            eprintln!("       -> {}", dest.display());
            match download_to(url, hdrs, &dest, max_bytes).await {
                Ok(n) => {
                    dl_bytes += n;
                    if first.is_none() {
                        first = Some(dest.clone());
                    }
                    eprintln!("       ok {n} bytes");
                }
                Err(e) => {
                    eprintln!("       DL FAIL {e}");
                    dl_ok = false;
                    break;
                }
            }
            if dl_bytes > max_bytes + 300_000_000 {
                eprintln!("       cumulative over cap, abort");
                dl_ok = false;
                break;
            }
        }
        if !dl_ok || first.is_none() {
            let _ = std::fs::remove_dir_all(&game_dir);
            continue;
        }
        let dl_secs = t0.elapsed().as_secs_f64();

        let entry = install::extract_entry_point(&game_dir, first.as_ref().unwrap());
        eprintln!(
            "   downloaded {:.1} MB in {:.0}s, extracting entry {}",
            dl_bytes as f64 / 1e6,
            dl_secs,
            entry.display()
        );
        tokio::fs::create_dir_all(&install_dir).await.ok();
        let te = Instant::now();
        match install::run_7z(&entry, &install_dir, |_p| {}).await {
            Ok(()) => {
                let (bytes, files, samples) = verify_extracted(&install_dir);
                let ex_secs = te.elapsed().as_secs_f64();
                eprintln!(
                    "   EXTRACT OK  {files} files, {:.1} MB, {:.0}s",
                    bytes as f64 / 1e6,
                    ex_secs
                );
                for s in &samples {
                    eprintln!("       {s}");
                }
                if files == 0 || bytes == 0 {
                    eprintln!(
                        "\nRESULT EMPTY source={source} host={} game=\"{}\"",
                        opt.host_type, gg.title
                    );
                    if !keep {
                        let _ = std::fs::remove_dir_all(&game_dir);
                        let _ = std::fs::remove_dir_all(&install_dir);
                    }
                    continue;
                }
                let mut launch_report = String::new();
                if do_launch {
                    let launch_appid = match gg.steam_app_id {
                        Some(id) => format!("steam-{id}"),
                        None => sanitize(&gg.title).replace(' ', "-"),
                    };
                    eprintln!("   launching under proton (appid={launch_appid}, {launch_secs}s window)...");
                    let (ok, info) = launch_game(&install_dir, &out, &launch_appid, launch_secs);
                    eprintln!("   LAUNCH {} {}", if ok { "OK" } else { "FAIL" }, info);
                    launch_report =
                        format!(" launch={} ({})", if ok { "OK" } else { "FAIL" }, info);
                }
                eprintln!(
                    "\nRESULT PASS source={source} host={} game=\"{}\" dlBytes={dl_bytes} extractBytes={bytes} files={files}{launch_report}",
                    opt.host_type, gg.title
                );
                if !keep {
                    let _ = std::fs::remove_dir_all(&game_dir);
                    let _ = std::fs::remove_dir_all(&install_dir);
                    let _ = std::fs::remove_dir_all(out.join("compatdata"));
                }
                return;
            }
            Err(e) => {
                eprintln!("   EXTRACT FAIL {e}");
                eprintln!(
                    "\nRESULT EXTRACT_FAIL source={source} host={} game=\"{}\" err={e}",
                    opt.host_type, gg.title
                );
                if !keep {
                    let _ = std::fs::remove_dir_all(&game_dir);
                    let _ = std::fs::remove_dir_all(&install_dir);
                }
                continue;
            }
        }
    }

    eprintln!("\nRESULT NO_INSTALL source={source} host={host_pref:?} tried={tried}");
    panic!("no game installed for source={source} host={host_pref:?}");
}
