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

pub(crate) fn free_bytes(path: &Path) -> u64 {
    let target = first_existing_ancestor(path);
    fs4::available_space(&target).unwrap_or(0)
}

// Game archives ship already-compressed assets, so the unpacked size runs
// ~1.0-1.3x the archive (Dying Light: The Beast: 71 GB zip -> 85 GB). 1.4x
// covers that with headroom; the old 2x flagged installs that fit comfortably
// (a 71 GB archive demanded ~220 GB free). A source-declared install size
// still wins when it's larger.
pub(crate) fn estimate_extract(download_bytes: u64, declared: u64, margin_gib: u64) -> u64 {
    let base = declared.max(download_bytes.saturating_mul(7) / 5);
    base + (margin_gib * GIB).max(base / 20)
}

pub(crate) fn human(bytes: u64) -> String {
    let units = ["B", "KB", "MB", "GB", "TB"];
    let mut val = bytes as f64;
    let mut i = 0;
    while val >= 1024.0 && i < units.len() - 1 {
        val /= 1024.0;
        i += 1;
    }
    format!("{val:.1} {}", units[i])
}

#[tauri::command(async)]
pub fn storage_precheck(state: State<'_, AppState>, opts: Value) -> Value {
    let target = opts
        .get("targetPath")
        .and_then(|v| v.as_str())
        .map(PathBuf::from)
        .unwrap_or_else(|| state.download_root());
    let download_bytes = opts.get("downloadBytes").and_then(|v| v.as_u64()).unwrap_or(0);
    let declared = opts.get("declaredInstallBytes").and_then(|v| v.as_u64()).unwrap_or(0);
    let margin_gib = state
        .settings
        .get("diskSpaceMarginGiB")
        .as_u64()
        .map(|n| n.clamp(0, 64))
        .unwrap_or(2);
    let extract = estimate_extract(download_bytes, declared, margin_gib);
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

#[tauri::command(async)]
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

#[tauri::command(async)]
pub fn storage_snapshot() -> Value {
    json!({ "ok": true, "reservations": [] })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn estimate_extract_stays_realistic_for_game_archives() {
        // Dying Light: The Beast — 71 GB zip unpacks to 85 GB. The estimate
        // must cover the real unpacked size without demanding multiples of it.
        let archive = 71_000_000_000u64;
        let unpacked = 85_000_000_000u64;
        let est = estimate_extract(archive, 0, 2);
        assert!(est >= unpacked, "estimate {est} must cover the real unpacked size");
        assert!(est <= 120_000_000_000, "estimate {est} demands way too much space");
    }

    #[test]
    fn estimate_extract_prefers_declared_install_size() {
        let est = estimate_extract(10_000_000_000, 40_000_000_000, 2);
        assert!(est >= 40_000_000_000);
    }
}
