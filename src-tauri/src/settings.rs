use std::path::PathBuf;

use parking_lot::Mutex;
use serde_json::{json, Map, Value};
use tauri::{AppHandle, Emitter, State};

use crate::error::Result;
use crate::state::AppState;

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
        self.inner
            .lock()
            .get(key)
            .cloned()
            .unwrap_or(Value::Null)
    }

    pub fn set(&self, key: &str, value: Value) {
        let snapshot = {
            let mut map = self.inner.lock();
            if value.is_null() {
                map.remove(key);
            } else {
                map.insert(key.to_string(), value);
            }
            map.clone()
        };
        self.persist(&snapshot);
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
    app.emit("uc:setting-changed", json!({ "key": key, "value": value }))
        .ok();
    json!({ "ok": true })
}

#[tauri::command(async)]
pub fn setting_clear_all(state: State<'_, AppState>) -> Result<Value> {
    let mut map = state.settings.inner.lock();
    map.clear();
    state.settings.persist(&map);
    Ok(json!({ "ok": true }))
}
