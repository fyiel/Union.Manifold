// Per-game mod management: NexusMods + Steam Workshop providers, copy-based
// deployment with backup/restore journaling. Storage lives under
// data_dir/mods/<appid>/ (mods.json config, staging/<modId> extracted files,
// backup/ originals, deploy.json journal).

use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::downloads::{now_ms, safe_folder_name, write_json_atomic, MANIFEST_NAME};
use crate::http;
use crate::library;
use crate::paths::AppPaths;
use crate::state::AppState;

pub mod nexus;
pub mod steamcmd;
pub mod thunderstore;
pub mod workshop;

// ---------------------------------------------------------------------------
// Models

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ModEntry {
    pub id: String,
    pub provider: String,
    pub remote_id: String,
    pub file_id: Option<u64>,
    pub name: String,
    pub version: String,
    pub author: String,
    pub picture: Option<String>,
    pub summary: Option<String>,
    pub enabled: bool,
    pub order: u32,
    pub installed_at: i64,
    pub size_bytes: u64,
    pub page_url: String,
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct GameMods {
    // Launcher appid this config belongs to. The folder name is a sanitized
    // form of the appid, so the reverse lookup (nxm link -> game) reads this.
    pub appid: String,
    pub nexus_domain: Option<String>,
    pub nexus_domain_auto: bool,
    // True once domain auto-detection ran against a successfully fetched games
    // list (or the user set/cleared the domain). Distinguishes "no match" from
    // "never tried / no API key yet" so detection can retry later.
    pub nexus_checked: bool,
    pub steam_appid: Option<u64>,
    // None = not yet probed against the Steam store; probe again next get.
    pub workshop_supported: Option<bool>,
    // Thunderstore community identifier bound to this game (r2modman-style
    // BepInEx mods). Detection is keyless, so thunderstore_checked only stays
    // false after a transient communities fetch failure, letting a later
    // mods_game_get retry.
    pub thunderstore_community: Option<String>,
    pub thunderstore_community_auto: bool,
    pub thunderstore_checked: bool,
    pub deploy_target: String,
    pub mods: Vec<ModEntry>,
}

#[derive(Clone, Default, PartialEq, Serialize, Deserialize)]
struct JournalEntry {
    #[serde(rename = "mod")]
    mod_id: String,
    backup: Option<String>,
}

#[derive(Default, PartialEq, Serialize, Deserialize)]
struct Journal {
    #[serde(default)]
    files: BTreeMap<String, JournalEntry>,
}

pub(crate) struct InstallSpec {
    pub appid: String,
    pub provider: String,
    pub remote_id: String,
    pub file_id: Option<u64>,
    pub name: String,
    pub version: String,
    pub author: String,
    pub picture: Option<String>,
    pub summary: Option<String>,
    pub page_url: String,
}

impl InstallSpec {
    pub(crate) fn mod_id(&self) -> String {
        format!("{}-{}", self.provider, self.remote_id)
    }
}

// ---------------------------------------------------------------------------
// Storage

pub(crate) fn game_mods_dir(paths: &AppPaths, appid: &str) -> PathBuf {
    paths.mods_dir().join(safe_folder_name(appid))
}

fn config_path(dir: &Path) -> PathBuf {
    dir.join("mods.json")
}

fn journal_path(dir: &Path) -> PathBuf {
    dir.join("deploy.json")
}

pub(crate) fn load_config(paths: &AppPaths, appid: &str) -> GameMods {
    let mut cfg = std::fs::read_to_string(config_path(&game_mods_dir(paths, appid)))
        .ok()
        .and_then(|t| serde_json::from_str::<GameMods>(&t).ok())
        .unwrap_or_default();
    cfg.appid = appid.to_string();
    cfg
}

pub(crate) fn save_config(paths: &AppPaths, appid: &str, cfg: &GameMods) {
    let dir = game_mods_dir(paths, appid);
    std::fs::create_dir_all(&dir).ok();
    if let Ok(v) = serde_json::to_value(cfg) {
        if let Err(e) = write_json_atomic(&config_path(&dir), &v) {
            crate::logging::write_line("warn", &format!("mods.json write failed for {appid}: {e}"));
        }
    }
}

fn load_journal(dir: &Path) -> Journal {
    std::fs::read_to_string(journal_path(dir))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

fn save_journal(dir: &Path, journal: &Journal) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("mods dir: {e}"))?;
    let v = serde_json::to_value(journal).map_err(|e| format!("journal encode: {e}"))?;
    write_json_atomic(&journal_path(dir), &v).map_err(|e| format!("journal write: {e}"))
}

// ---------------------------------------------------------------------------
// Shared helpers

pub(crate) fn fold(r: Result<Value, String>) -> Value {
    r.unwrap_or_else(|e| json!({ "ok": false, "error": e }))
}

pub(crate) fn urlenc(s: &str) -> String {
    percent_encoding::utf8_percent_encode(s, percent_encoding::NON_ALPHANUMERIC).to_string()
}

pub(crate) fn now_secs() -> i64 {
    now_ms() / 1000
}

// One async lock per game: manifest mutation + deploy must not interleave
// (parallel installs, a toggle racing an install's finalize step).
static GAME_LOCKS: LazyLock<parking_lot::Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>> =
    LazyLock::new(|| parking_lot::Mutex::new(HashMap::new()));

pub(crate) fn game_lock(appid: &str) -> Arc<tokio::sync::Mutex<()>> {
    GAME_LOCKS.lock().entry(appid.to_string()).or_default().clone()
}

pub(crate) fn emit_changed(app: &AppHandle, appid: &str) {
    app.emit("mods:changed", json!({ "appid": appid })).ok();
}

pub(crate) fn emit_progress(
    app: &AppHandle,
    appid: &str,
    mod_id: &str,
    name: &str,
    phase: &str,
    progress: Option<u8>,
    error: Option<&str>,
) {
    let mut payload = json!({
        "appid": appid,
        "modId": mod_id,
        "name": name,
        "phase": phase,
        "progress": progress,
    });
    if let Some(e) = error {
        payload["error"] = json!(e);
    }
    app.emit("mods:install-progress", payload).ok();
}

