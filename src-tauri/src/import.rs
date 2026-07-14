use std::collections::HashSet;
use std::path::{Path, PathBuf};

use serde::Deserialize;
use serde_json::{json, Value};
use tauri::State;

use crate::downloads::{now_ms, safe_folder_name, write_manifest_atomic, MANIFEST_NAME};
use crate::library;
use crate::state::AppState;

fn stable_local_id(path: &str) -> String {
    let mut hash: u64 = 0xcbf29ce484222325;
    for b in path.as_bytes() {
        hash ^= u64::from(*b);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("local-{hash:016x}")
}

fn prettify_stem(path: &Path) -> String {
    let stem = path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    let cleaned: String = stem.chars().map(|c| if c == '_' || c == '.' || c == '-' { ' ' } else { c }).collect();
    let trimmed = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    if trimmed.is_empty() { stem } else { trimmed }
}

fn write_import_manifest(state: &AppState, manifest: &Value) -> Result<(), String> {
    let name = manifest.get("name").and_then(|v| v.as_str()).unwrap_or("game");
    let dir = state.download_root().join(safe_folder_name(name));
    std::fs::create_dir_all(&dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
    write_manifest_atomic(&dir.join(MANIFEST_NAME), manifest);
    library::invalidate_scan();
    Ok(())
}

#[tauri::command]
pub async fn import_exe(state: State<'_, AppState>, exe_path: String, name: Option<String>) -> Result<Value, String> {
    let exe = Path::new(&exe_path);
    if !exe.is_file() {
        return Ok(json!({ "ok": false, "error": "executable not found" }));
    }
    let appid = stable_local_id(&exe_path);
    let roots = library::scan_roots(&state);
    if library::find_dir(&roots, &appid).is_some() {
        return Ok(json!({ "ok": true, "appid": appid, "existed": true }));
    }
    let name = name
        .map(|n| n.trim().to_string())
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| prettify_stem(exe));
    let size = std::fs::metadata(exe).map(|m| m.len()).unwrap_or(0);
    let install_dir = exe.parent().map(|p| p.to_string_lossy().to_string()).unwrap_or_default();
    let steam_app_id = crate::sources::steam::search_app_id(&name).await;
    let mut manifest = json!({
        "appid": appid,
        "name": name,
        "installStatus": "installed",
        "installType": "imported-exe",
        "installPath": install_dir,
        "exePath": exe_path,
        "installedAt": now_ms(),
        "metadata": { "name": name, "sizeBytes": size },
    });
    if let Some(id) = steam_app_id {
        manifest["steamAppId"] = json!(id);
        manifest["metadata"]["image"] = json!(crate::sources::steam::resolve_cover(id).await);
    }
    Ok(match write_import_manifest(&state, &manifest) {
        Ok(()) => json!({ "ok": true, "appid": appid, "name": name, "exePath": exe_path, "steamAppId": steam_app_id }),
        Err(e) => json!({ "ok": false, "error": e }),
    })
}

#[tauri::command]
pub async fn import_set_steam_appid(state: State<'_, AppState>, appid: String, steam_appid: u64) -> Result<Value, String> {
    let cover = crate::sources::steam::resolve_cover(steam_appid).await;
    let mut metadata = json!({ "image": cover, "steamAppId": steam_appid });
    if let Some(name) = crate::sources::steam::app_name(steam_appid).await {
        metadata["name"] = json!(name);
    }
    let roots = library::scan_roots(&state);
    let ok = library::merge_into_manifest(&roots, &appid, &json!({
        "steamAppId": steam_appid,
        "metadata": metadata,
    }));
    Ok(json!({ "ok": ok }))
}

#[tauri::command(async)]
pub fn custom_image_import(state: State<'_, AppState>, path: String) -> Value {
    use sha2::Digest;
    let src = Path::new(&path);
    if !src.is_file() {
        return json!({ "ok": false, "error": "file not found" });
    }
    let bytes = match std::fs::read(src) {
        Ok(b) => b,
        Err(e) => return json!({ "ok": false, "error": format!("read image: {e}") }),
    };
    let ext = src
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .filter(|e| ["png", "jpg", "jpeg", "webp", "gif", "bmp"].contains(&e.as_str()))
        .unwrap_or_else(|| "png".to_string());
    let name = format!("{}.{ext}", &hex::encode(sha2::Sha256::digest(&bytes))[..24]);
    let dir = state.paths.data_dir.join("custom-images");
    if let Err(e) = std::fs::create_dir_all(&dir) {
        return json!({ "ok": false, "error": format!("create dir: {e}") });
    }
    let dest = dir.join(&name);
    if !dest.exists() {
        if let Err(e) = std::fs::write(&dest, &bytes) {
            return json!({ "ok": false, "error": format!("write image: {e}") });
        }
    }
    json!({ "ok": true, "url": format!("uc-custom://{name}") })
}

fn vdf_pairs(text: &str) -> impl Iterator<Item = (String, String)> + '_ {
    text.lines().filter_map(|line| {
        let raw: Vec<&str> = line.trim().split('"').collect();
        if raw.len() >= 4 && raw[0].is_empty() && raw[2].trim().is_empty() {
            Some((raw[1].to_string(), raw[3].to_string()))
        } else {
            None
        }
    })
}

