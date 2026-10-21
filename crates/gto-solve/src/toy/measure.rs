//! Exploitability of a strategy profile from the crate's shared unilateral-gain measure,
//! and the copy of a profile into `f64` tables. Owner: the G1 agent (R2.4, O-102, O-108).
//!
//! Mechanism. For each player `i`, `crate::exploit::unilateral_gain` runs the engine's
//! best-response and expected-value walks, both `f32`, each widened to `f64` before the
//! subtraction so the gain is the exact difference of the two engine figures; the postflop
//! adapter's `best_response` uses the same function (R2.10). `NashConv` is the sum of the
//! two gains, the figure the engine itself calls exploitability; the mean is half of it,
//! what `OpenSpiel` calls exploitability (O-108); the percentage is `NashConv` over
//! `root_pot`. The engine's `br::exploitability` is never called: its debug assertion that
//! every gain is at least minus 1e-3 trips on Kuhn (O-102), and this measure carries no
//! assertion, so `gto-solve` and `validate` run their tests in the default debug profile.

use std::collections::BTreeMap;

use postflop_engine::br::StrategyProfile;
use postflop_engine::game::{Game, NodeInfo};

use super::{Exploitability, Measurement, NodeStrategy, Tables};
use crate::exploit::unilateral_gain;

/// Measure `profile` on `game`: both players' gains, `NashConv`, its mean and its share
/// of the pot, plus the expected value to each player, all in chips.
pub(crate) fn measure<G: Game, P: StrategyProfile>(game: &G, profile: &P) -> Measurement {
    let player_0 = unilateral_gain(game, 0, profile);
    let player_1 = unilateral_gain(game, 1, profile);
    let nash_conv_chips = player_0.gain + player_1.gain;
    let root_pot = f64::from(game.root_pot());
    Measurement {
        exploitability: Exploitability {
            gain_chips: [player_0.gain, player_1.gain],
            nash_conv_chips,
            mean_chips: nash_conv_chips / 2.0,
            pct_of_pot: 100.0 * nash_conv_chips / root_pot,
        },
        value_chips: [player_0.expected, player_1.expected],
    }
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

#[cfg(test)]
mod tests {
    use postflop_engine::br::UniformProfile;
    use postflop_engine::games::kuhn::Kuhn;

    use super::{measure, tables};

    /// R2.4 (O-102, O-108): on Kuhn the uniform profile is exploitable, the sum and the
    /// mean are consistent, the percentage is over the 2-chip pot, the values are
    /// zero-sum, and the tables count 12 information states with 3 root combos a side.
    #[test]
    fn r2_4_uniform_kuhn_profile_measures_consistently() {
        let game = Kuhn::new();
        let profile = UniformProfile(&game);
        let measurement = measure(&game, &profile);
        let exploitability = measurement.exploitability;
        assert!(exploitability.nash_conv_chips > 0.1, "{exploitability:?}");
        let [gain_0, gain_1] = exploitability.gain_chips;
        assert!((gain_0 + gain_1 - exploitability.nash_conv_chips).abs() < 1e-12);
        assert!((2.0 * exploitability.mean_chips - exploitability.nash_conv_chips).abs() < 1e-12);
        let pct = 100.0 * exploitability.nash_conv_chips / 2.0;
        assert!((exploitability.pct_of_pot - pct).abs() < 1e-9);
        let [value_0, value_1] = measurement.value_chips;
        assert!((value_0 + value_1).abs() < 1e-6, "zero sum: {value_0} + {value_1}");

        let tables = tables(&game, &profile);
        assert_eq!(tables.information_states, 12);
        assert_eq!(tables.root_weights, [vec![1.0; 3], vec![1.0; 3]]);
        let open = tables.strategies.get(&0).expect("node 0 is a decision");
        assert_eq!(open.combos, 3);
        assert_eq!(open.probabilities, vec![0.5; 6]);
    }
}
