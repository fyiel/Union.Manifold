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
}
