use std::path::{Path, PathBuf};

use serde_json::{json, Value};
use tauri::State;

use crate::state::AppState;

const GIB: u64 = 1024 * 1024 * 1024;

fn first_existing_ancestor(path: &Path) -> PathBuf {
    let mut cur = path.to_path_buf();
    loop {
        if cur.exists() {
            return cur;
        }
        match cur.parent() {
            Some(p) => cur = p.to_path_buf(),
            None => return PathBuf::from("/"),
        }
    }
}

fn free_bytes(path: &Path) -> u64 {
    let target = first_existing_ancestor(path);
    fs4::available_space(&target).unwrap_or(0)
}

fn estimate_extract(download_bytes: u64, declared: u64) -> u64 {
    let base = declared.max(download_bytes.saturating_mul(2));
    base + (2 * GIB).max(base / 20)
}

fn human(bytes: u64) -> String {
    let units = ["B", "KB", "MB", "GB", "TB"];
    let mut val = bytes as f64;
    let mut i = 0;
    while val >= 1024.0 && i < units.len() - 1 {
        val /= 1024.0;
        i += 1;
    }
    format!("{val:.1} {}", units[i])
}

#[tauri::command]
pub fn storage_precheck(state: State<'_, AppState>, opts: Value) -> Value {
    let target = opts
        .get("targetPath")
        .and_then(|v| v.as_str())
        .map(PathBuf::from)
        .unwrap_or_else(|| state.download_root());
    let download_bytes = opts.get("downloadBytes").and_then(|v| v.as_u64()).unwrap_or(0);
    let declared = opts.get("declaredInstallBytes").and_then(|v| v.as_u64()).unwrap_or(0);
    let extract = estimate_extract(download_bytes, declared);
    let required = download_bytes + extract;
    let free = free_bytes(&target);
    let ok = free >= required;
    let shortfall = required.saturating_sub(free);
    json!({
        "ok": ok,
        "requiredBytes": required,
        "freeBytes": free,
        "shortfallBytes": shortfall,
        "downloadBytes": download_bytes,
        "extractBytes": extract,
        "alreadyReservedBytes": 0,
        "availableAfterReservation": free,
        "mountRoot": first_existing_ancestor(&target).to_string_lossy(),
        "humanRequired": human(required),
        "humanFree": human(free),
        "humanShortfall": human(shortfall),
        "humanAvailable": human(free),
    })
}

#[tauri::command]
pub fn storage_summary(state: State<'_, AppState>, target_path: Option<String>) -> Value {
    let target = target_path.map(PathBuf::from).unwrap_or_else(|| state.download_root());
    let free = free_bytes(&target);
    json!({
        "ok": true,
        "mountRoot": first_existing_ancestor(&target).to_string_lossy(),
        "freeBytes": free,
        "reservedBytes": 0,
        "reservedDownloadBytes": 0,
        "reservedExtractBytes": 0,
        "availableBytes": free,
        "humanFree": human(free),
        "humanReserved": human(0),
        "humanAvailable": human(free),
    })
}

#[tauri::command]
pub fn storage_snapshot() -> Value {
    json!({ "ok": true, "reservations": [] })
}
