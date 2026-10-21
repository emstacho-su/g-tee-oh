//! Gate G1, Kuhn poker (04 section 6, R2.4). Owner: the G1 agent.
//!
//! Mechanism (S13 plan section B). Input: `kuhn.json`, case `standard`. Solve:
//! `gto_solve::toy::solve_dcfr(ToyGame::Kuhn, stop)` with the engine's default DCFR
//! (discounted counterfactual regret minimization) schedule in chunks of 1,000
//! iterations until `NashConv` is below 1e-4 chips or 200,000 iterations. Pass rules:
//! the absolute error of the player-0 value against the fixture's minus 1/18 is at most
//! `tolerances.game_value_abs` (0.001 chips), and `NashConv` of the average strategy is
//! strictly below `tolerances.exploitability_max` (0.001 chips, the stricter reading of
//! the reports README; 0.05 percent of the 2-chip pot). Both tolerances must be stated
//! in chips; any other unit is refused before anything is solved. Report only: the 12
//! strategy facts, parameter `a` bound from `p0-open-bet-j`.
//!
//! The work is split in three steps: [`limits`] reads the expected value and the two
//! tolerances, [`measurements`] solves and judges, and [`assemble`] builds the report.
//!
//! Report: id `g1-kuhn`, `r_ids` `["R2.4"]`. Measurement ids and thresholds:
//! `kuhn/standard/value-player-0` (informational), `kuhn/standard/value-abs-error`
//! (at most 0.001 chips), `kuhn/standard/nash-conv` (at most 0.001 chips, judged
//! strictly in code through `Measurement::judged_as`), `kuhn/standard/iterations`
//! (informational), `kuhn/standard/parameter-a` (informational, the bound parameter),
//! then one informational `kuhn/standard/<fact-id>` per strategy fact. `notes` names the
//! solver mode, the stop rule, the strict reading of the floor, the binding of `a` and
//! the fixture path.

use std::collections::BTreeMap;

use gto_solve::toy::{StopRule, ToyGame, ToySolution, solve_dcfr};

use crate::fixtures::toy_game::{Case, ToyGameFixture};
use crate::report::{Measurement, Threshold};

use super::{
    Gate, GateError, GateReport, SolvedCase, iterations_as_f64, missing_fact, required_tolerance,
    resolve_frequencies, unknown_case,
};

/// The one case of the Kuhn fixture.
const CASE_ID: &str = "standard";

/// The fact that binds the equilibrium family's parameter `a`.
const PARAMETER_FACT_ID: &str = "p0-open-bet-j";

/// The stop rule: chunks of 1,000 until `NashConv` is below 1e-4 chips or 200,000.
const STOP: StopRule =
    StopRule { target_nash_conv_chips: 1e-4, max_iterations: 200_000, chunk: 1_000 };

/// Where the fixture lives, relative to the repository root, for the notes.
const FIXTURE_PATH: &str = "validation/fixtures/toy-games/kuhn.json";

/// The unit of every chip figure in the report, and of both G1 tolerances.
const CHIPS: &str = "chips";

/// The unit of a strategy fact.
const FREQUENCY: &str = "frequency";

/// The prefix of every measurement id.
const ID_PREFIX: &str = "kuhn/standard";

/// The solved standard case with the frequency of every strategy fact the fixture names.
struct Solved {
    solution: ToySolution,
    frequencies: BTreeMap<String, f64>,
}

/// What G1 judges against: the fixture's player-0 value and the two tolerances, chips.
struct Limits {
    expected_value: f64,
    value_abs: f64,
    floor: f64,
}

/// The judged and informational rows, the thresholds, and the bound parameter.
struct Measured {
    thresholds: BTreeMap<String, Threshold>,
    measurements: Vec<Measurement>,
    parameter_a: Option<f64>,
}

/// Solve the `standard` case and resolve every strategy fact through the solution's
/// vocabulary.
fn solve_standard(fixture: &ToyGameFixture, case: &Case) -> Result<Solved, GateError> {
    if case.id != CASE_ID {
        return Err(unknown_case(fixture, case));
    }
    let solution = solve_dcfr(ToyGame::Kuhn, &STOP);
    let frequencies = resolve_frequencies(fixture, case, &solution)?;
    Ok(Solved { solution, frequencies })
}

