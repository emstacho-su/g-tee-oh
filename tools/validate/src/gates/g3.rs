//! Gate G3, Leduc hold'em against the committed `OpenSpiel` exploitability curve (04
//! section 6; R2.6; O-30, O-79, O-108, O-109, O-124). Owner: the G3 agent. Stub until
//! then.
//!
//! Mechanism (S13 plan section B). Inputs: `leduc.json` (`tolerances.curve_abs` 0.001
//! chips, `curve_rel` 0.1) and the curve it names,
//! `openspiel/leduc_exploitability.json`, checkpoints 1, 10, 100, 1000 and 5000 with
//! exploitability 2.373611111, 0.888578983, 0.095716353, 0.011817810 and 0.003552366
//! (mean gain, chips, ante 1). Solve: `gto_solve::toy::curve(ToyGame::Leduc,
//! SolverMode::PlainCfr, checkpoints)`, one continuous run of plain CFR
//! (counterfactual regret minimization) with simultaneous updates, uniform averaging,
//! no discounting and no regret floor (O-109, O-124). Measure (O-108): exploitability
//! is `(gain_0 + gain_1) / 2`, `CurvePoint::exploitability.mean_chips`. Pass rule
//! (O-79): at every checkpoint `|engine - fixture| <= max(curve_abs, curve_rel *
//! fixture)`, allowed errors 0.2374, 0.0889, 0.00957, 0.00118 and 0.001. Report only:
//! the engine's average-policy value to player 0 at 5000 next to the fixture's value of
//! minus 0.0859431; the engine DCFR (discounted CFR) default curve on the same model at
//! the same checkpoints (`SolverMode::dcfr_default()`, O-124); the mode line.
//!
//! Report: id `g3-leduc`, `r_ids` `["R2.6"]`. Measurement ids:
//! `leduc/plain-cfr/exploitability@<iteration>` judged with
//! `Threshold::between(fixture - allowed, fixture + allowed, "chips")`;
//! `leduc/plain-cfr/value-player-0@5000` and
//! `leduc/dcfr-default/exploitability@<iteration>` informational. `notes` carries the
//! mode line, "plain CFR: simultaneous updates, uniform averaging, no discounting, no
//! regret floor; exploitability = `NashConv` / 2 per O-108, O-109", and the provenance
//! path the fixture names.

#![allow(
    unused_variables,
    reason = "stub bodies consume nothing yet; the G3 agent removes this line"
)]

use crate::fixtures::openspiel::OpenSpielCurve;
use crate::fixtures::toy_game::ToyGameFixture;

use super::{GateError, GateReport};

/// The plain CFR curve on the Leduc model: the mean gain in chips at each requested
/// iteration, one continuous run.
#[must_use]
pub fn solve_curve(iterations: &[u64]) -> Vec<(u64, f64)> {
    todo!("G3: Leduc plain CFR at {iterations:?} through gto_solve::toy::curve")
}

/// Run the gate on the loaded fixture and curve.
///
/// # Errors
///
/// `GateError::NoCurve` when the fixture and the curve disagree on the checkpoints.
pub fn run(fixture: &ToyGameFixture, curve: &OpenSpielCurve) -> Result<GateReport, GateError> {
    todo!("G3: the Leduc gate report for {} against {}", fixture.id, curve.fixture)
}
