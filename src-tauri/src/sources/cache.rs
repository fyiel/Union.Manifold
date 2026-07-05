use std::collections::HashMap;
use std::future::Future;
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

pub struct KeyedCache<T: Clone> {
    ttl: Duration,
    cells: std::sync::Mutex<HashMap<String, Arc<Mutex<Option<(Instant, T)>>>>>,
}

impl<T: Clone> KeyedCache<T> {
    pub fn new(ttl: Duration) -> Self {
        KeyedCache {
            ttl,
            cells: std::sync::Mutex::new(HashMap::new()),
        }
    }

    pub async fn get_or<F, Fut>(&self, key: &str, fetcher: F) -> Option<T>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = Option<T>>,
    {
        let cell = {
            let mut map = self.cells.lock().unwrap();
            if !map.contains_key(key) {
                // Drop expired, idle cells so long type-ahead sessions don't
                // grow the map without bound.
                let ttl = self.ttl;
                map.retain(|_, c| match c.try_lock() {
                    // A locked cell has an in-flight fetch; a None value is a
                    // freshly created (about-to-fetch) cell. Keep both; only drop
                    // a cell whose stored value has actually expired.
                    Ok(g) => g.as_ref().map(|(at, _)| at.elapsed() < ttl).unwrap_or(true),
                    Err(_) => true,
                });
            }
            map.entry(key.to_string())
                .or_insert_with(|| Arc::new(Mutex::new(None)))
                .clone()
        };
        let mut guard = cell.lock().await;
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

    /// Returns the cached value only when present AND unexpired. Unlike
    /// `get_or`, an expired entry yields `None` (never the stale value), so a
    /// caller can force a refresh once the TTL lapses.
    pub async fn peek(&self, key: &str) -> Option<T> {
        let cell = {
            let map = self.cells.lock().unwrap();
            map.get(key).cloned()
        }?;
        let guard = cell.lock().await;
        match guard.as_ref() {
            Some((at, val)) if at.elapsed() < self.ttl => Some(val.clone()),
            _ => None,
        }
    }
}
