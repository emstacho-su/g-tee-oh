//! Gate G3, Leduc hold'em against the committed `OpenSpiel` exploitability curve (04
//! section 6; R2.6; O-30, O-79, O-108, O-109, O-124). Owner: the G3 agent.
//!
//! Mechanism (S13 plan section B). Inputs: `leduc.json` (`tolerances.curve_abs` 0.001
//! chips, `curve_rel` 0.1) and the curve it names,
//! `openspiel/leduc_exploitability.json`, checkpoints 1, 10, 100, 1000 and 5000 with
//! exploitability 2.373611111, 0.888578983, 0.095716353, 0.011817810 and 0.003552366
//! (mean gain, chips, ante 1). Solve: `gto_solve::toy::curve(ToyGame::Leduc,
//! SolverMode::PlainCfr, checkpoints)`, one continuous run of plain CFR
//! (counterfactual regret minimization) with alternating updates, uniform averaging,
//! no discounting and no regret floor (O-109, O-124). Alternating, not simultaneous:
//! `OpenSpiel`'s `CFRSolver` passes `alternating_updates=True` to its base solver, so
//! that is what produced the curve; the fixture's `generator` block records it since the
//! O-128 correction (see `gto_solve::toy::plain_cfr`). Measure (O-108): exploitability
//! is `(gain_0 + gain_1) / 2`, `CurvePoint::exploitability.mean_chips`. Pass rule
//! (O-79): at every checkpoint `|engine - fixture| <= max(curve_abs, curve_rel *
//! fixture)`, allowed errors 0.2374, 0.0889, 0.00957, 0.00118 and 0.001. Report only:
//! the engine's average-policy value to player 0 at the last checkpoint next to the
//! fixture's value of minus 0.0859431 (in the notes); the engine DCFR (discounted CFR)
//! default curve on the same model at the same checkpoints (`SolverMode::dcfr_default()`,
//! O-124); the mode line.
//!
//! Report: id `g3-leduc`, `r_ids` `["R2.6"]`. Measurement ids:
//! `leduc/plain-cfr/exploitability@<iteration>` judged with
//! `Threshold::between(fixture - allowed, fixture + allowed, "chips")`;
//! `leduc/plain-cfr/value-player-0@<last iteration>` and
//! `leduc/dcfr-default/exploitability@<iteration>` informational. `notes` carries the
//! mode line ([`MODE_LINE`]), the fixture's player-0 value and the provenance path the
//! fixture names.

use std::collections::BTreeMap;
use std::path::PathBuf;

use gto_solve::toy::{CurvePoint, SolverMode, ToyGame, curve};

use crate::fixtures::FixtureError;
use crate::fixtures::openspiel::OpenSpielCurve;
use crate::fixtures::toy_game::ToyGameFixture;
use crate::report::{Measurement, Threshold};

use super::{Gate, GateError, GateReport};

const UNIT: &str = "chips";
/// The `measure` a fixture's curve reference must name: the field compared.
const COMPARED_MEASURE: &str = "exploitability";
/// How the judged curve was produced, for the report's notes.
const MODE_LINE: &str = "plain CFR: alternating updates as OpenSpiel's CFRSolver runs them \
                         (O-128), uniform averaging, no discounting, no regret floor; \
                         exploitability = NashConv / 2 per O-108, O-109";

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
/// not `exploitability`; `GateError::Fixture` when the fixture lacks the O-79 tolerance
/// pair.
pub fn run(fixture: &ToyGameFixture, reference: &OpenSpielCurve) -> Result<GateReport, GateError> {
    let named = fixture
        .curve
        .as_ref()
        .filter(|named| named.measure == COMPARED_MEASURE)
        .ok_or_else(|| GateError::NoCurve { fixture: fixture.id.clone() })?;
    let abs = tolerance(fixture, fixture.tolerances.curve_abs.as_ref(), "curve_abs")?;
    let rel = tolerance(fixture, fixture.tolerances.curve_rel.as_ref(), "curve_rel")?;
    let checkpoints = reference.iterations();
    let plain = curve(ToyGame::Leduc, SolverMode::PlainCfr, &checkpoints);
    let dcfr = curve(ToyGame::Leduc, SolverMode::dcfr_default(), &checkpoints);

    let judged: Vec<Measurement> = reference
        .checkpoints
        .iter()
        .zip(&plain)
        .map(|(row, point)| {
            // O-79: the larger of the absolute and the relative allowance.
            let allowed = abs.max(rel * row.exploitability);
            Measurement::judged(
                &format!("leduc/plain-cfr/exploitability@{}", row.iteration),
                point.exploitability.mean_chips,
                UNIT,
                Threshold::between(
                    row.exploitability - allowed,
                    row.exploitability + allowed,
                    UNIT,
                ),
            )
        })
        .collect();
    let value = plain.last().map(|point| {
        let id = format!("leduc/plain-cfr/value-player-0@{}", point.iteration);
        Measurement::informational(&id, point.value_chips[0], UNIT)
    });
    let dcfr_rows = dcfr.iter().map(|point: &CurvePoint| {
        let id = format!("leduc/dcfr-default/exploitability@{}", point.iteration);
        Measurement::informational(&id, point.exploitability.mean_chips, UNIT)
    });

    let thresholds: BTreeMap<String, Threshold> = judged
        .iter()
        .filter_map(|measurement| {
            measurement.threshold.clone().map(|threshold| (measurement.id.clone(), threshold))
        })
        .collect();
    let pass = judged.iter().all(|measurement| measurement.pass == Some(true));
    let fixture_value = reference.final_state.average_policy_value.first().copied();
    let notes = format!(
        "{MODE_LINE}. Fixture average-policy value to player 0 at iteration {}: {} chips \
         (reports only). Curve {} with provenance {}.",
        reference.final_state.iterations,
        fixture_value.map_or_else(|| "absent".to_owned(), |value| value.to_string()),
        named.file,
        named.provenance,
    );
    Ok(GateReport {
        report: Gate::G3.report_id().to_owned(),
        r_ids: vec![Gate::G3.r_id().to_owned()],
        pass,
        thresholds,
        measurements: judged.into_iter().chain(value).chain(dcfr_rows).collect(),
        notes,
    })
}

/// The value of one O-79 tolerance, or the error naming the fixture that lacks it.
fn tolerance(
    fixture: &ToyGameFixture,
    tolerance: Option<&crate::fixtures::toy_game::Tolerance>,
    name: &str,
) -> Result<f64, GateError> {
    tolerance.map(|tolerance| tolerance.value).ok_or_else(|| {
        GateError::Fixture(FixtureError::Invalid {
            path: PathBuf::from(format!("toy-games/{}.json", fixture.id)),
            reason: format!("tolerances.{name} is null; gate G3 needs the O-79 pair"),
        })
    })
}
