//! Leduc hold'em in the engine's vector form, as `OpenSpiel`'s `leduc_poker` defines it
//! by default. Owner: the G3 agent (R2.6, O-30). Stub until then.
//!
//! Rules (S13 plan section B, read off the `OpenSpiel` game object recorded in
//! `validation/fixtures/openspiel/PROVENANCE.md`). Six cards, J, Q, K in two suits; one
//! private card each; both ante 1. Round 1: player 0 acts first, a raise adds 2, at most
//! two raises; fold is legal only facing a raise; check-check or raise-call ends the
//! round. One public card, uniform over the 4 unseen cards. Round 2: player 0 acts first
//! again, a raise adds 4, the same limits. Showdown: a pair with the public card beats
//! everything, otherwise the higher rank wins and equal ranks split. Utilities are net
//! chips: the winner nets the loser's contribution, a folder loses its own.
//!
//! Vector form. 6 combos per player at the round-1 nodes; 5 chance nodes (after cc, crc,
//! crrc, rc and rrc) with 6 outcomes each at weight 0.25, whose `parent_of_child` drops
//! the public card for both players, so 5 combos per player below them; same-card
//! matchups are skipped at the terminals; the normalizer is 30 (6 times 5 compatible
//! root pairs); the root pot is 2. Round-2 nodes are one node per public card, so the
//! information states count 6 round-1 nodes times 6 combos plus 30 round-2 subtrees of
//! 6 nodes times 5 combos, 936 in all, the number `OpenSpiel` reports. The uniform
//! profile's mean gain is 2.373611111 chips, the curve's first row, and both pins hold
//! before any solver runs.
//!
//! The fixture states no strategy facts for Leduc (gate G3 asserts the curve only), so
//! the vocabulary is empty; the owner may add holdings for the report.

#![allow(
    unused_variables,
    reason = "stub bodies consume nothing yet; the G3 agent removes this line"
)]

use postflop_engine::game::{ChanceEdge, Game, NodeInfo};

use super::Names;

/// Leduc hold'em. The owner adds the node tables.
#[derive(Debug, Clone)]
pub(crate) struct Leduc;

/// Leduc hold'em with the default `OpenSpiel` parameters.
pub(crate) fn build() -> Leduc {
    todo!("G3: the Leduc model")
}

/// The fixture vocabulary: empty, see the module docs.
pub(crate) fn names() -> Names {
    Names::default()
}

impl Game for Leduc {
    fn root(&self) -> u32 {
        todo!("G3")
    }

    fn num_nodes(&self) -> usize {
        todo!("G3")
    }

    fn node(&self, node: u32) -> NodeInfo {
        todo!("G3")
    }

    fn child(&self, node: u32, action: usize) -> u32 {
        todo!("G3")
    }

    fn combo_count(&self, node: u32, player: u8) -> usize {
        todo!("G3")
    }

    fn root_weights(&self, player: u8) -> &[f32] {
        todo!("G3")
    }

    fn chance_outcome(&self, node: u32, outcome: usize) -> ChanceEdge<'_> {
        todo!("G3")
    }

    fn terminal_utility(&self, node: u32, hero: u8, opp_reach: &[f32], out: &mut [f32]) {
        todo!("G3")
    }

    fn normalizer(&self) -> f32 {
        todo!("G3")
    }

    fn root_pot(&self) -> f32 {
        todo!("G3")
    }
}