/// Solve one Kuhn case and read the value, `NashConv` and every strategy fact.
///
/// # Errors
///
/// `GateError::UnknownCase` for a case other than `standard`, `GateError::MissingFact`
/// when a fact's words resolve to nothing in the solved game.
pub fn solve_case(fixture: &ToyGameFixture, case: &Case) -> Result<SolvedCase, GateError> {
    let solved = solve_standard(fixture, case)?;
    Ok(SolvedCase {
        game_value_player_0: solved.solution.value_chips[0],
        exploitability_chips: solved.solution.exploitability.nash_conv_chips,
        frequencies: solved.frequencies,
        ratios: BTreeMap::new(),
    })
}

/// Run the gate on the loaded fixture.
///
/// # Errors
///
/// `GateError::UnknownCase` when the fixture has no `standard` case,
/// `GateError::MissingFact` when that case states no game value, `GateError::Fixture`
/// naming the field when `tolerances.game_value_abs` or `tolerances.exploitability_max`
/// is `null` or not in chips, and whatever [`solve_case`] reports.
pub fn run(fixture: &ToyGameFixture) -> Result<GateReport, GateError> {
    let case = fixture.case(CASE_ID).ok_or_else(|| GateError::UnknownCase {
        fixture: fixture.id.clone(),
        case: CASE_ID.to_owned(),
    })?;
    let limits = limits(fixture, case)?;
    let measured = measurements(fixture, case, &limits)?;
    Ok(assemble(measured))
}

/// The expected value and both tolerances, each tolerance required in chips.
fn limits(fixture: &ToyGameFixture, case: &Case) -> Result<Limits, GateError> {
    let expected =
        case.game_value.as_ref().ok_or_else(|| missing_fact(fixture, case, "game_value"))?;
    let tolerances = &fixture.tolerances;
    let value_abs = required_tolerance(
        fixture,
        tolerances.game_value_abs.as_ref(),
        "game_value_abs",
        CHIPS,
        Gate::G1,
    )?;
    let floor = required_tolerance(
        fixture,
        tolerances.exploitability_max.as_ref(),
        "exploitability_max",
        CHIPS,
        Gate::G1,
    )?;
    Ok(Limits { expected_value: expected.value, value_abs, floor })
}

/// Solve the case, judge the value error and the strict floor, and record the rest.
fn measurements(
    fixture: &ToyGameFixture,
    case: &Case,
    limits: &Limits,
) -> Result<Measured, GateError> {
    let solved = solve_standard(fixture, case)?;
    let solution = &solved.solution;
    let value = solution.value_chips[0];
    let nash_conv = solution.exploitability.nash_conv_chips;
    let value_threshold = Threshold::at_most(limits.value_abs, CHIPS);
    let floor_threshold = Threshold::at_most(limits.floor, CHIPS);
    let thresholds = BTreeMap::from([
        (id("value-abs-error"), value_threshold.clone()),
        (id("nash-conv"), floor_threshold.clone()),
    ]);
    let value_error = (value - limits.expected_value).abs();
    let judged = [
        Measurement::informational(&id("value-player-0"), value, CHIPS),
        Measurement::judged(&id("value-abs-error"), value_error, CHIPS, value_threshold),
        // The floor is strict (plan section B), so the gate judges it and the report
        // carries the inclusive bound beside that verdict.
        Measurement::judged_as(
            &id("nash-conv"),
            nash_conv,
            CHIPS,
            floor_threshold,
            nash_conv < limits.floor,
        ),
        Measurement::informational(
            &id("iterations"),
            iterations_as_f64(solution.iterations),
            "iterations",
        ),
    ];
    let parameter_a = solved.frequencies.get(PARAMETER_FACT_ID).copied();
    let parameter = parameter_a
        .map(|a| Measurement::informational(&id("parameter-a"), a, FREQUENCY))
        .into_iter();
    let facts = solved
        .frequencies
        .iter()
        .map(|(fact, frequency)| Measurement::informational(&id(fact), *frequency, FREQUENCY));
    let measurements = judged.into_iter().chain(parameter).chain(facts).collect();
    Ok(Measured { thresholds, measurements, parameter_a })
}

/// The gate report: the verdict over the judged rows and the notes line.
fn assemble(measured: Measured) -> GateReport {
    let pass = measured.measurements.iter().all(|measurement| measurement.pass.unwrap_or(true));
    GateReport {
        report: Gate::G1.report_id().to_owned(),
        r_ids: vec![Gate::G1.r_id().to_owned()],
        pass,
        thresholds: measured.thresholds,
        measurements: measured.measurements,
        notes: notes(measured.parameter_a),
    }
}

