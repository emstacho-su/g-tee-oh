//! The engine's discounted counterfactual regret minimization (DCFR) solver under a stop
//! rule. Owner: the G1 agent (R2.4). Stub until then.
//!
//! Mechanism. `Solver::new(game)` sizes the regret and strategy storage; each
//! `run(chunk, params, 0, |_, _, _| {})` advances the solve by one chunk with the engine's
//! own reporting off, so the engine never calls its `exploitability`, whose debug
//! assertion trips on Kuhn's negative player-0 value (O-102). After each chunk
//! `measure::measure` reads `solver.average()`; the loop stops when `NashConv` is below
//! the stop rule's target or the iteration count has reached its maximum, the last chunk
//! being cut short so the maximum is never exceeded; a chunk of 0 is read as 1. `curve`
//! is the same run measured at each checkpoint instead, with the rules `super::curve`
//! documents (a checkpoint of 0 is the uniform profile before any iteration). `solve`
//! hands back `measure::tables` of the average strategy. Leduc has 6 chance outcomes,
//! below the engine's `PAR_MIN_OUTCOMES` of 8, so every toy solve stays on the
//! sequential, bit-deterministic path.

#![allow(
    unused_variables,
    clippy::needless_pass_by_value,
    reason = "stub bodies consume nothing yet; the G1 agent removes this line"
)]

use postflop_engine::cfr::DcfrParams;
use postflop_engine::game::Game;

use super::{CurvePoint, Solved, StopRule};

/// Solve `game` by DCFR with `params` in chunks under `stop`, and hand back the measured
/// average strategy.
pub(crate) fn solve<G: Game + Sync>(game: G, params: &DcfrParams, stop: &StopRule) -> Solved {
    todo!("G1: DCFR under {stop:?} with {params:?}")
}

/// One continuous DCFR run with `params`, measured at each checkpoint.
pub(crate) fn curve<G: Game + Sync>(
    game: G,
    params: &DcfrParams,
    checkpoints: &[u64],
) -> Vec<CurvePoint> {
    todo!("G1: DCFR curve at {checkpoints:?} with {params:?}")
}