// ---------------------------------------------------------------------------
// Deployment engine (copy-based, journaled)

// Journal keys are '/'-separated relpaths under the deploy target.
fn rel_string(base: &Path, p: &Path) -> Option<String> {
    let rel = p.strip_prefix(base).ok()?;
    let parts: Vec<String> = rel
        .components()
        .map(|c| c.as_os_str().to_string_lossy().to_string())
        .collect();
    if parts.is_empty() {
        return None;
    }
    Some(parts.join("/"))
}

fn rel_to_path(base: &Path, rel: &str) -> PathBuf {
    let mut out = base.to_path_buf();
    for comp in rel.split('/').filter(|c| !c.is_empty() && *c != "." && *c != "..") {
        out.push(comp);
    }
    out
}

fn remove_empty_parents(path: &Path, stop: &Path) {
    let mut cur = path.parent();
    while let Some(d) = cur {
        if d == stop || !d.starts_with(stop) {
            break;
        }
        if std::fs::remove_dir(d).is_err() {
            break; // non-empty or gone: stop climbing
        }
        cur = d.parent();
    }
}

pub(crate) fn join_target(base: &Path, target: &str) -> Result<PathBuf, String> {
    if target.is_empty() {
        return Ok(base.to_path_buf());
    }
    let mut out = base.to_path_buf();
    for comp in target.replace('\\', "/").split('/') {
        if comp.is_empty() || comp == "." {
            continue;
        }
        if comp == ".." {
            return Err("deployTarget may not contain '..'".to_string());
        }
        out.push(comp);
    }
    Ok(out)
}

/// Sync the deploy target with the union of enabled mods' staged files.
/// Higher `order` wins conflicts; pre-existing originals are moved into
/// backup/ before the first overwrite and restored when their file is no
/// longer desired. Returns the number of deployed files.
pub(crate) fn deploy_to(game_dir: &Path, target: &Path, cfg: &GameMods) -> Result<usize, String> {
    let staging_root = game_dir.join("staging");
    let backup_root = game_dir.join("backup");

    // Desired file map: enabled mods in ascending order, later wins.
    let mut enabled: Vec<&ModEntry> = cfg.mods.iter().filter(|m| m.enabled).collect();
    enabled.sort_by_key(|m| m.order);
    let mut desired: HashMap<String, (PathBuf, String)> = HashMap::new();
    for m in enabled {
        let sdir = staging_root.join(&m.id);
        for entry in walkdir::WalkDir::new(&sdir).into_iter().flatten() {
            if !entry.file_type().is_file() {
                continue;
            }
            if let Some(rel) = rel_string(&sdir, entry.path()) {
                desired.insert(rel, (entry.path().to_path_buf(), m.id.clone()));
            }
        }
    }

    if !desired.is_empty() {
        std::fs::create_dir_all(target).map_err(|e| format!("deploy target: {e}"))?;
    }

    let mut journal = load_journal(game_dir);

    // 1) Remove deployed files no longer desired; restore their backups.
    let stale: Vec<String> = journal
        .files
        .keys()
        .filter(|k| !desired.contains_key(*k))
        .cloned()
        .collect();
    for rel in stale {
        let entry = match journal.files.remove(&rel) {
            Some(e) => e,
            None => continue,
        };
        let dst = rel_to_path(target, &rel);
        std::fs::remove_file(&dst).ok();
        if let Some(b) = entry.backup {
            let bpath = rel_to_path(&backup_root, &b);
            if bpath.is_file() {
                if let Some(parent) = dst.parent() {
                    std::fs::create_dir_all(parent).ok();
                }
                std::fs::rename(&bpath, &dst).map_err(|e| format!("restore {rel}: {e}"))?;
                remove_empty_parents(&bpath, &backup_root);
            }
        }
        remove_empty_parents(&dst, target);
    }

    // 2) Copy every desired file, backing up untouched originals first.
    for (rel, (src, owner)) in &desired {
        let dst = rel_to_path(target, rel);
        if let Some(parent) = dst.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("deploy {rel}: {e}"))?;
        }
        let backup = match journal.files.get(rel) {
            Some(prior) => prior.backup.clone(),
            None => {
                if dst.exists() {
                    // Pre-existing original: move it aside before overwriting.
                    // If an unjournaled backup already exists (corrupt/lost
                    // journal, crash mid-deploy), the older file is the true
                    // original — keep it and let the stale copy at dst be
                    // overwritten below instead of clobbering the backup.
                    let bpath = rel_to_path(&backup_root, rel);
                    if !bpath.is_file() {
                        if let Some(parent) = bpath.parent() {
                            std::fs::create_dir_all(parent).map_err(|e| format!("backup {rel}: {e}"))?;
                        }
                        if std::fs::rename(&dst, &bpath).is_err() {
                            std::fs::copy(&dst, &bpath).map_err(|e| format!("backup {rel}: {e}"))?;
                            std::fs::remove_file(&dst).ok();
                        }
                    }
                    Some(rel.clone())
                } else {
                    None
                }
            }
        };
        std::fs::copy(src, &dst).map_err(|e| format!("deploy {rel}: {e}"))?;
        journal.files.insert(
            rel.clone(),
            JournalEntry {
                mod_id: owner.clone(),
                backup,
            },
        );
    }

    save_journal(game_dir, &journal)?;
    Ok(journal.files.len())
}

/// Remove every journaled file from the target, restore all backups, clear
/// the journal.
pub(crate) fn undeploy_from(game_dir: &Path, target: &Path) -> Result<(), String> {
    let backup_root = game_dir.join("backup");
    let journal = load_journal(game_dir);
    for (rel, entry) in &journal.files {
        let dst = rel_to_path(target, rel);
        std::fs::remove_file(&dst).ok();
        if let Some(b) = &entry.backup {
            let bpath = rel_to_path(&backup_root, b);
            if bpath.is_file() {
                if let Some(parent) = dst.parent() {
                    std::fs::create_dir_all(parent).ok();
                }
                std::fs::rename(&bpath, &dst).map_err(|e| format!("restore {rel}: {e}"))?;
                remove_empty_parents(&bpath, &backup_root);
            }
        }
        remove_empty_parents(&dst, target);
    }
    save_journal(game_dir, &Journal::default())
}

