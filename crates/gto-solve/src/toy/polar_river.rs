//! The polar river toy game, the `polar-river-pot-bet` case of
//! `validation/fixtures/toy-games/akq.json`, which the engine does not model. Owner: the
//! G2 agent (R2.5). Stub until then.
//!
//! Rules (S13 plan section B). Player 1 holds air (combo 0) or the nuts (combo 1), root
//! weight 1 each; player 0 holds one bluff catcher (combo 0); there is no card removal.
//! The tree and the payoffs are the AKQ ones: node 0 is player 1 at the root (check 0,
//! bet 1), node 1 the showdown after a check, node 2 player 0 facing the bet (fold 0,
//! call 1), node 3 the fold and node 4 the showdown after a call. A showdown pays the
//! winner `P / 2` after a check and `P / 2 + B` after a call, the nuts always winning;
//! a fold gives player 1 `P / 2`. Every terminal is zero-sum in net chips. The
//! normalizer is 2 (two joint combo pairs) and the root pot is `P`. At `P = B = 1` the
//! equilibrium is unique: bet the nuts always, bet air half the time, call half the time,
//! so bluffs are one third of the bets.
//!
//! The fixture names the holdings `nuts`, `air` and `bluff_catcher`, the nodes `open` and
//! `facing_bet`, and states three strategy facts, so `names` lists 3 facts and 3
//! holdings.

#![allow(
    unused_variables,
    reason = "stub bodies consume nothing yet; the G2 agent removes this line"
)]

use postflop_engine::game::{ChanceEdge, Game, NodeInfo};

use super::Names;

/// The polar river game. The owner adds the pot, the bet and the root weights.
#[derive(Debug, Clone)]
pub(crate) struct PolarRiver;

/// The polar river game with a dead pot of `pot` chips and one bet of `bet` chips.
pub(crate) fn build(pot: f64, bet: f64) -> PolarRiver {
    todo!("G2: the polar river game with pot {pot} and bet {bet}")
}

/// The fixture vocabulary mapped onto the layout above.
pub(crate) fn names() -> Names {
    todo!("G2: the polar river name map")
}

impl Game for PolarRiver {
    fn root(&self) -> u32 {
        todo!("G2")
    }

    fn num_nodes(&self) -> usize {
        todo!("G2")
    }

    fn node(&self, node: u32) -> NodeInfo {
        todo!("G2")
    }

    fn child(&self, node: u32, action: usize) -> u32 {
        todo!("G2")
    }

    fn combo_count(&self, node: u32, player: u8) -> usize {
        todo!("G2")
    }

    fn root_weights(&self, player: u8) -> &[f32] {
        todo!("G2")
    }

    fn chance_outcome(&self, node: u32, outcome: usize) -> ChanceEdge<'_> {
        todo!("G2: the polar river game has no chance nodes")
    }

    fn terminal_utility(&self, node: u32, hero: u8, opp_reach: &[f32], out: &mut [f32]) {
        todo!("G2")
    }

    fn normalizer(&self) -> f32 {
        todo!("G2")
    }

    fn root_pot(&self) -> f32 {
        todo!("G2")
    }
}
