use crate::http::{self, FetchOpts};
use crate::install;
use crate::sources::adapters;
use crate::sources::hosts;
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
        "unioncrax" => adapters::unioncrax::query(&params).await,
        "gamebounty" => adapters::gamebounty::query(&params).await,
        "ankergames" => adapters::ankergames::query(&params).await,
        _ => adapters::steamrip::query(&params).await,
    }
}

async fn detail_of(source: &str, slug: &str) -> Option<SourceGame> {
    match source {
        "unioncrax" => adapters::unioncrax::get_detail(slug).await,
        "gamebounty" => adapters::gamebounty::get_detail(slug).await,
        "ankergames" => adapters::ankergames::get_detail(slug).await,
        _ => adapters::steamrip::get_detail(slug).await,
    }
}

async fn resolve_any(source: &str, opt: &DownloadOption) -> ResolveResult {
    match source {
        "unioncrax" => adapters::unioncrax::resolve_download(opt).await,
        "ankergames" => adapters::ankergames::resolve_download(opt).await,
        _ => hosts::resolve_url(opt).await,
    }
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

#[tokio::test]
#[ignore]
async fn install_one_game() {
    let source = env("UM_SOURCE").unwrap_or_else(|| "steamrip".to_string());
    let query = env("UM_QUERY");
    let host_pref = env("UM_HOST");
    let max_gb: f64 = env("UM_MAX_GB").and_then(|s| s.parse().ok()).unwrap_or(5.0);
    let out = PathBuf::from(env("UM_OUT").unwrap_or_else(|| "/tmp/um_install".to_string()));
    let keep = env("UM_KEEP").is_some();
    let max_bytes = (max_gb * 1_000_000_000.0) as u64;

    eprintln!(
        "== install probe source={source} host={host_pref:?} query={query:?} maxGB={max_gb} out={} ==",
        out.display()
    );
    let games = source_games(&source, query.as_deref(), 60).await;
    eprintln!("catalog returned {} games", games.len());

    let mut tried = 0usize;
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

        let mut targets: Vec<(String, Option<HashMap<String, String>>, String)> = Vec::new();
        if let Some(files) = &r.files {
            for (i, f) in files.iter().enumerate() {
                targets.push((f.url.clone(), r.headers.clone(), name_for(&f.url, &f.file_name, i)));
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
                eprintln!(
                    "\nRESULT PASS source={source} host={} game=\"{}\" dlBytes={dl_bytes} extractBytes={bytes} files={files}",
                    opt.host_type, gg.title
                );
                if !keep {
                    let _ = std::fs::remove_dir_all(&game_dir);
                    let _ = std::fs::remove_dir_all(&install_dir);
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
