//! Gate G1, Kuhn poker (04 section 6, R2.4). Owner: the G1 agent.
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
//! (informational), `kuhn/standard/parameter-a` (informational, the bound parameter),
//! then one informational `kuhn/standard/<fact-id>` per strategy fact. `notes` names the
//! solver mode, the stop rule, the strict reading of the floor, the binding of `a` and
//! the fixture path.

use std::collections::BTreeMap;

use gto_solve::toy::{StopRule, ToyGame, ToySolution, solve_dcfr};

use crate::fixtures::toy_game::{Case, ToyGameFixture};
use crate::report::{Measurement, Threshold};

use super::{Gate, GateError, GateReport, SolvedCase};

/// The one case of the Kuhn fixture.
const CASE_ID: &str = "standard";

/// The fact that binds the equilibrium family's parameter `a`.
const PARAMETER_FACT_ID: &str = "p0-open-bet-j";

/// The stop rule: chunks of 1,000 until `NashConv` is below 1e-4 chips or 200,000.
const STOP: StopRule =
    StopRule { target_nash_conv_chips: 1e-4, max_iterations: 200_000, chunk: 1_000 };

/// Where the fixture lives, relative to the repository root, for the notes.
const FIXTURE_PATH: &str = "validation/fixtures/toy-games/kuhn.json";

/// The unit of every chip figure in the report.
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

/// Solve the `standard` case and resolve every strategy fact through the solution's
/// vocabulary.
fn solve_standard(fixture: &ToyGameFixture, case: &Case) -> Result<Solved, GateError> {
    if case.id != CASE_ID {
        return Err(GateError::UnknownCase { fixture: fixture.id.clone(), case: case.id.clone() });
    }
    let solution = solve_dcfr(ToyGame::Kuhn, &STOP);
    let frequencies = case
        .strategy_facts
        .iter()
        .map(|fact| {
            solution
                .frequency(fact.player, &fact.node, &fact.holding, &fact.action)
                .map(|frequency| (fact.id.clone(), frequency))
                .ok_or_else(|| GateError::MissingFact {
                    fixture: fixture.id.clone(),
                    case: case.id.clone(),
                    fact: fact.id.clone(),
                })
        })
        .collect::<Result<_, _>>()?;
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
/// `GateError::MissingFact` when that case states no game value or the fixture states
/// no `game_value_abs` or `exploitability_max` tolerance (the fact named is the missing
/// field), and whatever [`solve_case`] reports.
pub fn run(fixture: &ToyGameFixture) -> Result<GateReport, GateError> {
    let case = fixture.case(CASE_ID).ok_or_else(|| GateError::UnknownCase {
        fixture: fixture.id.clone(),
        case: CASE_ID.to_owned(),
    })?;
    let missing = |fact: &str| GateError::MissingFact {
        fixture: fixture.id.clone(),
        case: case.id.clone(),
        fact: fact.to_owned(),
    };
    let expected = case.game_value.as_ref().ok_or_else(|| missing("game_value"))?;
    let tolerances = &fixture.tolerances;
    let value_abs =
        tolerances.game_value_abs.as_ref().ok_or_else(|| missing("tolerances.game_value_abs"))?;
    let floor = tolerances
        .exploitability_max
        .as_ref()
        .ok_or_else(|| missing("tolerances.exploitability_max"))?;

    let solved = solve_standard(fixture, case)?;
    let solution = &solved.solution;
    let value = solution.value_chips[0];
    let nash_conv = solution.exploitability.nash_conv_chips;
    let parameter_a = solved.frequencies.get(PARAMETER_FACT_ID).copied();

    let value_threshold = Threshold::at_most(value_abs.value, CHIPS);
    let floor_threshold = Threshold::at_most(floor.value, CHIPS);
    let thresholds = BTreeMap::from([
        (id("value-abs-error"), value_threshold.clone()),
        (id("nash-conv"), floor_threshold.clone()),
    ]);

    let mut measurements = vec![
        Measurement::informational(&id("value-player-0"), value, CHIPS),
        Measurement::judged(
            &id("value-abs-error"),
            (value - expected.value).abs(),
            CHIPS,
            value_threshold,
        ),
        // The floor is strict (plan section B), so the gate judges it and the report
        // carries the inclusive bound beside that verdict.
        Measurement::judged_as(
            &id("nash-conv"),
            nash_conv,
            CHIPS,
            floor_threshold,
            nash_conv < floor.value,
        ),
        Measurement::informational(
            &id("iterations"),
            iterations_as_f64(solution.iterations),
            "iterations",
        ),
    ];
    if let Some(parameter_a) = parameter_a {
        measurements.push(Measurement::informational(&id("parameter-a"), parameter_a, FREQUENCY));
    }
    measurements.extend(
        solved
            .frequencies
            .iter()
            .map(|(fact, frequency)| Measurement::informational(&id(fact), *frequency, FREQUENCY)),
    );
    let pass = measurements.iter().all(|measurement| measurement.pass.unwrap_or(true));

    Ok(GateReport {
        report: Gate::G1.report_id().to_owned(),
        r_ids: vec![Gate::G1.r_id().to_owned()],
        pass,
        thresholds,
        measurements,
        notes: notes(parameter_a),
    })
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

/// An iteration count as a report value. The stop rule caps it at 200,000, far inside
/// the range `f64` represents exactly.
#[allow(clippy::cast_precision_loss, reason = "iteration counts stay far below 2^53")]
fn iterations_as_f64(iterations: u64) -> f64 {
    iterations as f64
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
