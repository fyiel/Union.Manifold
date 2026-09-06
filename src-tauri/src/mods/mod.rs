use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::downloads::{now_ms, safe_folder_name, write_json_atomic};
use crate::http;
use crate::library;
use crate::paths::AppPaths;
use crate::state::AppState;

pub mod nexus;
pub mod steamcmd;
pub mod thunderstore;
pub mod workshop;

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
    pub deploy_prefix: String,
    pub deploy_reason: String,
    pub deploy_confidence: String,
    pub deploy_blocked: bool,
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct GameMods {
    pub appid: String,
    pub nexus_domain: Option<String>,
    pub nexus_domain_auto: bool,
    pub nexus_domain_checked: bool,
    pub steam_appid: Option<u64>,
    pub workshop_supported: Option<bool>,
    /// Set once an authenticated SteamCMD session rescues an item that
    /// anonymous download refused; later installs skip the anonymous pass.
    pub workshop_auth_required: bool,
    pub thunderstore_community: Option<String>,
    pub thunderstore_community_auto: bool,
    pub thunderstore_checked: bool,
    pub deploy_target: String,
    pub deployment_plan_version: u32,
    pub mods: Vec<ModEntry>,
}

#[derive(Clone, Default, PartialEq, Serialize, Deserialize)]
struct JournalEntry {
    backup: Option<String>,
}

#[derive(Clone, Default, PartialEq, Serialize, Deserialize)]
struct Journal {
    #[serde(default)]
    files: BTreeMap<String, JournalEntry>,
}

#[derive(Clone)]
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

pub(crate) fn fold(r: Result<Value, String>) -> Value {
    r.unwrap_or_else(|e| json!({ "ok": false, "error": e }))
}

pub(crate) fn join_rel(rel: &Path) -> String {
    rel.components()
        .map(|c| c.as_os_str().to_string_lossy().to_string())
        .collect::<Vec<_>>()
        .join("/")
}


fn enabled_mods(cfg: &GameMods) -> Vec<&ModEntry> {
    let mut enabled: Vec<&ModEntry> = cfg
        .mods
        .iter()
        .filter(|m| m.enabled && !m.deploy_blocked)
        .collect();
    enabled.sort_by_key(|m| m.order);
    enabled
}

fn staging_root(game_dir: &Path) -> PathBuf {
    game_dir.join("staging")
}

fn backup_root(game_dir: &Path) -> PathBuf {
    game_dir.join("backup")
}

pub(crate) fn urlenc(s: &str) -> String {
    percent_encoding::utf8_percent_encode(s, percent_encoding::NON_ALPHANUMERIC).to_string()
}

pub(crate) fn now_secs() -> i64 {
    now_ms() / 1000
}

pub(crate) fn period_days(period: &str) -> Option<i64> {
    match period {
        "7" => Some(7),
        "28" => Some(28),
        _ => None,
    }
}

static GAME_LOCKS: LazyLock<parking_lot::Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>> =
    LazyLock::new(|| parking_lot::Mutex::new(HashMap::new()));
static DISCOVERING_GAMES: LazyLock<parking_lot::Mutex<HashSet<String>>> =
    LazyLock::new(|| parking_lot::Mutex::new(HashSet::new()));

pub(crate) fn game_lock(appid: &str) -> Arc<tokio::sync::Mutex<()>> {
    GAME_LOCKS
        .lock()
        .entry(appid.to_string())
        .or_default()
        .clone()
}

async fn blocking_game<T: Send + 'static>(
    app: AppHandle,
    appid: String,
    f: impl FnOnce(&AppHandle, &AppState, &str) -> T + Send + 'static,
) -> Result<T, String> {
    tokio::task::spawn_blocking(move || {
        // Keep the lock owned by the filesystem task itself: dropping a
        // cancelled IPC future must not let the next mutation overtake it.
        let lock = game_lock(&appid);
        let _guard = lock.blocking_lock();
        let state = app.state::<AppState>();
        f(&app, &state, &appid)
    })
    .await
    .map_err(|error| format!("mod filesystem task failed: {error}"))
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

pub(crate) fn manifest_get<'a>(m: &'a Value, key: &str) -> Option<&'a Value> {
    m.get(key).or_else(|| m.pointer(&format!("/metadata/{key}")))
}

fn rel_string(base: &Path, p: &Path) -> Option<String> {
    let rel = p.strip_prefix(base).ok()?;
    (!rel.as_os_str().is_empty()).then(|| join_rel(rel))
}

fn rel_to_path(base: &Path, rel: &str) -> PathBuf {
    let mut out = base.to_path_buf();
    for comp in rel
        .split('/')
        .filter(|c| !c.is_empty() && *c != "." && *c != "..")
    {
        out.push(comp);
    }
    out
}

/// Whether the journal entry claims a backup that is not on disk. Such an
/// entry may describe a deploy that crashed between the journal write and
/// the file move, so the target file is not verifiably replaceable.
fn claimed_backup_missing(entry: &JournalEntry, backup_root: &Path) -> bool {
    entry
        .backup
        .as_ref()
        .map(|b| !rel_to_path(backup_root, b).is_file())
        .unwrap_or(false)
}

/// Byte comparison used to tell a previous deploy's own content from a
/// user- or game-written file at the same path. A bounded process-local
/// cache skips bytes only after an equal comparison and exact metadata match.
#[derive(Clone, PartialEq, Eq)]
struct FileStamp {
    len: u64,
    modified: Option<std::time::SystemTime>,
    #[cfg(unix)]
    device: u64,
    #[cfg(unix)]
    inode: u64,
    #[cfg(unix)]
    changed_secs: i64,
    #[cfg(unix)]
    changed_nanos: i64,
    #[cfg(windows)]
    created: u64,
    #[cfg(windows)]
    last_write: u64,
    #[cfg(windows)]
    attributes: u32,
}

impl FileStamp {
    fn from_metadata(metadata: &std::fs::Metadata) -> Self {
        #[cfg(unix)]
        use std::os::unix::fs::MetadataExt;
        #[cfg(windows)]
        use std::os::windows::fs::MetadataExt;

        Self {
            len: metadata.len(),
            modified: metadata.modified().ok(),
            #[cfg(unix)]
            device: metadata.dev(),
            #[cfg(unix)]
            inode: metadata.ino(),
            #[cfg(unix)]
            changed_secs: metadata.ctime(),
            #[cfg(unix)]
            changed_nanos: metadata.ctime_nsec(),
            #[cfg(windows)]
            created: metadata.creation_time(),
            #[cfg(windows)]
            last_write: metadata.last_write_time(),
            #[cfg(windows)]
            attributes: metadata.file_attributes(),
        }
    }
}

#[derive(Clone)]
struct VerifiedComparison {
    target: PathBuf,
    source: FileStamp,
    deployed: FileStamp,
}

const VERIFIED_COMPARISONS_MAX: usize = 8192;
static VERIFIED_COMPARISONS: LazyLock<parking_lot::Mutex<HashMap<PathBuf, VerifiedComparison>>> =
    LazyLock::new(|| parking_lot::Mutex::new(HashMap::new()));

fn read_comparison_file(path: &Path) -> std::io::Result<Vec<u8>> {
    std::fs::read(path)
}

fn same_file(a: &Path, b: &Path) -> bool {
    let (Ok(am), Ok(bm)) = (std::fs::metadata(a), std::fs::metadata(b)) else {
        VERIFIED_COMPARISONS.lock().remove(b);
        return false;
    };
    if am.len() != bm.len() {
        VERIFIED_COMPARISONS.lock().remove(b);
        return false;
    }
    let deployed = FileStamp::from_metadata(&am);
    let source = FileStamp::from_metadata(&bm);
    if VERIFIED_COMPARISONS.lock().get(b).is_some_and(|verified| {
        verified.target == a && verified.source == source && verified.deployed == deployed
    }) {
        return true;
    }
    let same = match (read_comparison_file(a), read_comparison_file(b)) {
        (Ok(ac), Ok(bc)) => ac == bc,
        _ => false,
    };
    let mut verified = VERIFIED_COMPARISONS.lock();
    if same {
        if verified.contains_key(b) || verified.len() < VERIFIED_COMPARISONS_MAX {
            verified.insert(
                b.to_path_buf(),
                VerifiedComparison {
                    target: a.to_path_buf(),
                    source,
                    deployed,
                },
            );
        }
    } else {
        verified.remove(b);
    }
    same
}

fn remove_empty_parents(path: &Path, stop: &Path) {
    let mut cur = path.parent();
    while let Some(d) = cur {
        if d == stop || !d.starts_with(stop) {
            break;
        }
        if std::fs::remove_dir(d).is_err() {
            break;
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

fn directory_has_files(path: &Path) -> bool {
    walkdir::WalkDir::new(path)
        .min_depth(1)
        .into_iter()
        .flatten()
        .any(|entry| entry.file_type().is_file())
}

fn write_mod_engine_profile(
    game_dir: &Path,
    target: &Path,
    cfg: &GameMods,
) -> Result<Option<PathBuf>, String> {
    let Some((game, _)) = mod_engine_game_for(Some(target), cfg.steam_appid) else {
        return Ok(None);
    };
    let staging_root = staging_root(game_dir);
    let mods: Vec<&ModEntry> = enabled_mods(cfg)
        .into_iter()
        .filter(|entry| entry.deploy_prefix == MOD_ENGINE_DEPLOY_ROOT)
        .collect();

    let mut profile = format!(
        "profileVersion = \"v1\"\n\n[[supports]]\ngame = {}\n",
        serde_json::to_string(game).unwrap()
    );
    let mut has_payload = false;
    for entry in mods {
        let folder = safe_folder_name(&entry.id);
        let staged = staging_root.join(&entry.id).join(&folder);
        let mod_dir = staged.join("mod");
        if directory_has_files(&mod_dir) {
            let id = serde_json::to_string(&folder).unwrap();
            let path = serde_json::to_string(&format!("{MOD_ENGINE_DEPLOY_ROOT}/{folder}/mod"))
                .unwrap();
            profile.push_str(&format!("\n[[packages]]\nid = {id}\npath = {path}\n"));
            has_payload = true;
        }

        let natives_dir = staged.join("natives");
        let mut natives: Vec<String> = walkdir::WalkDir::new(&natives_dir)
            .min_depth(1)
            .into_iter()
            .flatten()
            .filter(|native| {
                native.file_type().is_file()
                    && native
                        .path()
                        .extension()
                        .and_then(|extension| extension.to_str())
                        .map(|extension| extension.eq_ignore_ascii_case("dll"))
                        .unwrap_or(false)
            })
            .filter_map(|native| rel_string(&natives_dir, native.path()))
            .collect();
        natives.sort();
        for native in natives {
            let path = serde_json::to_string(&format!(
                "{MOD_ENGINE_DEPLOY_ROOT}/{folder}/natives/{native}"
            ))
            .unwrap_or_else(|_| "\"\"".to_string());
            profile.push_str(&format!("\n[[natives]]\npath = {path}\n"));
            has_payload = true;
        }
    }

    let generated = game_dir.join("generated").join(MOD_ENGINE_PROFILE);
    if !has_payload {
        std::fs::remove_file(&generated).ok();
        return Ok(None);
    }
    if let Some(parent) = generated.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("Mod Engine profile dir: {error}"))?;
    }
    std::fs::write(&generated, profile).map_err(|error| format!("Mod Engine profile: {error}"))?;
    Ok(Some(generated))
}
fn mod_manifest_version(dir: &Path) -> Option<String> {
    ["description.json", "info.json", "modinfo.json"]
        .into_iter()
        .find_map(|name| {
            std::fs::read_to_string(dir.join(name))
                .ok()
                .and_then(|text| serde_json::from_str::<Value>(&text).ok())
                .and_then(|metadata| metadata.get("version")?.as_str().map(str::to_string))
        })
}

fn versioned_archive_root(staged: &Path, version: &str) -> Option<PathBuf> {
    if version.is_empty() {
        return None;
    }
    let mut manifest_children = 0;
    let mut selected = None;
    for path in std::fs::read_dir(staged)
        .ok()?
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.is_dir())
    {
        let Some(child_version) = mod_manifest_version(&path) else {
            continue;
        };
        manifest_children += 1;
        if child_version == version {
            if selected.is_some() {
                return None;
            }
            selected = Some(path);
        }
    }
    (manifest_children > 1).then_some(selected).flatten()
}

fn child_dir(parent: &Path, name: &str) -> Option<PathBuf> {
    std::fs::read_dir(parent)
        .ok()?
        .flatten()
        .find(|entry| {
            entry.path().is_dir()
                && entry
                    .file_name()
                    .to_string_lossy()
                    .eq_ignore_ascii_case(name)
        })
        .map(|entry| entry.path())
}

fn normalize_mewgenics_localization_append(staged: &Path) -> Result<bool, String> {
    let Some(data) = child_dir(staged, "data") else {
        return Ok(false);
    };
    let Some(text) = child_dir(&data, "text") else {
        return Ok(false);
    };
    let combined = text.join("combined.csv.append");
    if combined.exists() {
        return Ok(false);
    }
    let mut legacy: Vec<PathBuf> = std::fs::read_dir(&text)
        .map_err(|error| format!("Mewgenics localization directory: {error}"))?
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            path.is_file()
                && path
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_ascii_lowercase()
                    .ends_with(".csv.append")
        })
        .collect();
    if legacy.len() != 1 {
        return Ok(false);
    }
    std::fs::rename(legacy.pop().unwrap(), &combined)
        .map_err(|error| format!("Mewgenics localization migration: {error}"))?;
    Ok(true)
}

fn launch_payload_paths_for_entry(staging_root: &Path, entry: &ModEntry) -> Vec<PathBuf> {
    let staged = staging_root.join(&entry.id);
    if !staged.is_dir() {
        return Vec::new();
    }
    if has_root_dir(&staged, &["data"]) {
        return vec![staged];
    }
    if let Some(selected) = versioned_archive_root(&staged, &entry.version) {
        return vec![selected];
    }

    let mut children: Vec<PathBuf> = std::fs::read_dir(&staged)
        .ok()
        .into_iter()
        .flatten()
        .flatten()
        .map(|child| child.path())
        .filter(|child| child.is_dir() && has_root_dir(child, &["data"]))
        .collect();
    children.sort_by_key(|child| {
        child
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_lowercase()
    });
    if children.is_empty() {
        vec![staged]
    } else {
        children
    }
}

fn enabled_mewgenics_mod_paths(game_dir: &Path, cfg: &GameMods) -> Vec<PathBuf> {
    if cfg.steam_appid != Some(MEWGENICS_STEAM_APPID) {
        return Vec::new();
    }
    let staging_root = staging_root(game_dir);
    let enabled = enabled_mods(cfg);
    enabled
        .into_iter()
        .flat_map(|entry| launch_payload_paths_for_entry(&staging_root, entry))
        .collect()
}

