//! The node-key index hash (R2.7, A3 section 1): the 64-bit xxhash (xxh64, seed 0) of the
//! key's canonical text. `gto-model` guarantees one text per key, so equal keys hash
//! equally; the writer rejects two different keys of one solution with the same hash.
//!
//! Lane W (writer) owns this file.

#![allow(unused_variables, reason = "S14 red skeleton: lane W replaces the todo!() body")]

use gto_model::NodeKey;

/// The xxh64 seed. Fixed, because stored records carry the hash.
pub const KEY_HASH_SEED: u64 = 0;

/// xxh64 of `key.to_string()` with `KEY_HASH_SEED`.
#[must_use]
pub fn key_hash(key: &NodeKey) -> u64 {
    todo!("lane W: xxh64 of the key text")
}
