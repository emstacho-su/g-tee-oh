//! Gate G2, the AKQ (ace, king, queen) game and the polar river toy (04 section 6,
//! R2.5). Owner: the G2 agent. Stub until then.
//!
//! Mechanism (S13 plan section B). Input: `akq.json`, cases `pot1-bet-quarter`
//! (`ToyGame::Akq { pot: 1, bet: 0.25 }`), `pot1-bet-half` (bet 0.5), `pot1-bet-pot`
//! (bet 1) and `polar-river-pot-bet` (`ToyGame::PolarRiver { pot: 1, bet: 1 }`); the
//! case's `betting.dead_pot` and `betting.bet_sizes[0]` give the two numbers, and the
//! case id tells the two games apart. Solve: the engine's default DCFR (discounted
//! counterfactual regret minimization) in chunks of 1,000 until `NashConv` is below
//! 1e-5 chips or 1,000,000 iterations. Pass rule, with `tolerances.frequency_points`
//! 0.5 points read as 0.005 in frequency units: every strategy fact as `fact_error` in
//! `tests/gates.rs` judges it (exact facts within 0.005, segment facts inside the
//! widened segment, affine facts against the bound parameter) and every ratio fact
//! within 0.005 of its value. Ratio definitions, with root weights read through
//! `ToySolution::root_weight`: `bluff-share-of-bets` is `bet(Q) / (bet(Q) + bet(K) +
//! bet(A))` for AKQ and `bet(air) / (bet(air) + bet(nuts))` for the polar game (equal
//! weights); `defense-share-of-range` is `(call(K) + call(A)) / 2`, the caller's
//! holdings when the bettor holds the bluff, which is `P / (P + B)`;
//! `defense-share-of-bluff-catchers` is `call(bluff_catcher)`.
//!
//! Report: id `g2-akq`, `r_ids` `["R2.5"]`. One judged measurement per fact,
//! `akq/<case-id>/<fact-id>`, with `Threshold::between(expected - 0.005, expected +
//! 0.005, "frequency")` (for a segment fact, the segment widened by 0.005; for an affine
//! fact, the value at the bound parameter), ratios likewise; `akq/<case-id>/nash-conv`
//! and `akq/<case-id>/iterations` informational. `notes` names the stop rule and the
//! fixture path.

#![allow(
    unused_variables,
    reason = "stub bodies consume nothing yet; the G2 agent removes this line"
)]

use crate::fixtures::toy_game::{Case, ToyGameFixture};

use super::{GateError, GateReport, SolvedCase};

/// Solve one AKQ or polar river case and read `NashConv`, every strategy fact and every
/// ratio fact.
///
/// # Errors
///
/// `GateError::UnknownCase` for a case id the gate does not model,
/// `GateError::MissingFact` when a fact's words resolve to nothing in the solved game.
pub fn solve_case(fixture: &ToyGameFixture, case: &Case) -> Result<SolvedCase, GateError> {
    todo!("G2: solve {} case {} through gto_solve::toy", fixture.id, case.id)
}

/// Run the gate on every case of the loaded fixture.
///
/// # Errors
///
/// Whatever [`solve_case`] reports for a case.
pub fn run(fixture: &ToyGameFixture) -> Result<GateReport, GateError> {
    todo!("G2: the AKQ and polar river gate report for {}", fixture.id)
}
