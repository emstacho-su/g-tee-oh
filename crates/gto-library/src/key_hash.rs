//! The node-key index hash (R2.7, A3 section 1): the 64-bit xxhash (xxh64, seed 0) of the
//! key's canonical text. `gto-model` guarantees one text per key, so equal keys hash
//! equally; the writer rejects two different keys of one solution with the same hash.
//!
//! Lane W (writer) owns this file.

use gto_model::NodeKey;
use xxhash_rust::xxh64::xxh64;

/// The xxh64 seed. Fixed, because stored records carry the hash.
pub const KEY_HASH_SEED: u64 = 0;

/// xxh64 of `key.to_string()` with `KEY_HASH_SEED`.
#[must_use]
pub fn key_hash(key: &NodeKey) -> u64 {
    xxh64(key.to_string().as_bytes(), KEY_HASH_SEED)
}
