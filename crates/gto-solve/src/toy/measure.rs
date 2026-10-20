//! Exploitability of a strategy profile from the engine's best-response and
//! expected-value walks, and the copy of a profile into `f64` tables. Owner: the G1
//! agent (R2.4, O-102, O-108). `measure` is a stub until then; `tables` is settled.
//!
//! Mechanism. For each player `i`, `postflop_engine::br::best_response_value(game, i,
//! profile)` is the value of best-responding to the profile and
//! `postflop_engine::br::expected_value(game, i, profile)` the value of following it; the
//! unilateral gain is their difference. That is four walks, all `f32`, widened here.
//! `NashConv` is the sum of the two gains, the figure the engine itself calls
//! exploitability; the mean is half of it, what `OpenSpiel` calls exploitability (O-108);
//! the percentage is `NashConv` over `root_pot`. The engine's `br::exploitability` is
//! never called: its debug assertion that every gain is at least minus 1e-3 trips on
//! Kuhn (O-102), and this measure carries no assertion, so `gto-solve` and `validate`
//! run their tests in the default debug profile.

#![allow(
    unused_variables,
    dead_code,
    reason = "stub bodies consume nothing yet and nothing calls here until dcfr.rs and \
              plain_cfr.rs are filled; the G1 agent removes this line"
)]

use std::collections::BTreeMap;

use postflop_engine::br::StrategyProfile;
use postflop_engine::game::{Game, NodeInfo};

use super::{Measurement, NodeStrategy, Tables};

/// Measure `profile` on `game`: both players' gains, `NashConv`, its mean and its share
/// of the pot, plus the expected value to each player, all in chips.
pub(crate) fn measure<G: Game, P: StrategyProfile>(game: &G, profile: &P) -> Measurement {
    todo!("G1: four best-response and expected-value walks")
}

/// Copy `profile`'s strategy at every decision node of `game` and the root weights into
/// `f64` tables, and count the information states (the acting player's live combos
/// summed over the decision nodes). Both solver files call this once their run ends.
pub(crate) fn tables<G: Game, P: StrategyProfile>(game: &G, profile: &P) -> Tables {
    let strategies: BTreeMap<u32, NodeStrategy> = (0..game.num_nodes())
        .filter_map(|index| {
            let node = u32::try_from(index).expect("the engine addresses nodes by u32");
            match game.node(node) {
                NodeInfo::Decision { player, num_actions } => {
                    Some((node, game.combo_count(node, player), num_actions))
                }
                NodeInfo::Chance { .. } | NodeInfo::Terminal => None,
            }
        })
        .map(|(node, combos, num_actions)| {
            let mut probabilities = vec![0.0f32; num_actions * combos];
            profile.strategy_into(node, &mut probabilities);
            (node, NodeStrategy { combos, probabilities: widen(&probabilities) })
        })
        .collect();
    let information_states = strategies.values().map(|strategy| strategy.combos as u64).sum();
    let root_weights = [widen(game.root_weights(0)), widen(game.root_weights(1))];
    Tables { strategies, root_weights, information_states }
}

/// `f32` engine figures to `f64`, the adapter boundary.
pub(crate) fn widen(values: &[f32]) -> Vec<f64> {
    values.iter().copied().map(f64::from).collect()
}