fn deploy_target_dir(state: &AppState, appid: &str, cfg: &GameMods) -> Result<PathBuf, String> {
    let roots = library::scan_roots(state);
    let base = library::game_files_dir(&roots, appid)
        .ok_or_else(|| format!("game {appid} not found in library"))?;
    join_target(&base, &cfg.deploy_target)
}

fn redeploy(state: &AppState, appid: &str, cfg: &GameMods) -> Result<usize, String> {
    let dir = game_mods_dir(&state.paths, appid);
    let target = deploy_target_dir(state, appid, cfg)?;
    deploy_to(&dir, &target, cfg)
}

// ---------------------------------------------------------------------------
// Lazy per-game detection

fn read_game_manifest(roots: &[PathBuf], appid: &str) -> Option<Value> {
    let dir = library::find_dir(roots, appid)?;
    let text = std::fs::read_to_string(dir.join(MANIFEST_NAME)).ok()?;
    serde_json::from_str(&text).ok()
}

fn game_title(state: &AppState, appid: &str) -> Option<String> {
    let roots = library::scan_roots(state);
    let m = read_game_manifest(&roots, appid)?;
    m.get("name")
        .and_then(|v| v.as_str())
        .or_else(|| m.pointer("/metadata/name").and_then(|v| v.as_str()))
        .map(str::to_string)
}

async fn detect_steam_appid(state: &AppState, appid: &str) -> Option<u64> {
    if let Some(id) = appid.strip_prefix("steam-").and_then(|s| s.parse::<u64>().ok()) {
        return Some(id);
    }
    let roots = library::scan_roots(state);
    let manifest = read_game_manifest(&roots, appid)?;
    if let Some(id) = manifest
        .get("steamAppId")
        .and_then(|v| v.as_u64())
        .filter(|id| *id > 0)
    {
        return Some(id);
    }
    if let Some(id) = manifest
        .pointer("/metadata/steamAppId")
        .and_then(|v| v.as_u64())
        .filter(|id| *id > 0)
    {
        return Some(id);
    }
    let name = manifest
        .get("name")
        .and_then(|v| v.as_str())
        .or_else(|| manifest.pointer("/metadata/name").and_then(|v| v.as_str()))?
        .to_string();
    crate::sources::steam::search_app_id(&name).await
}

// ---------------------------------------------------------------------------
// Shared install pipeline

/// Stream `url` into `dest`, reporting percent progress (None when the total
/// size is unknown). Returns received bytes.
pub(crate) async fn download_to_file(
    url: &str,
    dest: &Path,
    headers: HashMap<String, String>,
    mut on_progress: impl FnMut(Option<u8>),
) -> Result<u64, String> {
    use futures::StreamExt;
    use tokio::io::AsyncWriteExt;

    let opts = http::FetchOpts {
        headers,
        // Archive downloads run for minutes; the client-wide 25s timeout
        // only fits API calls. reqwest's per-request timeout covers the
        // whole body read, so give it generous headroom.
        timeout: Some(Duration::from_secs(2 * 60 * 60)),
        ..Default::default()
    };
    let resp = http::fetch(url, &opts).await.map_err(|e| format!("download: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("download failed: HTTP {}", resp.status()));
    }
    let total = resp.content_length().filter(|t| *t > 0);
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("download dir: {e}"))?;
    }
    let mut file = tokio::fs::File::create(dest)
        .await
        .map_err(|e| format!("download file: {e}"))?;
    let mut stream = resp.bytes_stream();
    let mut received: u64 = 0;
    let mut last: Option<u8> = total.map(|_| 0);
    on_progress(last);
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("download stream: {e}"))?;
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("download write: {e}"))?;
        received += chunk.len() as u64;
        let pct = total.map(|t| ((received.saturating_mul(100)) / t.max(1)).min(100) as u8);
        if pct != last {
            last = pct;
            on_progress(pct);
        }
    }
    file.flush().await.ok();
    Ok(received)
}

fn filename_from_url(url: &str) -> Option<String> {
    let u = url::Url::parse(url).ok()?;
    let last = u.path_segments()?.last()?.to_string();
    let decoded = percent_encoding::percent_decode_str(&last)
        .decode_utf8_lossy()
        .to_string();
    let safe = safe_folder_name(&decoded);
    (!safe.is_empty() && safe != "unknown").then_some(safe)
}

pub(crate) fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    for entry in walkdir::WalkDir::new(src).into_iter().flatten() {
        let rel = match entry.path().strip_prefix(src) {
            Ok(r) if !r.as_os_str().is_empty() => r,
            _ => continue,
        };
        let to = dst.join(rel);
        if entry.file_type().is_dir() {
            std::fs::create_dir_all(&to).map_err(|e| format!("copy dir: {e}"))?;
        } else if entry.file_type().is_file() {
            if let Some(parent) = to.parent() {
                std::fs::create_dir_all(parent).map_err(|e| format!("copy dir: {e}"))?;
            }
            std::fs::copy(entry.path(), &to).map_err(|e| format!("copy file: {e}"))?;
        }
    }
    Ok(())
}

fn upsert_mod(cfg: &mut GameMods, spec: &InstallSpec, size: u64) {
    let mod_id = spec.mod_id();
    if let Some(m) = cfg.mods.iter_mut().find(|m| m.id == mod_id) {
        // Reinstall/update: keep the user's enabled flag + order.
        m.file_id = spec.file_id;
        m.name = spec.name.clone();
        m.version = spec.version.clone();
        m.author = spec.author.clone();
        m.picture = spec.picture.clone();
        m.summary = spec.summary.clone();
        m.installed_at = now_secs();
        m.size_bytes = size;
        m.page_url = spec.page_url.clone();
    } else {
        let order = cfg.mods.iter().map(|m| m.order + 1).max().unwrap_or(0);
        cfg.mods.push(ModEntry {
            id: mod_id,
            provider: spec.provider.clone(),
            remote_id: spec.remote_id.clone(),
            file_id: spec.file_id,
            name: spec.name.clone(),
            version: spec.version.clone(),
            author: spec.author.clone(),
            picture: spec.picture.clone(),
            summary: spec.summary.clone(),
            enabled: true,
            order,
            installed_at: now_secs(),
            size_bytes: size,
            page_url: spec.page_url.clone(),
        });
    }
}

