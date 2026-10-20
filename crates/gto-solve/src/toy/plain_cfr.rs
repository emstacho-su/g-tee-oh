//! Plain counterfactual regret minimization (CFR) over the engine's `Game` trait: the
//! reference traversal gate G3 runs so the Leduc curve is comparable with the committed
//! `OpenSpiel` run. Owner: the G3 agent (R2.6, O-109, O-124). Stub until then.
//!
//! Why not the engine solver: `Solver::run` hard-codes alternating updates, and its
//! discount step multiplies every cumulative regret by 0.5 at iteration 1 whatever the
//! exponents are; neither can be switched off through `DcfrParams`, and the vendored
//! crate is not edited (O-102). So this file carries a small vector-form CFR of its own
//! and the engine's best-response calculator measures it, which is what makes G3 a check
//! of the Leduc model, of the engine's exploitability measure and of the traversal
//! invariants against `OpenSpiel` (O-124).
//!
//! Mechanism (S13 plan section C). At the start of an iteration every decision node's
//! regret-matching strategy is snapshotted, uniform where no regret is positive. Then two
//! hero walks: the opponent's reach is root weights times opponent strategy times chance
//! weights, the hero's reach is the hero's own strategy only (chance weights excluded, as
//! `OpenSpiel` does); cumulative regret gains the instantaneous regret with no floor and
//! no discount; the strategy sum gains hero reach times strategy. The average strategy is
//! the normalised sum, uniform where the sum is zero, and is exposed through
//! `postflop_engine::br::StrategyProfile` so `measure::measure` reads it. `curve` runs one
//! continuous solve and measures at each checkpoint with the rules `super::curve`
//! documents: a checkpoint of 0 is the uniform profile before any iteration.

#![allow(
    unused_variables,
    clippy::needless_pass_by_value,
    reason = "stub bodies consume nothing yet; the G3 agent removes this line"
)]

use postflop_engine::game::Game;

use super::CurvePoint;

/// One continuous plain CFR run on `game`, measured at each checkpoint.
pub(crate) fn curve<G: Game>(game: G, checkpoints: &[u64]) -> Vec<CurvePoint> {
    todo!("G3: plain CFR curve at {checkpoints:?}")
}
