use std::collections::HashSet;
use std::path::PathBuf;
use std::time::{Duration, Instant};

use parking_lot::Mutex;
use serde_json::{json, Value};
use tauri::State;

use crate::downloads::{now_ms, MANIFEST_NAME};
use crate::state::AppState;

const INSTALLED: &[&str] = &["installed"];
const INSTALLING: &[&str] = &[
    "installing",
    "queued",
    "paused",
    "downloaded",
    "extracting",
    "failed",
    "cancelled",
];

type ScanSnapshot = (Instant, String, Vec<(PathBuf, Value)>);
static SCAN_CACHE: Mutex<Option<ScanSnapshot>> = Mutex::new(None);
static SCAN_GATE: Mutex<()> = Mutex::new(());
const SCAN_TTL: Duration = Duration::from_millis(10_000);

pub(crate) fn scan_roots(state: &AppState) -> Vec<PathBuf> {
    let mut roots = vec![state.download_root()];
    for p in legacy_roots(state) {
        if !roots.contains(&p) {
            roots.push(p);
        }
    }
    roots
}

static LEGACY_ROOTS: Mutex<Option<(Value, Vec<PathBuf>)>> = Mutex::new(None);

fn legacy_roots(state: &AppState) -> Vec<PathBuf> {
    let configured = state.settings.get("legacyLibraryPaths");
    let mut cache = LEGACY_ROOTS.lock();
    if let Some((key, roots)) = cache.as_ref() {
        if *key == configured {
            return roots.clone();
        }
    }
    let mut out: Vec<PathBuf> = Vec::new();
    if let Some(arr) = configured.as_array() {
        for v in arr {
            if let Some(s) = v.as_str().filter(|s| !s.is_empty()) {
                let p = PathBuf::from(s);
                if p.is_dir() && !out.contains(&p) {
                    out.push(p);
                }
            }
        }
    }
    if let Some(home) = dirs::home_dir() {
        let legacy = home.join("UnionCrax.Direct").join("installed");
        if legacy.is_dir() && !out.contains(&legacy) {
            out.push(legacy);
        }
    }
    *cache = Some((configured, out.clone()));
    out
}

fn roots_key(roots: &[PathBuf]) -> String {
    roots
        .iter()
        .map(|p| p.to_string_lossy().to_string())
        .collect::<Vec<_>>()
        .join("\u{0}")
}

fn cached_scan(key: &str) -> Option<Vec<(PathBuf, Value)>> {
    let guard = SCAN_CACHE.lock();
    match guard.as_ref() {
        Some((at, cached_key, data)) if cached_key == key && at.elapsed() < SCAN_TTL => {
            Some(data.clone())
        }
        _ => None,
    }
}

fn load_all_cached(roots: &[PathBuf]) -> Vec<(PathBuf, Value)> {
    let key = roots_key(roots);
    if let Some(data) = cached_scan(&key) {
        return data;
    }
    let _scan = SCAN_GATE.lock();
    if let Some(data) = cached_scan(&key) {
        return data;
    }
    let data = load_all(roots);
    *SCAN_CACHE.lock() = Some((Instant::now(), key, data.clone()));
    data
}

pub(crate) fn invalidate_scan() {
    *SCAN_CACHE.lock() = None;
}

fn load_all(roots: &[PathBuf]) -> Vec<(PathBuf, Value)> {
    let mut out = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    for root in roots {
        let entries = match std::fs::read_dir(root) {
            Ok(e) => e,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let dir = entry.path();
            if !dir.is_dir() {
                continue;
            }
            let manifest_path = dir.join(MANIFEST_NAME);
            if let Ok(text) = std::fs::read_to_string(&manifest_path) {
                if let Ok(mut v) = serde_json::from_str::<Value>(&text) {
                    if let Some(obj) = v.as_object_mut() {
                        if !obj.contains_key("installStatus") && obj.contains_key("appid") {
                            obj.insert("installStatus".into(), json!("installed"));
                        }
                        obj.entry("installPath")
                            .or_insert(json!(dir.to_string_lossy()));
                        obj.insert("folder".into(), json!(dir.to_string_lossy()));
                    }
                    if let Some(id) = v.get("appid").and_then(|a| a.as_str()) {
                        if !seen.insert(id.to_string()) {
                            continue;
                        }
                    }
                    out.push((dir, v));
                }
            }
        }
    }
    out
}

