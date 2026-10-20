//! Core domain types for no-limit hold'em: cards, hand indexes, canonical flops, action
//! tokens, node keys, spot-class keys, stakes with their rake models, game configurations
//! and the bet buckets. Every other crate speaks in these types, so this crate sits at the
//! bottom of the layering (A1 section 2) and depends on nothing in the workspace: never on
//! gto-solve and never on the vendored engine (architecture decision record (ADR) 0018,
//! library-first). Only serde and thiserror come in from outside.
//!
//! Units: chips outside the solver's internals are integer centi-big-blinds (cbb), so 2.5
//! big blinds (bb) is `Cbb(250)` (A2 section 2). Keys and sizes therefore stay exact and
//! never drift through floating point.
//!
//! Module map, with the requirement identifiers (R IDs) each group closes:
//!
//! - `types`: the shared plain data (`Cbb`, `Street`, `Position`, `PositionPair`,
//!   `TableSize`, `GameFormat`, `Stake`, `RakeModel`, `GameConfig`, `ConfigId` and the one
//!   `ModelError`).
//! - `cards` and `index` (R2.1): `Card`, `Rank`, `Suit`, `Flop` and `Board`; the 169-class
//!   and 1,326-combo indexes in the A3 section 1 order.
//! - `iso` and `iso_table` (R2.1): suit permutations, the canonical flop and board, the
//!   1,755 canonical flops with multiplicity weights summing to 22,100, and the texture
//!   family.
//! - `tokens`, `keys` and `spot_class` (R2.1): action tokens, node keys with a parse and
//!   display round trip, and spot-class keys.
//! - `rake`, `config` and `buckets` (R2.2, R2.3): rake models (ADR 0014), configurations
//!   keyed by stake, and the bet-bucket mapping (ADR 0008, ADR 0020).
//!
//! The two R0.11 vectors, the bucket-edge table and the node-key round trip, live under
//! `tests/r0_11_vectors.rs`; the property tests live under `tests/props.rs`.

#![forbid(unsafe_code)]

pub mod buckets;
pub mod cards;
pub mod config;
pub mod index;
pub mod iso;
pub mod iso_table;
pub mod keys;
pub mod rake;
pub mod spot_class;
pub mod tokens;
pub mod types;

pub use buckets::{BUCKET_EDGES_PCT, Bucket, bucket_for};
pub use cards::{Board, Card, Flop, Rank, Suit};
pub use index::{ComboId, HandClass, HandClassKind};
pub use iso::{SuitPermutation, TextureFamily, canonical_board, canonical_flop};
pub use iso_table::{CanonicalFlop, canonical_flops, canonical_index, flop_weight};
pub use keys::{NodeKey, StreetSection};
pub use spot_class::{ActionFamily, DepthBand, SpotClass, SpotClassKey};
pub use tokens::ActionToken;
pub use types::{
    Cbb, ConfigId, GameConfig, GameFormat, ModelError, Position, PositionPair, RakeModel, Stake,
    Street, TableSize,
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
