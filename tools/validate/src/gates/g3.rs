//! Gate G3, Leduc hold'em against the committed `OpenSpiel` exploitability curve (04
//! section 6; R2.6; O-30, O-79, O-108, O-109, O-124). Owner: the G3 agent.
//!
//! Mechanism (S13 plan section B). Inputs: `leduc.json` (`tolerances.curve_abs` 0.001
//! chips, `curve_rel` 0.1 as a ratio; any other unit is refused before the curve runs)
//! and the curve it names, `openspiel/leduc_exploitability.json`, checkpoints 1, 10,
//! 100, 1000 and 5000 with exploitability 2.373611111, 0.888578983, 0.095716353,
//! 0.011817810 and 0.003552366 (mean gain, chips, ante 1). Solve:
//! `gto_solve::toy::curve(ToyGame::Leduc, SolverMode::PlainCfr, checkpoints)`, one
//! continuous run of plain CFR (counterfactual regret minimization) with alternating
//! updates, uniform averaging, no discounting and no regret floor (O-109, O-124).
//! Alternating, not simultaneous: `OpenSpiel`'s `CFRSolver` passes
//! `alternating_updates=True` to its base solver, so that is what produced the curve;
//! the fixture's `generator` block records it since the O-128 correction (see
//! `gto_solve::toy::plain_cfr`). Measure (O-108): exploitability is `(gain_0 + gain_1) /
//! 2`, `CurvePoint::exploitability.mean_chips`. Pass rule (O-79): at every checkpoint
//! `|engine - fixture| <= max(curve_abs, curve_rel * fixture)`, allowed errors 0.2374,
//! 0.0889, 0.00957, 0.00118 and 0.001. Report only: the engine's average-policy value to
//! player 0 at the last checkpoint next to the fixture's value of minus 0.0859431 (in the
//! notes); the engine DCFR (discounted CFR) default curve on the same model at the same
//! checkpoints (`SolverMode::dcfr_default()`, O-124); the mode line.
//!
//! The work is split in three steps: [`allowance`] reads the O-79 pair, [`measurements`]
//! runs both curves and judges the plain one, and [`assemble`] builds the report.
//!
//! Report: id `g3-leduc`, `r_ids` `["R2.6"]`. Measurement ids:
//! `leduc/plain-cfr/exploitability@<iteration>` judged with
//! `Threshold::between(fixture - allowed, fixture + allowed, "chips")`;
//! `leduc/plain-cfr/value-player-0@<last iteration>` and
//! `leduc/dcfr-default/exploitability@<iteration>` informational. `notes` carries the
//! mode line ([`MODE_LINE`]), the fixture's player-0 value and the provenance path the
//! fixture names.

use std::collections::BTreeMap;

use gto_solve::toy::{CurvePoint, SolverMode, ToyGame, curve};

use crate::fixtures::openspiel::OpenSpielCurve;
use crate::fixtures::toy_game::{CurveReference, ToyGameFixture};
use crate::report::{Measurement, Threshold};

use super::{Gate, GateError, GateReport, required_tolerance};

/// The unit of every measurement, and of `tolerances.curve_abs`.
const UNIT: &str = "chips";
/// The unit of `tolerances.curve_rel`, as `leduc.json` states it.
const RATIO: &str = "ratio";
/// The `measure` a fixture's curve reference must name: the field compared.
const COMPARED_MEASURE: &str = "exploitability";
/// How the judged curve was produced, for the report's notes.
const MODE_LINE: &str = "plain CFR: alternating updates as OpenSpiel's CFRSolver runs them \
                         (O-128), uniform averaging, no discounting, no regret floor; \
                         exploitability = NashConv / 2 per O-108, O-109";

/// The O-79 pair: an absolute allowance in chips and a relative one as a ratio.
struct Allowance {
    abs: f64,
    rel: f64,
}

impl Allowance {
    /// O-79: the larger of the absolute and the relative allowance at `expected`.
    fn at(&self, expected: f64) -> f64 {
        self.abs.max(self.rel * expected)
    }
}

/// The plain CFR curve on the Leduc model: the mean gain in chips at each requested
/// iteration, one continuous run.
#[must_use]
pub fn solve_curve(iterations: &[u64]) -> Vec<(u64, f64)> {
    curve(ToyGame::Leduc, SolverMode::PlainCfr, iterations)
        .iter()
        .map(|point| (point.iteration, point.exploitability.mean_chips))
        .collect()
}

/// Run the gate on the loaded fixture and curve.
///
/// # Errors
///
/// `GateError::NoCurve` when the fixture names no curve or one whose compared measure is
/// not `exploitability`; `GateError::Fixture` naming the field when `curve_abs` is
/// `null` or not in chips, or `curve_rel` is `null` or not a ratio.
pub fn run(fixture: &ToyGameFixture, reference: &OpenSpielCurve) -> Result<GateReport, GateError> {
    let named = fixture
        .curve
        .as_ref()
        .filter(|named| named.measure == COMPARED_MEASURE)
        .ok_or_else(|| GateError::NoCurve { fixture: fixture.id.clone() })?;
    let allowance = allowance(fixture)?;
    let measurements = measurements(reference, &allowance);
    Ok(assemble(measurements, reference, named))
}

