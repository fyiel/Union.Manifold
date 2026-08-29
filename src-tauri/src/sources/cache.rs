use std::collections::HashMap;
use std::future::Future;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use tokio::sync::Mutex;

pub struct Cached<T: Clone> {
    ttl: Duration,
    cell: Mutex<Option<(Instant, T)>>,
}

impl<T: Clone> Cached<T> {
    pub fn new(ttl: Duration) -> Self {
        Cached {
            ttl,
            cell: Mutex::new(None),
        }
    }

    pub async fn get_or<F, Fut>(&self, fetcher: F) -> Option<T>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = Option<T>>,
    {
        let mut guard = self.cell.lock().await;
        if let Some((at, val)) = guard.as_ref() {
            if at.elapsed() < self.ttl {
                return Some(val.clone());
            }
        }
        match fetcher().await {
            Some(fresh) => {
                *guard = Some((Instant::now(), fresh.clone()));
                Some(fresh)
            }
            None => guard.as_ref().map(|(_, v)| v.clone()),
        }
    }
}

/// A cached cell: (stored_at, cache epoch at store time, value). The epoch tag
/// lets reads reject values written before a clear()/refresh even when the map
/// entry itself survived (the streaming path stores into a cell fetched before
/// its fetch loop ran).
type CacheCell<T> = (Instant, u64, T);
type KeyedCells<T> = parking_lot::Mutex<HashMap<String, Arc<Mutex<Option<CacheCell<T>>>>>>;
type KeyedCellsGuard<'a, T> =
    parking_lot::MutexGuard<'a, HashMap<String, Arc<Mutex<Option<CacheCell<T>>>>>>;

pub struct KeyedCache<T: Clone> {
    ttl: Duration,
    max_entries: Option<usize>,
    epoch: AtomicU64,
    cells: KeyedCells<T>,
}

impl<T: Clone> KeyedCache<T> {
    pub fn new(ttl: Duration) -> Self {
        KeyedCache {
            ttl,
            max_entries: None,
            epoch: AtomicU64::new(0),
            cells: parking_lot::Mutex::new(HashMap::new()),
        }
    }

    /// A cache that evicts down to `max_entries` on insert (expired entries
    /// first, then oldest stored time; in-flight cells are exempt because their
    /// mutex cannot be acquired). The pools use this so distinct filter combos
    /// cannot pin unbounded memory.
    pub fn with_limit(ttl: Duration, max_entries: usize) -> Self {
        KeyedCache {
            ttl,
            max_entries: Some(max_entries),
            epoch: AtomicU64::new(0),
            cells: parking_lot::Mutex::new(HashMap::new()),
        }
    }

    /// The current cache epoch; callers that fetch outside get_or (the
    /// streaming query path) capture this before fetching and hand it to
    /// store_if_epoch so a concurrent clear() cannot re-seed the cache with
    /// pre-refresh data.
    pub fn epoch(&self) -> u64 {
        self.epoch.load(Ordering::Relaxed)
    }

    fn evict(&self, map: &mut KeyedCellsGuard<'_, T>, max: usize) {
        if map.len() <= max {
            return;
        }
        let ttl = self.ttl;
        let mut candidates: Vec<(String, Instant)> = map
            .iter()
            .filter_map(|(key, cell)| match cell.try_lock() {
                Ok(guard) => Some((
                    key.clone(),
                    guard.as_ref().map(|(at, _, _)| *at).unwrap_or_else(Instant::now),
                )),
                Err(_) => None, // in-flight fetch: exempt
            })
            .collect();
        // Expired first, then oldest stored time.
        candidates.sort_by(|a, b| {
            let ae = a.1.elapsed() >= ttl;
            let be = b.1.elapsed() >= ttl;
            be.cmp(&ae).then_with(|| a.1.cmp(&b.1))
        });
        for (key, _) in candidates {
            if map.len() <= max {
                break;
            }
            map.remove(&key);
        }
    }

    pub async fn get_or<F, Fut>(&self, key: &str, fetcher: F) -> Option<T>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = Option<T>>,
    {
        let epoch = self.epoch();
        let cell = {
            let mut map = self.cells.lock();
            if !map.contains_key(key) {
                if let Some(max) = self.max_entries {
                    self.evict(&mut map, max.saturating_sub(1));
                } else {
                    let ttl = self.ttl;
                    map.retain(|_, c| match c.try_lock() {
                        Ok(g) => g.as_ref().map(|(at, _, _)| at.elapsed() < ttl).unwrap_or(true),
                        Err(_) => true,
                    });
                }
            }
            map.entry(key.to_string())
                .or_insert_with(|| Arc::new(Mutex::new(None)))
                .clone()
        };
        let mut guard = cell.lock().await;
        if let Some((at, cell_epoch, val)) = guard.as_ref() {
            if *cell_epoch == epoch && at.elapsed() < self.ttl {
                return Some(val.clone());
            }
        }
        match fetcher().await {
            Some(fresh) => {
                // A clear() during the fetch discards the write: the value is
                // still returned to this caller, but the next access refetches.
                if self.epoch() == epoch {
                    *guard = Some((Instant::now(), epoch, fresh.clone()));
                }
                Some(fresh)
            }
            None => match guard.as_ref() {
                // Stale-while-revalidate for current-epoch cells: an expired
                // entry is still served when the refetch failed, but a cell
                // written before a clear() is a miss (never serve pre-clear
                // data after refresh).
                Some((_, cell_epoch, v)) if *cell_epoch == epoch => Some(v.clone()),
                _ => None,
            },
        }
    }

    pub async fn peek(&self, key: &str) -> Option<T> {
        let cell = {
            let map = self.cells.lock();
            map.get(key).cloned()
        }?;
        let guard = cell.lock().await;
        let epoch = self.epoch();
        match guard.as_ref() {
            Some((at, cell_epoch, val)) if *cell_epoch == epoch && at.elapsed() < self.ttl => {
                Some(val.clone())
            }
            _ => None,
        }
    }

    /// Store a value only if the cache epoch has not advanced since `epoch`
    /// was captured. The streaming query path fetches its pool before touching
    /// the cache, so a plain get_or would re-seed a cleared cache with
    /// pre-refresh data after sources_refresh.
    pub async fn store_if_epoch(&self, key: &str, epoch: u64, value: T) {
        if self.epoch() != epoch {
            return;
        }
        let cell = {
            let mut map = self.cells.lock();
            if let Some(max) = self.max_entries {
                self.evict(&mut map, max.saturating_sub(1));
            }
            map.entry(key.to_string())
                .or_insert_with(|| Arc::new(Mutex::new(None)))
                .clone()
        };
        let mut guard = cell.lock().await;
        if self.epoch() == epoch {
            *guard = Some((Instant::now(), epoch, value));
        }
    }

    /// Drop every cached entry so the next access refetches, and advance the
    /// epoch so in-flight fetches' stores are discarded. Used by the Sources
    /// "refresh" action to make a forced catalogue update visible immediately.
    pub fn clear(&self) {
        self.epoch.fetch_add(1, Ordering::Relaxed);
        self.cells.lock().clear();
    }
}
