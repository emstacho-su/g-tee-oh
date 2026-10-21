//! Exact best response for a solved postflop game (R2.10, O-138).
//!
//! Mechanism: for each player `i`, the engine's `br::best_response_value(game, i, profile)`
//! is the value of best-responding to the average strategy and `br::expected_value(game,
//! i, profile)` the value of following it, both in big blinds (bb) per hand over the full
//! tree with every runout dealt. Each `f32` figure is widened to `f64` before the
//! subtraction, so the gain is the exact difference of the two engine figures; it is the
//! same mechanism as S13's toy measure. The engine's `br::exploitability` is never called:
//! it sums best-response values, which a raked game offsets by the expected rake, and its
//! debug assertion misfires on games with a negative value (O-102). A unilateral gain has
//! neither problem, so it is the stop rule's figure, as a percent of the starting pot.

use postflop_engine::br;

use super::solve::SolvedGame;

/// Percent per whole.
const PERCENT: f64 = 100.0;

/// Both players' best response, expected value and gain, `[oop, ip]`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct BestResponseReport {
    /// The value of best-responding to the opponent's average strategy, bb per hand.
    pub best_response_bb: [f64; 2],
    /// The value of both players following their average strategies, bb per hand.
    pub expected_value_bb: [f64; 2],
    /// `best_response_bb - expected_value_bb`: what deviating alone gains.
    pub gain_bb: [f64; 2],
    /// `gain_bb` as a percent of the starting pot.
    pub gain_pct_pot: [f64; 2],
}

/// The exact best response to a solved game's average strategy.
#[must_use]
pub fn best_response(solved: &SolvedGame) -> BestResponseReport {
    let cfr = solved.solver();
    let game = cfr.game();
    let profile = cfr.average();
    let pot = game.config().starting_pot;
    let best_response_bb =
        [0, 1].map(|hero| f64::from(br::best_response_value(game, hero, &profile)));
    let expected_value_bb = [0, 1].map(|hero| f64::from(br::expected_value(game, hero, &profile)));
    let gain_bb = [0, 1].map(|player| best_response_bb[player] - expected_value_bb[player]);
    let gain_pct_pot = gain_bb.map(|gain| PERCENT * gain / pot);
    BestResponseReport { best_response_bb, expected_value_bb, gain_bb, gain_pct_pot }
}