pub(crate) fn deploy_to(game_dir: &Path, target: &Path, cfg: &GameMods) -> Result<usize, String> {
    let staging_root = staging_root(game_dir);
    let backup_root = backup_root(game_dir);
    let mewgenics_paths = enabled_mewgenics_mod_paths(game_dir, cfg);

    let enabled = enabled_mods(cfg);
    let mut desired: HashMap<String, PathBuf> = HashMap::new();
    for m in enabled {
        if cfg.steam_appid == Some(MEWGENICS_STEAM_APPID) {
            continue;
        }
        let prefix = join_rel(&join_target(Path::new(""), &m.deploy_prefix)?);
        let sdir = staging_root.join(&m.id);
        for entry in walkdir::WalkDir::new(&sdir).into_iter().flatten() {
            if !entry.file_type().is_file() {
                continue;
            }
            if let Some(rel) = rel_string(&sdir, entry.path()) {
                let prefixed = if prefix.is_empty() {
                    rel
                } else {
                    format!("{prefix}/{rel}")
                };
                desired.insert(prefixed, entry.path().to_path_buf());
            }
        }
    }
    if let Some(profile) = write_mod_engine_profile(game_dir, target, cfg)? {
        desired.insert(MOD_ENGINE_PROFILE.to_string(), profile);
    }

    if !desired.is_empty() {
        std::fs::create_dir_all(target).map_err(|e| format!("deploy target: {e}"))?;
    }

    let mut journal = load_journal(game_dir);
    let old_journal = journal.clone();

    let stale: Vec<String> = journal
        .files
        .keys()
        .filter(|k| !desired.contains_key(*k))
        .cloned()
        .collect();

    // Where an original is preserved when deploying a rel over an existing
    // file: the prior journal's backup path, or a fresh backup at
    // backup_root/<rel> when the target currently holds a file that is not
    // this mod's own previous content. Used by both the journal computation
    // and the mutation loop so the persisted journal can never under-claim
    // a backup the deploy actually creates.
    fn plan_backup(
        old_journal: &Journal,
        target: &Path,
        rel: &str,
        matches_deployed: bool,
    ) -> Option<String> {
        match old_journal.files.get(rel) {
            Some(prior) => match &prior.backup {
                Some(b) => Some(b.clone()),
                None => {
                    let dst = rel_to_path(target, rel);
                    // With no prior backup the target should hold this mod's
                    // own previous deploy; a plain redeploy must not back up
                    // managed content or a later removal would restore stale
                    // mod files. Different content means the user or the
                    // game wrote over it — preserve that before overwriting.
                    if dst.exists() && !matches_deployed {
                        Some(rel.to_string())
                    } else {
                        None
                    }
                }
            },
            None => rel_to_path(target, rel)
                .exists()
                .then(|| rel.to_string()),
        }
    }

    // First compute the complete new journal in memory, without touching
    // the game directory. Backup references come from the prior journal or
    // from the file currently at the target path.
    for rel in &stale {
        journal.files.remove(rel);
    }
    let mut planned = HashMap::with_capacity(desired.len());
    for (rel, src) in &desired {
        let unchanged = old_journal.files.contains_key(rel)
            && same_file(&rel_to_path(target, rel), src);
        let backup = plan_backup(&old_journal, target, rel, unchanged);
        journal.files.insert(
            rel.clone(),
            JournalEntry {
                backup: backup.clone(),
            },
        );
        planned.insert(rel.clone(), (backup, unchanged));
    }

    // Persist the new journal before mutating anything. undeploy/disable
    // only ever delete a file whose claimed backup exists on disk, so a
    // crash between this write and the mutations below cannot destroy an
    // original that was never backed up.
    if journal != old_journal {
        save_journal(game_dir, &journal)?;
    }
    drop(journal);

    // Apply the mutations, tracking every applied op. On failure the game
    // directory is rolled back and a journal matching what is actually on
    // disk is persisted instead of the old one verbatim: a consumed backup
    // restore cannot be undone, so the restored file stays in place and its
    // entry is dropped from the journal (the same drop covers stale files
    // that were deleted outright or left alone because their backup was
    // missing).
    enum AppliedOp {
        Restored { rel: String },
        Deployed {
            rel: String,
            dst: PathBuf,
            src: PathBuf,
            backup: Option<PathBuf>,
            prior: bool,
            backup_created: bool,
        },
        MarkerWritten { path: PathBuf },
        MarkerCleared { path: PathBuf },
    }
    let mut applied: Vec<AppliedOp> = Vec::new();
    let marker = game_dir.join(MEWGENICS_DEPLOY_MARKER);
    let result = (|| {
        for rel in &stale {
            let entry = match old_journal.files.get(rel) {
                Some(e) => e,
                None => continue,
            };
            if claimed_backup_missing(entry, &backup_root) {
                // The claimed backup is gone, so the file at the target may
                // be the unbacked-up original (crash between journal write
                // and mutation) or an already-restored original. Leave it
                // alone and unmanage it.
                applied.push(AppliedOp::Restored { rel: rel.clone() });
                continue;
            }
            let dst = rel_to_path(target, rel);
            if let Some(b) = &entry.backup {
                let bpath = rel_to_path(&backup_root, b);
                if let Some(parent) = dst.parent() {
                    std::fs::create_dir_all(parent).ok();
                }
                // Rename the backup over the target first so a failed rename
                // (locked path, directory in the way) leaves the previous
                // file in place and the journal still matching disk.
                if std::fs::rename(&bpath, &dst).is_err() {
                    std::fs::remove_file(&dst).ok();
                    std::fs::rename(&bpath, &dst).map_err(|e| format!("restore {rel}: {e}"))?;
                }
                remove_empty_parents(&bpath, &backup_root);
            } else {
                std::fs::remove_file(&dst).ok();
            }
            remove_empty_parents(&dst, target);
            applied.push(AppliedOp::Restored { rel: rel.clone() });
        }

        for (rel, src) in &desired {
            let (planned_backup, unchanged) = planned
                .get(rel)
                .expect("every desired file has a deployment plan");
            if *unchanged {
                continue;
            }
            let dst = rel_to_path(target, rel);
            if let Some(parent) = dst.parent() {
                std::fs::create_dir_all(parent).map_err(|e| format!("deploy {rel}: {e}"))?;
            }
            let prior = old_journal.files.contains_key(rel);
            let back_up = |dst: &Path, bpath: &Path| -> Result<(), String> {
                if let Some(parent) = bpath.parent() {
                    std::fs::create_dir_all(parent).map_err(|e| format!("backup {rel}: {e}"))?;
                }
                if std::fs::rename(dst, bpath).is_err() {
                    std::fs::copy(dst, bpath).map_err(|e| format!("backup {rel}: {e}"))?;
                    std::fs::remove_file(dst).ok();
                }
                Ok(())
            };
            let mut backup_created = false;
            let backup: Option<PathBuf> =
                planned_backup
                    .clone()
                    .map(|b| -> Result<PathBuf, String> {
                        let bpath = rel_to_path(&backup_root, &b);
                        // The plan says the target held a file worth
                        // preserving. Materialize the backup unless it
                        // already exists; a claimed backup that is missing
                        // with the target still holding a file means that
                        // file may be the unbacked original (crash between
                        // journal write and mutation).
                        if !bpath.is_file() && dst.exists() {
                            back_up(&dst, &bpath)?;
                            backup_created = true;
                        }
                        Ok(bpath)
                    })
                    .transpose()?;
            // Record the op before the copy so a copy failure still rolls
            // the backup move back.
            applied.push(AppliedOp::Deployed {
                rel: rel.clone(),
                dst: dst.clone(),
                src: src.clone(),
                backup,
                prior,
                backup_created,
            });
            std::fs::copy(src, &dst).map_err(|e| format!("deploy {rel}: {e}"))?;
        }

        if cfg.steam_appid == Some(MEWGENICS_STEAM_APPID) {
            if mewgenics_paths.is_empty() {
                std::fs::remove_file(&marker).ok();
                applied.push(AppliedOp::MarkerCleared { path: marker.clone() });
            } else {
                std::fs::write(&marker, b"enabled\n")
                    .map_err(|e| format!("Mewgenics deploy marker: {e}"))?;
                applied.push(AppliedOp::MarkerWritten { path: marker.clone() });
            }
        }
        Ok(())
    })();
    if let Err(error) = result {
        let mut reconciled = old_journal.clone();
        for op in applied.iter().rev() {
            match op {
                AppliedOp::Restored { rel } => {
                    reconciled.files.remove(rel);
                }
                AppliedOp::Deployed {
                    rel,
                    dst,
                    src,
                    backup,
                    prior,
                    backup_created,
                } => {
                    if *prior {
                        // The old journal claimed this rel deployed; restore
                        // that content from staging, which is immutable for
                        // the duration of the deploy.
                        std::fs::copy(src, dst).ok();
                        if *backup_created {
                            // A user- or game-written file was materialized
                            // as the claimed backup; claim it so a later
                            // undeploy restores it instead of stranding it.
                            if let Some(entry) = reconciled.files.get_mut(rel) {
                                entry.backup = Some(rel.clone());
                            }
                        }
                    } else {
                        std::fs::remove_file(dst).ok();
                        if let Some(b) = backup {
                            std::fs::rename(b, dst).ok();
                        }
                    }
                }
                AppliedOp::MarkerWritten { path } => {
                    std::fs::remove_file(path).ok();
                }
                AppliedOp::MarkerCleared { path } => {
                    std::fs::write(path, b"enabled\n").ok();
                }
            }
        }
        save_journal(game_dir, &reconciled).ok();
        return Err(error);
    }

    if cfg.steam_appid == Some(MEWGENICS_STEAM_APPID) {
        Ok(mewgenics_paths.len())
    } else {
        std::fs::remove_file(&marker).ok();
        Ok(desired.len())
    }
}

pub(crate) fn undeploy_from(game_dir: &Path, target: &Path) -> Result<(), String> {
    let backup_root = backup_root(game_dir);
    let journal = load_journal(game_dir);
    for (rel, entry) in &journal.files {
        if claimed_backup_missing(entry, &backup_root) {
            // The claimed backup is gone, so the file at the target may be
            // the unbacked-up original (a deploy crashed between writing the
            // journal and moving the file) or an already-restored original.
            // Never delete a file whose original cannot be restored.
            continue;
        }
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
    save_journal(game_dir, &Journal::default())?;
    std::fs::remove_file(game_dir.join(MEWGENICS_DEPLOY_MARKER)).ok();
    Ok(())
}

fn is_game_dir(dir: &Path) -> bool {
    let Ok(rd) = std::fs::read_dir(dir) else {
        return false;
    };
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().to_lowercase();
        let path = e.path();
        if path.is_dir() && (name == "bepinex" || name.ends_with("_data")) {
            return true;
        }
        if path.is_file() {
            if name == "gameassembly.dll"
                || name == "unityplayer.dll"
                || name == "doorstop_config.ini"
            {
                return true;
            }
            if name.ends_with(".exe")
                && !name.contains("unitycrashhandler")
                && !name.contains("unins")
            {
                return true;
            }
        }
    }
    false
}

pub(crate) fn resolve_game_root(base: &Path) -> PathBuf {
    if is_game_dir(base) {
        return base.to_path_buf();
    }
    let mut cur = base.to_path_buf();
    for _ in 0..2 {
        let Ok(rd) = std::fs::read_dir(&cur) else {
            break;
        };
        let subdirs: Vec<PathBuf> = rd
            .flatten()
            .map(|e| e.path())
            .filter(|p| p.is_dir())
            .collect();
        if let Some(hit) = subdirs.iter().find(|d| is_game_dir(d)) {
            return hit.clone();
        }
        if subdirs.len() == 1 {
            cur = subdirs.into_iter().next().unwrap();
            continue;
        }
        break;
    }
    base.to_path_buf()
}

fn deploy_target_dir(state: &AppState, appid: &str, cfg: &GameMods) -> Result<PathBuf, String> {
    let roots = library::scan_roots(state);
    let base = library::game_files_dir(&roots, appid)
        .ok_or_else(|| format!("game {appid} not found in library"))?;
    if cfg.deploy_target.is_empty() {
        Ok(resolve_game_root(&base))
    } else {
        join_target(&base, &cfg.deploy_target)
    }
}

fn redeploy(state: &AppState, appid: &str, cfg: &GameMods) -> Result<usize, String> {
    let dir = game_mods_dir(&state.paths, appid);
    let target = deploy_target_dir(state, appid, cfg)?;
    deploy_to(&dir, &target, cfg)
}

pub(crate) fn active_mod_engine_profile(state: &AppState, appid: &str) -> Option<PathBuf> {
    let cfg = load_config(&state.paths, appid);
    if !enabled_mods(&cfg)
        .iter()
        .any(|entry| entry.deploy_prefix == MOD_ENGINE_DEPLOY_ROOT)
    {
        return None;
    }
    let profile = deploy_target_dir(state, appid, &cfg)
        .ok()?
        .join(MOD_ENGINE_PROFILE);
    profile.is_file().then_some(profile)
}

pub(crate) fn active_mewgenics_mod_paths(state: &AppState, appid: &str) -> Vec<PathBuf> {
    let dir = game_mods_dir(&state.paths, appid);
    if !dir.join(MEWGENICS_DEPLOY_MARKER).is_file() {
        return Vec::new();
    }
    enabled_mewgenics_mod_paths(&dir, &load_config(&state.paths, appid))
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum ModLayout {
    Raw,
    RequiresInstaller,
    BepInEx,
    ModEngine3,
    Lenny,
    MelonLoader,
    Fluffy,
    ModsFolder,
    RimWorld,
    WuchangEnabler,
    WuchangPackage,
}

fn game_layout(steam_appid: Option<u64>) -> Option<ModLayout> {
    match steam_appid {
        Some(2060160) => Some(ModLayout::BepInEx),
        Some(881100) => Some(ModLayout::ModsFolder),
        _ => None,
    }
}

const MOD_ENGINE_PROFILE: &str = ".union-manifold.me3";
const MOD_ENGINE_DEPLOY_ROOT: &str = ".union-manifold-me3";
const RESIDENT_EVIL_REQUIEM_STEAM_APPID: u64 = 3_764_200;
const EVERYTHING_IS_CRAB_STEAM_APPID: u64 = 3_526_710;
const RIMWORLD_STEAM_APPID: u64 = 294_100;
const MEWGENICS_STEAM_APPID: u64 = 686_060;
const MEWGENICS_DEPLOY_MARKER: &str = ".mewgenics-modpaths";
const WUCHANG_STEAM_APPID: u64 = 2_277_560;
const WUCHANG_MODS_PREFIX: &str = "Project_Plague/Content/Paks/~mods";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LoaderCompatibility {
    name: &'static str,
    compatible: bool,
    reason: String,
}

fn mod_engine_game(steam_appid: Option<u64>) -> Option<(&'static str, &'static str)> {
    match steam_appid {
        Some(374320) => Some(("darksouls3", "Dark Souls III")),
        Some(814380) => Some(("sekiro", "Sekiro: Shadows Die Twice")),
        Some(1245620) => Some(("eldenring", "Elden Ring")),
        Some(1888160) => Some(("armoredcore6", "Armored Core VI: Fires of Rubicon")),
        Some(2622380) => Some(("nightreign", "Elden Ring Nightreign")),
        _ => None,
    }
}

fn lenny_game(steam_appid: Option<u64>) -> Option<&'static str> {
    match steam_appid {
        Some(271590) => Some("Grand Theft Auto V (Legacy)"),
        Some(1174180) => Some("Red Dead Redemption 2"),
        _ => None,
    }
}