/// Move (or copy) a fully staged mod directory into staging/<modId>, upsert
/// the manifest entry, redeploy, and emit events. Shared by both providers.
pub(crate) async fn finalize_install(
    app: &AppHandle,
    spec: &InstallSpec,
    staged_src: &Path,
    move_src: bool,
) -> Result<usize, String> {
    let state = app.state::<AppState>();
    let mod_id = spec.mod_id();
    let lock = game_lock(&spec.appid);
    let _g = lock.lock().await;

    let dir = game_mods_dir(&state.paths, &spec.appid);
    let final_dir = dir.join("staging").join(&mod_id);
    if final_dir.exists() {
        std::fs::remove_dir_all(&final_dir).map_err(|e| format!("replace staging: {e}"))?;
    }
    if let Some(parent) = final_dir.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("staging dir: {e}"))?;
    }
    if move_src && std::fs::rename(staged_src, &final_dir).is_ok() {
        // moved wholesale
    } else {
        copy_dir_recursive(staged_src, &final_dir)?;
        if move_src {
            std::fs::remove_dir_all(staged_src).ok();
        }
    }
    let size = crate::install::dir_size(&final_dir);

    let mut cfg = load_config(&state.paths, &spec.appid);
    upsert_mod(&mut cfg, spec, size);
    save_config(&state.paths, &spec.appid, &cfg);
    let n = redeploy(&state, &spec.appid, &cfg)?;
    emit_changed(app, &spec.appid);
    Ok(n)
}

/// Full archive install: download -> extract (7z sidecar) -> stage -> deploy,
/// with `mods:install-progress` events for every phase. Errors are emitted,
/// never returned — this runs as a detached background task.
pub(crate) async fn run_archive_install(
    app: AppHandle,
    spec: InstallSpec,
    url: String,
    headers: HashMap<String, String>,
) {
    let mod_id = spec.mod_id();
    if let Err(e) = archive_install_inner(&app, &spec, &url, headers).await {
        emit_progress(&app, &spec.appid, &mod_id, &spec.name, "error", None, Some(&e));
    }
}

async fn archive_install_inner(
    app: &AppHandle,
    spec: &InstallSpec,
    url: &str,
    headers: HashMap<String, String>,
) -> Result<(), String> {
    let state = app.state::<AppState>();
    let mod_id = spec.mod_id();
    let dir = game_mods_dir(&state.paths, &spec.appid);
    let tmp_dir = dir.join(".tmp");
    std::fs::create_dir_all(&tmp_dir).map_err(|e| format!("tmp dir: {e}"))?;

    emit_progress(app, &spec.appid, &mod_id, &spec.name, "downloading", Some(0), None);
    let fname = filename_from_url(url).unwrap_or_else(|| format!("{mod_id}.archive"));
    let archive = tmp_dir.join(format!("{mod_id}-{fname}"));
    download_to_file(url, &archive, headers, |p| {
        emit_progress(app, &spec.appid, &mod_id, &spec.name, "downloading", p, None);
    })
    .await?;

    emit_progress(app, &spec.appid, &mod_id, &spec.name, "extracting", None, None);
    let extract_dir = tmp_dir.join(format!("{mod_id}-extract"));
    if extract_dir.exists() {
        std::fs::remove_dir_all(&extract_dir).ok();
    }
    let res = crate::install::run_7z(&archive, &extract_dir, |p| {
        emit_progress(app, &spec.appid, &mod_id, &spec.name, "extracting", Some(p), None);
    })
    .await
    .map_err(|e| e.to_string());
    std::fs::remove_file(&archive).ok();
    res?;
    flatten_tar(&extract_dir).await?;

    emit_progress(app, &spec.appid, &mod_id, &spec.name, "installing", None, None);
    let out = finalize_install(app, spec, &extract_dir, true).await;
    std::fs::remove_dir_all(&extract_dir).ok();
    out?;
    emit_progress(app, &spec.appid, &mod_id, &spec.name, "done", Some(100), None);
    Ok(())
}

/// 7z extracts foo.tar.gz to a single foo.tar in one pass; unwrap it so
/// staging holds real files.
async fn flatten_tar(dir: &Path) -> Result<(), String> {
    let entries: Vec<PathBuf> = std::fs::read_dir(dir)
        .map_err(|e| format!("extract dir: {e}"))?
        .flatten()
        .map(|e| e.path())
        .collect();
    if entries.len() != 1 {
        return Ok(());
    }
    let only = &entries[0];
    let is_tar = only.is_file()
        && only
            .extension()
            .map(|e| e.eq_ignore_ascii_case("tar"))
            .unwrap_or(false);
    if !is_tar {
        return Ok(());
    }
    crate::install::run_7z(only, dir, |_| {})
        .await
        .map_err(|e| e.to_string())?;
    std::fs::remove_file(only).ok();
    Ok(())
}

// ---------------------------------------------------------------------------
// Commands

