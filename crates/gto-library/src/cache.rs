//! `ByteLru`: a least recently used (LRU) cache bounded by bytes, not entries (R2.7, A3
//! section 5). It wraps an unbounded `lru::LruCache` and keeps a running total of the value
//! lengths; an insert evicts from the least recently used end until the total fits the cap.
//! A value larger than the whole cap is served to the caller but never cached, so the total
//! never exceeds `QUERY_CACHE_BYTES`.
//!
//! Lane R (reader) owns this file.

use std::hash::Hash;
use std::sync::Arc;

use lru::LruCache;

/// Decoded frames keyed by `K`, bounded by `cap_bytes` of value length.
pub struct ByteLru<K> {
    entries: LruCache<K, Arc<[u8]>>,
    cap_bytes: u64,
    used_bytes: u64,
}

/// A value's length in bytes; a length past `u64` saturates, which no cap admits.
fn byte_len(v: &[u8]) -> u64 {
    u64::try_from(v.len()).unwrap_or(u64::MAX)
}

impl<K: Hash + Eq> ByteLru<K> {
    /// An empty cache holding at most `cap_bytes` of values.
    #[must_use]
    pub fn new(cap_bytes: u64) -> Self {
        ByteLru { entries: LruCache::unbounded(), cap_bytes, used_bytes: 0 }
    }

    /// The value for `k`, marking it most recently used.
    pub fn get(&mut self, k: &K) -> Option<Arc<[u8]>> {
        self.entries.get(k).cloned()
    }

    /// Caches `v` under `k`, evicting least recently used entries until it fits; a value
    /// larger than the cap is not cached. A value already under `k` is dropped first.
    pub fn insert(&mut self, k: K, v: Arc<[u8]>) {
        if let Some(old) = self.entries.pop(&k) {
            self.used_bytes -= byte_len(&old);
        }
        let len = byte_len(&v);
        if len > self.cap_bytes {
            return;
        }
        while self.used_bytes + len > self.cap_bytes {
            match self.entries.pop_lru() {
                Some((_, evicted)) => self.used_bytes -= byte_len(&evicted),
                None => break,
            }
        }
        self.used_bytes += len;
        self.entries.put(k, v);
    }

    /// The total length of the cached values.
    #[must_use]
    pub fn used_bytes(&self) -> u64 {
        self.used_bytes
    }

    /// The cap in bytes.
    #[must_use]
    pub fn cap_bytes(&self) -> u64 {
        self.cap_bytes
    }

    /// How many entries are cached.
    #[must_use]
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    /// True when nothing is cached.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
}
