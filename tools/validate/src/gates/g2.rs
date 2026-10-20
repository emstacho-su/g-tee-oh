//! Gate G2, the AKQ (ace, king, queen) game and the polar river toy (04 section 6,
//! R2.5). Owner: the G2 agent.
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

use std::collections::BTreeMap;
use std::path::PathBuf;

use gto_solve::toy::{StopRule, ToyGame, ToySolution, solve_dcfr};

use crate::fixtures::FixtureError;
use crate::fixtures::toy_game::{Case, Frequency, RatioFact, StrategyFact, ToyGameFixture};
use crate::report::{Measurement, Threshold};

use super::{Gate, GateError, GateReport, SolvedCase};

/// The stop rule: chunks of 1,000 iterations until `NashConv` is below 1e-5 chips or
/// 1,000,000 iterations have run.
const STOP: StopRule =
    StopRule { target_nash_conv_chips: 1e-5, max_iterations: 1_000_000, chunk: 1_000 };
/// Percentage points per frequency unit.
const POINTS_PER_UNIT: f64 = 100.0;
/// The unit the fixture states its tolerance in.
const POINTS_UNIT: &str = "percentage_points";
/// Measurement units.
const FREQUENCY: &str = "frequency";
const CHIPS: &str = "chips";
const ITERATIONS: &str = "iterations";
/// The fixture, relative to the repository root, for the notes and for errors.
const FIXTURE_PATH: &str = "validation/fixtures/toy-games/akq.json";
/// The three AKQ cases and the polar river case, by id.
const AKQ_CASES: [&str; 3] = ["pot1-bet-quarter", "pot1-bet-half", "pot1-bet-pot"];
const POLAR_RIVER_CASE: &str = "polar-river-pot-bet";

/// Which holdings play which part in the ratio formulas of one game.
struct Parts {
    /// Player 1's bluffing holdings at `open`.
    bluffs: &'static [&'static str],
    /// Player 1's value holdings at `open`.
    values: &'static [&'static str],
    /// Player 0's holdings at `facing_bet` that face a bluff: the defense share counts
    /// their calls.
    catchers: &'static [&'static str],
}

const AKQ_PARTS: Parts = Parts { bluffs: &["Q"], values: &["K", "A"], catchers: &["K", "A"] };
const POLAR_PARTS: Parts =
    Parts { bluffs: &["air"], values: &["nuts"], catchers: &["bluff_catcher"] };

/// A solved case with the iteration count the report records.
struct Solved {
    case: SolvedCase,
    iterations: u64,
}

/// Solve one AKQ or polar river case and read `NashConv`, every strategy fact and every
/// ratio fact.
///
/// # Errors
///
/// `GateError::UnknownCase` for a case id the gate does not model or a case without a
/// positive pot and bet, `GateError::MissingFact` when a fact's words resolve to nothing
/// in the solved game, a ratio id is not one of the three defined above, or a share's
/// denominator is zero.
pub fn solve_case(fixture: &ToyGameFixture, case: &Case) -> Result<SolvedCase, GateError> {
    solve(fixture, case).map(|solved| solved.case)
}

/// Run the gate on every case of the loaded fixture.
///
/// # Errors
///
/// Whatever [`solve_case`] reports for a case, and `GateError::Fixture` when the fixture
/// states no `frequency_points` tolerance in percentage points.
pub fn run(fixture: &ToyGameFixture) -> Result<GateReport, GateError> {
    let tolerance = frequency_tolerance(fixture)?;
    let measurements: Vec<Measurement> = fixture
        .cases
        .iter()
        .map(|case| case_measurements(fixture, case, tolerance))
        .collect::<Result<Vec<_>, _>>()?
        .into_iter()
        .flatten()
        .collect();
    let thresholds = measurements
        .iter()
        .filter_map(|measurement| {
            measurement.threshold.clone().map(|threshold| (measurement.id.clone(), threshold))
        })
        .collect();
    let pass = measurements.iter().all(|measurement| measurement.pass.unwrap_or(true));
    Ok(GateReport {
        report: Gate::G2.report_id().to_owned(),
        r_ids: vec![Gate::G2.r_id().to_owned()],
        pass,
        thresholds,
        measurements,
        notes: notes(tolerance),
    })
}

/// The game a case names, with the parts its ratio formulas use.
fn game_of(fixture: &ToyGameFixture, case: &Case) -> Result<(ToyGame, &'static Parts), GateError> {
    let pot = case.betting.dead_pot;
    let bet = case.betting.bet_sizes.first().copied().unwrap_or(0.0);
    if pot <= 0.0 || bet <= 0.0 {
        return Err(unknown_case(fixture, case));
    }
    if AKQ_CASES.contains(&case.id.as_str()) {
        Ok((ToyGame::Akq { pot, bet }, &AKQ_PARTS))
    } else if case.id == POLAR_RIVER_CASE {
        Ok((ToyGame::PolarRiver { pot, bet }, &POLAR_PARTS))
    } else {
        Err(unknown_case(fixture, case))
    }
}

