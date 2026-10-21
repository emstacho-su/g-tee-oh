//! `ByteLru`: a least recently used (LRU) cache bounded by bytes, not entries (R2.7, A3
//! section 5). It wraps an unbounded `lru::LruCache` and keeps a running total of the value
//! lengths; an insert evicts from the least recently used end until the total fits the cap.
//! A value larger than the whole cap is served to the caller but never cached, so the total
//! never exceeds `QUERY_CACHE_BYTES`.
//!
//! Lane R (reader) owns this file.

#![allow(
    unused_variables,
    dead_code,
    clippy::needless_pass_by_value,
    reason = "S14 red skeleton: lane R replaces the todo!() bodies"
)]

use std::hash::Hash;
use std::sync::Arc;

use lru::LruCache;

/// Decoded frames keyed by `K`, bounded by `cap_bytes` of value length.
pub struct ByteLru<K> {
    entries: LruCache<K, Arc<[u8]>>,
    cap_bytes: u64,
    used_bytes: u64,
}

impl<K: Hash + Eq> ByteLru<K> {
    /// An empty cache holding at most `cap_bytes` of values.
    #[must_use]
    pub fn new(cap_bytes: u64) -> Self {
        todo!("lane R: unbounded LruCache plus byte accounting")
    }

    /// The value for `k`, marking it most recently used.
    pub fn get(&mut self, k: &K) -> Option<Arc<[u8]>> {
        todo!("lane R: lookup and promote")
    }

    /// Caches `v` under `k`, evicting least recently used entries until it fits; a value
    /// larger than the cap is not cached.
    pub fn insert(&mut self, k: K, v: Arc<[u8]>) {
        todo!("lane R: insert with eviction")
    }

    /// The total length of the cached values.
    #[must_use]
    pub fn used_bytes(&self) -> u64 {
        todo!("lane R: running total")
    }

    /// The cap in bytes.
    #[must_use]
    pub fn cap_bytes(&self) -> u64 {
        todo!("lane R: cap")
    }

    /// How many entries are cached.
    #[must_use]
    pub fn len(&self) -> usize {
        todo!("lane R: entry count")
    }

    /// True when nothing is cached.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        todo!("lane R: empty check")
    }
}
