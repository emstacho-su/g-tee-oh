//! The heap layout of the vendored engine's game and solver, in bytes per item, for the
//! memory estimate (R2.10, O-139). Crate-private.
//!
//! Mechanism: the sizes of the engine's public types come from `std::mem::size_of`, so they
//! follow the engine and the target. Three engine types are private, so their sizes are
//! written down from their fields on a 64-bit target; the allocator test
//! (`r2_10_estimate_bounds_allocator_peak`) fails if they drift. A `Vec` filled by pushes
//! from empty holds room for the next power of two at or above its length, never fewer
//! than four elements (`vec_capacity`), and a hash table holds a power of two buckets with
//! room for seven eighths of them (`hash_table_bytes`); both are how the standard library
//! grows them.

use std::mem::size_of;

use postflop_engine::cards::NUM_CARDS;
use postflop_engine::game::NodeInfo;
use postflop_engine::terminal::{Hand, SortedRanks};
use postflop_engine::tree::{Action, Node};

/// Converts a `size_of` to bytes as a `u64`; a type size always fits.
const fn bytes(size: usize) -> u64 {
    size as u64
}

/// One node of the engine's tree arena (`tree::Node`).
pub(crate) const NODE: u64 = bytes(size_of::<Node>());
/// One action of a decision node's action list (`tree::Action`).
pub(crate) const ACTION: u64 = bytes(size_of::<Action>());
/// The per-card child table a chance node boxes: one `u32` per card.
pub(crate) const CHANCE_CHILDREN: u64 = bytes(size_of::<[u32; NUM_CARDS]>());
/// The cached kind of one node (`game::NodeInfo`).
pub(crate) const NODE_INFO: u64 = bytes(size_of::<NodeInfo>());
/// A `u32` per node: the game's board id and side-table index, the solver's storage offset
/// and region size, and an `f32` scale per node per array in 16-bit storage.
pub(crate) const WORD: u64 = bytes(size_of::<u32>());
/// One hole-card pair in a board's live hand list (`terminal::Hand`).
pub(crate) const HAND: u64 = bytes(size_of::<Hand>());
/// One chance outcome: the card and the child node.
pub(crate) const OUTCOME: u64 = bytes(size_of::<(u8, u32)>());
/// The engine's private `ChanceData`: a `u32` board, a `Vec` of outcomes and an `f32`.
pub(crate) const CHANCE_DATA: u64 = bytes(size_of::<Vec<(u8, u32)>>() + 2 * size_of::<u32>());
/// The engine's private `TermData`: a `u32` board, an `Option<u8>` folder and three
/// `[f64; 2]` payoffs, padded to the alignment of an `f64`.
pub(crate) const TERM_DATA: u64 = bytes(3 * size_of::<[f64; 2]>() + size_of::<u64>());
/// The engine's private `BoardData`: the board cards, two hand lists, two index lists and
/// two optional showdown rankings.
pub(crate) const BOARD_DATA: u64 = bytes(
    size_of::<Vec<u8>>()
        + 2 * size_of::<Vec<Hand>>()
        + 2 * size_of::<Vec<u32>>()
        + 2 * size_of::<Option<SortedRanks>>(),
);
/// The room a board's card list holds once a dealt card is pushed onto a copy of its
/// parent: the standard library's smallest capacity for byte elements.
pub(crate) const BOARD_CARDS: u64 = 8;
/// The engine's private `CardMap`: two `Vec<u32>`, one per player.
pub(crate) const CARD_MAP: u64 = bytes(2 * size_of::<Vec<u32>>());
/// One entry of the engine's chance map table: a board id and a `Vec` of card maps.
pub(crate) const MAP_ENTRY: u64 = bytes(size_of::<(u32, Vec<u64>)>());
/// Cards in the deck, as an array length.
pub(crate) const DECK_CARDS: usize = NUM_CARDS;
/// Cards in the deck, as a count.
pub(crate) const DECK: u64 = bytes(NUM_CARDS);

/// The fewest elements a `Vec` makes room for on its first push.
const MIN_VEC_CAPACITY: u64 = 4;
/// Control bytes a hash table keeps past its buckets, one probe group.
const HASH_GROUP_BYTES: u64 = 16;
/// The fewest buckets a non-empty hash table holds.
const MIN_HASH_BUCKETS: u64 = 4;
/// Buckets below which a hash table may fill all but one bucket.
const SMALL_HASH_BUCKETS: u64 = 8;

/// Elements a `Vec` filled by `len` pushes from empty has room for.
pub(crate) fn vec_capacity(len: u64) -> u64 {
    if len == 0 { 0 } else { len.next_power_of_two().max(MIN_VEC_CAPACITY) }
}

/// Bytes a hash table of `entries` entries of `entry_bytes` holds after inserts from empty:
/// the buckets, one control byte per bucket and one probe group.
pub(crate) fn hash_table_bytes(entries: u64, entry_bytes: u64) -> u64 {
    if entries == 0 {
        return 0;
    }
    let mut buckets = MIN_HASH_BUCKETS;
    while room(buckets) < entries {
        buckets *= 2;
    }
    buckets * (entry_bytes + 1) + HASH_GROUP_BYTES
}

/// Entries a hash table of `buckets` buckets holds before it grows.
fn room(buckets: u64) -> u64 {
    if buckets < SMALL_HASH_BUCKETS { buckets - 1 } else { buckets / 8 * 7 }
}

#[cfg(test)]
mod tests {
    use super::{hash_table_bytes, vec_capacity};

    /// R2.10 (O-139): the growth rules the estimate models.
    #[test]
    fn r2_10_vec_and_hash_growth_rules() {
        assert_eq!(vec_capacity(0), 0);
        assert_eq!(vec_capacity(1), 4);
        assert_eq!(vec_capacity(5), 8);
        assert_eq!(vec_capacity(49), 64);
        assert_eq!(vec_capacity(1_024), 1_024);
        assert_eq!(hash_table_bytes(0, 16), 0);
        assert_eq!(hash_table_bytes(3, 16), 4 * 17 + 16);
        assert_eq!(hash_table_bytes(50, 32), 64 * 33 + 16);
        assert_eq!(hash_table_bytes(56, 32), 64 * 33 + 16);
        assert_eq!(hash_table_bytes(57, 32), 128 * 33 + 16);
    }
}
