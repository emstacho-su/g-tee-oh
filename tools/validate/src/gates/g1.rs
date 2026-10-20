//! Gate G1, Kuhn poker (04 section 6, R2.4). Owner: the G1 agent. Stub until then.
//!
//! Mechanism (S13 plan section B). Input: `kuhn.json`, case `standard`. Solve:
//! `gto_solve::toy::solve_dcfr(ToyGame::Kuhn, stop)` with the engine's default DCFR
//! (discounted counterfactual regret minimization) schedule in chunks of 1,000
//! iterations until `NashConv` is below 1e-4 chips or 200,000 iterations. Pass rules:
//! the absolute error of the player-0 value against the fixture's minus 1/18 is at most
//! `tolerances.game_value_abs` (0.001 chips), and `NashConv` of the average strategy is
//! strictly below `tolerances.exploitability_max` (0.001 chips, the stricter reading of
//! the reports README; 0.05 percent of the 2-chip pot). Report only: the 12 strategy
//! facts, parameter `a` bound from `p0-open-bet-j`.
//!
//! Report: id `g1-kuhn`, `r_ids` `["R2.4"]`. Measurement ids and thresholds:
//! `kuhn/standard/value-player-0` (informational), `kuhn/standard/value-abs-error`
//! (at most 0.001 chips), `kuhn/standard/nash-conv` (at most 0.001 chips, judged
//! strictly in code through `Measurement::judged_as`), `kuhn/standard/iterations`
//! (informational), then one informational `kuhn/standard/<fact-id>` per strategy fact.
//! `notes` names the stop rule and the fixture path.

#![allow(
    unused_variables,
    reason = "stub bodies consume nothing yet; the G1 agent removes this line"
)]

use crate::fixtures::toy_game::{Case, ToyGameFixture};

use super::{GateError, GateReport, SolvedCase};

/// Solve one Kuhn case and read the value, `NashConv` and every strategy fact.
///
/// # Errors
///
/// `GateError::UnknownCase` for a case other than `standard`, `GateError::MissingFact`
/// when a fact's words resolve to nothing in the solved game.
pub fn solve_case(fixture: &ToyGameFixture, case: &Case) -> Result<SolvedCase, GateError> {
    todo!("G1: solve {} case {} through gto_solve::toy", fixture.id, case.id)
}

/// Run the gate on the loaded fixture.
///
/// # Errors
///
/// Whatever [`solve_case`] reports for the `standard` case.
pub fn run(fixture: &ToyGameFixture) -> Result<GateReport, GateError> {
    todo!("G1: the Kuhn gate report for {}", fixture.id)
}