/// A measurement id under the `kuhn/standard` prefix.
fn id(suffix: &str) -> String {
    format!("{ID_PREFIX}/{suffix}")
}

/// The notes line: the solver mode, the stop rule, the strict floor, the binding of `a`
/// and the fixture path.
fn notes(parameter_a: Option<f64>) -> String {
    let binding = parameter_a.map_or_else(
        || format!("parameter a is unbound because the fixture states no {PARAMETER_FACT_ID} fact"),
        |a| format!("parameter a = {a} bound from {PARAMETER_FACT_ID}"),
    );
    format!(
        "engine DCFR with the default schedule (alpha 1.5, beta 0, gamma 2, regret floor off), \
         chunks of {} iterations until NashConv < {} chips or {} iterations; NashConv = \
         gain_0 + gain_1 of the average strategy, judged strictly below exploitability_max; \
         the strategy facts are informational and document the one-parameter equilibrium \
         family, {binding}; fixture {FIXTURE_PATH}",
        STOP.chunk, STOP.target_nash_conv_chips, STOP.max_iterations
    )
}

#[cfg(test)]
mod tests {
    use super::super::{Gate, GateError, fixtures_dir, load_toy_game};
    use super::{PARAMETER_FACT_ID, run, solve_case};

    /// R2.4: the gate report passes on the committed fixture, carries the four plan
    /// measurements and the two thresholds, records the 12 strategy facts and the bound
    /// parameter as informational rows, and names the fixture in the notes.
    #[test]
    fn r2_4_g1_report_passes_with_the_plan_measurements() {
        let fixture = load_toy_game(&fixtures_dir(&crate::repo_root()), "kuhn").expect("loads");
        let report = run(&fixture).expect("the gate runs");
        assert_eq!(report.report, Gate::G1.report_id());
        assert_eq!(report.r_ids, vec![Gate::G1.r_id()]);
        assert!(report.pass, "{report:?}");
        let ids: Vec<&str> = report.measurements.iter().map(|m| m.id.as_str()).collect();
        for expected in [
            "kuhn/standard/value-player-0",
            "kuhn/standard/value-abs-error",
            "kuhn/standard/nash-conv",
            "kuhn/standard/iterations",
            "kuhn/standard/parameter-a",
            "kuhn/standard/p0-open-bet-j",
            "kuhn/standard/p1-facing-bet-call-k",
        ] {
            assert!(ids.contains(&expected), "missing {expected} in {ids:?}");
        }
        assert_eq!(report.measurements.len(), 5 + 12);
        assert_eq!(report.thresholds.len(), 2);
        assert!(report.thresholds.contains_key("kuhn/standard/nash-conv"));
        let judged = report.measurements.iter().filter(|m| m.pass.is_some()).count();
        assert_eq!(judged, 2, "only the value error and the floor are judged");
        assert!(report.notes.contains(PARAMETER_FACT_ID));
        assert!(report.notes.contains("kuhn.json"));
    }

    /// R2.4: a G1 tolerance in a unit other than chips is refused with a fixture error
    /// naming the field, before anything is solved or judged.
    #[test]
    fn r2_4_g1_refuses_a_tolerance_in_the_wrong_unit() {
        let fixture = load_toy_game(&fixtures_dir(&crate::repo_root()), "kuhn").expect("loads");
        for field in ["game_value_abs", "exploitability_max"] {
            let mut copy = fixture.clone();
            let tolerances = &mut copy.tolerances;
            let tolerance = match field {
                "game_value_abs" => tolerances.game_value_abs.as_mut(),
                _ => tolerances.exploitability_max.as_mut(),
            };
            tolerance.expect("kuhn.json states it").unit = "percentage_points".to_owned();
            let error = run(&copy).expect_err("a wrong unit is refused");
            assert!(matches!(error, GateError::Fixture(_)), "{field}: {error}");
            assert!(error.to_string().contains(&format!("tolerances.{field}")), "{error}");
        }
    }

    /// R2.4: a case the gate does not model is refused by name, not solved.
    #[test]
    fn r2_4_g1_refuses_an_unknown_case() {
        let fixture = load_toy_game(&fixtures_dir(&crate::repo_root()), "kuhn").expect("loads");
        let mut case = fixture.cases[0].clone();
        case.id = "no-such-case".to_owned();
        let error = solve_case(&fixture, &case).expect_err("refused");
        assert!(matches!(error, GateError::UnknownCase { .. }), "{error}");
        assert!(error.to_string().contains("no-such-case"));
    }
}
