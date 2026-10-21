//! Seeded synthetic trees (R2.7, feature `synthetic`): solved nodes with valid keys and
//! plausible numbers, for tests, benches and the size estimate (R-19). Nothing here is a
//! real solve; data written from it carries `synthetic: true` (O-57).
//!
//! Mechanism: a `ChaCha8Rng` generator seeded with `SyntheticParams::seed` drives every choice,
//! so one seed always gives the same tree. Keys are built through the `gto-model` builders
//! (`NodeKey::preflop`, `with_flop` and so on), so every key parses and displays back.
//!
//! Lane M (manifest, schema, bench) owns this file.

#![allow(unused_variables, reason = "S14 red skeleton: lane M replaces the todo!() body")]

use crate::record::{HandSpace, SolvedNode};

/// What to generate.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SyntheticParams {
    /// The generator seed.
    pub seed: u64,
    /// How many nodes, each with a distinct key.
    pub nodes: usize,
    /// The hand space of every node.
    pub hand_space: HandSpace,
    /// The share of the hand space each node holds, in `(0, 1]`; 1 gives dense records.
    pub range_fraction: f64,
    /// The share of hands that play one action at frequency 1, in `[0, 1]`.
    pub pure_share: f64,
    /// The inclusive range of actions per node, for example `(2, 4)`.
    pub actions: (u8, u8),
}

impl Default for SyntheticParams {
    /// Seed 0, 64 dense preflop nodes, half the hands pure, 2 to 4 actions.
    fn default() -> Self {
        SyntheticParams {
            seed: 0,
            nodes: 64,
            hand_space: HandSpace::Preflop169,
            range_fraction: 1.0,
            pure_share: 0.5,
            actions: (2, 4),
        }
    }
}

/// A synthetic tree for `p`: `p.nodes` nodes with distinct keys of one configuration and
/// pair, frequencies that sum to one per hand, and one expected value per action.
#[must_use]
pub fn synthetic_tree(p: &SyntheticParams) -> Vec<SolvedNode> {
    todo!("lane M: seeded generator over gto-model builders")
}
