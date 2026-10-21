//! The canonical tree hash (R2.9, O-135). A solve records the hash of the configuration its
//! tree was built from, so a stored solution can be matched to its tree on any machine.
//!
//! Mechanism: `canonical_bytes` writes every value of a `TreeConfig` as little-endian
//! integers in one fixed order:
//!
//! 1. The tag `TREE_HASH_TAG` followed by a NUL byte.
//! 2. `allin_threshold_bp` as a u32, then `raise_cap` as a u8.
//! 3. For each player in [out of position (OOP), in position (IP)], each street in [flop,
//!    turn, river] and each kind in [bet, raise, donk]: the number of sizes as a u32, each
//!    size in basis points (bp) as a u32 in ascending order, then the all-in flag as a u8.
//!
//! The bytes hold no floats, no map iteration order and no `usize`, so the Secure Hash
//! Algorithm 256 (SHA-256) digest of them is the same on x86 and arm64.

use std::fmt::Write as _;

use sha2::{Digest, Sha256};

use crate::postflop::config::TreeConfig;

/// Hexadecimal digits in a printed tree hash: two per byte of the 32-byte digest.
const HEX_DIGITS: usize = 64;

/// A capacity that holds the canonical bytes of a small configuration without regrowing.
const CANONICAL_BYTES_HINT: usize = 256;

/// The tag that opens the canonical bytes. A change to the byte layout changes the version
/// at its end.
pub const TREE_HASH_TAG: &str = "g-tee-oh/tree-config/1";

/// The canonical bytes of a configuration, in the layout the module docs give.
#[must_use]
pub fn canonical_bytes(cfg: &TreeConfig) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(CANONICAL_BYTES_HINT);
    bytes.extend_from_slice(TREE_HASH_TAG.as_bytes());
    bytes.push(0);
    bytes.extend_from_slice(&cfg.allin_threshold_bp().to_le_bytes());
    bytes.push(cfg.raise_cap());
    for (_, _, _, table) in cfg.tables() {
        bytes.extend_from_slice(&table.count().to_le_bytes());
        for size_bp in table.sizes_bp() {
            bytes.extend_from_slice(&size_bp.to_le_bytes());
        }
        bytes.push(u8::from(table.allin()));
    }
    bytes
}

/// The SHA-256 digest of `canonical_bytes`.
#[must_use]
pub fn tree_hash(cfg: &TreeConfig) -> [u8; 32] {
    Sha256::digest(canonical_bytes(cfg)).into()
}

/// `tree_hash` as 64 lowercase hexadecimal digits.
#[must_use]
pub fn tree_hash_hex(cfg: &TreeConfig) -> String {
    tree_hash(cfg).iter().fold(String::with_capacity(HEX_DIGITS), |mut text, byte| {
        write!(text, "{byte:02x}").expect("writing to a String cannot fail");
        text
    })
}