fn solve(fixture: &ToyGameFixture, case: &Case) -> Result<Solved, GateError> {
    let (game, parts) = game_of(fixture, case)?;
    let solution = solve_dcfr(game, &STOP);
    let frequencies = case
        .strategy_facts
        .iter()
        .map(|fact| {
            solution
                .frequency(fact.player, &fact.node, &fact.holding, &fact.action)
                .map(|value| (fact.id.clone(), value))
                .ok_or_else(|| missing_fact(fixture, case, &fact.id))
        })
        .collect::<Result<BTreeMap<_, _>, _>>()?;
    let ratios = case
        .ratio_facts
        .iter()
        .map(|ratio| {
            ratio_value(&solution, parts, &ratio.id)
                .map(|value| (ratio.id.clone(), value))
                .ok_or_else(|| missing_fact(fixture, case, &ratio.id))
        })
        .collect::<Result<BTreeMap<_, _>, _>>()?;
    Ok(Solved {
        case: SolvedCase {
            game_value_player_0: solution.value_chips[0],
            exploitability_chips: solution.exploitability.nash_conv_chips,
            frequencies,
            ratios,
        },
        iterations: solution.iterations,
    })
}

/// The root-weighted mass of `action` over `holdings` at `node` and the holdings' total
/// weight: `(sum of weight * frequency, sum of weight)`. `None` when a holding or its
/// frequency is not in the solved game's vocabulary.
fn weighted(
    solution: &ToySolution,
    player: u8,
    node: &str,
    holdings: &[&str],
    action: &str,
) -> Option<(f64, f64)> {
    holdings.iter().try_fold((0.0, 0.0), |(mass, weight), holding| {
        let w = solution.root_weight(player, holding)?;
        let frequency = solution.frequency(player, node, holding, action)?;
        Some((mass + w * frequency, weight + w))
    })
}

/// `part / whole`, or `None` when there is no whole to take a share of.
fn share(part: f64, whole: f64) -> Option<f64> {
    (whole > 0.0).then(|| part / whole)
}

/// One ratio fact by id: bluffs as a share of all bets, or the calls of the holdings
/// that face a bluff as a share of their weight (the range-level defense for AKQ, the
/// bluff catcher's call for the polar game, one formula).
fn ratio_value(solution: &ToySolution, parts: &Parts, id: &str) -> Option<f64> {
    match id {
        "bluff-share-of-bets" => {
            let (bluff_bets, _) = weighted(solution, 1, "open", parts.bluffs, "bet")?;
            let (value_bets, _) = weighted(solution, 1, "open", parts.values, "bet")?;
            share(bluff_bets, bluff_bets + value_bets)
        }
        "defense-share-of-range" | "defense-share-of-bluff-catchers" => {
            let (calls, weight) = weighted(solution, 0, "facing_bet", parts.catchers, "call")?;
            share(calls, weight)
        }
        _ => None,
    }
}

/// The G2 tolerance in frequency units: the fixture's percentage points over 100.
fn frequency_tolerance(fixture: &ToyGameFixture) -> Result<f64, GateError> {
    let invalid = |reason: &str| {
        GateError::Fixture(FixtureError::Invalid {
            path: PathBuf::from(FIXTURE_PATH),
            reason: reason.to_owned(),
        })
    };
    let points =
        fixture.tolerances.frequency_points.as_ref().ok_or_else(|| {
            invalid("tolerances.frequency_points is null; gate G2 judges nothing")
        })?;
    if points.unit != POINTS_UNIT {
        return Err(invalid(&format!(
            "tolerances.frequency_points.unit is {}, gate G2 reads {POINTS_UNIT}",
            points.unit
        )));
    }
    Ok(points.value / POINTS_PER_UNIT)
}

/// Every measurement of one case: a judged one per strategy fact and per ratio fact,
/// then `NashConv` and the iteration count for the reader.
fn case_measurements(
    fixture: &ToyGameFixture,
    case: &Case,
    tolerance: f64,
) -> Result<Vec<Measurement>, GateError> {
    let solved = solve(fixture, case)?;
    let bindings = bind_parameters(case, &solved.case);
    let facts = case.strategy_facts.iter().map(|fact| {
        let (min, max) = fact_bounds(fixture, case, fact, &bindings)?;
        let value = solved
            .case
            .frequencies
            .get(&fact.id)
            .copied()
            .ok_or_else(|| missing_fact(fixture, case, &fact.id))?;
        Ok(judged(case, &fact.id, value, min, max, tolerance))
    });
    let ratios = case.ratio_facts.iter().map(|ratio: &RatioFact| {
        let value = solved
            .case
            .ratios
            .get(&ratio.id)
            .copied()
            .ok_or_else(|| missing_fact(fixture, case, &ratio.id))?;
        Ok(judged(case, &ratio.id, value, ratio.value, ratio.value, tolerance))
    });
    let informational = [
        Ok(Measurement::informational(
            &measurement_id(case, "nash-conv"),
            solved.case.exploitability_chips,
            CHIPS,
        )),
        Ok(Measurement::informational(
            &measurement_id(case, ITERATIONS),
            iterations_as_f64(solved.iterations),
            ITERATIONS,
        )),
    ];
    facts.chain(ratios).chain(informational).collect()
}