pub(crate) fn steam_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    #[cfg(windows)]
    {
        for env in ["ProgramFiles(x86)", "ProgramFiles"] {
            if let Ok(base) = std::env::var(env) {
                roots.push(PathBuf::from(base).join("Steam"));
            }
        }
    }
    #[cfg(unix)]
    {
        if let Some(home) = dirs::home_dir() {
            roots.push(home.join(".steam/steam"));
            roots.push(home.join(".local/share/Steam"));
            roots.push(home.join(".var/app/com.valvesoftware.Steam/.local/share/Steam"));
        }
    }
    roots.retain(|p| p.join("steamapps").is_dir());
    roots
}

fn steam_library_dirs() -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = Vec::new();
    let mut seen: HashSet<PathBuf> = HashSet::new();
    for root in steam_roots() {
        let steamapps = root.join("steamapps");
        let mut push = |p: PathBuf| {
            if p.is_dir() {
                if let Ok(canon) = p.canonicalize() {
                    if seen.insert(canon) {
                        dirs.push(p);
                    }
                }
            }
        };
        push(steamapps.clone());
        for vdf in [steamapps.join("libraryfolders.vdf"), root.join("config/libraryfolders.vdf")] {
            if let Ok(text) = std::fs::read_to_string(vdf) {
                for (key, value) in vdf_pairs(&text) {
                    if key == "path" {
                        push(PathBuf::from(value.replace("\\\\", "\\")).join("steamapps"));
                    }
                }
            }
        }
    }
    dirs
}

fn is_steam_tool(name: &str) -> bool {
    let n = name.to_lowercase();
    n.starts_with("proton")
        || n.starts_with("steam linux runtime")
        || n.contains("steamworks common")
        || n == "steamvr"
}

#[tauri::command(async)]
pub fn steam_library_scan(state: State<'_, AppState>) -> Value {
    let roots = library::scan_roots(&state);
    let imported: HashSet<String> = library::all_appids(&roots).into_iter().collect();
    let mut apps = Vec::new();
    let mut seen: HashSet<u64> = HashSet::new();
    for lib in steam_library_dirs() {
        let entries = match std::fs::read_dir(&lib) {
            Ok(e) => e,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let fname = entry.file_name().to_string_lossy().to_string();
            if !fname.starts_with("appmanifest_") || !fname.ends_with(".acf") {
                continue;
            }
            let text = match std::fs::read_to_string(&path) {
                Ok(t) => t,
                Err(_) => continue,
            };
            let mut appid: Option<u64> = None;
            let mut name = String::new();
            let mut installdir = String::new();
            let mut size: u64 = 0;
            for (key, value) in vdf_pairs(&text) {
                match key.as_str() {
                    "appid" if appid.is_none() => appid = value.parse().ok(),
                    "name" if name.is_empty() => name = value,
                    "installdir" if installdir.is_empty() => installdir = value,
                    "SizeOnDisk" if size == 0 => size = value.parse().unwrap_or(0),
                    _ => {}
                }
            }
            let Some(id) = appid else { continue };
            if name.is_empty() || is_steam_tool(&name) || !seen.insert(id) {
                continue;
            }
            let install_path = lib.join("common").join(&installdir);
            apps.push(json!({
                "steamAppId": id,
                "name": name,
                "installPath": install_path.to_string_lossy(),
                "sizeBytes": size,
                "imported": imported.contains(&format!("steam-{id}")),
            }));
        }
    }
    apps.sort_by(|a, b| {
        a.get("name").and_then(|v| v.as_str()).unwrap_or("").to_lowercase()
            .cmp(&b.get("name").and_then(|v| v.as_str()).unwrap_or("").to_lowercase())
    });
    json!({ "ok": true, "steamFound": !steam_roots().is_empty(), "found": !apps.is_empty(), "apps": apps })
}

