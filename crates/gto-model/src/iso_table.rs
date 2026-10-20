//! The 1,755 canonical flops and their multiplicity weights (R2.1, A2 section 1). There
//! are 22,100 three-card flops; each maps to one canonical flop, and a canonical flop's
//! weight is how many raw flops map to it, so the weights sum to 22,100. A rainbow unpaired
//! flop weighs 24, a two-tone or paired flop 12, a monotone flop or trips 4 (286 rank
//! patterns with 64 flops each, 156 paired patterns with 24 each, 13 trips with 4 each).
//!
//! The table is built once by enumerating every flop through `iso::canonical_flop` and is
//! sorted ascending by `Flop`, which compares the written cards by card integer: the first
//! entry is `2c2d2h` and the last is `AcAdAh`. The index into this table is the flop's
//! position in the library (A3 section 2 keys builds by flop) and in coverage counts.
//!
//! Owner: the isomorphism agent (files `iso.rs` and `iso_table.rs`).

#![allow(
    unused_variables,
    reason = "stub bodies are todo!() until the isomorphism agent fills them in"
)]

use serde::{Deserialize, Serialize};

use crate::cards::Flop;

/// Canonical flops under suit permutation.
pub const CANONICAL_FLOP_COUNT: usize = 1_755;

/// Three-card flops in a 52-card deck, the sum of the weights.
pub const RAW_FLOP_COUNT: u32 = 22_100;

/// A canonical flop with the number of raw flops in its class.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct CanonicalFlop {
    /// The representative flop.
    pub flop: Flop,
    /// Raw flops that map to it: 4, 12 or 24.
    pub weight: u16,
}

/// The table of canonical flops, sorted ascending by `Flop`. Built on first use and cached
/// for the life of the process.
#[must_use]
pub fn canonical_flops() -> &'static [CanonicalFlop] {
    todo!()
}

/// The table index of a canonical flop, or `None` when the flop is not canonical.
#[must_use]
pub fn canonical_index(flop: Flop) -> Option<u16> {
    todo!()
}

/// The weight of any flop's class: the weight of its canonical flop.
#[must_use]
pub fn flop_weight(flop: Flop) -> u16 {
    todo!()
}

/// The sum of every weight in the table, which is `RAW_FLOP_COUNT`.
#[must_use]
pub fn total_weight() -> u32 {
    todo!()
}