fn status_of(v: &Value) -> String {
    v.get("installStatus")
        .and_then(|s| s.as_str())
        .unwrap_or("")
        .to_string()
}

fn list_by(roots: &[PathBuf], statuses: &[&str]) -> Vec<Value> {
    load_all_cached(roots)
        .into_iter()
        .filter(|(_, v)| statuses.contains(&status_of(v).as_str()))
        .map(|(_, v)| v)
        .collect()
}

fn get_by(roots: &[PathBuf], appid: &str, statuses: &[&str]) -> Option<Value> {
    load_all_cached(roots)
        .into_iter()
        .find(|(_, v)| {
            v.get("appid").and_then(|a| a.as_str()) == Some(appid)
                && statuses.contains(&status_of(v).as_str())
        })
        .map(|(_, v)| v)
}

pub(crate) fn installed_manifests(state: &AppState) -> Vec<Value> {
    list_by(&scan_roots(state), INSTALLED)
}

pub(crate) fn installed_manifest(state: &AppState, appid: &str) -> Option<Value> {
    get_by(&scan_roots(state), appid, INSTALLED)
}

pub(crate) fn find_dir(roots: &[PathBuf], appid: &str) -> Option<PathBuf> {
    load_all_cached(roots)
        .into_iter()
        .find(|(_, v)| v.get("appid").and_then(|a| a.as_str()) == Some(appid))
        .map(|(dir, _)| dir)
}

pub(crate) fn all_appids(roots: &[PathBuf]) -> Vec<String> {
    load_all_cached(roots)
        .into_iter()
        .filter_map(|(_, v)| v.get("appid").and_then(|a| a.as_str()).map(str::to_string))
        .collect()
}

pub(crate) fn game_files_dir(roots: &[PathBuf], appid: &str) -> Option<PathBuf> {
    let (dir, v) = load_all_cached(roots)
        .into_iter()
        .find(|(_, v)| v.get("appid").and_then(|a| a.as_str()) == Some(appid))?;
    if let Some(p) = v.get("installPath").and_then(|p| p.as_str()) {
        let path = PathBuf::from(p);
        if path != dir && path.is_dir() {
            return Some(path);
        }
    }
    Some(dir)
}

pub(crate) fn merge_into_manifest(roots: &[PathBuf], appid: &str, updates: &Value) -> bool {
    if let Some(dir) = find_dir(roots, appid) {
        let manifest_path = dir.join(MANIFEST_NAME);
        let mut manifest = std::fs::read_to_string(&manifest_path)
            .ok()
            .and_then(|t| serde_json::from_str::<Value>(&t).ok())
            .and_then(|v| v.as_object().cloned())
            .unwrap_or_default();
        if let Some(obj) = updates.as_object() {
            for (k, v) in obj {
                if v.is_null() {
                    manifest.remove(k);
                } else if k == "metadata"
                    && manifest.get(k).map(|m| m.is_object()).unwrap_or(false)
                    && v.is_object()
                {
                    let old = manifest.get_mut(k).and_then(|m| m.as_object_mut()).unwrap();
                    for (nk, nv) in v.as_object().unwrap() {
                        if nv.is_null() {
                            old.remove(nk);
                        } else {
                            old.insert(nk.clone(), nv.clone());
                        }
                    }
                } else {
                    manifest.insert(k.clone(), v.clone());
                }
            }
        }
        manifest.insert("updatedAt".into(), json!(now_ms()));
        crate::downloads::write_manifest_atomic(&manifest_path, &Value::Object(manifest));
        invalidate_scan();
        return true;
    }
    false
}

#[tauri::command(async)]
pub fn installed_list(state: State<'_, AppState>) -> Vec<Value> {
    list_by(&scan_roots(&state), INSTALLED)
}