fn fluffy_game(steam_appid: Option<u64>) -> Option<&'static str> {
    match steam_appid {
        Some(21690) => Some("Resident Evil 5"),
        Some(221040) => Some("Resident Evil 6"),
        Some(222480) => Some("Resident Evil Revelations"),
        Some(254700) => Some("Resident Evil 4"),
        Some(287290) => Some("Resident Evil Revelations 2"),
        Some(304240) => Some("Resident Evil"),
        Some(310950) => Some("Street Fighter V"),
        Some(329050) => Some("Devil May Cry 4 Special Edition"),
        Some(339340) => Some("Resident Evil 0"),
        Some(389730) => Some("Tekken 7"),
        Some(418370) => Some("Resident Evil 7"),
        Some(544750) => Some("Soulcalibur VI"),
        Some(582010) => Some("Monster Hunter: World"),
        Some(601150) => Some("Devil May Cry 5"),
        Some(692850) => Some("Bloodstained: Ritual of the Night"),
        Some(883710) => Some("Resident Evil 2"),
        Some(952060) => Some("Resident Evil 3"),
        Some(1196590) => Some("Resident Evil Village"),
        Some(1286320) => Some("Exoprimal"),
        Some(1364780) => Some("Street Fighter 6"),
        Some(1446780) => Some("Monster Hunter Rise"),
        Some(1778820) => Some("Tekken 8"),
        Some(2050650) => Some("Resident Evil 4"),
        Some(2054970) => Some("Dragon's Dogma 2"),
        Some(2246340) => Some("Monster Hunter Wilds"),
        Some(2510710) => Some("Kunitsu-Gami: Path of the Goddess"),
        Some(2527390) => Some("Dead Rising Deluxe Remaster"),
        Some(RESIDENT_EVIL_REQUIEM_STEAM_APPID) => Some("Resident Evil Requiem"),
        _ => None,
    }
}

fn root_has_file_matching(target: &Path, predicate: impl Fn(&str) -> bool) -> bool {
    std::fs::read_dir(target)
        .ok()
        .into_iter()
        .flatten()
        .flatten()
        .any(|entry| {
            entry.path().is_file() && predicate(&entry.file_name().to_string_lossy().to_lowercase())
        })
}

fn mod_engine_target_game(target: &Path) -> Option<(&'static str, &'static str)> {
    [
        ("darksoulsiii.exe", ("darksouls3", "Dark Souls III")),
        ("sekiro.exe", ("sekiro", "Sekiro: Shadows Die Twice")),
        ("eldenring.exe", ("eldenring", "Elden Ring")),
        (
            "armoredcore6.exe",
            ("armoredcore6", "Armored Core VI: Fires of Rubicon"),
        ),
        ("nightreign.exe", ("nightreign", "Elden Ring Nightreign")),
    ]
    .into_iter()
    .find_map(|(executable, game)| {
        root_has_file_matching(target, |name| name.eq_ignore_ascii_case(executable)).then_some(game)
    })
}

fn mod_engine_game_for(
    target: Option<&Path>,
    steam_appid: Option<u64>,
) -> Option<(&'static str, &'static str)> {
    mod_engine_game(steam_appid).or_else(|| target.and_then(mod_engine_target_game))
}

fn lenny_target_game(target: &Path) -> Option<&'static str> {
    [
        ("gta5.exe", "Grand Theft Auto V (Legacy)"),
        ("rdr2.exe", "Red Dead Redemption 2"),
    ]
    .into_iter()
    .find_map(|(executable, title)| {
        root_has_file_matching(target, |name| name.eq_ignore_ascii_case(executable))
            .then_some(title)
    })
}

fn lenny_game_for(target: Option<&Path>, steam_appid: Option<u64>) -> Option<&'static str> {
    lenny_game(steam_appid).or_else(|| target.and_then(lenny_target_game))
}

fn is_unity_target(target: &Path) -> bool {
    let has_runtime = root_has_file_matching(target, |name| {
        name == "unityplayer.dll" || name == "gameassembly.dll"
    });
    let has_data = std::fs::read_dir(target)
        .ok()
        .into_iter()
        .flatten()
        .flatten()
        .any(|entry| {
            entry.path().is_dir()
                && entry
                    .file_name()
                    .to_string_lossy()
                    .to_lowercase()
                    .ends_with("_data")
        });
    has_runtime && has_data
}

fn is_fluffy_target(target: &Path) -> bool {
    has_root_dir(target, &["nativePC"])
        || root_has_file_matching(target, |name| {
            name.starts_with("re_chunk_")
                && (name.ends_with(".pak") || name.contains(".pak.patch_"))
        })
}

