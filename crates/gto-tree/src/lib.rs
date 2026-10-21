//! Betting tree construction: turns a spot description built from `gto-model` types into
//! the game tree a solver walks. It depends on `gto-model` only among the workspace crates
//! (A1 section 2), so a tree can be built, inspected and hashed without linking any solver.
//!
//! Mechanism: a sizing convention spec (`spec`) is read from JavaScript Object Notation
//! (JSON) and every value is moved onto an integer grid at that boundary: big blinds (bb)
//! to centi-big-blinds (cbb), pot fractions to basis points (bp) and multipliers to
//! hundredths. Past parsing, everything is an integer. From the spec the crate builds two
//! things:
//!
//! - `preflop`: the two-seat preflop tree of a position pair with every other seat folded
//!   (O-136), whose flop lines (`PreflopLine`) carry the pot and stack a postflop solve
//!   starts from.
//! - `postflop`: the postflop size tables (`TreeConfig`), their canonical tree hash, and a
//!   card-free betting skeleton (`ActionTree`) that repeats the engine's sizing arithmetic,
//!   so the solver adapter can estimate memory and check the one-size-per-bucket rule of
//!   architecture decision records (ADR) 0020 and 0008 before any engine game exists.
//!
//! Players are numbered as the engine numbers them, out of position (OOP) 0 and in
//! position (IP) 1 (`Player`), the same order the library format stores (O-130). Every
//! fallible function returns the one `TreeError`.
//!
//! Requirement identifiers (R IDs): R2.9 for the trees and the hash, R1.6 for the public
//! sizing test over the seed conventions (O-75).

#![forbid(unsafe_code)]

pub mod error;
pub mod player;
pub mod postflop;
pub mod preflop;
pub mod spec;
mod units;

pub use error::TreeError;
pub use player::Player;
pub use postflop::{
    ActionTree, DEFAULT_ALLIN_THRESHOLD_BP, DEFAULT_RAISE_CAP, DecisionNode, MAX_SKELETON_NODES,
    PlayerSizes, RootState, SizeKind, SizeTable, SkeletonCounts, StreetCounts, StreetSizes,
    TREE_HASH_TAG, TreeConfig, canonical_bytes, tree_hash, tree_hash_hex,
};
pub use preflop::{LineKind, PreflopLine, PreflopNode, PreflopTree};
pub use spec::{IsoRule, PostflopSpec, SPEC_VERSION, SizingConventionSpec, StreetFractions};

/// The crate's package name, used by the workspace link tests (R0.1).
pub const CRATE_NAME: &str = "gto-tree";

#[cfg(test)]
mod tests {
    use super::CRATE_NAME;

    #[test]
    fn r0_1_gto_tree_links() {
        assert_eq!(CRATE_NAME, env!("CARGO_PKG_NAME"));
        // The edge to gto-model is real: this symbol resolves only through that crate.
        assert_eq!(gto_model::CRATE_NAME, "gto-model");
    }
}
