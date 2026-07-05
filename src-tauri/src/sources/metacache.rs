use std::collections::HashMap;
use std::path::PathBuf;

use once_cell::sync::OnceCell;
use serde::{de::DeserializeOwned, Serialize};

static DIR: OnceCell<PathBuf> = OnceCell::new();

pub fn init(dir: PathBuf) {
    std::fs::create_dir_all(&dir).ok();
    let _ = DIR.set(dir);
}

fn path(name: &str) -> Option<PathBuf> {
    DIR.get().map(|d| d.join(name))
}

pub fn load<V: DeserializeOwned>(name: &str) -> HashMap<String, V> {
    path(name)
        .and_then(|p| std::fs::read(&p).ok())
        .and_then(|b| serde_json::from_slice::<HashMap<String, V>>(&b).ok())
        .unwrap_or_default()
}

pub fn save<V: Serialize>(name: &str, map: &HashMap<String, V>) {
    if let Some(p) = path(name) {
        if let Ok(bytes) = serde_json::to_vec(map) {
            let tmp = p.with_extension("tmp");
            if std::fs::write(&tmp, &bytes).is_ok() {
                std::fs::rename(&tmp, &p).ok();
            }
        }
    }
}

/// Persist off the async worker: clone the map, then hand the blocking file
/// write to the blocking pool. Callers MUST drop their `std::sync::Mutex`
/// guard before awaiting this so the lock is never held across the fs write.
pub async fn save_async<V: Serialize + Send + 'static>(name: &'static str, map: HashMap<String, V>) {
    let _ = tokio::task::spawn_blocking(move || save(name, &map)).await;
}
