use super::*;
use std::sync::atomic::{AtomicUsize, Ordering};

#[tokio::test]
async fn cached_serves_value_within_ttl_without_refetch() {
    let c: Cached<u32> = Cached::new(Duration::from_secs(60));
    assert_eq!(c.get_or(|| async { Some(1) }).await, Some(1));
    assert_eq!(c.get_or(|| async { Some(2) }).await, Some(1));
}

#[tokio::test]
async fn cached_refetches_after_ttl_expiry() {
    let c: Cached<u32> = Cached::new(Duration::from_millis(30));
    assert_eq!(c.get_or(|| async { Some(1) }).await, Some(1));
    tokio::time::sleep(Duration::from_millis(60)).await;
    assert_eq!(c.get_or(|| async { Some(2) }).await, Some(2));
}

#[tokio::test]
async fn cached_serves_stale_value_when_refresh_fails() {
    let c: Cached<u32> = Cached::new(Duration::from_millis(30));
    assert_eq!(c.get_or(|| async { Some(1) }).await, Some(1));
    tokio::time::sleep(Duration::from_millis(60)).await;
    assert_eq!(c.get_or(|| async { None }).await, Some(1));
}

#[tokio::test]
async fn cached_returns_none_when_first_fetch_fails() {
    let c: Cached<u32> = Cached::new(Duration::from_secs(60));
    assert_eq!(c.get_or(|| async { None }).await, None);
}

#[tokio::test]
async fn keyed_cache_isolates_keys() {
    let c: KeyedCache<String> = KeyedCache::new(Duration::from_secs(60));
    let a = c.get_or("alpha", || async { Some("a".to_string()) }).await;
    let b = c.get_or("beta", || async { Some("b".to_string()) }).await;
    assert_eq!(a.as_deref(), Some("a"));
    assert_eq!(b.as_deref(), Some("b"));
    assert_eq!(c.peek("alpha").await.as_deref(), Some("a"));
    assert_eq!(c.peek("beta").await.as_deref(), Some("b"));
}

#[tokio::test]
async fn keyed_cache_peek_misses_unknown_and_expired_keys() {
    let c: KeyedCache<u32> = KeyedCache::new(Duration::from_millis(30));
    assert_eq!(c.peek("nope").await, None);
    c.get_or("k", || async { Some(7) }).await;
    assert_eq!(c.peek("k").await, Some(7));
    tokio::time::sleep(Duration::from_millis(60)).await;
    assert_eq!(c.peek("k").await, None);
}

#[tokio::test]
async fn keyed_cache_clear_forces_refetch() {
    let calls = AtomicUsize::new(0);
    let c: KeyedCache<u32> = KeyedCache::new(Duration::from_secs(60));
    c.get_or("k", || async {
        calls.fetch_add(1, Ordering::SeqCst);
        Some(1)
    })
    .await;
    c.clear();
    let v = c
        .get_or("k", || async {
            calls.fetch_add(1, Ordering::SeqCst);
            Some(2)
        })
        .await;
    assert_eq!(v, Some(2));
    assert_eq!(calls.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn keyed_cache_serves_stale_per_key_when_refresh_fails() {
    let c: KeyedCache<u32> = KeyedCache::new(Duration::from_millis(30));
    c.get_or("k", || async { Some(5) }).await;
    tokio::time::sleep(Duration::from_millis(60)).await;
    assert_eq!(c.get_or("k", || async { None }).await, Some(5));
}

#[tokio::test]
async fn store_if_epoch_discards_writes_after_clear() {
    let c: KeyedCache<u32> = KeyedCache::new(Duration::from_secs(60));
    let epoch = c.epoch();
    c.clear();
    c.store_if_epoch("k", epoch, 9).await;
    assert_eq!(c.peek("k").await, None);
    assert_eq!(c.get_or("k", || async { Some(3) }).await, Some(3));
}

#[tokio::test]
async fn store_if_epoch_keeps_same_epoch_writes() {
    let c: KeyedCache<u32> = KeyedCache::new(Duration::from_secs(60));
    let epoch = c.epoch();
    c.store_if_epoch("k", epoch, 9).await;
    assert_eq!(c.peek("k").await, Some(9));
}

#[tokio::test]
async fn in_flight_fetch_after_clear_does_not_re_seed_the_cache() {
    let c = std::sync::Arc::new(KeyedCache::new(Duration::from_secs(60)));
    let (tx, rx) = tokio::sync::oneshot::channel::<()>();
    let fetch_started = std::sync::Arc::new(tokio::sync::Notify::new());
    let start = fetch_started.clone();
    let fetcher = async move {
        start.notify_one();
        rx.await.ok();
        Some(42)
    };
    let handle = tokio::spawn({
        let cache = c.clone();
        async move { cache.get_or("k", || fetcher).await }
    });
    fetch_started.notified().await;
    c.clear();
    tx.send(()).ok();
    assert_eq!(handle.await.unwrap(), Some(42)); // caller still served
    assert_eq!(c.peek("k").await, None); // but the store was discarded
    assert_eq!(c.get_or("k", || async { Some(7) }).await, Some(7));
}

#[tokio::test]
async fn bounded_cache_evicts_oldest_beyond_limit() {
    let c: KeyedCache<u32> = KeyedCache::with_limit(Duration::from_secs(60), 2);
    c.get_or("a", || async { Some(1) }).await;
    c.get_or("b", || async { Some(2) }).await;
    c.get_or("c", || async { Some(3) }).await;
    assert_eq!(c.peek("a").await, None); // oldest evicted
    assert_eq!(c.peek("b").await, Some(2));
    assert_eq!(c.peek("c").await, Some(3));
}

#[tokio::test]
async fn bounded_cache_evicts_expired_before_fresh() {
    let c: KeyedCache<u32> = KeyedCache::with_limit(Duration::from_millis(30), 2);
    c.get_or("old", || async { Some(1) }).await;
    tokio::time::sleep(Duration::from_millis(60)).await;
    c.get_or("fresh", || async { Some(2) }).await;
    c.get_or("new", || async { Some(3) }).await;
    assert_eq!(c.peek("old").await, None); // expired evicted
    assert_eq!(c.peek("fresh").await, Some(2));
    assert_eq!(c.peek("new").await, Some(3));
}