#[derive(Deserialize)]
pub struct SteamImportApp {
    #[serde(rename = "steamAppId")]
    pub steam_app_id: u64,
    pub name: String,
    #[serde(rename = "installPath")]
    pub install_path: Option<String>,
    #[serde(rename = "sizeBytes")]
    pub size_bytes: Option<u64>,
}

#[tauri::command]
pub async fn steam_library_import(state: State<'_, AppState>, apps: Vec<SteamImportApp>) -> Result<Value, String> {
    let roots = library::scan_roots(&state);
    let existing: HashSet<String> = library::all_appids(&roots).into_iter().collect();
    let mut imported = 0u32;
    let mut errors = Vec::new();
    for app in apps {
        let appid = format!("steam-{}", app.steam_app_id);
        if existing.contains(&appid) {
            continue;
        }
        let cover = crate::sources::steam::resolve_cover(app.steam_app_id).await;
        let manifest = json!({
            "appid": appid,
            "name": app.name,
            "installStatus": "installed",
            "installType": "steam",
            "steamAppId": app.steam_app_id,
            "installPath": app.install_path,
            "installedAt": now_ms(),
            "metadata": {
                "name": app.name,
                "sizeBytes": app.size_bytes,
                "image": cover,
            },
        });
        match write_import_manifest(&state, &manifest) {
            Ok(()) => imported += 1,
            Err(e) => errors.push(json!({ "name": app.name, "error": e })),
        }
    }
    Ok(json!({ "ok": errors.is_empty(), "imported": imported, "errors": errors }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vdf_pairs_reads_quoted_lines() {
        let text = "\"AppState\"\n{\n\t\"appid\"\t\t\"620\"\n\t\"name\"\t\t\"Portal 2\"\n\t\"installdir\"\t\t\"Portal 2\"\n\t\"SizeOnDisk\"\t\t\"12805319665\"\n}\n";
        let pairs: Vec<(String, String)> = vdf_pairs(text).collect();
        assert!(pairs.contains(&("appid".into(), "620".into())));
        assert!(pairs.contains(&("name".into(), "Portal 2".into())));
        assert!(pairs.contains(&("SizeOnDisk".into(), "12805319665".into())));
    }

    #[test]
    fn vdf_pairs_reads_library_paths() {
        let text = "\"libraryfolders\"\n{\n\t\"0\"\n\t{\n\t\t\"path\"\t\t\"/home/me/.local/share/Steam\"\n\t}\n\t\"1\"\n\t{\n\t\t\"path\"\t\t\"/mnt/games/SteamLibrary\"\n\t}\n}\n";
        let paths: Vec<String> = vdf_pairs(text).filter(|(k, _)| k == "path").map(|(_, v)| v).collect();
        assert_eq!(paths, vec!["/home/me/.local/share/Steam", "/mnt/games/SteamLibrary"]);
    }

    #[test]
    fn stable_local_id_is_deterministic() {
        let a = stable_local_id("/games/Foo/foo.exe");
        assert_eq!(a, stable_local_id("/games/Foo/foo.exe"));
        assert_ne!(a, stable_local_id("/games/Bar/bar.exe"));
        assert!(a.starts_with("local-"));
    }

    #[test]
    fn prettify_stem_cleans_separators() {
        assert_eq!(prettify_stem(Path::new("/g/My_Cool.Game-v1.exe")), "My Cool Game v1");
    }
}
