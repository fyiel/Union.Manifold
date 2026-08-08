use std::path::PathBuf;
use std::sync::{Arc, OnceLock};

use parking_lot::Mutex;
use serde_json::{json, Map, Value};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::error::Result;
use crate::state::AppState;

static SETTINGS_GLOBAL: OnceLock<Arc<SettingsStore>> = OnceLock::new();

pub fn init(store: Arc<SettingsStore>) {
    SETTINGS_GLOBAL.set(store).ok();
}

pub fn hide_torrent_sources() -> bool {
    SETTINGS_GLOBAL
        .get()
        .map(|s| s.get("hideTorrentSources").as_bool().unwrap_or(false))
        .unwrap_or(false)
}

/// Dedicated toggle for Online-Fix repair fetching. Online-Fix is a
/// torrent-only source excluded from the regular source lists, so its
/// availability is tracked by its own setting rather than `disabledSources`.
/// When unset, it falls back to the legacy disabledSources entry so existing
/// users keep their previous choice.
/// Whether the legacy `disabledSources` list held an "onlinefix" entry.
/// The startup migration performs the same check so the two stay in
/// lockstep; keep them identical when touching either.
fn legacy_onlinefix_disabled(store: &SettingsStore) -> bool {
    store
        .get("disabledSources")
        .as_array()
        .map(|a| a.iter().any(|v| v.as_str() == Some("onlinefix")))
        .unwrap_or(false)
}

pub fn onlinefix_enabled() -> bool {
    SETTINGS_GLOBAL
        .get()
        .map(|s| onlinefix_enabled_in(s))
        .unwrap_or(false)
}

fn onlinefix_enabled_in(store: &SettingsStore) -> bool {
    match store.get("onlineFixEnabled") {
        Value::Bool(b) => b,
        // Unset means the startup migration has not run yet (or a fresh
        // profile): fall back to the legacy disabledSources entry.
        Value::Null => !legacy_onlinefix_disabled(store),
        // Any other type is garbage from a generic setting write; the
        // repair feature is gated, so default to disabled rather than
        // accidentally re-enabling it.
        _ => false,
    }
}

pub struct SettingsStore {
    path: PathBuf,
    inner: Mutex<Map<String, Value>>,
}

impl SettingsStore {
    pub fn load(path: PathBuf) -> Self {
        let inner = std::fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str::<Value>(&s).ok())
            .and_then(|v| v.as_object().cloned())
            .unwrap_or_default();
        Self {
            path,
            inner: Mutex::new(inner),
        }
    }

    fn persist(&self, map: &Map<String, Value>) {
        if let Ok(text) = serde_json::to_string_pretty(map) {
            let tmp = self.path.with_extension("json.tmp");
            if std::fs::write(&tmp, text).is_ok() {
                std::fs::rename(&tmp, &self.path).ok();
            }
        }
    }

    pub fn get(&self, key: &str) -> Value {
        self.inner.lock().get(key).cloned().unwrap_or(Value::Null)
    }

    pub fn set(&self, key: &str, value: Value) {
        let mut map = self.inner.lock();
        if value.is_null() {
            map.remove(key);
        } else {
            map.insert(key.to_string(), value);
        }
        self.persist(&map);
    }

    pub fn merge_library_game_meta(
        &self,
        appid: &str,
        patch: Map<String, Value>,
        play_time_delta_ms: u64,
    ) -> Value {
        let mut settings = self.inner.lock();
        let metadata = settings
            .entry("libraryGameMeta".to_string())
            .or_insert_with(|| json!({}));
        if !metadata.is_object() {
            *metadata = json!({});
        }
        let metadata = metadata.as_object_mut().expect("object assigned above");
        let entry = metadata
            .entry(appid.to_string())
            .or_insert_with(|| json!({}));
        if !entry.is_object() {
            *entry = json!({});
        }
        let entry = entry.as_object_mut().expect("object assigned above");
        for (key, value) in patch {
            if value.is_null() {
                entry.remove(&key);
            } else {
                entry.insert(key, value);
            }
        }
        if play_time_delta_ms > 0 {
            let total = entry
                .get("playTimeMs")
                .and_then(Value::as_u64)
                .unwrap_or(0)
                .saturating_add(play_time_delta_ms);
            entry.insert("playTimeMs".to_string(), json!(total));
        }
        let merged = Value::Object(entry.clone());
        self.persist(&settings);
        merged
    }

    pub fn get_string(&self, key: &str) -> Option<String> {
        self.get(key).as_str().map(|s| s.to_string())
    }
}

#[tauri::command(async)]
pub fn setting_get(state: State<'_, AppState>, key: String) -> Value {
    state.settings.get(&key)
}

#[tauri::command(async)]
pub fn setting_set(app: AppHandle, state: State<'_, AppState>, key: String, value: Value) -> Value {
    state.settings.set(&key, value.clone());
    if key == "downloadBandwidthLimitKBps" {
        let aria2 = state.downloads.aria2();
        let kbps = value.as_u64().unwrap_or(0);
        tauri::async_runtime::spawn(async move { aria2.set_bandwidth_limit(kbps).await });
    }
    if key == "proxyUrl" {
        let url = value.as_str().map(|s| s.to_string());
        crate::http::set_proxy(url.clone());
        let aria2 = state.downloads.aria2();
        tauri::async_runtime::spawn(async move { aria2.set_proxy(url).await });
    }
    if key == "slipgateUrl" || key == "slipgateKey" {
        // Slipgate identity changed: drop the cached Online-Fix readiness and
        // re-probe against the new endpoint, then let the frontend re-list.
        crate::sources::adapters::onlinefix::invalidate();
        let probe_app = app.clone();
        tauri::async_runtime::spawn(async move {
            crate::sources::adapters::onlinefix::refresh().await;
            probe_app.emit("uc:sources-updated", json!({})).ok();
        });
    }
    app.emit("uc:setting-changed", json!({ "key": key, "value": value }))
        .ok();
    json!({ "ok": true })
}

pub(crate) fn merge_library_game_meta(
    app: &AppHandle,
    appid: &str,
    patch: Map<String, Value>,
    play_time_delta_ms: u64,
) -> Value {
    let state = app.state::<AppState>();
    let entry = state
        .settings
        .merge_library_game_meta(appid, patch, play_time_delta_ms);
    let value = state.settings.get("libraryGameMeta");
    app.emit(
        "uc:setting-changed",
        json!({ "key": "libraryGameMeta", "value": value, "appid": appid, "entry": entry }),
    )
    .ok();
    entry
}

#[tauri::command(async)]
pub fn setting_merge_library_game_meta(
    app: AppHandle,
    appid: String,
    patch: Map<String, Value>,
    play_time_delta_ms: Option<u64>,
) -> Value {
    let entry = merge_library_game_meta(&app, &appid, patch, play_time_delta_ms.unwrap_or(0));
    json!({ "ok": true, "entry": entry })
}

#[tauri::command(async)]
pub fn setting_clear_all(state: State<'_, AppState>) -> Result<Value> {
    let mut map = state.settings.inner.lock();
    map.clear();
    state.settings.persist(&map);
    Ok(json!({ "ok": true }))
}

#[cfg(test)]
#[path = "../../.dev/rust/settings_tests.rs"]
mod dev_settings_tests;