#[tauri::command]
pub async fn mods_game_get(state: State<'_, AppState>, appid: String) -> Result<Value, String> {
    let lock = game_lock(&appid);
    let _g = lock.lock().await;
    let existed = config_path(&game_mods_dir(&state.paths, &appid)).is_file();
    let mut cfg = load_config(&state.paths, &appid);
    let mut dirty = false;

    if cfg.steam_appid.is_none() {
        if let Some(id) = detect_steam_appid(&state, &appid).await {
            cfg.steam_appid = Some(id);
            dirty = true;
        }
    }
    if cfg.nexus_domain.is_none() && !cfg.nexus_checked {
        // Detection needs the games index, which needs an API key. No key or a
        // transient fetch failure: leave nexus_checked false so a later call
        // retries; the frontend shows the key prompt when domain is null.
        if let Some(key) = state
            .settings
            .get_string("nexusApiKey")
            .map(|k| k.trim().to_string())
            .filter(|k| !k.is_empty())
        {
            if let Some(title) = game_title(&state, &appid) {
                if let Ok(found) = nexus::match_domain(&key, &title).await {
                    cfg.nexus_checked = true;
                    cfg.nexus_domain_auto = found.is_some();
                    cfg.nexus_domain = found;
                    dirty = true;
                }
            }
        }
    }
    if cfg.workshop_supported.is_none() {
        if let Some(said) = cfg.steam_appid {
            if let Some(supported) = workshop::detect_workshop_support(said).await {
                cfg.workshop_supported = Some(supported);
                dirty = true;
            }
        }
    }
    if cfg.thunderstore_community.is_none() && !cfg.thunderstore_checked {
        // Keyless, so unlike nexus this needs no API key gate. A failed
        // communities fetch leaves thunderstore_checked false to retry later.
        if let Some(title) = game_title(&state, &appid) {
            if let Ok(found) = thunderstore::match_community(&title).await {
                cfg.thunderstore_checked = true;
                cfg.thunderstore_community_auto = found.is_some();
                cfg.thunderstore_community = found.map(|c| c.identifier);
                dirty = true;
            }
        }
    }

    if dirty || !existed {
        save_config(&state.paths, &appid, &cfg);
    }
    let deployed = !load_journal(&game_mods_dir(&state.paths, &appid)).files.is_empty();
    Ok(json!({
        "ok": true,
        "nexusDomain": cfg.nexus_domain,
        "nexusDomainAuto": cfg.nexus_domain_auto,
        "steamAppid": cfg.steam_appid,
        "workshopSupported": cfg.workshop_supported.unwrap_or(false),
        "thunderstoreCommunity": cfg.thunderstore_community,
        "thunderstoreCommunityAuto": cfg.thunderstore_community_auto,
        "thunderstoreSupported": cfg.thunderstore_community.is_some(),
        "deployTarget": cfg.deploy_target,
        "deployed": deployed,
        "mods": serde_json::to_value(&cfg.mods).unwrap_or_else(|_| json!([])),
    }))
}

#[tauri::command]
pub async fn mods_game_set(
    app: AppHandle,
    state: State<'_, AppState>,
    appid: String,
    config: Value,
) -> Result<Value, String> {
    let lock = game_lock(&appid);
    let _g = lock.lock().await;
    let mut cfg = load_config(&state.paths, &appid);
    let dir = game_mods_dir(&state.paths, &appid);

    if let Some(v) = config.get("nexusDomain") {
        match v.as_str().map(str::trim).filter(|s| !s.is_empty()) {
            Some(s) => {
                cfg.nexus_domain = Some(s.to_string());
                cfg.nexus_domain_auto = false;
                cfg.nexus_checked = true;
            }
            None => {
                cfg.nexus_domain = None;
                cfg.nexus_domain_auto = false;
                cfg.nexus_checked = false; // allow auto-detection to retry
            }
        }
    }

    if let Some(v) = config.get("thunderstoreCommunity") {
        match v.as_str().map(str::trim).filter(|s| !s.is_empty()) {
            Some(s) => {
                cfg.thunderstore_community = Some(s.to_string());
                cfg.thunderstore_community_auto = false;
                cfg.thunderstore_checked = true;
            }
            None => {
                cfg.thunderstore_community = None;
                cfg.thunderstore_community_auto = false;
                cfg.thunderstore_checked = false; // allow auto-detection to retry
            }
        }
    }

    let res: Result<(), String> = (|| {
        if let Some(v) = config.get("deployTarget").and_then(|v| v.as_str()) {
            let new_target = v.trim().trim_matches('/').trim_matches('\\').to_string();
            if new_target != cfg.deploy_target {
                // Pull everything out of the old target before switching.
                if let Ok(old) = deploy_target_dir(&state, &appid, &cfg) {
                    undeploy_from(&dir, &old)?;
                }
                cfg.deploy_target = new_target;
                let target = deploy_target_dir(&state, &appid, &cfg)?;
                deploy_to(&dir, &target, &cfg)?;
            }
        }
        Ok(())
    })();

    save_config(&state.paths, &appid, &cfg);
    emit_changed(&app, &appid);
    Ok(fold(res.map(|_| json!({ "ok": true }))))
}

#[tauri::command]
pub async fn mods_toggle(
    app: AppHandle,
    state: State<'_, AppState>,
    appid: String,
    mod_id: String,
    enabled: bool,
) -> Result<Value, String> {
    let lock = game_lock(&appid);
    let _g = lock.lock().await;
    let mut cfg = load_config(&state.paths, &appid);
    let Some(m) = cfg.mods.iter_mut().find(|m| m.id == mod_id) else {
        return Ok(json!({ "ok": false, "error": format!("mod {mod_id} not found") }));
    };
    m.enabled = enabled;
    save_config(&state.paths, &appid, &cfg);
    let res = redeploy(&state, &appid, &cfg);
    emit_changed(&app, &appid);
    Ok(fold(res.map(|_| json!({ "ok": true }))))
}

#[tauri::command]
pub async fn mods_reorder(
    app: AppHandle,
    state: State<'_, AppState>,
    appid: String,
    ordered_ids: Vec<String>,
) -> Result<Value, String> {
    let lock = game_lock(&appid);
    let _g = lock.lock().await;
    let mut cfg = load_config(&state.paths, &appid);
    let pos: HashMap<&str, usize> = ordered_ids
        .iter()
        .enumerate()
        .map(|(i, id)| (id.as_str(), i))
        .collect();
    // Stable sort keeps any id missing from the list at the tail in its
    // current relative order, then orders are renumbered densely.
    cfg.mods
        .sort_by_key(|m| pos.get(m.id.as_str()).copied().unwrap_or(usize::MAX));
    for (i, m) in cfg.mods.iter_mut().enumerate() {
        m.order = i as u32;
    }
    save_config(&state.paths, &appid, &cfg);
    let res = redeploy(&state, &appid, &cfg);
    emit_changed(&app, &appid);
    Ok(fold(res.map(|_| json!({ "ok": true }))))
}