fn loader_compatibility(
    target: Option<&Path>,
    steam_appid: Option<u64>,
) -> Vec<LoaderCompatibility> {
    let me3 = mod_engine_game_for(target, steam_appid);
    let lenny = lenny_game_for(target, steam_appid);
    let unity_files = target.map(is_unity_target).unwrap_or(false);
    let melon = steam_appid == Some(EVERYTHING_IS_CRAB_STEAM_APPID) || unity_files;
    let fluffy_title = fluffy_game(steam_appid);
    let fluffy_files = target.map(is_fluffy_target).unwrap_or(false);
    let wuchang = steam_appid == Some(WUCHANG_STEAM_APPID)
        || target
            .and_then(|root| child_dir(root, "Project_Plague"))
            .is_some();

    vec![
        LoaderCompatibility {
            name: "Mod Engine 3",
            compatible: me3.is_some(),
            reason: me3
                .map(|(_, title)| format!("officially supported for {title}"))
                .unwrap_or_else(|| {
                    "this Steam title is not in Mod Engine 3's supported game list".to_string()
                }),
        },
        LoaderCompatibility {
            name: "Lenny's Mod Loader",
            compatible: lenny.is_some(),
            reason: lenny
                .map(|title| format!("supported for {title}"))
                .unwrap_or_else(|| {
                    "this Steam title is not supported by Lenny's Mod Loader".to_string()
                }),
        },
        LoaderCompatibility {
            name: "MelonLoader",
            compatible: melon,
            reason: if steam_appid == Some(EVERYTHING_IS_CRAB_STEAM_APPID) {
                "known MelonLoader title".to_string()
            } else if unity_files {
                "detected Unity runtime and game data".to_string()
            } else {
                "no Windows Unity runtime was detected".to_string()
            },
        },
        LoaderCompatibility {
            name: "Fluffy Mod Manager",
            compatible: fluffy_title.is_some() || fluffy_files,
            reason: if let Some(title) = fluffy_title {
                format!("supported Fluffy title: {title}")
            } else if fluffy_files {
                "detected a supported RE Engine or MT Framework game layout".to_string()
            } else {
                "no supported title or game layout was detected".to_string()
            },
        },
        LoaderCompatibility {
            name: "Wuchang Mod Enabler",
            compatible: wuchang,
            reason: if steam_appid == Some(WUCHANG_STEAM_APPID) {
                "supported for WUCHANG: Fallen Feathers".to_string()
            } else if wuchang {
                "detected a Project_Plague mod loader tree".to_string()
            } else {
                "this title is not WUCHANG: Fallen Feathers".to_string()
            },
        },
    ]
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct DeploymentPlan {
    layout: ModLayout,
    deploy_prefix: String,
    reason: String,
    confidence: &'static str,
}

fn deployment_plan(
    layout: ModLayout,
    prefix: &str,
    reason: &str,
    confidence: &'static str,
) -> DeploymentPlan {
    DeploymentPlan {
        layout,
        deploy_prefix: prefix.to_string(),
        reason: reason.to_string(),
        confidence,
    }
}

/// The single non-thunderstore-meta entry of `dir`, if it is a directory.
fn single_payload_dir(dir: &Path) -> Option<PathBuf> {
    let mut found: Option<PathBuf> = None;
    for entry in std::fs::read_dir(dir).ok()?.flatten() {
        let path = entry.path();
        if path
            .file_name()
            .map(|n| is_ts_meta(&n.to_string_lossy()))
            .unwrap_or(false)
        {
            continue;
        }
        if found.is_some() {
            return None;
        }
        found = Some(path);
    }
    found.filter(|p| p.is_dir())
}

fn classification_root(staged: &Path) -> PathBuf {
    let Some(dir) = single_payload_dir(staged) else {
        return staged.to_path_buf();
    };
    let name = dir
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_lowercase();
    if MEANINGFUL_DIRS.contains(&name.as_str()) {
        staged.to_path_buf()
    } else {
        dir
    }
}

fn has_root_dir(root: &Path, names: &[&str]) -> bool {
    std::fs::read_dir(root)
        .ok()
        .into_iter()
        .flatten()
        .flatten()
        .any(|entry| {
            entry.path().is_dir()
                && names.iter().any(|name| {
                    entry
                        .file_name()
                        .to_string_lossy()
                        .eq_ignore_ascii_case(name)
                })
        })
}

fn has_root_file(root: &Path, name: &str) -> bool {
    std::fs::read_dir(root)
        .ok()
        .into_iter()
        .flatten()
        .flatten()
        .any(|entry| {
            entry.path().is_file()
                && entry
                    .file_name()
                    .to_string_lossy()
                    .eq_ignore_ascii_case(name)
        })
}

fn has_extension(root: &Path, extensions: &[&str], max_depth: usize) -> bool {
    walkdir::WalkDir::new(root)
        .max_depth(max_depth)
        .into_iter()
        .flatten()
        .any(|entry| {
            entry.file_type().is_file()
                && entry
                    .path()
                    .extension()
                    .and_then(|ext| ext.to_str())
                    .map(|ext| {
                        extensions
                            .iter()
                            .any(|wanted| ext.eq_ignore_ascii_case(wanted))
                    })
                    .unwrap_or(false)
        })
}

fn contains_fomod(root: &Path) -> bool {
    walkdir::WalkDir::new(root)
        .max_depth(4)
        .into_iter()
        .flatten()
        .any(|entry| {
            entry.file_type().is_file()
                && entry
                    .path()
                    .to_string_lossy()
                    .replace('\\', "/")
                    .to_lowercase()
                    .ends_with("fomod/moduleconfig.xml")
        })
}

fn is_bethesda_game(target: &Path, steam_appid: Option<u64>) -> bool {
    if matches!(
        steam_appid,
        Some(22320 | 22330 | 22370 | 22380 | 72850 | 377160 | 489830 | 1716740)
    ) {
        return true;
    }
    let data = target.join("Data");
    data.is_dir() && has_extension(&data, &["esm", "esl"], 2)
}

fn is_bethesda_payload(root: &Path) -> bool {
    has_root_dir(
        root,
        &[
            "meshes",
            "textures",
            "scripts",
            "sound",
            "interface",
            "strings",
            "skse",
        ],
    ) || has_extension(root, &["esp", "esm", "esl", "bsa"], 3)
}

fn unreal_paks_target(target: &Path) -> Option<String> {
    let mut matches: Vec<String> = walkdir::WalkDir::new(target)
        .min_depth(2)
        .max_depth(4)
        .into_iter()
        .flatten()
        .filter(|entry| {
            entry.file_type().is_dir()
                && entry
                    .file_name()
                    .to_string_lossy()
                    .eq_ignore_ascii_case("Paks")
        })
        .filter_map(|entry| {
            let parent = entry.path().parent()?;
            if !parent
                .file_name()?
                .to_string_lossy()
                .eq_ignore_ascii_case("Content")
            {
                return None;
            }
            let rel = rel_string(target, entry.path())?;
            if rel
                .split('/')
                .any(|part| part.eq_ignore_ascii_case("Engine"))
            {
                return None;
            }
            Some(format!("{rel}/~mods"))
        })
        .collect();
    matches.sort_by_key(|path| path.matches('/').count());
    matches.into_iter().next()
}

fn has_content_paks(root: &Path) -> bool {
    child_dir(root, "Content")
        .and_then(|content| child_dir(&content, "Paks"))
        .is_some()
}

fn wuchang_project_plague_root(root: &Path) -> Option<PathBuf> {
    walkdir::WalkDir::new(root)
        .max_depth(4)
        .into_iter()
        .flatten()
        .find(|entry| {
            entry.file_type().is_dir()
                && entry
                    .file_name()
                    .to_string_lossy()
                    .eq_ignore_ascii_case("Project_Plague")
        })
        .map(|entry| entry.into_path())
}

fn is_wuchang_enabler_payload(root: &Path) -> bool {
    wuchang_project_plague_root(root).is_some()
        || root
            .file_name()
            .map(|name| name.to_string_lossy().eq_ignore_ascii_case("Project_Plague"))
            .unwrap_or(false)
}

fn is_wuchang_enabler_identity(provider: &str, remote_id: &str, page_url: &str) -> bool {
    if !provider.eq_ignore_ascii_case("nexus") || remote_id != "3" {
        return false;
    }
    let Ok(page) = url::Url::parse(page_url) else {
        return false;
    };
    if page.scheme() != "https"
        || !matches!(page.host_str(), Some("nexusmods.com" | "www.nexusmods.com"))
    {
        return false;
    }
    let segments: Vec<&str> = page.path_segments().into_iter().flatten().collect();
    segments == ["wuchangfallenfeathers", "mods", "3"]
}

fn rimworld_about_at(dir: &Path) -> bool {
    child_dir(dir, "about")
        .map(|about| has_root_file(&about, "about.xml"))
        .unwrap_or(false)
}

fn is_rimworld_mod_package(root: &Path) -> bool {
    // classification_root descends into a lone wrapper directory, so the root
    // can be the About folder itself.
    let is_about_dir = root
        .file_name()
        .map(|n| n.to_string_lossy().eq_ignore_ascii_case("about"))
        .unwrap_or(false);
    if (is_about_dir && has_root_file(root, "about.xml")) || rimworld_about_at(root) {
        return true;
    }
    // A tree already wrapped by the RimWorld staging layout: Mods/<name>/About/About.xml.
    child_dir(root, "mods")
        .map(|mods| {
            std::fs::read_dir(mods)
                .ok()
                .into_iter()
                .flatten()
                .flatten()
                .any(|entry| entry.path().is_dir() && rimworld_about_at(&entry.path()))
        })
        .unwrap_or(false)
}

fn is_rimworld_target(target: &Path) -> bool {
    if !has_root_dir(target, &["Mods"]) {
        return false;
    }
    std::fs::read_dir(target)
        .ok()
        .into_iter()
        .flatten()
        .flatten()
        .any(|entry| {
            if !entry.path().is_dir() {
                return false;
            }
            let name = entry.file_name().to_string_lossy().to_lowercase();
            name.starts_with("rimworld") && name.ends_with("_data")
        })
}

fn infer_deployment_plan_for_entry(
    target: &Path,
    staged: &Path,
    steam_appid: Option<u64>,
    provider: &str,
    remote_id: &str,
    page_url: &str,
) -> DeploymentPlan {
    let root = classification_root(staged);
    if steam_appid == Some(WUCHANG_STEAM_APPID)
        && is_wuchang_enabler_identity(provider, remote_id, page_url)
        && (is_wuchang_enabler_payload(staged) || has_content_paks(&root))
    {
        return deployment_plan(
            ModLayout::WuchangEnabler,
            "",
            "matched Nexus wuchangfallenfeathers mod 3 and its Project_Plague enabler tree",
            "high",
        );
    }
    infer_deployment_plan(target, staged, steam_appid)
}

fn infer_deployment_plan(target: &Path, staged: &Path, steam_appid: Option<u64>) -> DeploymentPlan {
    let root = classification_root(staged);
    if contains_fomod(&root) {
        return deployment_plan(
            ModLayout::RequiresInstaller,
            "",
            "the archive uses an interactive FOMOD installer",
            "low",
        );
    }
    if steam_appid == Some(MEWGENICS_STEAM_APPID) {
        return deployment_plan(
            ModLayout::Raw,
            "",
            "Mewgenics loads this staged mod folder through -modpaths at launch",
            "high",
        );
    }
    if has_root_dir(&root, &["BepInEx"]) {
        return deployment_plan(
            ModLayout::BepInEx,
            "",
            "the archive contains a BepInEx tree",
            "high",
        );
    }
    if has_root_dir(&root, &["lml"]) {
        return deployment_plan(
            ModLayout::Raw,
            "",
            "the archive already contains a game-relative Lenny's Mod Loader tree",
            "high",
        );
    }
    if let Some((_, title)) = mod_engine_game_for(Some(target), steam_appid) {
        return deployment_plan(
            ModLayout::ModEngine3,
            MOD_ENGINE_DEPLOY_ROOT,
            &format!("the title is supported by Mod Engine 3 ({title})"),
            "high",
        );
    }
    if let Some(title) = lenny_game_for(Some(target), steam_appid) {
        if has_root_file(&root, "install.xml") || has_root_dir(&root, &["replace", "stream"]) {
            return deployment_plan(
                ModLayout::Lenny,
                "lml",
                &format!("the archive is a Lenny's Mod Loader package for {title}"),
                "high",
            );
        }
    }
    if let Some(layout) = game_layout(steam_appid) {
        return deployment_plan(layout, "", "matched the game-specific mod layout", "high");
    }
    if is_rimworld_mod_package(&root)
        && (steam_appid == Some(RIMWORLD_STEAM_APPID) || is_rimworld_target(target))
    {
        return deployment_plan(
            ModLayout::RimWorld,
            "",
            "the archive is a RimWorld mod package, which loads from a per-mod folder under Mods",
            "high",
        );
    }
    if has_root_file(&root, "modinfo.ini")
        && (fluffy_game(steam_appid).is_some() || is_fluffy_target(target))
    {
        return deployment_plan(
            ModLayout::Fluffy,
            "",
            "the archive contains Fluffy metadata and the game has a supported title or layout",
            "high",
        );
    }
    if steam_appid == Some(WUCHANG_STEAM_APPID)
        && has_extension(&root, &["pak", "utoc", "ucas"], 6)
    {
        return deployment_plan(
            ModLayout::WuchangPackage,
            WUCHANG_MODS_PREFIX,
            "Wuchang unsigned packages load through Project_Plague's ~mods folder",
            "high",
        );
    }
    if has_root_dir(
        &root,
        &[
            "Data",
            "Mods",
            "MelonLoader",
            "Content",
            "reframework",
            "natives",
            "pak_mods",
            "nativePC",
        ],
    ) {
        return deployment_plan(
            ModLayout::Raw,
            "",
            "the archive already contains a game-relative folder tree",
            "high",
        );
    }

    let uses_reframework = steam_appid == Some(RESIDENT_EVIL_REQUIEM_STEAM_APPID)
        || target.join("reframework").is_dir();
    if uses_reframework
        && has_extension(&root, &["lua"], 3)
        && !has_extension(&root, &["dll", "exe", "pak", "utoc", "ucas"], 3)
    {
        return deployment_plan(
            ModLayout::Raw,
            "reframework/autorun",
            "the game uses REFramework and the archive contains an unwrapped Lua autorun script",
            "high",
        );
    }

    let has_dll = has_extension(&root, &["dll"], 3);
    if target.join("BepInEx").is_dir() && has_dll {
        return deployment_plan(
            ModLayout::BepInEx,
            "",
            "the game uses BepInEx and the archive contains plugin files",
            "high",
        );
    }
    let uses_melonloader = steam_appid == Some(EVERYTHING_IS_CRAB_STEAM_APPID)
        || target.join("MelonLoader").is_dir()
        || is_unity_target(target);
    if uses_melonloader && has_dll {
        let packaged_folder = has_root_file(&root, "manifest.json");
        return deployment_plan(
            if packaged_folder {
                ModLayout::MelonLoader
            } else {
                ModLayout::Raw
            },
            "Mods",
            if packaged_folder {
                "the game uses MelonLoader and the archive contains a manifest-backed mod folder"
            } else {
                "the game uses MelonLoader and the archive contains a mod DLL"
            },
            "high",
        );
    }
    if is_bethesda_game(target, steam_appid) && is_bethesda_payload(&root) {
        return deployment_plan(
            ModLayout::Raw,
            "Data",
            "the archive contains Bethesda data files without a Data wrapper",
            "high",
        );
    }
    if has_extension(&root, &["pak", "utoc", "ucas"], 3) {
        if let Some(prefix) = unreal_paks_target(target) {
            return deployment_plan(
                ModLayout::Raw,
                &prefix,
                "the archive contains Unreal package files and the game has a Content/Paks directory",
                "high",
            );
        }
    }
    if is_fluffy_target(target) && has_extension(&root, &["pak"], 3) {
        return deployment_plan(
            ModLayout::Fluffy,
            "",
            "the archive contains a PAK mod and the game has a supported Fluffy layout",
            "high",
        );
    }
    if target.join("Mods").is_dir()
        && (has_extension(&root, &["lua"], 3)
            || walkdir::WalkDir::new(&root)
                .max_depth(3)
                .into_iter()
                .flatten()
                .any(|entry| {
                    entry
                        .file_name()
                        .to_string_lossy()
                        .eq_ignore_ascii_case("mod.xml")
                }))
    {
        return deployment_plan(
            ModLayout::ModsFolder,
            "",
            "the game has a Mods directory and the archive contains a structured script mod",
            "medium",
        );
    }

    deployment_plan(
        ModLayout::Raw,
        "",
        "no known loader or archive layout was detected, so paths are relative to the game root",
        "low",
    )
}

fn wrap_in_mods_folder(staged: &Path, fallback_name: &str) -> Result<(), String> {
    wrap_in_named_mods_folder(staged, "mods", fallback_name)
}

fn apply_rimworld_layout(staged: &Path, fallback_name: &str) -> Result<(), String> {
    wrap_in_named_mods_folder(staged, "Mods", fallback_name)
}

fn wrap_in_named_mods_folder(
    staged: &Path,
    dir_name: &str,
    fallback_name: &str,
) -> Result<(), String> {
    let entries: Vec<PathBuf> = std::fs::read_dir(staged)
        .map_err(|e| format!("stage read: {e}"))?
        .flatten()
        .map(|e| e.path())
        .collect();
    let has_mods_dir = entries.iter().any(|p| {
        p.is_dir()
            && p.file_name()
                .map(|n| n.eq_ignore_ascii_case("mods"))
                .unwrap_or(false)
    });
    if entries.is_empty() || has_mods_dir {
        return Ok(());
    }
    let mods_dir = staged.join(dir_name);
    std::fs::create_dir_all(&mods_dir).map_err(|e| format!("mods wrap: {e}"))?;
    if entries.len() == 1 && entries[0].is_dir() {
        let name = entries[0].file_name().unwrap().to_os_string();
        move_tree(&entries[0], &mods_dir.join(name), "mods wrap")?;
    } else {
        let folder = safe_folder_name(fallback_name);
        let dest = mods_dir.join(if folder.is_empty() { "mod" } else { &folder });
        std::fs::create_dir_all(&dest).map_err(|e| format!("mods wrap: {e}"))?;
        for p in &entries {
            let name = p.file_name().unwrap().to_os_string();
            move_tree(p, &dest.join(name), "mods wrap")?;
        }
    }
    Ok(())
}

#[derive(Default)]
struct LocalGameMetadata {
    title: Option<String>,
    steam_appid: Option<u64>,
}

fn steam_appid_from_key(appid: &str) -> Option<u64> {
    appid
        .strip_prefix("steam-")
        .and_then(|value| value.parse::<u64>().ok())
}

fn local_game_metadata_with(
    appid: &str,
    needs_title: bool,
    load_manifest: impl FnOnce() -> Option<Value>,
) -> LocalGameMetadata {
    let keyed_steam = steam_appid_from_key(appid);
    if keyed_steam.is_some() && !needs_title {
        return LocalGameMetadata {
            steam_appid: keyed_steam,
            ..Default::default()
        };
    }
    let manifest = load_manifest();
    LocalGameMetadata {
        title: manifest
            .as_ref()
            .and_then(|value| manifest_get(value, "name"))
            .and_then(Value::as_str)
            .map(str::to_string),
        steam_appid: keyed_steam.or_else(|| {
            manifest
                .as_ref()
                .and_then(|value| manifest_get(value, "steamAppId"))
                .and_then(Value::as_u64)
                .filter(|id| *id > 0)
        }),
    }
}

fn local_game_metadata(state: &AppState, appid: &str, needs_title: bool) -> LocalGameMetadata {
    local_game_metadata_with(appid, needs_title, || library::installed_manifest(state, appid))
}

async fn detect_steam_appid(app: &AppHandle, appid: &str) -> Option<u64> {
    if let Some(id) = steam_appid_from_key(appid) {
        return Some(id);
    }
    let app = app.clone();
    let appid = appid.to_string();
    let metadata = tokio::task::spawn_blocking(move || {
        local_game_metadata(&app.state::<AppState>(), &appid, true)
    })
    .await
    .ok()?;
    if metadata.steam_appid.is_some() {
        return metadata.steam_appid;
    }
    crate::sources::steam::search_app_id(metadata.title.as_deref()?).await
}

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
        timeout: Some(Duration::from_secs(2 * 60 * 60)),
        ..Default::default()
    };
    let resp = http::fetch(url, &opts)
        .await
        .map_err(|e| format!("download: {e}"))?;
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
    let mut last_emit = Instant::now();
    on_progress(last);
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("download stream: {e}"))?;
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("download write: {e}"))?;
        received += chunk.len() as u64;
        let pct = total.map(|t| ((received.saturating_mul(100)) / t.max(1)).min(100) as u8);
        if should_emit_download_progress(last, pct, last_emit.elapsed()) {
            last = pct;
            last_emit = Instant::now();
            on_progress(pct);
        }
    }
    file.flush().await.ok();
    Ok(received)
}

fn should_emit_download_progress(
    last: Option<u8>,
    next: Option<u8>,
    elapsed: Duration,
) -> bool {
    next != last && (next == Some(100) || elapsed >= Duration::from_millis(200))
}

fn filename_from_url(url: &str) -> Option<String> {
    let u = url::Url::parse(url).ok()?;
    let last = u.path_segments()?.next_back()?.to_string();
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

const BEPINEX_SUBDIRS: &[&str] = &["plugins", "config", "patchers", "core"];

fn is_ts_meta(name: &str) -> bool {
    matches!(
        name.to_lowercase().as_str(),
        "manifest.json"
            | "icon.png"
            | "readme.md"
            | "changelog.md"
            | "license"
            | "license.md"
            | "license.txt"
    )
}

fn bepinex_root(src: &Path) -> PathBuf {
    if src.join("BepInEx").is_dir() {
        return src.to_path_buf();
    }
    if let Some(payload) = single_payload_dir(src) {
        if payload.join("BepInEx").is_dir() {
            return payload;
        }
    }
    src.to_path_buf()
}

pub(crate) fn apply_bepinex_layout(src: &Path, dst: &Path, full_name: &str) -> Result<(), String> {
    std::fs::create_dir_all(dst).map_err(|e| format!("stage dir: {e}"))?;
    let root = bepinex_root(src);
    if root.join("BepInEx").is_dir() {
        return copy_dir_recursive(&root, dst);
    }
    let plugin_dir = dst.join("BepInEx").join("plugins").join(full_name);
    for entry in std::fs::read_dir(&root)
        .map_err(|e| format!("stage read: {e}"))?
        .flatten()
    {
        let path = entry.path();
        let fname = entry.file_name().to_string_lossy().to_string();
        let lname = fname.to_lowercase();
        if path.is_dir() && BEPINEX_SUBDIRS.contains(&lname.as_str()) {
            copy_dir_recursive(&path, &dst.join("BepInEx").join(&lname))?;
        } else if path.is_dir() {
            copy_dir_recursive(&path, &plugin_dir.join(&fname))?;
        } else if path.is_file() {
            std::fs::create_dir_all(&plugin_dir).map_err(|e| format!("stage dir: {e}"))?;
            std::fs::copy(&path, plugin_dir.join(&fname))
                .map_err(|e| format!("stage file: {e}"))?;
        }
    }
    Ok(())
}

const MEANINGFUL_DIRS: &[&str] = &[
    "bepinex",
    "data",
    "lml",
    "mod",
    "mods",
    "natives",
    "nativepc",
    "pak_mods",
    "plugins",
    "patchers",
    "config",
    "core",
    "replace",
    "reframework",
    "scripts",
    "stream",
    "content",
    "userlibs",
    "userdata",
];

pub(crate) fn strip_wrapper_dir(staged: &Path) -> Result<(), String> {
    let entries: Vec<PathBuf> = std::fs::read_dir(staged)
        .map_err(|e| format!("stage read: {e}"))?
        .flatten()
        .map(|e| e.path())
        .collect();
    if entries.len() != 1 || !entries[0].is_dir() {
        return Ok(());
    }
    let wrapper = &entries[0];
    let name = wrapper
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_lowercase();
    if MEANINGFUL_DIRS.contains(&name.as_str()) {
        return Ok(());
    }
    let inner: Vec<PathBuf> = std::fs::read_dir(wrapper)
        .map_err(|e| format!("stage read: {e}"))?
        .flatten()
        .map(|e| e.path())
        .collect();
    if inner.is_empty() {
        return Ok(());
    }
    for path in inner {
        let to = staged.join(path.file_name().unwrap_or_default());
        if std::fs::rename(&path, &to).is_ok() {
            continue;
        }
        if path.is_dir() {
            copy_dir_recursive(&path, &to)?;
        } else {
            std::fs::copy(&path, &to).map_err(|e| format!("unwrap: {e}"))?;
        }
    }
    std::fs::remove_dir_all(wrapper).ok();
    Ok(())
}

fn move_tree(src: &Path, dst: &Path, context: &str) -> Result<(), String> {
    if let Some(parent) = dst.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("{context}: {e}"))?;
    }
    if std::fs::rename(src, dst).is_ok() {
        return Ok(());
    }
    if src.is_dir() {
        copy_dir_recursive(src, dst)?;
        std::fs::remove_dir_all(src).ok();
    } else {
        std::fs::copy(src, dst).map_err(|e| format!("{context}: {e}"))?;
        std::fs::remove_file(src).ok();
    }
    Ok(())
}

