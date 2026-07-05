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

/// Persist off the async worker: clone the map, then hand the blocking file
/// write to the blocking pool. Callers MUST drop their `std::sync::Mutex`
/// guard before awaiting this so the lock is never held across the fs write.
pub async fn save_async<V: Serialize + Send + 'static>(name: &'static str, map: HashMap<String, V>) {
    let _ = tokio::task::spawn_blocking(move || save(name, &map)).await;
}

/// How long a `WriteBehind` map stays dirty before its flush task fires.
/// Every insert landing inside the window rides along with the one pending
/// flush, so a burst of detail views costs one file write, not one per view.
const FLUSH_DELAY: Duration = Duration::from_secs(2);

/// Every live `WriteBehind` map (registered on first insert) so `flush_all`
/// can reach them at shutdown. parking_lot: const-constructible, no unwrap.
static FLUSHERS: Mutex<Vec<&'static (dyn Flush + Send + Sync)>> = Mutex::new(Vec::new());

trait Flush {
    fn flush_if_dirty(&self);
}

/// Synchronously flush every dirty write-behind map; intended for the
/// process exit hook so inserts younger than `FLUSH_DELAY` survive quit.
/// If it is never called, the loss bound is `FLUSH_DELAY` worth of freshly
/// cached rows — acceptable, every entry is a re-fetchable HTTP cache row.
pub fn flush_all() {
    for f in FLUSHERS.lock().iter() {
        f.flush_if_dirty();
    }
}

/// Write-behind metacache map. Reads and inserts touch only the in-memory
/// map; a single debounced flush task persists the whole file shortly after
/// the last burst of inserts. These files grow to megabytes, so the previous
/// full-file rewrite per insert dominated the cost of opening a detail view.
pub struct WriteBehind<V: 'static> {
    name: &'static str,
    map: Mutex<HashMap<String, V>>,
    /// True from an insert until the next flush snapshot; also guarantees at
    /// most one flush task is pending at a time.
    dirty: AtomicBool,
    /// Serializes tmp-write + rename so overlapping flushes can never
    /// interleave bytes in the shared tmp file. Snapshots are taken under
    /// this lock, so the file always ends up holding the newest snapshot.
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

    /// Insert and mark dirty. At most one debounced flush task is spawned;
    /// the snapshot is taken when it fires, so every insert landing before
    /// then is included in the same file write.
    pub fn insert(&'static self, key: String, value: V) {
        self.map.lock().insert(key, value);
        if !self.registered.swap(true, Ordering::AcqRel) {
            FLUSHERS.lock().push(self);
        }
        if self.dirty.swap(true, Ordering::AcqRel) {
            return; // the pending flush will pick this insert up
        }
        tokio::spawn(async move {
            tokio::time::sleep(FLUSH_DELAY).await;
            let _ = tokio::task::spawn_blocking(move || self.flush_if_dirty()).await;
        });
    }
}

impl<V: Clone + Serialize + DeserializeOwned + Send + Sync> Flush for WriteBehind<V> {
    fn flush_if_dirty(&self) {
        // Clear BEFORE snapshotting: an insert racing with the snapshot
        // re-marks dirty and schedules a fresh flush instead of being lost.
        if !self.dirty.swap(false, Ordering::AcqRel) {
            return;
        }
        let _io = self.io.lock();
        let snapshot = self.map.lock().clone();
        save(self.name, &snapshot);
    }
}
