#![allow(unused_variables, dead_code, reason = "S16 stub: lane C fills this file")]
//! Seeded server-side deals, the reveal of one street at a time and the bounded deal
//! store (R2.13, plan C.4, A5 rule two, O-16, O-152). Lane C fills this file: the deck
//! shuffle from `rng::SplitMix64`, the pure `deal(seed, filter)` with its deal id (the
//! first 16 bytes of the sha256 over the seed and the canonical filter text as a UUID
//! string, through `gto_library::sha256_hex`), the start node through
//! `Library::node`, and the `lru::LruCache` of `DEAL_STORE_CAPACITY` deals behind a mutex
//! that `DealStore` becomes.
//!
//! S16 freezes the shape `AppState` holds: `DealStore::new(capacity)`,
//! `DealStore::capacity` and `DealStore::held`, the gauge `solver_query_deals_held` reads
//! (lane D). The stub holds nothing, so `held` is 0 until lane C lands. Lane C removes the
//! allowance at the top of this file.

use std::num::NonZeroUsize;

/// How many deals the store keeps before evicting the least recently used (O-152); a deal
/// evicted or lost to a restart is recreated by posting the same seed and filter (R3.6).
pub const DEAL_STORE_CAPACITY: usize = 4096;

/// The bounded store of deals made since startup.
#[derive(Debug)]
pub struct DealStore {
    capacity: NonZeroUsize,
}

impl DealStore {
    /// A store holding at most `capacity` deals; a capacity of 0 holds one.
    #[must_use]
    pub fn new(capacity: usize) -> DealStore {
        DealStore { capacity: NonZeroUsize::new(capacity.max(1)).unwrap_or(NonZeroUsize::MIN) }
    }

    /// The most deals the store keeps.
    #[must_use]
    pub fn capacity(&self) -> usize {
        self.capacity.get()
    }

    /// How many deals the store holds now.
    #[must_use]
    pub fn held(&self) -> usize {
        0
    }
}