#[tauri::command(async)]
pub fn installed_get(state: State<'_, AppState>, appid: String) -> Value {
    get_by(&scan_roots(&state), &appid, INSTALLED).unwrap_or(Value::Null)
}

#[tauri::command(async)]
pub fn installing_list(state: State<'_, AppState>) -> Vec<Value> {
    list_by(&scan_roots(&state), INSTALLING)
}

#[tauri::command(async)]
pub fn installing_get(state: State<'_, AppState>, appid: String) -> Value {
    get_by(&scan_roots(&state), &appid, INSTALLING).unwrap_or(Value::Null)
}

#[tauri::command(async)]
pub fn installed_save(state: State<'_, AppState>, appid: String, metadata: Value) -> Value {
    let roots = scan_roots(&state);
    if merge_into_manifest(&roots, &appid, &json!({ "metadata": metadata })) {
        return json!({ "ok": true });
    }
    let name = metadata
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or(&appid)
        .to_string();
    let dir = state
        .download_root()
        .join(crate::downloads::safe_folder_name(&name));
    std::fs::create_dir_all(&dir).ok();
    crate::downloads::write_manifest_atomic(
        &dir.join(MANIFEST_NAME),
        &json!({
            "appid": appid,
            "name": name,
            "installStatus": "installing",
            "metadata": metadata,
            "updatedAt": now_ms(),
        }),
    );
    invalidate_scan();
    json!({ "ok": true })
}

#[tauri::command(async)]
pub fn installed_update_metadata(
    state: State<'_, AppState>,
    appid: String,
    updates: Value,
) -> Value {
    json!({ "ok": merge_into_manifest(&scan_roots(&state), &appid, &json!({ "metadata": updates })) })
}

#[tauri::command(async)]
pub fn installing_status_set(
    state: State<'_, AppState>,
    appid: String,
    status: String,
    error: Option<String>,
) -> Value {
    let updates = json!({ "installStatus": status, "installError": error });
    json!({ "ok": merge_into_manifest(&scan_roots(&state), &appid, &updates) })
}

fn remove_dir_unless_installed(roots: &[PathBuf], appid: &str) {
    if let Some(dir) = find_dir(roots, appid) {
        let installed = std::fs::read_to_string(dir.join(MANIFEST_NAME))
            .ok()
            .and_then(|t| serde_json::from_str::<Value>(&t).ok())
            .map(|v| status_of(&v) == "installed")
            .unwrap_or(false);
        if !installed {
            std::fs::remove_dir_all(&dir).ok();
            invalidate_scan();
        }
    }
}

#[tauri::command(async)]
pub fn installed_delete(state: State<'_, AppState>, appid: String) -> Value {
    if let Some(dir) = find_dir(&scan_roots(&state), &appid) {
        std::fs::remove_dir_all(&dir).ok();
        invalidate_scan();
    }
    json!({ "ok": true })
}