fn apply_lenny_layout(staged: &Path, fallback_name: &str) -> Result<(), String> {
    let root = classification_root(staged);
    if root != staged && has_root_file(&root, "install.xml") {
        return Ok(());
    }
    if !has_root_file(staged, "install.xml") {
        return strip_wrapper_dir(staged);
    }

    let entries: Vec<PathBuf> = std::fs::read_dir(staged)
        .map_err(|e| format!("Lenny stage read: {e}"))?
        .flatten()
        .map(|entry| entry.path())
        .collect();
    let mut folder = safe_folder_name(fallback_name);
    if folder.is_empty() || folder == "unknown" {
        folder = "mod".to_string();
    }
    let mut destination = staged.join(&folder);
    if entries.iter().any(|entry| entry == &destination) {
        destination = staged.join(format!("{folder}-mod"));
    }
    std::fs::create_dir_all(&destination).map_err(|e| format!("Lenny package folder: {e}"))?;
    for entry in entries {
        let name = entry.file_name().unwrap_or_default().to_os_string();
        move_tree(&entry, &destination.join(name), "Lenny package move")?;
    }
    Ok(())
}

fn apply_fluffy_layout(staged: &Path) -> Result<(), String> {
    strip_wrapper_dir(staged)?;
    for name in ["modinfo.ini", "screenshot.jpg", "screenshot.png"] {
        let path = std::fs::read_dir(staged)
            .ok()
            .into_iter()
            .flatten()
            .flatten()
            .find(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .eq_ignore_ascii_case(name)
            })
            .map(|entry| entry.path());
        if let Some(path) = path.filter(|path| path.is_file()) {
            std::fs::remove_file(path).map_err(|e| format!("Fluffy metadata cleanup: {e}"))?;
        }
    }
    Ok(())
}

fn apply_wuchang_enabler_layout(staged: &Path) -> Result<(), String> {
    let direct = child_dir(staged, "Project_Plague");
    let entry_count = std::fs::read_dir(staged)
        .map_err(|error| format!("Wuchang stage read: {error}"))?
        .flatten()
        .count();
    if direct.is_some() && entry_count == 1 {
        return Ok(());
    }

    let source = direct.or_else(|| wuchang_project_plague_root(staged));
    let direct_payload = has_content_paks(staged);
    if source.is_none() && !direct_payload {
        return Err("Wuchang enabler archive has no Project_Plague tree".to_string());
    }

    let name = staged
        .file_name()
        .unwrap_or_default()
        .to_string_lossy();
    let temporary = staged.with_file_name(format!(".{name}-wuchang-layout"));
    if temporary.exists() {
        std::fs::remove_dir_all(&temporary)
            .map_err(|error| format!("Wuchang temporary cleanup: {error}"))?;
    }
    let project_plague = temporary.join("Project_Plague");
    std::fs::create_dir_all(&project_plague)
        .map_err(|error| format!("Wuchang stage: {error}"))?;

    if let Some(source) = source {
        copy_dir_recursive(&source, &project_plague)?;
    } else {
        copy_dir_recursive(staged, &project_plague)?;
    }

    std::fs::remove_dir_all(staged).map_err(|error| format!("Wuchang stage replace: {error}"))?;
    std::fs::rename(&temporary, staged)
        .map_err(|error| format!("Wuchang stage replace: {error}"))
}

fn apply_wuchang_package_layout(staged: &Path) -> Result<(), String> {
    let name = staged
        .file_name()
        .unwrap_or_default()
        .to_string_lossy();
    let temporary = staged.with_file_name(format!(".{name}-wuchang-package"));
    if temporary.exists() {
        std::fs::remove_dir_all(&temporary)
            .map_err(|error| format!("Wuchang package temporary cleanup: {error}"))?;
    }
    std::fs::create_dir_all(&temporary)
        .map_err(|error| format!("Wuchang package stage: {error}"))?;

    let mut copied = 0usize;
    for entry in walkdir::WalkDir::new(staged).into_iter().flatten() {
        if !entry.file_type().is_file()
            || !entry
                .path()
                .extension()
                .and_then(|extension| extension.to_str())
                .map(|extension| matches!(extension.to_ascii_lowercase().as_str(), "pak" | "utoc" | "ucas"))
                .unwrap_or(false)
        {
            continue;
        }
        let destination = temporary.join(entry.file_name());
        if destination.exists() {
            std::fs::remove_dir_all(&temporary).ok();
            return Err(format!(
                "Wuchang package contains duplicate file name {}",
                entry.file_name().to_string_lossy()
            ));
        }
        std::fs::copy(entry.path(), &destination)
            .map_err(|error| format!("Wuchang package copy: {error}"))?;
        copied += 1;
    }
    if copied == 0 {
        std::fs::remove_dir_all(&temporary).ok();
        return Err("Wuchang package contains no .pak, .utoc, or .ucas files".to_string());
    }

    std::fs::remove_dir_all(staged)
        .map_err(|error| format!("Wuchang package replace: {error}"))?;
    std::fs::rename(&temporary, staged)
        .map_err(|error| format!("Wuchang package replace: {error}"))
}

fn is_mod_engine_bootstrap(name: &str) -> bool {
    name == MOD_ENGINE_PROFILE
        || name.ends_with(".me3")
        || name.starts_with("modengine2")
        || (name.starts_with("launchmod") && (name.ends_with(".bat") || name.ends_with(".cmd")))
        || (name.starts_with("config_") && name.ends_with(".toml"))
}

fn apply_mod_engine_layout(staged: &Path, mod_id: &str) -> Result<(), String> {
    let root = classification_root(staged);
    let has_dll = has_extension(&root, &["dll"], 3);
    let has_asset_payload = has_root_dir(
        &root,
        &[
            "mod", "parts", "chr", "map", "event", "msg", "param", "sfx", "menu", "sound", "asset",
            "action",
        ],
    ) || has_root_file(&root, "regulation.bin")
        || has_extension(&root, &["dcx", "bnd", "bhd", "bdt"], 3);
    let native_only = has_dll && !has_asset_payload;
    let folder = safe_folder_name(mod_id);
    let temporary = staged.with_file_name(format!(".{folder}-me3-layout"));
    if temporary.exists() {
        std::fs::remove_dir_all(&temporary)
            .map_err(|e| format!("Mod Engine temporary cleanup: {e}"))?;
    }
    let package = temporary.join(&folder);
    std::fs::create_dir_all(&package).map_err(|e| format!("Mod Engine stage: {e}"))?;

    let entries: Vec<PathBuf> = std::fs::read_dir(&root)
        .map_err(|e| format!("Mod Engine stage read: {e}"))?
        .flatten()
        .map(|entry| entry.path())
        .collect();
    for entry in entries {
        let name = entry
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
        let lower = name.to_lowercase();
        if entry.is_file() && (is_ts_meta(&lower) || is_mod_engine_bootstrap(&lower)) {
            continue;
        }
        let destination = if entry.is_dir() && lower == "mod" {
            package.join("mod")
        } else if entry.is_dir() && lower == "natives" {
            package.join("natives")
        } else if native_only
            || (entry.is_file()
                && entry
                    .extension()
                    .and_then(|extension| extension.to_str())
                    .map(|extension| extension.eq_ignore_ascii_case("dll"))
                    .unwrap_or(false))
        {
            package.join("natives").join(&name)
        } else {
            package.join("mod").join(&name)
        };
        move_tree(&entry, &destination, "Mod Engine package move")?;
    }

    std::fs::remove_dir_all(staged).map_err(|e| format!("Mod Engine stage replace: {e}"))?;
    std::fs::rename(&temporary, staged).map_err(|e| format!("Mod Engine stage replace: {e}"))
}

fn apply_staging_layout(
    staged: &Path,
    layout: ModLayout,
    fallback_name: &str,
    mod_id: &str,
) -> Result<(), String> {
    match layout {
        ModLayout::Raw => strip_wrapper_dir(staged),
        ModLayout::ModEngine3 => apply_mod_engine_layout(staged, mod_id),
        ModLayout::Lenny => apply_lenny_layout(staged, fallback_name),
        ModLayout::MelonLoader => Ok(()),
        ModLayout::Fluffy => apply_fluffy_layout(staged),
        ModLayout::ModsFolder => wrap_in_mods_folder(staged, fallback_name),
        ModLayout::RimWorld => apply_rimworld_layout(staged, fallback_name),
        ModLayout::WuchangEnabler => apply_wuchang_enabler_layout(staged),
        ModLayout::WuchangPackage => apply_wuchang_package_layout(staged),
        ModLayout::BepInEx | ModLayout::RequiresInstaller => {
            Err("loader-specific staging layout reached the raw archive path".to_string())
        }
    }
}

fn bepinex_plugin_name(spec: &InstallSpec) -> String {
    let name = safe_folder_name(&spec.name);
    if name == "unknown" {
        spec.mod_id()
    } else {
        name
    }
}

fn upsert_mod(cfg: &mut GameMods, spec: &InstallSpec, size: u64, plan: &DeploymentPlan) {
    let mod_id = spec.mod_id();
    let order = cfg.mods.iter().map(|m| m.order + 1).max().unwrap_or(0);
    let mut entry = ModEntry {
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
        deploy_prefix: plan.deploy_prefix.clone(),
        deploy_reason: plan.reason.clone(),
        deploy_confidence: plan.confidence.to_string(),
        deploy_blocked: false,
    };
    if let Some(m) = cfg.mods.iter_mut().find(|m| m.id == entry.id) {
        entry.enabled = m.enabled;
        entry.order = m.order;
        *m = entry;
    } else {
        cfg.mods.push(entry);
    }
}

pub(crate) async fn finalize_install(
    app: &AppHandle,
    spec: &InstallSpec,
    staged_src: &Path,
    move_src: bool,
) -> Result<usize, String> {
    let steam_appid = detect_steam_appid(app, &spec.appid).await;
    blocking_game(app.clone(), spec.appid.clone(), {
        let spec = spec.clone();
        let staged_src = staged_src.to_path_buf();
        move |app, state, _| {
            finalize_install_blocking(
                app,
                state,
                &spec,
                &staged_src,
                move_src,
                steam_appid,
            )
        }
    })
    .await?
}

fn finalize_install_blocking(
    app: &AppHandle,
    state: &AppState,
    spec: &InstallSpec,
    staged_src: &Path,
    move_src: bool,
    steam_appid: Option<u64>,
) -> Result<usize, String> {
    let mod_id = spec.mod_id();

    let dir = game_mods_dir(&state.paths, &spec.appid);
    let final_dir = dir.join("staging").join(&mod_id);
    if final_dir.exists() {
        std::fs::remove_dir_all(&final_dir).map_err(|e| format!("replace staging: {e}"))?;
    }
    if let Some(parent) = final_dir.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("staging dir: {e}"))?;
    }
    let selected_src = versioned_archive_root(staged_src, &spec.version);
    let staged_src = selected_src.as_deref().unwrap_or(staged_src);
    let mut cfg = load_config(&state.paths, &spec.appid);
    let steam_appid = steam_appid.or(cfg.steam_appid);
    if cfg.steam_appid.is_none() {
        cfg.steam_appid = steam_appid;
    }
    let target = deploy_target_dir(state, &spec.appid, &cfg)?;
    let mut plan = infer_deployment_plan_for_entry(
        &target,
        staged_src,
        steam_appid,
        &spec.provider,
        &spec.remote_id,
        &spec.page_url,
    );
    if !cfg.deploy_target.is_empty() {
        apply_manual_target(&mut plan, &cfg.deploy_target);
    }

    if plan.layout == ModLayout::RequiresInstaller {
        return Err("this mod uses an interactive FOMOD installer, which Union.Manifold cannot safely choose options for yet".to_string());
    }
    if plan.layout == ModLayout::BepInEx {
        apply_bepinex_layout(staged_src, &final_dir, &bepinex_plugin_name(spec))?;
        if move_src {
            std::fs::remove_dir_all(staged_src).ok();
        }
    } else if move_src {
        move_tree(staged_src, &final_dir, "staging move")?;
        apply_staging_layout(&final_dir, plan.layout, &spec.name, &mod_id)?;
    } else {
        copy_dir_recursive(staged_src, &final_dir)?;
        apply_staging_layout(&final_dir, plan.layout, &spec.name, &mod_id)?;
    }

    if steam_appid == Some(MEWGENICS_STEAM_APPID) {
        normalize_mewgenics_localization_append(&final_dir)?;
    }

    let size = crate::install::dir_size(&final_dir);
    upsert_mod(&mut cfg, spec, size, &plan);
    cfg.deployment_plan_version = DEPLOYMENT_PLAN_VERSION;
    // Deploy before persisting: a failed install must not show up as
    // installed with nothing on disk. The failed deploy_to has already
    // reconciled the journal with the game directory, and the staging
    // folder is replaced on the next attempt.
    let n = redeploy(state, &spec.appid, &cfg)?;
    save_config(&state.paths, &spec.appid, &cfg);
    emit_changed(app, &spec.appid);
    Ok(n)
}