#[tauri::command]
pub async fn mods_uninstall(
    app: AppHandle,
    state: State<'_, AppState>,
    appid: String,
    mod_id: String,
) -> Result<Value, String> {
    let lock = game_lock(&appid);
    let _g = lock.lock().await;
    let mut cfg = load_config(&state.paths, &appid);
    let before = cfg.mods.len();
    cfg.mods.retain(|m| m.id != mod_id);
    if cfg.mods.len() == before {
        return Ok(json!({ "ok": false, "error": format!("mod {mod_id} not found") }));
    }
    save_config(&state.paths, &appid, &cfg);
    // Redeploy first: the diff restores this mod's files from backup.
    let res = redeploy(&state, &appid, &cfg);
    let dir = game_mods_dir(&state.paths, &appid);
    std::fs::remove_dir_all(dir.join("staging").join(&mod_id)).ok();
    emit_changed(&app, &appid);
    Ok(fold(res.map(|_| json!({ "ok": true }))))
}

#[tauri::command]
pub async fn mods_deploy(
    app: AppHandle,
    state: State<'_, AppState>,
    appid: String,
) -> Result<Value, String> {
    let lock = game_lock(&appid);
    let _g = lock.lock().await;
    let cfg = load_config(&state.paths, &appid);
    let res = redeploy(&state, &appid, &cfg);
    emit_changed(&app, &appid);
    Ok(fold(res.map(|n| json!({ "ok": true, "fileCount": n }))))
}

#[tauri::command]
pub async fn mods_undeploy(
    app: AppHandle,
    state: State<'_, AppState>,
    appid: String,
) -> Result<Value, String> {
    let lock = game_lock(&appid);
    let _g = lock.lock().await;
    let cfg = load_config(&state.paths, &appid);
    let dir = game_mods_dir(&state.paths, &appid);
    let res: Result<(), String> = (|| {
        let target = deploy_target_dir(&state, &appid, &cfg)?;
        undeploy_from(&dir, &target)
    })();
    emit_changed(&app, &appid);
    Ok(fold(res.map(|_| json!({ "ok": true }))))
}

