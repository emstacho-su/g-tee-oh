//! Core domain types for no-limit hold'em, shared by every g-tee-oh crate: cards, hand
//! indexes, canonical flops, action tokens, node keys, spot-class keys, stakes with their
//! rake models, game configurations and bet buckets.
//!
//! Every other crate speaks in these types, so this crate sits at the bottom of the layering
//! (A1 section 2) and depends on nothing in the workspace: never on gto-solve and never on
//! the vendored engine (architecture decision record (ADR) 0018, library-first). Only serde
//! and thiserror come in from outside, and proptest only for the tests.
//!
//! Units: chips outside the solver's internals are integer centi-big-blinds (cbb), so 2.5
//! big blinds (bb) is `Cbb(250)` (A2 section 2). Keys and sizes therefore stay exact and
//! never drift through floating point.
//!
//! Every value with a text form has one `Display` spelling, and parsing what was displayed
//! gives the value back. Most `FromStr` impls accept only that spelling. Two are lenient
//! about order because their input is a set of cards: `Flop::from_str` takes its three
//! cards in any order and `ComboId::from_str` its two in either order, each sorting into
//! the written form. Node-key text is strict regardless: `StreetSection::parse` in `keys`
//! rejects a flop or a card spelled other than its `Display` form inside a key, so every
//! key has exactly one text and storage can hash the key text (A3 section 1).
//!
//! Modules, each with the requirement identifiers (R IDs) it closes and the vault document
//! it implements:
//!
//! - `types` (A2 section 2): the shared plain data, `Cbb`, `Street`, `Position`,
//!   `PositionPair`, `TableSize`, `GameFormat`, `RakeModel`, `Stake`, `GameConfig` and
//!   `ConfigId`, plus the one `ModelError` every module reports.
//! - `cards` (R2.1; A3 section 1, A2 section 2): `Rank`, `Suit`, `Card` as the integer
//!   `rank * 4 + suit`, `Flop` held in written order and `Board`.
//! - `index` (R2.1; A3 section 1): the 169 hand classes and the 1,326 combos in index order.
//! - `iso` (R2.1; A2 section 1, 06 section 2): `SuitPermutation`, the canonical flop and
//!   board, and the texture families.
//! - `iso_table` (R2.1; A2 section 1): the 1,755 canonical flops with the multiplicity
//!   weights that sum to 22,100.
//! - `tokens` (R2.1; A3 section 1): `ActionToken` and the dotted action line.
//! - `keys` (R2.1; A3 section 1): `NodeKey` with its parse and display round trip.
//! - `spot_class` (R2.1; A6 section 1, 06 section 2): `ActionFamily`, `DepthBand`,
//!   `SpotClass` and `SpotClassKey`, preflop only in v1.
//! - `rake` (R2.2; ADR 0014, O-2, O-66, O-7): the rake taken from a pot and the cap in cbb,
//!   as behaviour on `RakeModel` and `Stake`.
//! - `config` (R2.2; ADR 0014, 01 section 3, O-72, O-112): the stake constructors, the
//!   `ConfigId` grammar and the eleven-row v1 catalog, mirrored from the database seed.
//! - `buckets` (R2.3; ADR 0008, 05 section 6.4, ADR 0020): `Bucket` and the percent-of-pot
//!   edge table.
//! - `grading` (R2.13; ADR 0004, O-22, O-150): the grading floor beside its constants.
//!
//! The two R0.11 vectors, the bucket-edge table and the node-key round trip, live under
//! `tests/r0_11_vectors.rs`; the property tests live under `tests/props.rs`.
//!
//! The crate root re-exports every type and the free functions, so a caller can write
//! `gto_model::NodeKey` or `gto_model::parse_cards`. Separators, catalog numbers and edge
//! tables stay on their modules (`tokens::LINE_SEPARATOR`, `rake::LIVE_CAP_1_3_CENTS`,
//! `buckets::BUCKET_EDGES_PCT`) so the path says where each number comes from.

#![forbid(unsafe_code)]

pub mod buckets;
pub mod cards;
pub mod config;
pub mod grading;
pub mod index;
pub mod iso;
pub mod iso_table;
pub mod keys;
pub mod rake;
pub mod spot_class;
pub mod tokens;
pub mod types;

pub use buckets::{Bucket, bucket_for};
pub use cards::{Board, Card, Flop, Rank, Suit, format_cards, parse_cards};
pub use config::v1_configs;
pub use grading::{Floor, FloorSource, NOISE_FLOOR_PCT_POT, floor_pct_pot};
pub use index::{ComboId, HandClass, HandClassKind};
pub use iso::{SuitPermutation, TextureFamily, canonical_board, canonical_flop, is_canonical_flop};
pub use iso_table::{
    CANONICAL_FLOP_COUNT, CanonicalFlop, RAW_FLOP_COUNT, canonical_flops, canonical_index,
    flop_weight, total_weight,
};
pub use keys::{NodeKey, StreetSection};
pub use spot_class::{ActionFamily, DepthBand, SpotClass, SpotClassKey};
pub use tokens::{ActionToken, format_line, parse_line};
pub use types::{
    Cbb, ConfigId, GameConfig, GameFormat, ModelError, NOISE_FLOOR_PCT_POT_X100,
    PREFLOP_FLOOR_FALLBACK, Position, PositionPair, RakeModel, Stake, Street, TableSize,
};

/// The crate's package name, used by the workspace link tests (R0.1).
pub const CRATE_NAME: &str = "gto-model";

#[cfg(test)]
mod tests {
    use super::CRATE_NAME;

    #[test]
    fn r0_1_gto_model_links() {
        assert_eq!(CRATE_NAME, env!("CARGO_PKG_NAME"));
    }
}