#[tauri::command(async)]
pub fn installing_delete(state: State<'_, AppState>, appid: String) -> Value {
    remove_dir_unless_installed(&scan_roots(&state), &appid);
    json!({ "ok": true })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_stub(root: &std::path::Path, folder: &str, manifest: &Value) -> PathBuf {
        let dir = root.join(folder);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join(MANIFEST_NAME),
            serde_json::to_string(manifest).unwrap(),
        )
        .unwrap();
        dir
    }

    fn override_payload(id: u64, store_name: Option<&str>) -> Value {
        let mut metadata =
            json!({ "image": format!("https://cdn.test/{id}/capsule.jpg"), "steamAppId": id });
        if let Some(name) = store_name {
            metadata["name"] = json!(name);
        }
        json!({ "steamAppId": id, "metadata": metadata })
    }

    fn read_manifest(dir: &std::path::Path) -> Value {
        serde_json::from_str(&std::fs::read_to_string(dir.join(MANIFEST_NAME)).unwrap()).unwrap()
    }

    #[test]
    fn game_files_dir_prefers_manifest_install_path() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("library");
        std::fs::create_dir_all(&root).unwrap();
        let real = tmp.path().join("SteamLibrary/common/Portal 2");
        std::fs::create_dir_all(&real).unwrap();

        write_stub(
            &root,
            "portal-2",
            &json!({
                "appid": "steam-620",
                "installStatus": "installed",
                "installPath": real.to_string_lossy(),
            }),
        );
        let normal = write_stub(
            &root,
            "some-game",
            &json!({
                "appid": "42",
                "installStatus": "installed",
            }),
        );
        let stale = write_stub(
            &root,
            "gone-game",
            &json!({
                "appid": "local-dead",
                "installStatus": "installed",
                "installPath": tmp.path().join("nowhere").to_string_lossy(),
            }),
        );

        let roots = vec![root];
        assert_eq!(game_files_dir(&roots, "steam-620"), Some(real));
        assert_eq!(game_files_dir(&roots, "42"), Some(normal));
        assert_eq!(game_files_dir(&roots, "local-dead"), Some(stale));
        assert_eq!(game_files_dir(&roots, "missing"), None);
    }

    #[test]
    fn steam_override_merge_persists_identity_and_preserves_siblings() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = write_stub(
            tmp.path(),
            "card-corner",
            &json!({
                "appid": "local-0011223344556677",
                "name": "CardCorner",
                "installStatus": "installed",
                "installType": "imported-exe",
                "installPath": "/games/Card Corner",
                "exePath": "/games/Card Corner/CardCorner.exe",
                "updatedAt": 1_000,
                "metadata": {
                    "steamAppId": 111,
                    "image": "https://cdn.test/111/capsule.jpg",
                    "name": "Card Corner (wrong)",
                    "genre": "Puzzle",
                },
            }),
        );

        let roots = vec![tmp.path().to_path_buf()];
        let before = now_ms();
        assert!(merge_into_manifest(
            &roots,
            "local-0011223344556677",
            &override_payload(620, Some("Card Corner"))
        ));

        let m = read_manifest(&dir);
        assert_eq!(m["steamAppId"].as_u64(), Some(620));
        assert_eq!(m["metadata"]["steamAppId"].as_u64(), Some(620));
        assert_eq!(m["metadata"]["name"], json!("Card Corner"));
        assert_eq!(
            m["metadata"]["image"],
            json!("https://cdn.test/620/capsule.jpg")
        );
        assert_eq!(m["appid"], json!("local-0011223344556677"));
        assert_eq!(m["name"], json!("CardCorner"));
        assert_eq!(m["installStatus"], json!("installed"));
        assert_eq!(m["installType"], json!("imported-exe"));
        assert_eq!(m["installPath"], json!("/games/Card Corner"));
        assert_eq!(m["exePath"], json!("/games/Card Corner/CardCorner.exe"));
        assert_eq!(m["metadata"]["genre"], json!("Puzzle"));
        assert!(m["updatedAt"].as_i64().unwrap() >= before);
    }

    #[test]
    fn steam_override_unknown_appid_is_rejected_and_writes_nothing() {
        let tmp = tempfile::tempdir().unwrap();
        let a = write_stub(
            tmp.path(),
            "game-a",
            &json!({
                "appid": "steam-620",
                "installStatus": "installed",
                "metadata": { "steamAppId": 620 },
            }),
        );
        let b = write_stub(
            tmp.path(),
            "game-b",
            &json!({
                "appid": "42",
                "installStatus": "installed",
            }),
        );
        let before_a = std::fs::read(a.join(MANIFEST_NAME)).unwrap();
        let before_b = std::fs::read(b.join(MANIFEST_NAME)).unwrap();

        let roots = vec![tmp.path().to_path_buf()];
        assert!(!merge_into_manifest(
            &roots,
            "steam-999",
            &override_payload(999, Some("Nope"))
        ));

        assert_eq!(std::fs::read(a.join(MANIFEST_NAME)).unwrap(), before_a);
        assert_eq!(std::fs::read(b.join(MANIFEST_NAME)).unwrap(), before_b);
    }

    #[test]
    fn steam_override_reapplied_is_idempotent() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = write_stub(
            tmp.path(),
            "portal-2",
            &json!({
                "appid": "steam-1234",
                "name": "Portal 2 Repack",
                "installStatus": "installed",
                "metadata": { "steamAppId": 1234, "name": "Some Other Game" },
            }),
        );

        let roots = vec![tmp.path().to_path_buf()];
        let payload = override_payload(620, Some("Portal 2"));
        assert!(merge_into_manifest(&roots, "steam-1234", &payload));
        let mut first = read_manifest(&dir);
        assert!(merge_into_manifest(&roots, "steam-1234", &payload));
        let mut second = read_manifest(&dir);

        assert_eq!(second["steamAppId"].as_u64(), Some(620));
        assert_eq!(second["metadata"]["steamAppId"].as_u64(), Some(620));
        first.as_object_mut().unwrap().remove("updatedAt");
        second.as_object_mut().unwrap().remove("updatedAt");
        assert_eq!(first, second);
    }

    #[test]
    fn steam_override_without_store_name_keeps_existing_metadata_name() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = write_stub(
            tmp.path(),
            "obscure-game",
            &json!({
                "appid": "local-ffffeeeeddddcccc",
                "installStatus": "installed",
                "metadata": {
                    "steamAppId": 111,
                    "name": "Hand Picked Name",
                    "image": "https://cdn.test/111/capsule.jpg",
                },
            }),
        );

        let roots = vec![tmp.path().to_path_buf()];
        assert!(merge_into_manifest(
            &roots,
            "local-ffffeeeeddddcccc",
            &override_payload(3_489_700, None)
        ));

        let m = read_manifest(&dir);
        assert_eq!(m["steamAppId"].as_u64(), Some(3_489_700));
        assert_eq!(m["metadata"]["steamAppId"].as_u64(), Some(3_489_700));
        assert_eq!(
            m["metadata"]["image"],
            json!("https://cdn.test/3489700/capsule.jpg")
        );
        assert_eq!(m["metadata"]["name"], json!("Hand Picked Name"));
    }

    #[test]
    fn steam_override_creates_metadata_on_entry_without_one() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = write_stub(
            tmp.path(),
            "legacy-game",
            &json!({
                "appid": "777",
                "name": "Legacy Game",
                "installStatus": "installed",
            }),
        );

        let roots = vec![tmp.path().to_path_buf()];
        assert!(merge_into_manifest(
            &roots,
            "777",
            &override_payload(620, Some("Portal 2"))
        ));

        let m = read_manifest(&dir);
        assert_eq!(m["steamAppId"].as_u64(), Some(620));
        assert_eq!(m["metadata"]["steamAppId"].as_u64(), Some(620));
        assert_eq!(m["metadata"]["name"], json!("Portal 2"));
        assert_eq!(m["name"], json!("Legacy Game"));
    }

    #[test]
    fn steam_override_survives_later_metadata_only_update() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = write_stub(
            tmp.path(),
            "kept-game",
            &json!({
                "appid": "steam-4321",
                "installStatus": "installed",
                "metadata": { "steamAppId": 111, "image": "https://cdn.test/111/capsule.jpg" },
            }),
        );

        let roots = vec![tmp.path().to_path_buf()];
        assert!(merge_into_manifest(
            &roots,
            "steam-4321",
            &override_payload(620, Some("Portal 2"))
        ));
        assert!(merge_into_manifest(
            &roots,
            "steam-4321",
            &json!({ "metadata": { "image": "uc-custom://abcd" } })
        ));

        let m = read_manifest(&dir);
        assert_eq!(m["steamAppId"].as_u64(), Some(620));
        assert_eq!(m["metadata"]["steamAppId"].as_u64(), Some(620));
        assert_eq!(m["metadata"]["name"], json!("Portal 2"));
        assert_eq!(m["metadata"]["image"], json!("uc-custom://abcd"));
    }
}

#[cfg(test)]
#[path = "../../.dev/rust/library_tests.rs"]
mod dev_library_tests;