#[tauri::command(async)]
pub fn mods_open_folder(state: State<'_, AppState>, appid: String) -> Value {
    let dir = game_mods_dir(&state.paths, &appid).join("staging");
    if let Err(e) = std::fs::create_dir_all(&dir) {
        return json!({ "ok": false, "error": format!("staging dir: {e}") });
    }
    match crate::system::open_path_os(&dir) {
        Ok(_) => json!({ "ok": true }),
        Err(e) => json!({ "ok": false, "error": e.to_string() }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn write_file(p: &Path, content: &str) {
        if let Some(parent) = p.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(p, content).unwrap();
    }

    fn read(p: &Path) -> String {
        std::fs::read_to_string(p).unwrap()
    }

    fn mk_mod(game_dir: &Path, id: &str, order: u32, files: &[(&str, &str)]) -> ModEntry {
        for (rel, content) in files {
            write_file(&rel_to_path(&game_dir.join("staging").join(id), rel), content);
        }
        ModEntry {
            id: id.to_string(),
            provider: "nexus".to_string(),
            remote_id: id.to_string(),
            enabled: true,
            order,
            name: id.to_string(),
            ..Default::default()
        }
    }

    #[test]
    fn deploy_higher_order_wins_conflicts() {
        let tmp = tempdir().unwrap();
        let dir = tmp.path().join("m");
        let target = tmp.path().join("game");
        std::fs::create_dir_all(&target).unwrap();
        let a = mk_mod(&dir, "nexus-1", 0, &[("data/conflict.txt", "from-a"), ("a-only.txt", "a")]);
        let b = mk_mod(&dir, "nexus-2", 1, &[("data/conflict.txt", "from-b")]);
        let cfg = GameMods { mods: vec![a, b], ..Default::default() };

        let n = deploy_to(&dir, &target, &cfg).unwrap();
        assert_eq!(n, 2);
        assert_eq!(read(&target.join("data/conflict.txt")), "from-b");
        assert_eq!(read(&target.join("a-only.txt")), "a");
        let journal = load_journal(&dir);
        assert_eq!(journal.files.get("data/conflict.txt").unwrap().mod_id, "nexus-2");
    }

    #[test]
    fn toggle_off_restores_backed_up_original() {
        let tmp = tempdir().unwrap();
        let dir = tmp.path().join("m");
        let target = tmp.path().join("game");
        write_file(&target.join("data/original.txt"), "original");
        let a = mk_mod(&dir, "nexus-1", 0, &[("data/original.txt", "modded")]);
        let mut cfg = GameMods { mods: vec![a], ..Default::default() };

        deploy_to(&dir, &target, &cfg).unwrap();
        assert_eq!(read(&target.join("data/original.txt")), "modded");
        assert!(dir.join("backup/data/original.txt").is_file());

        cfg.mods[0].enabled = false;
        deploy_to(&dir, &target, &cfg).unwrap();
        assert_eq!(read(&target.join("data/original.txt")), "original");
        assert!(load_journal(&dir).files.is_empty());
        assert!(!dir.join("backup/data/original.txt").exists());
    }

    #[test]
    fn undeploy_restores_everything() {
        let tmp = tempdir().unwrap();
        let dir = tmp.path().join("m");
        let target = tmp.path().join("game");
        write_file(&target.join("keep.txt"), "keep");
        write_file(&target.join("overwritten.txt"), "original");
        let a = mk_mod(&dir, "nexus-1", 0, &[("overwritten.txt", "modded"), ("added/new.txt", "new")]);
        let cfg = GameMods { mods: vec![a], ..Default::default() };

        deploy_to(&dir, &target, &cfg).unwrap();
        undeploy_from(&dir, &target).unwrap();

        assert_eq!(read(&target.join("keep.txt")), "keep");
        assert_eq!(read(&target.join("overwritten.txt")), "original");
        assert!(!target.join("added").exists(), "mod-created dirs cleaned up");
        assert!(load_journal(&dir).files.is_empty());
    }

    #[test]
    fn reorder_changes_conflict_winner() {
        let tmp = tempdir().unwrap();
        let dir = tmp.path().join("m");
        let target = tmp.path().join("game");
        std::fs::create_dir_all(&target).unwrap();
        let a = mk_mod(&dir, "nexus-1", 0, &[("f.txt", "from-a")]);
        let b = mk_mod(&dir, "nexus-2", 1, &[("f.txt", "from-b")]);
        let mut cfg = GameMods { mods: vec![a, b], ..Default::default() };

        deploy_to(&dir, &target, &cfg).unwrap();
        assert_eq!(read(&target.join("f.txt")), "from-b");

        cfg.mods[0].order = 1;
        cfg.mods[1].order = 0;
        deploy_to(&dir, &target, &cfg).unwrap();
        assert_eq!(read(&target.join("f.txt")), "from-a");
        assert_eq!(load_journal(&dir).files.get("f.txt").unwrap().mod_id, "nexus-1");
    }

    #[test]
    fn deploy_is_idempotent() {
        let tmp = tempdir().unwrap();
        let dir = tmp.path().join("m");
        let target = tmp.path().join("game");
        write_file(&target.join("orig.txt"), "original");
        let a = mk_mod(&dir, "nexus-1", 0, &[("orig.txt", "modded"), ("extra.txt", "x")]);
        let cfg = GameMods { mods: vec![a], ..Default::default() };

        let n1 = deploy_to(&dir, &target, &cfg).unwrap();
        let j1 = std::fs::read(journal_path(&dir)).unwrap();
        let n2 = deploy_to(&dir, &target, &cfg).unwrap();
        let j2 = std::fs::read(journal_path(&dir)).unwrap();

        assert_eq!(n1, n2);
        assert_eq!(j1, j2, "journal byte-identical across redeploys");
        assert_eq!(read(&target.join("orig.txt")), "modded");
        // The original backup survives the second pass untouched.
        assert_eq!(read(&dir.join("backup/orig.txt")), "original");
    }

    #[test]
    fn join_target_rejects_escapes() {
        let base = Path::new("/base");
        assert!(join_target(base, "../evil").is_err());
        assert!(join_target(base, "sub/../../evil").is_err());
        assert_eq!(join_target(base, "").unwrap(), PathBuf::from("/base"));
        assert_eq!(join_target(base, "Data/Mods").unwrap(), PathBuf::from("/base/Data/Mods"));
        assert_eq!(join_target(base, "Data\\Mods").unwrap(), PathBuf::from("/base/Data/Mods"));
    }

    #[test]
    fn undeploy_prunes_nested_dirs_but_keeps_user_dirs() {
        let tmp = tempdir().unwrap();
        let dir = tmp.path().join("m");
        let target = tmp.path().join("game");
        write_file(&target.join("a/keep.txt"), "keep");
        write_file(&target.join("x/y/orig.txt"), "original");
        let a = mk_mod(
            &dir,
            "nexus-1",
            0,
            &[("a/b/c/deep.txt", "deep"), ("x/y/orig.txt", "modded"), ("top.txt", "top")],
        );
        let cfg = GameMods { mods: vec![a], ..Default::default() };

        deploy_to(&dir, &target, &cfg).unwrap();
        undeploy_from(&dir, &target).unwrap();

        // Mod-created directory chains are pruned all the way up...
        assert!(!target.join("a/b").exists(), "mod-created nested dirs pruned");
        assert!(!target.join("top.txt").exists());
        // ...but user dirs that still hold original files survive.
        assert_eq!(read(&target.join("a/keep.txt")), "keep");
        assert_eq!(read(&target.join("x/y/orig.txt")), "original");
        // Nested backup dirs are pruned once their originals go home.
        assert!(!dir.join("backup/x").exists(), "backup subdirs pruned after restore");
    }

    #[test]
    fn uninstall_of_winner_hands_file_to_survivor_and_restores_the_rest() {
        let tmp = tempdir().unwrap();
        let dir = tmp.path().join("m");
        let target = tmp.path().join("game");
        write_file(&target.join("b-only.txt"), "original");
        let a = mk_mod(&dir, "nexus-1", 0, &[("shared.txt", "from-a")]);
        let b = mk_mod(&dir, "nexus-2", 1, &[("shared.txt", "from-b"), ("b-only.txt", "modded")]);
        let mut cfg = GameMods { mods: vec![a, b], ..Default::default() };

        deploy_to(&dir, &target, &cfg).unwrap();
        assert_eq!(read(&target.join("shared.txt")), "from-b");

        // Uninstall = drop from the manifest, then redeploy (mods_uninstall).
        // One pass must both withdraw B's exclusive file and hand the shared
        // one back to the lower-order survivor.
        cfg.mods.retain(|m| m.id != "nexus-2");
        let n = deploy_to(&dir, &target, &cfg).unwrap();

        assert_eq!(n, 1);
        assert_eq!(read(&target.join("shared.txt")), "from-a");
        assert_eq!(load_journal(&dir).files.get("shared.txt").unwrap().mod_id, "nexus-1");
        assert_eq!(read(&target.join("b-only.txt")), "original");
        assert!(!dir.join("backup/b-only.txt").exists());
    }

    #[test]
    fn backup_survives_winner_change_and_undeploy_restores_original() {
        let tmp = tempdir().unwrap();
        let dir = tmp.path().join("m");
        let target = tmp.path().join("game");
        write_file(&target.join("f.txt"), "original");
        let a = mk_mod(&dir, "nexus-1", 0, &[("f.txt", "from-a")]);
        let b = mk_mod(&dir, "nexus-2", 1, &[("f.txt", "from-b")]);

        // First deploy: only A installed; the original is backed up.
        let cfg_a = GameMods { mods: vec![a.clone()], ..Default::default() };
        deploy_to(&dir, &target, &cfg_a).unwrap();
        assert_eq!(read(&dir.join("backup/f.txt")), "original");

        // B installs on top and wins. The backup must still be the original,
        // not A's copy that B just overwrote.
        let cfg_ab = GameMods { mods: vec![a, b], ..Default::default() };
        deploy_to(&dir, &target, &cfg_ab).unwrap();
        assert_eq!(read(&target.join("f.txt")), "from-b");
        assert_eq!(read(&dir.join("backup/f.txt")), "original");
        assert_eq!(
            load_journal(&dir).files.get("f.txt").unwrap().backup.as_deref(),
            Some("f.txt")
        );

        undeploy_from(&dir, &target).unwrap();
        assert_eq!(read(&target.join("f.txt")), "original");
    }

    #[test]
    fn deploy_target_switch_restores_old_target_before_claiming_new() {
        let tmp = tempdir().unwrap();
        let dir = tmp.path().join("m");
        let game = tmp.path().join("game");
        write_file(&game.join("f.txt"), "root-original");
        write_file(&game.join("Data/f.txt"), "data-original");
        let a = mk_mod(&dir, "nexus-1", 0, &[("f.txt", "modded")]);
        let cfg = GameMods { mods: vec![a], ..Default::default() };

        // Deployed at the game root.
        deploy_to(&dir, &game, &cfg).unwrap();
        assert_eq!(read(&game.join("f.txt")), "modded");

        // deployTarget change (mods_game_set): undeploy old, deploy new.
        undeploy_from(&dir, &game).unwrap();
        let new_target = join_target(&game, "Data").unwrap();
        deploy_to(&dir, &new_target, &cfg).unwrap();

        // Old target pristine again; new one claimed with its own backup.
        assert_eq!(read(&game.join("f.txt")), "root-original");
        assert_eq!(read(&game.join("Data/f.txt")), "modded");
        assert_eq!(read(&dir.join("backup/f.txt")), "data-original");

        // Round-trip out of the new target too.
        undeploy_from(&dir, &new_target).unwrap();
        assert_eq!(read(&game.join("Data/f.txt")), "data-original");
        assert_eq!(read(&game.join("f.txt")), "root-original");
    }

    #[test]
    fn disabled_mod_contributes_nothing_until_enabled() {
        let tmp = tempdir().unwrap();
        let dir = tmp.path().join("m");
        let target = tmp.path().join("game");
        std::fs::create_dir_all(&target).unwrap();
        let a = mk_mod(&dir, "nexus-1", 0, &[("conflict.txt", "from-a"), ("a.txt", "a")]);
        let mut b = mk_mod(&dir, "nexus-2", 1, &[("conflict.txt", "from-b"), ("b.txt", "b")]);
        b.enabled = false;
        let mut cfg = GameMods { mods: vec![a, b], ..Default::default() };

        let n = deploy_to(&dir, &target, &cfg).unwrap();
        assert_eq!(n, 2);
        // A disabled mod never wins a conflict, whatever its order says.
        assert_eq!(read(&target.join("conflict.txt")), "from-a");
        assert!(!target.join("b.txt").exists());

        cfg.mods[1].enabled = true;
        let n = deploy_to(&dir, &target, &cfg).unwrap();
        assert_eq!(n, 3);
        assert_eq!(read(&target.join("conflict.txt")), "from-b");
        assert_eq!(read(&target.join("b.txt")), "b");
        // A's exclusive file keeps its content and journal entry; enabling B
        // must not re-backup A's own deployed copy as if it were an original.
        let j = load_journal(&dir);
        assert_eq!(read(&target.join("a.txt")), "a");
        assert_eq!(j.files.get("a.txt").unwrap().mod_id, "nexus-1");
        assert!(j.files.get("a.txt").unwrap().backup.is_none());
    }

    #[test]
    fn staging_drift_missing_files_are_treated_as_removed() {
        let tmp = tempdir().unwrap();
        let dir = tmp.path().join("m");
        let target = tmp.path().join("game");
        write_file(&target.join("drift.txt"), "original");
        let a = mk_mod(&dir, "nexus-1", 0, &[("drift.txt", "modded"), ("stay.txt", "stay")]);
        let cfg = GameMods { mods: vec![a], ..Default::default() };

        deploy_to(&dir, &target, &cfg).unwrap();

        // A staged file vanishes behind the engine's back: treated as removed,
        // its backup goes home, the rest stays deployed.
        std::fs::remove_file(dir.join("staging/nexus-1/drift.txt")).unwrap();
        let n = deploy_to(&dir, &target, &cfg).unwrap();
        assert_eq!(n, 1);
        assert_eq!(read(&target.join("drift.txt")), "original");
        assert_eq!(read(&target.join("stay.txt")), "stay");
        assert!(load_journal(&dir).files.get("drift.txt").is_none());

        // The whole staging dir vanishes: everything is cleanly withdrawn.
        std::fs::remove_dir_all(dir.join("staging/nexus-1")).unwrap();
        let n = deploy_to(&dir, &target, &cfg).unwrap();
        assert_eq!(n, 0);
        assert!(!target.join("stay.txt").exists());
        assert!(load_journal(&dir).files.is_empty());
    }

    #[test]
    fn corrupt_journal_never_clobbers_backups() {
        let tmp = tempdir().unwrap();
        let dir = tmp.path().join("m");
        let target = tmp.path().join("game");
        write_file(&target.join("f.txt"), "original");
        let a = mk_mod(&dir, "nexus-1", 0, &[("f.txt", "modded")]);
        let cfg = GameMods { mods: vec![a], ..Default::default() };

        deploy_to(&dir, &target, &cfg).unwrap();
        std::fs::write(journal_path(&dir), "{ not json !!!").unwrap();

        // Undeploy with an unreadable journal must not delete anything.
        undeploy_from(&dir, &target).unwrap();
        assert_eq!(read(&target.join("f.txt")), "modded");
        assert_eq!(read(&dir.join("backup/f.txt")), "original");

        // Redeploy re-adopts the deployed copy. The on-target file looks like
        // a pre-existing original, but the surviving backup must not be
        // replaced by that stale mod copy.
        deploy_to(&dir, &target, &cfg).unwrap();
        assert_eq!(read(&dir.join("backup/f.txt")), "original");
        assert_eq!(
            load_journal(&dir).files.get("f.txt").unwrap().backup.as_deref(),
            Some("f.txt")
        );

        // ...so a later undeploy still brings the true original home.
        undeploy_from(&dir, &target).unwrap();
        assert_eq!(read(&target.join("f.txt")), "original");
    }
}