pub(crate) async fn run_archive_install(
    app: AppHandle,
    spec: InstallSpec,
    url: String,
    headers: HashMap<String, String>,
) {
    let mod_id = spec.mod_id();
    if let Err(e) = archive_install_inner(&app, &spec, &url, headers).await {
        emit_progress(
            &app,
            &spec.appid,
            &mod_id,
            &spec.name,
            "error",
            None,
            Some(&e),
        );
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

    emit_progress(
        app,
        &spec.appid,
        &mod_id,
        &spec.name,
        "downloading",
        Some(0),
        None,
    );
    let fname = filename_from_url(url).unwrap_or_else(|| format!("{mod_id}.archive"));
    let archive = tmp_dir.join(format!("{mod_id}-{fname}"));
    download_to_file(url, &archive, headers, |p| {
        emit_progress(
            app,
            &spec.appid,
            &mod_id,
            &spec.name,
            "downloading",
            p,
            None,
        );
    })
    .await?;

    emit_progress(
        app,
        &spec.appid,
        &mod_id,
        &spec.name,
        "extracting",
        None,
        None,
    );
    let extract_dir = tmp_dir.join(format!("{mod_id}-extract"));
    if extract_dir.exists() {
        std::fs::remove_dir_all(&extract_dir).ok();
    }
    let res = crate::install::run_7z(&archive, &extract_dir, |p| {
        emit_progress(
            app,
            &spec.appid,
            &mod_id,
            &spec.name,
            "extracting",
            Some(p),
            None,
        );
    })
    .await
    .map_err(|e| e.to_string());
    std::fs::remove_file(&archive).ok();
    res?;
    flatten_tar(&extract_dir).await?;

    emit_progress(
        app,
        &spec.appid,
        &mod_id,
        &spec.name,
        "installing",
        None,
        None,
    );
    let out = finalize_install(app, spec, &extract_dir, true).await;
    std::fs::remove_dir_all(&extract_dir).ok();
    out?;
    emit_progress(
        app,
        &spec.appid,
        &mod_id,
        &spec.name,
        "done",
        Some(100),
        None,
    );
    Ok(())
}


fn apply_manual_target(plan: &mut DeploymentPlan, target: &str) {
    if !matches!(plan.layout, ModLayout::ModEngine3 | ModLayout::Lenny) {
        plan.deploy_prefix.clear();
    }
    plan.reason = format!("using the manual deploy target {}; {}", target, plan.reason);
    plan.confidence = "manual";
}

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

const DEPLOYMENT_PLAN_VERSION: u32 = 8;

fn refresh_deployment_plans(state: &AppState, appid: &str, cfg: &mut GameMods) -> bool {
    let Ok(target) = deploy_target_dir(state, appid, cfg) else {
        return false;
    };
    let manual_target = cfg.deploy_target.clone();
    let staging = game_mods_dir(&state.paths, appid).join("staging");
    let migrating = cfg.deployment_plan_version < DEPLOYMENT_PLAN_VERSION;
    let mut changed = migrating;
    let mut migration_failed = false;
    for installed in &mut cfg.mods {
        let staged = staging.join(&installed.id);
        if !staged.is_dir() {
            continue;
        }
        if migrating && cfg.steam_appid == Some(MEWGENICS_STEAM_APPID) {
            match normalize_mewgenics_localization_append(&staged) {
                Ok(migrated) => changed |= migrated,
                Err(error) => {
                    crate::logging::write_line(
                        "warn",
                        &format!(
                            "Mewgenics localization migration failed for {appid}/{}: {error}",
                            installed.id
                        ),
                    );
                    migration_failed = true;
                    continue;
                }
            }
        }
        let mut plan = infer_deployment_plan_for_entry(
            &target,
            &staged,
            cfg.steam_appid,
            &installed.provider,
            &installed.remote_id,
            &installed.page_url,
        );
        if migrating
            && matches!(
                plan.layout,
                ModLayout::ModEngine3
                    | ModLayout::Lenny
                    | ModLayout::Fluffy
                    | ModLayout::RimWorld
                    | ModLayout::WuchangEnabler
                    | ModLayout::WuchangPackage
            )
        {
            if let Err(error) =
                apply_staging_layout(&staged, plan.layout, &installed.name, &installed.id)
            {
                crate::logging::write_line(
                    "warn",
                    &format!(
                        "mod deployment layout migration failed for {appid}/{}: {error}",
                        installed.id
                    ),
                );
                migration_failed = true;
                continue;
            }
        }
        if !manual_target.is_empty() {
            apply_manual_target(&mut plan, &manual_target);
        }
        let blocked = plan.layout == ModLayout::RequiresInstaller;
        let confidence = plan.confidence.to_string();
        if installed.deploy_prefix != plan.deploy_prefix
            || installed.deploy_reason != plan.reason
            || installed.deploy_confidence != confidence
            || installed.deploy_blocked != blocked
        {
            installed.deploy_prefix = plan.deploy_prefix;
            installed.deploy_reason = plan.reason;
            installed.deploy_confidence = confidence;
            installed.deploy_blocked = blocked;
            changed = true;
        }
    }
    if migration_failed {
        return true;
    }
    cfg.deployment_plan_version = DEPLOYMENT_PLAN_VERSION;
    changed
}

fn game_state_value(state: &AppState, appid: &str, cfg: &GameMods) -> Value {
    let dir = game_mods_dir(&state.paths, appid);
    let deployed = !load_journal(&dir).files.is_empty()
        || dir.join(MEWGENICS_DEPLOY_MARKER).is_file();
    let compatibility_target = deploy_target_dir(state, appid, cfg).ok();
    let loaders = loader_compatibility(compatibility_target.as_deref(), cfg.steam_appid);
    json!({
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
        "loaderCompatibility": loaders,
        "mods": serde_json::to_value(&cfg.mods).unwrap(),
    })
}

fn discovery_needed_for(cfg: &GameMods, has_nexus_key: bool) -> bool {
    cfg.steam_appid.is_none()
        || cfg.workshop_supported.is_none()
        || !cfg.thunderstore_checked
        || (cfg.nexus_domain.is_none()
            && !cfg.nexus_domain_checked
            && has_nexus_key)
}

struct DiscoverySeed {
    initial: GameMods,
    title: Option<String>,
    nexus_key: Option<String>,
}

fn load_local_game_state(state: &AppState, appid: &str) -> (Value, Option<DiscoverySeed>) {
    let existed = config_path(&game_mods_dir(&state.paths, appid)).is_file();
    let mut cfg = load_config(&state.paths, appid);
    let mut dirty = false;
    let mut steam_changed = false;
    let nexus_key = state
        .settings
        .get_string("nexusApiKey")
        .map(|key| key.trim().to_string())
        .filter(|key| !key.is_empty());
    let needs_title = !cfg.thunderstore_checked
        || (cfg.nexus_domain.is_none()
            && !cfg.nexus_domain_checked
            && nexus_key.is_some());
    let metadata = if cfg.steam_appid.is_none() || needs_title {
        local_game_metadata(state, appid, needs_title)
    } else {
        LocalGameMetadata::default()
    };

    if cfg.steam_appid.is_none() {
        if let Some(id) = metadata.steam_appid {
            cfg.steam_appid = Some(id);
            dirty = true;
            steam_changed = true;
        }
    }
    let plan_dirty = if steam_changed
        || cfg.deployment_plan_version < DEPLOYMENT_PLAN_VERSION
        || cfg
            .mods
            .iter()
            .any(|installed| installed.deploy_reason.is_empty())
    {
        refresh_deployment_plans(state, appid, &mut cfg)
    } else {
        false
    };
    dirty |= plan_dirty;

    if dirty || !existed {
        save_config(&state.paths, appid, &cfg);
    }
    if plan_dirty {
        if let Err(error) = redeploy(state, appid, &cfg) {
            crate::logging::write_line(
                "warn",
                &format!("mod deployment plan migration failed for {appid}: {error}"),
            );
        }
    }
    let discovery = discovery_needed_for(&cfg, nexus_key.is_some()).then(|| DiscoverySeed {
        initial: cfg.clone(),
        title: metadata.title,
        nexus_key,
    });
    (game_state_value(state, appid, &cfg), discovery)
}

fn spawn_game_discovery(app: AppHandle, appid: String, seed: DiscoverySeed) {
    if !DISCOVERING_GAMES.lock().insert(appid.clone()) {
        return;
    }
    tauri::async_runtime::spawn(async move {
        discover_game(app, &appid, seed).await;
        DISCOVERING_GAMES.lock().remove(&appid);
    });
}

async fn discover_game(app: AppHandle, appid: &str, seed: DiscoverySeed) {
    let DiscoverySeed {
        initial,
        title,
        nexus_key,
    } = seed;
    let title_ref = title.as_deref();
    let steam = async {
        if initial.steam_appid.is_none() {
            match title_ref {
                Some(title) => crate::sources::steam::search_app_id(title).await,
                None => None,
            }
        } else {
            None
        }
    };
    let nexus = async {
        if initial.nexus_domain.is_none() && !initial.nexus_domain_checked {
            match (nexus_key.as_deref(), title_ref) {
                (Some(key), Some(title)) => nexus::match_domain(key, title).await.ok(),
                _ => None,
            }
        } else {
            None
        }
    };
    let thunderstore = async {
        if initial.thunderstore_community.is_none() && !initial.thunderstore_checked {
            match title_ref {
                Some(title) => thunderstore::match_community(title).await.ok(),
                None => None,
            }
        } else {
            None
        }
    };
    let workshop = async {
        if initial.workshop_supported.is_none() {
            match initial.steam_appid {
                Some(steam_appid) => workshop::detect_workshop_support(steam_appid).await,
                None => None,
            }
        } else {
            None
        }
    };
    let (steam, nexus, thunderstore, workshop) =
        tokio::join!(steam, nexus, thunderstore, workshop);
    let workshop = if workshop.is_none()
        && initial.workshop_supported.is_none()
        && initial.steam_appid.is_none()
    {
        match steam {
            Some(steam_appid) => workshop::detect_workshop_support(steam_appid).await,
            None => None,
        }
    } else {
        workshop
    };

    let app_for_merge = app.clone();
    let merged = blocking_game(
        app_for_merge,
        appid.to_string(),
        move |app, state, appid| {
            let mut cfg = load_config(&state.paths, appid);
            let mut dirty = false;
            let mut steam_changed = false;
            if cfg.steam_appid.is_none() {
                if let Some(found) = steam {
                    cfg.steam_appid = Some(found);
                    dirty = true;
                    steam_changed = true;
                }
            }
            if cfg.nexus_domain.is_none() && !cfg.nexus_domain_checked {
                if let Some(found) = nexus {
                    cfg.nexus_domain_checked = true;
                    cfg.nexus_domain_auto = found.is_some();
                    cfg.nexus_domain = found;
                    dirty = true;
                }
            }
            if cfg.thunderstore_community.is_none() && !cfg.thunderstore_checked {
                if let Some(found) = thunderstore {
                    cfg.thunderstore_checked = true;
                    cfg.thunderstore_community_auto = found.is_some();
                    cfg.thunderstore_community = found.map(|community| community.identifier);
                    dirty = true;
                }
            }
            if cfg.workshop_supported.is_none() {
                if let Some(found) = workshop {
                    cfg.workshop_supported = Some(found);
                    dirty = true;
                }
            }
            let plan_dirty = steam_changed
                || cfg.deployment_plan_version < DEPLOYMENT_PLAN_VERSION
                || cfg
                    .mods
                    .iter()
                    .any(|installed| installed.deploy_reason.is_empty());
            let plan_dirty = plan_dirty && refresh_deployment_plans(state, appid, &mut cfg);
            dirty |= plan_dirty;
            if !dirty {
                return;
            }
            save_config(&state.paths, appid, &cfg);
            if plan_dirty {
                if let Err(error) = redeploy(state, appid, &cfg) {
                    crate::logging::write_line(
                        "warn",
                        &format!("mod deployment plan discovery failed for {appid}: {error}"),
                    );
                }
            }
            emit_changed(app, appid);
        },
    )
    .await;
    if let Err(error) = merged {
        crate::logging::write_line("warn", &error);
    }
}

#[tauri::command]
pub async fn mods_game_get(app: AppHandle, appid: String) -> Result<Value, String> {
    let (value, discovery) = blocking_game(app.clone(), appid.clone(), |_, state, appid| {
        load_local_game_state(state, appid)
    })
    .await?;
    if let Some(seed) = discovery {
        spawn_game_discovery(app, appid, seed);
    }
    Ok(value)
}

pub(crate) fn relativize_target(base: &Path, picked: &Path) -> Result<String, String> {
    let b = base.canonicalize().unwrap_or_else(|_| base.to_path_buf());
    let p = picked
        .canonicalize()
        .unwrap_or_else(|_| picked.to_path_buf());
    let rel = p
        .strip_prefix(&b)
        .map_err(|_| "folder must be inside the game directory".to_string())?;
    Ok(join_rel(rel))
}

#[tauri::command]
pub async fn mods_deploy_target_pick(
    app: AppHandle,
    state: State<'_, AppState>,
    appid: String,
) -> Result<Value, String> {
    let roots = library::scan_roots(&state);
    let base = library::game_files_dir(&roots, &appid)
        .ok_or_else(|| format!("game {appid} not found in library"))?;
    let Some(picked) = crate::dialogs::pick_folder(app).await else {
        return Ok(json!({ "ok": false }));
    };
    Ok(fold(
        relativize_target(&base, Path::new(&picked))
            .map(|target| json!({ "ok": true, "target": target })),
    ))
}

#[tauri::command]
pub async fn mods_game_set(app: AppHandle, appid: String, config: Value) -> Result<Value, String> {
    blocking_game(app, appid, move |app, state, appid| {
        let mut cfg = load_config(&state.paths, appid);
        let dir = game_mods_dir(&state.paths, appid);

        if let Some(v) = config.get("nexusDomain") {
            let v = v.as_str().map(str::trim).filter(|s| !s.is_empty());
            cfg.nexus_domain = v.map(str::to_string);
            cfg.nexus_domain_auto = false;
            cfg.nexus_domain_checked = true;
        }

        if let Some(v) = config.get("thunderstoreCommunity") {
            let v = v.as_str().map(str::trim).filter(|s| !s.is_empty());
            cfg.thunderstore_community = v.map(str::to_string);
            cfg.thunderstore_community_auto = false;
            cfg.thunderstore_checked = v.is_some();
        }

        let res: Result<(), String> = (|| {
            if let Some(v) = config.get("deployTarget").and_then(|v| v.as_str()) {
                let new_target = v.trim().trim_matches('/').trim_matches('\\').to_string();
                if new_target != cfg.deploy_target {
                    if let Ok(old) = deploy_target_dir(state, appid, &cfg) {
                        undeploy_from(&dir, &old)?;
                    }
                    // Validate the NEW target before persisting: a bad target
                    // (e.g. one with a `..` segment) must not survive as the
                    // stored config.
                    cfg.deploy_target = new_target;
                    let target = deploy_target_dir(state, appid, &cfg)?;
                    refresh_deployment_plans(state, appid, &mut cfg);
                    deploy_to(&dir, &target, &cfg)?;
                }
            }
            Ok(())
        })();

        if res.is_ok() {
            save_config(&state.paths, appid, &cfg);
        }
        emit_changed(app, appid);
        fold(res.map(|_| json!({ "ok": true })))
    })
    .await
}

#[tauri::command]
pub async fn mods_toggle(
    app: AppHandle,
    appid: String,
    mod_id: String,
    enabled: bool,
) -> Result<Value, String> {
    blocking_game(app, appid, move |app, state, appid| {
        let mut cfg = load_config(&state.paths, appid);
        let Some(m) = cfg.mods.iter_mut().find(|m| m.id == mod_id) else {
            return json!({ "ok": false, "error": format!("mod {mod_id} not found") });
        };
        m.enabled = enabled;
        let res = redeploy(state, appid, &cfg);
        if res.is_ok() {
            // Persist only after the files actually moved, so a failed deploy
            // leaves both the config and the game directory describing the
            // previous state.
            save_config(&state.paths, appid, &cfg);
        }
        emit_changed(app, appid);
        fold(res.map(|_| json!({ "ok": true })))
    })
    .await
}

#[tauri::command]
pub async fn mods_reorder(
    app: AppHandle,
    appid: String,
    ordered_ids: Vec<String>,
) -> Result<Value, String> {
    blocking_game(app, appid, move |app, state, appid| {
        let mut cfg = load_config(&state.paths, appid);
        let pos: HashMap<&str, usize> = ordered_ids
            .iter()
            .enumerate()
            .map(|(i, id)| (id.as_str(), i))
            .collect();
        cfg.mods
            .sort_by_key(|m| pos.get(m.id.as_str()).copied().unwrap_or(usize::MAX));
        for (i, m) in cfg.mods.iter_mut().enumerate() {
            m.order = i as u32;
        }
        let res = redeploy(state, appid, &cfg);
        if res.is_ok() {
            save_config(&state.paths, appid, &cfg);
        }
        emit_changed(app, appid);
        fold(res.map(|_| json!({ "ok": true })))
    })
    .await
}

#[tauri::command]
pub async fn mods_uninstall(
    app: AppHandle,
    appid: String,
    mod_id: String,
) -> Result<Value, String> {
    blocking_game(app, appid, move |app, state, appid| {
        let mut cfg = load_config(&state.paths, appid);
        let before = cfg.mods.len();
        cfg.mods.retain(|m| m.id != mod_id);
        if cfg.mods.len() == before {
            return json!({ "ok": false, "error": format!("mod {mod_id} not found") });
        }
        let res = redeploy(state, appid, &cfg);
        if res.is_ok() {
            // Only forget the mod once its files are actually gone; a failed
            // redeploy keeps the config so the UI can retry.
            save_config(&state.paths, appid, &cfg);
            let dir = game_mods_dir(&state.paths, appid);
            std::fs::remove_dir_all(dir.join("staging").join(&mod_id)).ok();
        }
        emit_changed(app, appid);
        fold(res.map(|_| json!({ "ok": true })))
    })
    .await
}

#[tauri::command]
pub async fn mods_deploy(app: AppHandle, appid: String) -> Result<Value, String> {
    blocking_game(app, appid, |app, state, appid| {
        let cfg = load_config(&state.paths, appid);
        let res = redeploy(state, appid, &cfg);
        emit_changed(app, appid);
        fold(res.map(|n| json!({ "ok": true, "fileCount": n })))
    })
    .await
}

#[tauri::command]
pub async fn mods_undeploy(app: AppHandle, appid: String) -> Result<Value, String> {
    blocking_game(app, appid, |app, state, appid| {
        let cfg = load_config(&state.paths, appid);
        let dir = game_mods_dir(&state.paths, appid);
        let res: Result<(), String> = (|| {
            let target = deploy_target_dir(state, appid, &cfg)?;
            undeploy_from(&dir, &target)
        })();
        emit_changed(app, appid);
        fold(res.map(|_| json!({ "ok": true })))
    })
    .await
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
            write_file(
                &rel_to_path(&game_dir.join("staging").join(id), rel),
                content,
            );
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
        let a = mk_mod(
            &dir,
            "nexus-1",
            0,
            &[("data/conflict.txt", "from-a"), ("a-only.txt", "a")],
        );
        let b = mk_mod(&dir, "nexus-2", 1, &[("data/conflict.txt", "from-b")]);
        let cfg = GameMods {
            mods: vec![a, b],
            ..Default::default()
        };

        let n = deploy_to(&dir, &target, &cfg).unwrap();
        assert_eq!(n, 2);
        assert_eq!(read(&target.join("data/conflict.txt")), "from-b");
        assert_eq!(read(&target.join("a-only.txt")), "a");
        let _journal = load_journal(&dir);
    }

    #[test]
    fn mewgenics_activates_staged_paths_instead_of_copying_mod_files() {
        let tmp = tempdir().unwrap();
        let dir = tmp.path().join("m");
        let target = tmp.path().join("game");
        let a = mk_mod(&dir, "nexus-1", 1, &[("data/a.gon.patch", "a")]);
        let b = mk_mod(&dir, "nexus-2", 0, &[("data/b.gon.merge", "b")]);
        let mut cfg = GameMods {
            mods: vec![a, b],
            ..Default::default()
        };

        deploy_to(&dir, &target, &cfg).unwrap();
        assert!(target.join("data/a.gon.patch").is_file());

        cfg.steam_appid = Some(MEWGENICS_STEAM_APPID);
        assert_eq!(deploy_to(&dir, &target, &cfg).unwrap(), 2);
        assert!(!target.join("data").exists());
        assert!(load_journal(&dir).files.is_empty());
        assert!(dir.join(MEWGENICS_DEPLOY_MARKER).is_file());
        assert_eq!(
            enabled_mewgenics_mod_paths(&dir, &cfg),
            vec![dir.join("staging/nexus-2"), dir.join("staging/nexus-1")]
        );

        undeploy_from(&dir, &target).unwrap();
        assert!(!dir.join(MEWGENICS_DEPLOY_MARKER).exists());
    }

    #[test]
    fn mewgenics_migrates_legacy_split_localization_appends() {
        let tmp = tempdir().unwrap();
        let staged = tmp.path().join("nexus-44");
        write_file(
            &staged.join("Data/text/items.csv.append"),
            "KEY,en\nARMOR_LEATHERHAT_DESC,Part of the Leather Set Bonus",
        );

        assert!(normalize_mewgenics_localization_append(&staged).unwrap());
        assert!(!staged.join("Data/text/items.csv.append").exists());
        assert_eq!(
            read(&staged.join("Data/text/combined.csv.append")),
            "KEY,en\nARMOR_LEATHERHAT_DESC,Part of the Leather Set Bonus"
        );
        assert!(!normalize_mewgenics_localization_append(&staged).unwrap());
    }

    #[test]
    fn mewgenics_selects_the_matching_mod_from_a_mewtator_folder_bundle() {
        let tmp = tempdir().unwrap();
        let dir = tmp.path().join("m");
        let mut bundled = mk_mod(
            &dir,
            "nexus-8",
            0,
            &[
                ("Old Variant/data/ai.gon.patch", "old"),
                ("Current Variant/data/ai.gon.patch", "current"),
                ("Old Variant/description.json", r#"{"version":"0.0.1"}"#),
                ("Current Variant/description.json", r#"{"version":"0.0.2"}"#),
            ],
        );
        bundled.version = "0.0.2".to_string();
        let cfg = GameMods {
            steam_appid: Some(MEWGENICS_STEAM_APPID),
            mods: vec![bundled],
            ..Default::default()
        };

        assert_eq!(
            versioned_archive_root(&dir.join("staging/nexus-8"), "0.0.2"),
            Some(dir.join("staging/nexus-8/Current Variant"))
        );
        assert_eq!(
            enabled_mewgenics_mod_paths(&dir, &cfg),
            vec![dir.join("staging/nexus-8/Current Variant")]
        );
    }

    #[test]
    fn toggle_off_restores_backed_up_original() {
        let tmp = tempdir().unwrap();
        let dir = tmp.path().join("m");
        let target = tmp.path().join("game");
        write_file(&target.join("data/original.txt"), "original");
        let a = mk_mod(&dir, "nexus-1", 0, &[("data/original.txt", "modded")]);
        let mut cfg = GameMods {
            mods: vec![a],
            ..Default::default()
        };

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
        let a = mk_mod(
            &dir,
            "nexus-1",
            0,
            &[("overwritten.txt", "modded"), ("added/new.txt", "new")],
        );
        let cfg = GameMods {
            mods: vec![a],
            ..Default::default()
        };

        deploy_to(&dir, &target, &cfg).unwrap();
        undeploy_from(&dir, &target).unwrap();

        assert_eq!(read(&target.join("keep.txt")), "keep");
        assert_eq!(read(&target.join("overwritten.txt")), "original");
        assert!(
            !target.join("added").exists(),
            "mod-created dirs cleaned up"
        );
        assert!(load_journal(&dir).files.is_empty());
    }

    #[test]
    fn resolve_game_root_descends_into_nested_repack_folder() {
        let tmp = tempdir().unwrap();
        let base = tmp.path().join("GTFO");
        write_file(&base.join("Read Me.txt"), "x");
        write_file(&base.join("Run me!.bat"), "x");
        let game = base.join("GTFO");
        write_file(&game.join("GTFO.exe"), "mz");
        std::fs::create_dir_all(game.join("GTFO_Data")).unwrap();

        assert_eq!(resolve_game_root(&base), game);
    }

    #[test]
    fn resolve_game_root_leaves_flat_install_unchanged() {
        let tmp = tempdir().unwrap();
        let base = tmp.path().join("Game");
        write_file(&base.join("Game.exe"), "mz");
        std::fs::create_dir_all(base.join("Game_Data")).unwrap();

        assert_eq!(resolve_game_root(&base), base);
    }

    #[test]
    fn resolve_game_root_gives_up_when_no_game_dir_found() {
        let tmp = tempdir().unwrap();
        let base = tmp.path().join("empty");
        std::fs::create_dir_all(base.join("docs")).unwrap();
        std::fs::create_dir_all(base.join("extras")).unwrap();

        assert_eq!(resolve_game_root(&base), base);
    }

    #[test]
    fn reorder_changes_conflict_winner() {
        let tmp = tempdir().unwrap();
        let dir = tmp.path().join("m");
        let target = tmp.path().join("game");
        std::fs::create_dir_all(&target).unwrap();
        let a = mk_mod(&dir, "nexus-1", 0, &[("f.txt", "from-a")]);
        let b = mk_mod(&dir, "nexus-2", 1, &[("f.txt", "from-b")]);
        let mut cfg = GameMods {
            mods: vec![a, b],
            ..Default::default()
        };

        deploy_to(&dir, &target, &cfg).unwrap();
        assert_eq!(read(&target.join("f.txt")), "from-b");

        cfg.mods[0].order = 1;
        cfg.mods[1].order = 0;
        deploy_to(&dir, &target, &cfg).unwrap();
        assert_eq!(read(&target.join("f.txt")), "from-a");
    }

    #[test]
    fn deploy_is_idempotent() {
        let tmp = tempdir().unwrap();
        let dir = tmp.path().join("m");
        let target = tmp.path().join("game");
        write_file(&target.join("orig.txt"), "original");
        let a = mk_mod(
            &dir,
            "nexus-1",
            0,
            &[("orig.txt", "modded"), ("extra.txt", "x")],
        );
        let cfg = GameMods {
            mods: vec![a],
            ..Default::default()
        };

        let n1 = deploy_to(&dir, &target, &cfg).unwrap();
        let j1 = std::fs::read(journal_path(&dir)).unwrap();
        let n2 = deploy_to(&dir, &target, &cfg).unwrap();
        let j2 = std::fs::read(journal_path(&dir)).unwrap();

        assert_eq!(n1, n2);
        assert_eq!(j1, j2, "journal byte-identical across redeploys");
        assert_eq!(read(&target.join("orig.txt")), "modded");
        assert_eq!(read(&dir.join("backup/orig.txt")), "original");
    }

    #[test]
    fn join_target_rejects_escapes() {
        let base = Path::new("/base");
        assert!(join_target(base, "../evil").is_err());
        assert!(join_target(base, "sub/../../evil").is_err());
        assert_eq!(join_target(base, "").unwrap(), PathBuf::from("/base"));
        assert_eq!(
            join_target(base, "Data/Mods").unwrap(),
            PathBuf::from("/base/Data/Mods")
        );
        assert_eq!(
            join_target(base, "Data\\Mods").unwrap(),
            PathBuf::from("/base/Data/Mods")
        );
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
            &[
                ("a/b/c/deep.txt", "deep"),
                ("x/y/orig.txt", "modded"),
                ("top.txt", "top"),
            ],
        );
        let cfg = GameMods {
            mods: vec![a],
            ..Default::default()
        };

        deploy_to(&dir, &target, &cfg).unwrap();
        undeploy_from(&dir, &target).unwrap();

        assert!(
            !target.join("a/b").exists(),
            "mod-created nested dirs pruned"
        );
        assert!(!target.join("top.txt").exists());
        assert_eq!(read(&target.join("a/keep.txt")), "keep");
        assert_eq!(read(&target.join("x/y/orig.txt")), "original");
        assert!(
            !dir.join("backup/x").exists(),
            "backup subdirs pruned after restore"
        );
    }

    #[test]
    fn uninstall_of_winner_hands_file_to_survivor_and_restores_the_rest() {
        let tmp = tempdir().unwrap();
        let dir = tmp.path().join("m");
        let target = tmp.path().join("game");
        write_file(&target.join("b-only.txt"), "original");
        let a = mk_mod(&dir, "nexus-1", 0, &[("shared.txt", "from-a")]);
        let b = mk_mod(
            &dir,
            "nexus-2",
            1,
            &[("shared.txt", "from-b"), ("b-only.txt", "modded")],
        );
        let mut cfg = GameMods {
            mods: vec![a, b],
            ..Default::default()
        };

        deploy_to(&dir, &target, &cfg).unwrap();
        assert_eq!(read(&target.join("shared.txt")), "from-b");

        cfg.mods.retain(|m| m.id != "nexus-2");
        let n = deploy_to(&dir, &target, &cfg).unwrap();

        assert_eq!(n, 1);
        assert_eq!(read(&target.join("shared.txt")), "from-a");
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

        let cfg_a = GameMods {
            mods: vec![a.clone()],
            ..Default::default()
        };
        deploy_to(&dir, &target, &cfg_a).unwrap();
        assert_eq!(read(&dir.join("backup/f.txt")), "original");

        let cfg_ab = GameMods {
            mods: vec![a, b],
            ..Default::default()
        };
        deploy_to(&dir, &target, &cfg_ab).unwrap();
        assert_eq!(read(&target.join("f.txt")), "from-b");
        assert_eq!(read(&dir.join("backup/f.txt")), "original");
        assert_eq!(
            load_journal(&dir)
                .files
                .get("f.txt")
                .unwrap()
                .backup
                .as_deref(),
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
        let cfg = GameMods {
            mods: vec![a],
            ..Default::default()
        };

        deploy_to(&dir, &game, &cfg).unwrap();
        assert_eq!(read(&game.join("f.txt")), "modded");

        undeploy_from(&dir, &game).unwrap();
        let new_target = join_target(&game, "Data").unwrap();
        deploy_to(&dir, &new_target, &cfg).unwrap();

        assert_eq!(read(&game.join("f.txt")), "root-original");
        assert_eq!(read(&game.join("Data/f.txt")), "modded");
        assert_eq!(read(&dir.join("backup/f.txt")), "data-original");

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
        let a = mk_mod(
            &dir,
            "nexus-1",
            0,
            &[("conflict.txt", "from-a"), ("a.txt", "a")],
        );
        let mut b = mk_mod(
            &dir,
            "nexus-2",
            1,
            &[("conflict.txt", "from-b"), ("b.txt", "b")],
        );
        b.enabled = false;
        let mut cfg = GameMods {
            mods: vec![a, b],
            ..Default::default()
        };

        let n = deploy_to(&dir, &target, &cfg).unwrap();
        assert_eq!(n, 2);
        assert_eq!(read(&target.join("conflict.txt")), "from-a");
        assert!(!target.join("b.txt").exists());

        cfg.mods[1].enabled = true;
        let n = deploy_to(&dir, &target, &cfg).unwrap();
        assert_eq!(n, 3);
        assert_eq!(read(&target.join("conflict.txt")), "from-b");
        assert_eq!(read(&target.join("b.txt")), "b");
        let j = load_journal(&dir);
        assert_eq!(read(&target.join("a.txt")), "a");
        assert!(j.files.get("a.txt").unwrap().backup.is_none());
    }

    #[test]
    fn staging_drift_missing_files_are_treated_as_removed() {
        let tmp = tempdir().unwrap();
        let dir = tmp.path().join("m");
        let target = tmp.path().join("game");
        write_file(&target.join("drift.txt"), "original");
        let a = mk_mod(
            &dir,
            "nexus-1",
            0,
            &[("drift.txt", "modded"), ("stay.txt", "stay")],
        );
        let cfg = GameMods {
            mods: vec![a],
            ..Default::default()
        };

        deploy_to(&dir, &target, &cfg).unwrap();

        std::fs::remove_file(dir.join("staging/nexus-1/drift.txt")).unwrap();
        let n = deploy_to(&dir, &target, &cfg).unwrap();
        assert_eq!(n, 1);
        assert_eq!(read(&target.join("drift.txt")), "original");
        assert_eq!(read(&target.join("stay.txt")), "stay");
        assert!(!load_journal(&dir).files.contains_key("drift.txt"));

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
        let cfg = GameMods {
            mods: vec![a],
            ..Default::default()
        };

        deploy_to(&dir, &target, &cfg).unwrap();
        std::fs::write(journal_path(&dir), "{ not json !!!").unwrap();

        undeploy_from(&dir, &target).unwrap();
        assert_eq!(read(&target.join("f.txt")), "modded");
        assert_eq!(read(&dir.join("backup/f.txt")), "original");

        deploy_to(&dir, &target, &cfg).unwrap();
        assert_eq!(read(&dir.join("backup/f.txt")), "original");
        assert_eq!(
            load_journal(&dir)
                .files
                .get("f.txt")
                .unwrap()
                .backup
                .as_deref(),
            Some("f.txt")
        );

        undeploy_from(&dir, &target).unwrap();
        assert_eq!(read(&target.join("f.txt")), "original");
    }

    #[test]
    fn wrap_lone_folder_keeps_its_name_under_mods() {
        let tmp = tempdir().unwrap();
        let staged = tmp.path().join("s");
        write_file(&staged.join("CoolMod/mod.xml"), "x");
        wrap_in_mods_folder(&staged, "Cool Mod display").unwrap();
        assert!(staged.join("mods/CoolMod/mod.xml").is_file());
        assert!(!staged.join("CoolMod").exists());
    }

    #[test]
    fn wrap_bare_files_fall_back_to_mod_name() {
        let tmp = tempdir().unwrap();
        let staged = tmp.path().join("s");
        write_file(&staged.join("mod.xml"), "x");
        write_file(&staged.join("files/a.lua"), "y");
        wrap_in_mods_folder(&staged, "My Noita Mod").unwrap();
        let folder = safe_folder_name("My Noita Mod");
        assert!(staged.join("mods").join(&folder).join("mod.xml").is_file());
        assert!(staged
            .join("mods")
            .join(&folder)
            .join("files/a.lua")
            .is_file());
    }

    #[test]
    fn wrap_leaves_existing_mods_tree_untouched() {
        let tmp = tempdir().unwrap();
        let staged = tmp.path().join("s");
        write_file(&staged.join("mods/Existing/mod.xml"), "x");
        wrap_in_mods_folder(&staged, "whatever").unwrap();
        assert!(staged.join("mods/Existing/mod.xml").is_file());
        assert!(!staged.join("mods/mods").exists());
    }

    #[test]
    fn deploy_prefixes_are_applied_per_mod() {
        let tmp = tempdir().unwrap();
        let dir = tmp.path().join("m");
        let target = tmp.path().join("game");
        std::fs::create_dir_all(&target).unwrap();
        let mut data = mk_mod(&dir, "nexus-data", 0, &[("textures/a.dds", "a")]);
        data.deploy_prefix = "Data".to_string();
        let mut melon = mk_mod(&dir, "nexus-melon", 1, &[("plugin.dll", "b")]);
        melon.deploy_prefix = "Mods".to_string();
        let cfg = GameMods {
            mods: vec![data, melon],
            ..Default::default()
        };

        deploy_to(&dir, &target, &cfg).unwrap();

        assert_eq!(read(&target.join("Data/textures/a.dds")), "a");
        assert_eq!(read(&target.join("Mods/plugin.dll")), "b");
        let journal = load_journal(&dir);
        assert!(journal.files.contains_key("Data/textures/a.dds"));
        assert!(journal.files.contains_key("Mods/plugin.dll"));
    }

    #[test]
    fn infers_bepinex_from_archive_tree() {
        let tmp = tempdir().unwrap();
        let target = tmp.path().join("game");
        let staged = tmp.path().join("archive");
        write_file(&staged.join("Release/BepInEx/plugins/example.dll"), "x");

        let plan = infer_deployment_plan(&target, &staged, None);

        assert_eq!(plan.layout, ModLayout::BepInEx);
        assert_eq!(plan.deploy_prefix, "");
        assert_eq!(plan.confidence, "high");
    }

    #[test]
    fn infers_bethesda_data_for_unwrapped_payload() {
        let tmp = tempdir().unwrap();
        let target = tmp.path().join("game");
        let staged = tmp.path().join("archive");
        std::fs::create_dir_all(target.join("Data")).unwrap();
        write_file(&staged.join("textures/armor/example.dds"), "x");
        write_file(&staged.join("Example.esp"), "x");

        let plan = infer_deployment_plan(&target, &staged, Some(489830));

        assert_eq!(plan.layout, ModLayout::Raw);
        assert_eq!(plan.deploy_prefix, "Data");
        assert_eq!(plan.confidence, "high");
    }

    #[test]
    fn keeps_existing_data_wrapper_relative_to_game_root() {
        let tmp = tempdir().unwrap();
        let target = tmp.path().join("game");
        let staged = tmp.path().join("archive");
        std::fs::create_dir_all(target.join("Data")).unwrap();
        write_file(&staged.join("Data/textures/example.dds"), "x");

        let plan = infer_deployment_plan(&target, &staged, Some(489830));

        assert_eq!(plan.layout, ModLayout::Raw);
        assert_eq!(plan.deploy_prefix, "");
    }

    #[test]
    fn infers_melonloader_mods_folder_for_loose_dll() {
        let tmp = tempdir().unwrap();
        let target = tmp.path().join("game");
        let staged = tmp.path().join("archive");
        std::fs::create_dir_all(target.join("MelonLoader")).unwrap();
        write_file(&staged.join("ExampleMod.dll"), "x");

        let plan = infer_deployment_plan(&target, &staged, None);

        assert_eq!(plan.layout, ModLayout::Raw);
        assert_eq!(plan.deploy_prefix, "Mods");
        assert_eq!(plan.confidence, "high");
    }

    #[test]
    fn infers_rimworld_package_ahead_of_unity_dll_heuristic() {
        let tmp = tempdir().unwrap();
        let target = tmp.path().join("game");
        let staged = tmp.path().join("archive");
        std::fs::create_dir_all(target.join("Mods")).unwrap();
        std::fs::create_dir_all(target.join("RimWorldWin64_Data")).unwrap();
        write_file(&target.join("UnityPlayer.dll"), "x");
        write_file(&staged.join("About/About.xml"), "<ModMetaData />");
        write_file(&staged.join("1.6/Assemblies/Example.dll"), "x");

        let plan = infer_deployment_plan(&target, &staged, Some(RIMWORLD_STEAM_APPID));

        assert_eq!(plan.layout, ModLayout::RimWorld);
        assert_eq!(plan.deploy_prefix, "");
        assert_eq!(plan.confidence, "high");
    }

    #[test]
    fn infers_rimworld_package_from_appid_alone() {
        let tmp = tempdir().unwrap();
        let target = tmp.path().join("game");
        let staged = tmp.path().join("archive");
        write_file(&staged.join("About/About.xml"), "<ModMetaData />");

        let plan = infer_deployment_plan(&target, &staged, Some(RIMWORLD_STEAM_APPID));

        assert_eq!(plan.layout, ModLayout::RimWorld);
        assert_eq!(plan.deploy_prefix, "");
    }

    #[test]
    fn rimworld_plan_ignores_unrelated_unity_game_without_appid() {
        let tmp = tempdir().unwrap();
        let target = tmp.path().join("game");
        let staged = tmp.path().join("archive");
        std::fs::create_dir_all(target.join("Mods")).unwrap();
        write_file(&staged.join("About/About.xml"), "<ModMetaData />");

        let plan = infer_deployment_plan(&target, &staged, None);

        assert_ne!(plan.layout, ModLayout::RimWorld);
    }

    #[test]
    fn rimworld_wrapped_tree_keeps_rimworld_plan() {
        let tmp = tempdir().unwrap();
        let target = tmp.path().join("game");
        let staged = tmp.path().join("archive");
        write_file(&staged.join("Mods/Example/About/About.xml"), "<ModMetaData />");

        let plan = infer_deployment_plan(&target, &staged, Some(RIMWORLD_STEAM_APPID));

        assert_eq!(plan.layout, ModLayout::RimWorld);
        assert_eq!(plan.deploy_prefix, "");
    }

    #[test]
    fn rimworld_layout_wraps_content_into_named_mod_folder() {
        let tmp = tempdir().unwrap();
        let staged = tmp.path().join("s");
        write_file(&staged.join("About/About.xml"), "<ModMetaData />");
        write_file(&staged.join("1.6/Assemblies/Example.dll"), "x");
        apply_rimworld_layout(&staged, "Example Mod").unwrap();
        let folder = safe_folder_name("Example Mod");
        assert!(staged
            .join("Mods")
            .join(&folder)
            .join("About/About.xml")
            .is_file());
        assert!(staged
            .join("Mods")
            .join(&folder)
            .join("1.6/Assemblies/Example.dll")
            .is_file());
        assert!(!staged.join("About").exists());
    }

    #[test]
    fn infers_unreal_paks_folder_for_loose_package() {
        let tmp = tempdir().unwrap();
        let target = tmp.path().join("game");
        let staged = tmp.path().join("archive");
        std::fs::create_dir_all(target.join("Project/Content/Paks")).unwrap();
        write_file(&staged.join("ExampleMod.pak"), "x");

        let plan = infer_deployment_plan(&target, &staged, None);

        assert_eq!(plan.layout, ModLayout::Raw);
        assert_eq!(plan.deploy_prefix, "Project/Content/Paks/~mods");
        assert_eq!(plan.confidence, "high");
    }

    #[test]
    fn unknown_archive_falls_back_to_game_root_with_low_confidence() {
        let tmp = tempdir().unwrap();
        let target = tmp.path().join("game");
        let staged = tmp.path().join("archive");
        write_file(&staged.join("unknown.bin"), "x");

        let plan = infer_deployment_plan(&target, &staged, None);

        assert_eq!(plan.layout, ModLayout::Raw);
        assert_eq!(plan.deploy_prefix, "");
        assert_eq!(plan.confidence, "low");
    }

    #[test]
    fn detects_fomod_before_game_specific_layouts() {
        let tmp = tempdir().unwrap();
        let target = tmp.path().join("game");
        let staged = tmp.path().join("archive");
        write_file(&staged.join("Package/fomod/ModuleConfig.xml"), "<config />");
        write_file(&staged.join("Package/Data/example.esp"), "x");

        let plan = infer_deployment_plan(&target, &staged, Some(489830));

        assert_eq!(plan.layout, ModLayout::RequiresInstaller);
        assert_eq!(plan.confidence, "low");
    }

    #[test]
    fn blocking_an_existing_mod_removes_its_deployed_files() {
        let tmp = tempdir().unwrap();
        let dir = tmp.path().join("m");
        let target = tmp.path().join("game");
        write_file(&target.join("file.txt"), "original");
        let installed = mk_mod(&dir, "nexus-1", 0, &[("file.txt", "modded")]);
        let mut cfg = GameMods {
            mods: vec![installed],
            ..Default::default()
        };

        deploy_to(&dir, &target, &cfg).unwrap();
        assert_eq!(read(&target.join("file.txt")), "modded");

        cfg.mods[0].deploy_blocked = true;
        deploy_to(&dir, &target, &cfg).unwrap();
        assert_eq!(read(&target.join("file.txt")), "original");
        assert!(load_journal(&dir).files.is_empty());
    }

    #[test]
    fn deploy_rejects_escaping_persisted_prefix() {
        let tmp = tempdir().unwrap();
        let dir = tmp.path().join("m");
        let target = tmp.path().join("game");
        let mut installed = mk_mod(&dir, "nexus-1", 0, &[("file.txt", "x")]);
        installed.deploy_prefix = "../outside".to_string();
        let cfg = GameMods {
            mods: vec![installed],
            ..Default::default()
        };

        assert!(deploy_to(&dir, &target, &cfg).is_err());
        assert!(!tmp.path().join("outside/file.txt").exists());
    }
}
