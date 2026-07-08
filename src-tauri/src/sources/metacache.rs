use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use std::time::Duration;

use parking_lot::Mutex;
use serde::{de::DeserializeOwned, Serialize};

static DIR: OnceLock<PathBuf> = OnceLock::new();

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

pub async fn save_async<V: Serialize + Send + 'static>(name: &'static str, map: HashMap<String, V>) {
    let _ = tokio::task::spawn_blocking(move || save(name, &map)).await;
}

const FLUSH_DELAY: Duration = Duration::from_secs(2);

static FLUSHERS: Mutex<Vec<&'static (dyn Flush + Send + Sync)>> = Mutex::new(Vec::new());

trait Flush {
    fn flush_if_dirty(&self);
}

pub fn flush_all() {
    for f in FLUSHERS.lock().iter() {
        f.flush_if_dirty();
    }
}

pub struct WriteBehind<V: 'static> {
    name: &'static str,
    map: Mutex<HashMap<String, V>>,
    dirty: AtomicBool,
    io: Mutex<()>,
    registered: AtomicBool,
}

impl<V: Clone + Serialize + DeserializeOwned + Send + Sync> WriteBehind<V> {
    pub fn load(name: &'static str) -> Self {
        WriteBehind {
            name,
            map: Mutex::new(load(name)),
            dirty: AtomicBool::new(false),
            io: Mutex::new(()),
            registered: AtomicBool::new(false),
        }
    }

    pub fn get(&self, key: &str) -> Option<V> {
        self.map.lock().get(key).cloned()
    }

    pub fn insert(&'static self, key: String, value: V) {
        self.map.lock().insert(key, value);
        if !self.registered.swap(true, Ordering::AcqRel) {
            FLUSHERS.lock().push(self);
        }
        if self.dirty.swap(true, Ordering::AcqRel) {
            return;
        }
        tokio::spawn(async move {
            tokio::time::sleep(FLUSH_DELAY).await;
            let _ = tokio::task::spawn_blocking(move || self.flush_if_dirty()).await;
        });
    }
}

impl<V: Clone + Serialize + DeserializeOwned + Send + Sync> Flush for WriteBehind<V> {
    fn flush_if_dirty(&self) {
        if !self.dirty.swap(false, Ordering::AcqRel) {
            return;
        }
        let _io = self.io.lock();
        let snapshot = self.map.lock().clone();
        save(self.name, &snapshot);
    }
}