/// A frequency judged against `[min - tolerance, max + tolerance]`.
fn judged(case: &Case, fact: &str, value: f64, min: f64, max: f64, tolerance: f64) -> Measurement {
    let threshold = Threshold::between(min - tolerance, max + tolerance, FREQUENCY);
    Measurement::judged(&measurement_id(case, fact), value, FREQUENCY, threshold)
}

/// The closed interval a strategy fact pins before widening: a point for an exact or
/// affine fact, the fixture's range for a segment or parameter fact.
fn fact_bounds(
    fixture: &ToyGameFixture,
    case: &Case,
    fact: &StrategyFact,
    bindings: &BTreeMap<String, f64>,
) -> Result<(f64, f64), GateError> {
    match &fact.frequency {
        Frequency::Exact { value, .. } => Ok((*value, *value)),
        Frequency::Segment { min, max } | Frequency::Parameter { min, max, .. } => Ok((*min, *max)),
        Frequency::Affine { parameter, scale, offset } => {
            let bound =
                bindings.get(parameter).ok_or_else(|| missing_fact(fixture, case, &fact.id))?;
            let expected = scale * bound + offset;
            Ok((expected, expected))
        }
    }
}

/// The free parameters of an equilibrium family, bound from the solved frequencies.
fn bind_parameters(case: &Case, solved: &SolvedCase) -> BTreeMap<String, f64> {
    case.strategy_facts
        .iter()
        .filter_map(|fact| match &fact.frequency {
            Frequency::Parameter { name, .. } => {
                solved.frequencies.get(&fact.id).map(|actual| (name.clone(), *actual))
            }
            _ => None,
        })
        .collect()
}

fn measurement_id(case: &Case, fact: &str) -> String {
    format!("{}/{}/{fact}", Gate::G2.fixture_id(), case.id)
}

fn unknown_case(fixture: &ToyGameFixture, case: &Case) -> GateError {
    GateError::UnknownCase { fixture: fixture.id.clone(), case: case.id.clone() }
}

fn missing_fact(fixture: &ToyGameFixture, case: &Case, fact: &str) -> GateError {
    GateError::MissingFact {
        fixture: fixture.id.clone(),
        case: case.id.clone(),
        fact: fact.to_owned(),
    }
}

#[allow(clippy::cast_precision_loss, reason = "at most 1,000,000 iterations, exact in f64")]
fn iterations_as_f64(iterations: u64) -> f64 {
    iterations as f64
}

fn notes(tolerance: f64) -> String {
    format!(
        "DCFR default schedule (alpha 1.5, beta 0, gamma 2, no regret floor) in chunks of {} \
         iterations until NashConv < {} chips or {} iterations; every strategy fact and \
         ratio fact judged within {tolerance} in frequency units (the fixture's 0.5 \
         percentage points); bluff share = weighted bluff bets / weighted bets, defense \
         share = weighted calls of the holdings facing a bluff / their weight; fixture \
         {FIXTURE_PATH}",
        STOP.chunk, STOP.target_nash_conv_chips, STOP.max_iterations
    )
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use crate::fixtures::toy_game::ToyGameFixture;
    use crate::gates::{Gate, GateError, fixtures_dir, load_toy_game};

    use super::{run, solve_case};

    fn fixture() -> ToyGameFixture {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("..");
        load_toy_game(&fixtures_dir(&root), Gate::G2.fixture_id())
            .unwrap_or_else(|error| panic!("{error}"))
    }

    #[test]
    fn a_case_the_gate_does_not_model_is_an_unknown_case_error() {
        let fixture = fixture();
        let mut case = fixture.cases[0].clone();
        case.id = "pot1-bet-double".to_owned();
        match solve_case(&fixture, &case) {
            Err(GateError::UnknownCase { fixture: id, case: case_id }) => {
                assert_eq!((id.as_str(), case_id.as_str()), ("akq", "pot1-bet-double"));
            }
            other => panic!("expected UnknownCase, got {other:?}"),
        }
    }

    /// R2.5: the gate passes on the committed fixture and reports one judged measurement
    /// per fact plus the two informational ones per case.
    #[test]
    fn r2_5_run_passes_the_committed_fixture_with_one_measurement_per_fact() {
        let fixture = fixture();
        let report = run(&fixture).unwrap_or_else(|error| panic!("{error}"));
        assert_eq!(report.report, "g2-akq");
        assert_eq!(report.r_ids, vec!["R2.5".to_owned()]);
        let facts: usize =
            fixture.cases.iter().map(|c| c.strategy_facts.len() + c.ratio_facts.len()).sum();
        assert_eq!(report.measurements.len(), facts + 2 * fixture.cases.len());
        assert_eq!(report.thresholds.len(), facts, "one threshold per judged fact");
        let failed: Vec<_> =
            report.measurements.iter().filter(|m| m.pass == Some(false)).map(|m| &m.id).collect();
        assert!(report.pass, "failed measurements: {failed:?}");
        assert!(report.thresholds.contains_key("akq/polar-river-pot-bet/bluff-share-of-bets"));
        assert!(report.notes.contains(super::FIXTURE_PATH));
    }
}
