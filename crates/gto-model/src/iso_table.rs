//! The 1,755 canonical flops and their multiplicity weights (R2.1, A2 section 1). There
//! are 22,100 three-card flops; each maps to one canonical flop, and a canonical flop's
//! weight is how many raw flops map to it, so the weights sum to 22,100. A rainbow unpaired
//! flop weighs 24, a two-tone or paired flop 12, a monotone flop or trips 4 (286 rank
//! patterns with 64 flops each, 156 paired patterns with 24 each, 13 trips with 4 each).
//!
//! The table is built once by enumerating every flop through `iso::canonical_flop` and is
//! sorted ascending by `Flop`, which compares the written cards by card integer: the first
//! entry is `2c2d2h` and the last is `AcAdAh`. The index into this table is the flop's
//! position in the library (A3 section 2 keys builds by flop) and in coverage counts; the
//! weight is the flop's natural frequency when the trainer samples boards (02 section 4).
//!
//! Owner: the isomorphism agent (files `iso.rs` and `iso_table.rs`).

use std::collections::BTreeMap;
use std::sync::OnceLock;

use serde::{Deserialize, Serialize};

use crate::cards::{Card, Flop};
use crate::iso::canonical_flop;

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
    static TABLE: OnceLock<Vec<CanonicalFlop>> = OnceLock::new();
    TABLE.get_or_init(build_table)
}

/// Counts the raw flops behind each canonical flop. A `BTreeMap` keyed by `Flop` yields its
/// entries in ascending `Flop` order, which is the table order.
fn build_table() -> Vec<CanonicalFlop> {
    let counts = raw_flops().fold(BTreeMap::<Flop, u16>::new(), |mut counts, flop| {
        let (canonical, _) = canonical_flop(flop);
        *counts.entry(canonical).or_insert(0) += 1;
        counts
    });
    counts.into_iter().map(|(flop, weight)| CanonicalFlop { flop, weight }).collect()
}

/// Every three-card flop once: card indexes `a < b < c` over the 52-card deck.
fn raw_flops() -> impl Iterator<Item = Flop> {
    (0..Card::COUNT).flat_map(|a| {
        (a + 1..Card::COUNT)
            .flat_map(move |b| (b + 1..Card::COUNT).map(move |c| flop_at([a, b, c])))
    })
}

/// The flop at three distinct card indexes below 52. The caller keeps the indexes distinct
/// and in range, so neither constructor can fail.
fn flop_at(indexes: [u8; 3]) -> Flop {
    let cards = indexes.map(|index| Card::from_index(index).expect("a card index below 52"));
    Flop::new(cards).expect("three distinct card indexes are three distinct cards")
}

/// The table entry of a canonical flop. Every canonical flop is the image of at least one
/// raw flop (itself), and the table enumerates every raw flop, so the lookup cannot fail.
fn entry_of(canonical: Flop) -> &'static CanonicalFlop {
    let table = canonical_flops();
    let index = table
        .binary_search_by(|entry| entry.flop.cmp(&canonical))
        .expect("every canonical flop is in the table");
    &table[index]
}

/// The table index of a canonical flop, or `None` when the flop is not canonical. The table
/// holds only canonical flops, so a raw flop is simply absent from it.
#[must_use]
pub fn canonical_index(flop: Flop) -> Option<u16> {
    let table = canonical_flops();
    let index = table.binary_search_by(|entry| entry.flop.cmp(&flop)).ok()?;
    // The table has 1,755 entries, so the index always fits in a u16.
    u16::try_from(index).ok()
}

/// The weight of any flop's class: the weight of its canonical flop.
#[must_use]
pub fn flop_weight(flop: Flop) -> u16 {
    let (canonical, _) = canonical_flop(flop);
    entry_of(canonical).weight
}

/// The sum of every weight in the table, which is `RAW_FLOP_COUNT`.
#[must_use]
pub fn total_weight() -> u32 {
    canonical_flops().iter().map(|entry| u32::from(entry.weight)).sum()
}