/// The O-79 pair, `curve_abs` required in chips and `curve_rel` as a ratio.
fn allowance(fixture: &ToyGameFixture) -> Result<Allowance, GateError> {
    let tolerances = &fixture.tolerances;
    let abs =
        required_tolerance(fixture, tolerances.curve_abs.as_ref(), "curve_abs", UNIT, Gate::G3)?;
    let rel =
        required_tolerance(fixture, tolerances.curve_rel.as_ref(), "curve_rel", RATIO, Gate::G3)?;
    Ok(Allowance { abs, rel })
}

/// Both curves at the reference checkpoints: the plain CFR rows judged against the
/// reference within the allowance, then the last plain value and the DCFR rows for the
/// reader.
fn measurements(reference: &OpenSpielCurve, allowance: &Allowance) -> Vec<Measurement> {
    let checkpoints = reference.iterations();
    let plain = curve(ToyGame::Leduc, SolverMode::PlainCfr, &checkpoints);
    let dcfr = curve(ToyGame::Leduc, SolverMode::dcfr_default(), &checkpoints);
    let judged = reference.checkpoints.iter().zip(&plain).map(|(row, point)| {
        let allowed = allowance.at(row.exploitability);
        Measurement::judged(
            &format!("leduc/plain-cfr/exploitability@{}", row.iteration),
            point.exploitability.mean_chips,
            UNIT,
            Threshold::between(row.exploitability - allowed, row.exploitability + allowed, UNIT),
        )
    });
    let value = plain.last().map(|point| {
        let id = format!("leduc/plain-cfr/value-player-0@{}", point.iteration);
        Measurement::informational(&id, point.value_chips[0], UNIT)
    });
    let dcfr_rows = dcfr.iter().map(|point: &CurvePoint| {
        let id = format!("leduc/dcfr-default/exploitability@{}", point.iteration);
        Measurement::informational(&id, point.exploitability.mean_chips, UNIT)
    });
    judged.chain(value).chain(dcfr_rows).collect()
}

/// The gate report: thresholds and verdict from the judged rows, and the notes line
/// with the fixture's player-0 value and the curve's provenance.
fn assemble(
    measurements: Vec<Measurement>,
    reference: &OpenSpielCurve,
    named: &CurveReference,
) -> GateReport {
    let thresholds: BTreeMap<String, Threshold> = measurements
        .iter()
        .filter_map(|measurement| {
            measurement.threshold.clone().map(|threshold| (measurement.id.clone(), threshold))
        })
        .collect();
    let pass = measurements
        .iter()
        .filter(|measurement| measurement.threshold.is_some())
        .all(|measurement| measurement.pass == Some(true));
    let fixture_value = reference.final_state.average_policy_value.first().copied();
    let notes = format!(
        "{MODE_LINE}. Fixture average-policy value to player 0 at iteration {}: {} chips \
         (reports only). Curve {} with provenance {}.",
        reference.final_state.iterations,
        fixture_value.map_or_else(|| "absent".to_owned(), |value| value.to_string()),
        named.file,
        named.provenance,
    );
    GateReport {
        report: Gate::G3.report_id().to_owned(),
        r_ids: vec![Gate::G3.r_id().to_owned()],
        pass,
        thresholds,
        measurements,
        notes,
    }
}

#[cfg(test)]
mod tests {
    use super::super::{Gate, GateError, fixtures_dir, load_curve, load_toy_game};
    use super::run;

    /// R2.6: `curve_abs` in a unit other than chips, or `curve_rel` in one other than a
    /// ratio, is refused with a fixture error naming the field, before the curve is run.
    #[test]
    fn r2_6_g3_refuses_a_tolerance_in_the_wrong_unit() {
        let dir = fixtures_dir(&crate::repo_root());
        let fixture = load_toy_game(&dir, Gate::G3.fixture_id()).expect("loads");
        let reference = load_curve(&dir, &fixture).expect("loads");
        for (field, wrong) in [("curve_abs", "ratio"), ("curve_rel", "chips")] {
            let mut copy = fixture.clone();
            let tolerances = &mut copy.tolerances;
            let tolerance = match field {
                "curve_abs" => tolerances.curve_abs.as_mut(),
                _ => tolerances.curve_rel.as_mut(),
            };
            tolerance.expect("leduc.json states it").unit = wrong.to_owned();
            let error = run(&copy, &reference).expect_err("a wrong unit is refused");
            assert!(matches!(error, GateError::Fixture(_)), "{field}: {error}");
            assert!(error.to_string().contains(&format!("tolerances.{field}")), "{error}");
        }
    }
}
