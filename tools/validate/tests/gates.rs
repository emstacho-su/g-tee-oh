//! Gate tests for `tools/validate`: the fixture loading tests of requirement identifier
//! (R ID) R0.11 and the toy-game gates G1 to G3 of 04 section 6 (R2.4 to R2.6).
//!
//! Two kinds of test live here. The loading tests prove the fixture files under
//! `validation/fixtures/` exist, parse through serde with the closed field set the
//! fixtures README documents, and carry `schema_version` 1. The gate tests run the
//! engine through `gto-solve`: two helpers call `validate::gates::solve_case` and
//! `validate::gates::solve_leduc_curve`, the same code path the `validate gates`
//! subcommand writes its reports from, and each test body is the gate's pass rule
//! written as assertions against what they return.
//!
//! Identifiers cited: O-30 (the `OpenSpiel` curve fixture), O-79 (the G3 tolerance),
//! O-128 (the curve's alternating updates), R2.4 to R2.6 (09 section 6) and success
//! criterion 1 (09 section 7, row 1). CFR is counterfactual regret minimization.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use validate::fixtures::openspiel::OpenSpielCurve;
use validate::fixtures::toy_game::{Case, Frequency, ToyGameFixture};
use validate::fixtures::{FIXTURES_RELATIVE_TO_REPO_ROOT, SCHEMA_VERSION};

/// Each toy game with the gate and the requirement 09 section 6 assigns it.
const TOY_GAMES: [(&str, &str, &str); 3] =
    [("kuhn", "G1", "R2.4"), ("akq", "G2", "R2.5"), ("leduc", "G3", "R2.6")];

/// The checkpoint schedule `leduc_curve.py` ran (O-30).
const CURVE_ITERATIONS: [u64; 5] = [1, 10, 100, 1000, 5000];

/// Every file the fixtures README must name.
const FIXTURE_FILES: [&str; 6] = [
    "toy-games/kuhn.json",
    "toy-games/akq.json",
    "toy-games/leduc.json",
    "openspiel/leduc_curve.py",
    "openspiel/leduc_exploitability.json",
    "openspiel/PROVENANCE.md",
];

/// Closeness for numbers the fixture states exactly and the test restates in code.
const EXACT: f64 = 1e-15;

fn fixtures_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..").join(FIXTURES_RELATIVE_TO_REPO_ROOT)
}

fn load_toy_game(id: &str) -> ToyGameFixture {
    let path = fixtures_dir().join("toy-games").join(format!("{id}.json"));
    ToyGameFixture::load(&path).unwrap_or_else(|error| panic!("{error}"))
}

fn load_curve(fixture: &ToyGameFixture) -> OpenSpielCurve {
    let reference = fixture.curve.as_ref().expect("the fixture names its curve");
    let path = fixtures_dir().join(&reference.file);
    OpenSpielCurve::load(&path).unwrap_or_else(|error| panic!("{error}"))
}

fn read_fixture_text(relative: &str) -> String {
    let path = fixtures_dir().join(relative);
    std::fs::read_to_string(&path).unwrap_or_else(|error| panic!("{}: {error}", path.display()))
}

// Loading tests: green now, they prove the files exist and parse (R0.11).

/// R0.11: every toy-game fixture parses with the closed field set, carries
/// `schema_version` 1, and names the gate and the R ID the roadmap assigns it.
#[test]
fn r0_11_toy_game_fixtures_parse_with_schema_version_1() {
    for (id, gate, r_id) in TOY_GAMES {
        let fixture = load_toy_game(id);
        assert_eq!(fixture.schema_version, SCHEMA_VERSION, "{id}");
        assert_eq!(fixture.id, id);
        assert_eq!(fixture.gate, gate, "{id}");
        assert_eq!(fixture.r_id, r_id, "{id}");
        assert_eq!(fixture.players, 2, "{id}");
        assert!(!fixture.sources.is_empty(), "{id} names no source");
        assert!(!fixture.notes.is_empty(), "{id} carries no notes");
        let deck = &fixture.deck;
        assert_eq!(deck.ranks.len() * usize::from(deck.suits), usize::from(deck.cards), "{id}");
        for case in &fixture.cases {
            assert_eq!(case.betting.unit, "chips", "{id} case {}", case.id);
            assert_eq!(case.betting.bet_sizes.len(), usize::from(case.betting.rounds), "{id}");
        }
    }
}

/// R0.11: the Kuhn file carries the G1 numbers, the value minus 1/18 for player 0 and
/// both tolerances, plus the full equilibrium family (two players, two decision points
/// each, three cards).
#[test]
fn r0_11_kuhn_fixture_carries_the_g1_numbers() {
    let fixture = load_toy_game("kuhn");
    let case = fixture.case("standard").expect("kuhn has the standard case");
    let value = case.game_value.as_ref().expect("kuhn states its game value");
    assert_eq!(value.player, 0);
    assert!((value.value - (-1.0 / 18.0)).abs() < EXACT, "value {}", value.value);
    assert_eq!(value.exact.as_deref(), Some("-1/18"));
    assert!(fixture.tolerances.game_value_abs.is_some(), "G1 value tolerance");
    assert!(fixture.tolerances.exploitability_max.is_some(), "G1 exploitability floor");
    assert_eq!(case.strategy_facts.len(), 12);
}

/// R0.11: the AKQ file carries the three AKQ bet sizes, the polar river toy and the
/// G2 numbers 04 section 6 states for a pot sized polar bet.
#[test]
fn r0_11_akq_fixture_carries_the_g2_cases() {
    let fixture = load_toy_game("akq");
    for id in ["pot1-bet-quarter", "pot1-bet-half", "pot1-bet-pot", "polar-river-pot-bet"] {
        assert!(fixture.case(id).is_some(), "akq is missing case {id}");
    }
    let points = fixture.tolerances.frequency_points.as_ref().expect("G2 states its tolerance");
    assert!((points.value - 0.5).abs() < EXACT, "G2 tolerance {}", points.value);
    assert_eq!(points.unit, "percentage_points");
    let polar = fixture.case("polar-river-pot-bet").expect("checked above");
    let bluff = polar.ratio_fact("bluff-share-of-bets").expect("bluff share");
    assert!((bluff.value - 1.0 / 3.0).abs() < EXACT, "bluff share {}", bluff.value);
    let defense = polar.ratio_fact("defense-share-of-bluff-catchers").expect("defense share");
    assert!((defense.value - 0.5).abs() < EXACT, "defense share {}", defense.value);
}

/// R0.11: the Leduc file points at the committed curve and its provenance note, and
/// carries the O-79 tolerance pair.
#[test]
fn r0_11_leduc_fixture_references_the_curve_and_the_o79_tolerance() {
    let fixture = load_toy_game("leduc");
    let reference = fixture.curve.as_ref().expect("leduc names its curve");
    assert!(fixtures_dir().join(&reference.file).is_file(), "{}", reference.file);
    assert!(fixtures_dir().join(&reference.provenance).is_file(), "{}", reference.provenance);
    assert_eq!(reference.measure, "exploitability");
    let abs = fixture.tolerances.curve_abs.as_ref().expect("O-79 absolute part");
    let rel = fixture.tolerances.curve_rel.as_ref().expect("O-79 relative part");
    assert!((abs.value - 0.001).abs() < EXACT, "absolute {}", abs.value);
    assert!((rel.value - 0.1).abs() < EXACT, "relative {}", rel.value);
    assert_eq!(abs.unit, "chips");
    assert_eq!(rel.unit, "ratio");
}

/// R0.11 and O-30: the `OpenSpiel` curve parses, is plain CFR with alternating updates
/// (O-128: `CFRSolver` alternates whatever the first generator block said) at the
/// recorded schedule, and the provenance note names the version and the seed the file
/// carries.
#[test]
fn r0_11_openspiel_curve_parses_with_schema_version_1_and_provenance() {
    let fixture = load_toy_game("leduc");
    let curve = load_curve(&fixture);
    assert_eq!(curve.schema_version, SCHEMA_VERSION);
    assert_eq!(curve.game.name, "leduc_poker");
    assert_eq!(curve.generator.library, "open_spiel");
    assert!(!curve.generator.version.is_empty(), "version recorded");
    assert_eq!(curve.iterations(), CURVE_ITERATIONS);
    let generator = &curve.generator;
    let plain = !generator.regret_matching_plus && !generator.linear_averaging;
    assert!(plain, "the curve must come from plain CFR");
    assert!(generator.alternating_updates, "CFRSolver alternates its updates (O-128)");
    assert_eq!(curve.final_state.iterations, CURVE_ITERATIONS[CURVE_ITERATIONS.len() - 1]);
    assert!(curve.r_ids.iter().any(|r| r == "R2.6"), "curve serves R2.6");
    assert!(curve.o_ids.iter().any(|o| o == "O-30"), "curve answers O-30");

    let reference = fixture.curve.as_ref().expect("leduc names its curve");
    let provenance = read_fixture_text(&reference.provenance);
    assert!(provenance.contains(&generator.version), "PROVENANCE.md names the version");
    assert!(provenance.contains(&curve.seed.to_string()), "PROVENANCE.md names the seed");
}

/// R0.11: the fixtures README names every fixture file and links the reports README.
#[test]
fn r0_11_fixtures_readme_names_every_fixture_file() {
    let readme = read_fixture_text("README.md");
    for file in FIXTURE_FILES {
        assert!(readme.contains(file), "README.md does not name {file}");
    }
    assert!(readme.contains("validation/reports/README.md"), "README.md links the reports");
}

// Gate tests: the pass rules of G1 to G3 against the engine through `validate::gates`.

/// What `tools/validate` reports for one solved toy-game case (R2.4, R2.5): the game
/// value to player 0, the exploitability of the average strategy in chips, and the
/// solved frequency of every strategy fact and ratio fact the fixture names, keyed by
/// fact id.
struct SolvedCase {
    game_value_player_0: f64,
    exploitability_chips: f64,
    frequencies: BTreeMap<String, f64>,
    ratios: BTreeMap<String, f64>,
}

/// Solves one case through `validate::gates::solve_case`: the case's game is built in
/// `gto-solve` (Kuhn and AKQ wrap the engine's games, the polar river case is a game
/// `gto-solve` adds), solved with the engine's discounted CFR to the gate's stop rule,
/// and its average strategy read back in the fixture's vocabulary. A solve error panics
/// with its message.
fn solve_case(fixture: &ToyGameFixture, case: &Case) -> SolvedCase {
    let solved =
        validate::gates::solve_case(fixture, case).unwrap_or_else(|error| panic!("{error}"));
    SolvedCase {
        game_value_player_0: solved.game_value_player_0,
        exploitability_chips: solved.exploitability_chips,
        frequencies: solved.frequencies,
        ratios: solved.ratios,
    }
}

/// Runs `validate::gates::solve_leduc_curve`: the Leduc model in `gto-solve`, plain CFR
/// as `OpenSpiel`'s `CFRSolver` runs it (no regret matching plus, alternating updates,
/// uniform averaging, no discounting, O-124, O-128) in one continuous run, and the mean
/// best-response gain of the average strategy in chips, ante 1, at each requested
/// iteration.
fn solve_leduc_curve(iterations: &[u64]) -> Vec<(u64, f64)> {
    validate::gates::solve_leduc_curve(iterations)
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

/// Whether a solved frequency satisfies a fact within `tolerance` (a frequency, not
/// percentage points). The error names the expected value.
fn fact_error(
    frequency: &Frequency,
    actual: f64,
    tolerance: f64,
    bindings: &BTreeMap<String, f64>,
) -> Result<(), String> {
    let within_range = |min: f64, max: f64| {
        if actual >= min - tolerance && actual <= max + tolerance {
            Ok(())
        } else {
            Err(format!("{actual} is outside [{min}, {max}]"))
        }
    };
    match frequency {
        Frequency::Exact { value, .. } => within_range(*value, *value),
        Frequency::Segment { min, max } | Frequency::Parameter { min, max, .. } => {
            within_range(*min, *max)
        }
        Frequency::Affine { parameter, scale, offset } => {
            let bound = bindings
                .get(parameter)
                .ok_or_else(|| format!("parameter {parameter} is not bound"))?;
            let expected = scale * bound + offset;
            within_range(expected, expected)
        }
    }
}

/// R2.4, gate G1 (04 section 6): the solved Kuhn game value for player 0 is within
/// 0.001 of minus 1/18 and the exploitability of the average strategy is below 0.001
/// chips. Both numbers and both tolerances come from the fixture.
#[test]
fn r2_4_g1_kuhn_value_within_tolerance_and_exploitability_below_floor() {
    let fixture = load_toy_game("kuhn");
    let case = fixture.case("standard").expect("kuhn has the standard case");
    let expected = case.game_value.as_ref().expect("kuhn states its game value");
    let value_abs = fixture.tolerances.game_value_abs.as_ref().expect("G1 states it").value;
    let floor = fixture.tolerances.exploitability_max.as_ref().expect("G1 states it").value;

    let solved = solve_case(&fixture, case);

    let value_error = (solved.game_value_player_0 - expected.value).abs();
    assert!(
        value_error <= value_abs,
        "G1: player 0 value {} is {value_error} from {} ({:?}), tolerance {value_abs}",
        solved.game_value_player_0,
        expected.value,
        expected.exact
    );
    assert!(
        solved.exploitability_chips < floor,
        "G1: exploitability {} chips is not below {floor}",
        solved.exploitability_chips
    );
}

/// R2.5, gate G2 (04 section 6): every closed-form frequency of the AKQ cases and of
/// the polar river toy matches the solved average strategy within 0.5 percentage points.
/// Exact facts pin a value; at the pot sized AKQ bet the segment facts accept any point
/// of the equilibrium segment, and the range-level defense ratio is still exactly 1/2.
#[test]
fn r2_5_g2_akq_frequencies_match_closed_forms_within_half_a_point() {
    let fixture = load_toy_game("akq");
    let points = fixture.tolerances.frequency_points.as_ref().expect("G2 states it").value;
    let tolerance = points / 100.0;

    for case in &fixture.cases {
        let solved = solve_case(&fixture, case);
        let bindings = bind_parameters(case, &solved);
        for fact in &case.strategy_facts {
            let actual = solved
                .frequencies
                .get(&fact.id)
                .unwrap_or_else(|| panic!("G2: {} reports no frequency for {}", case.id, fact.id));
            if let Err(reason) = fact_error(&fact.frequency, *actual, tolerance, &bindings) {
                panic!(
                    "G2: {} {} (player {} {} {} {}): {reason}",
                    case.id, fact.id, fact.player, fact.node, fact.holding, fact.action
                );
            }
        }
        for ratio in &case.ratio_facts {
            let actual = solved
                .ratios
                .get(&ratio.id)
                .unwrap_or_else(|| panic!("G2: {} reports no ratio for {}", case.id, ratio.id));
            let error = (actual - ratio.value).abs();
            assert!(
                error <= tolerance,
                "G2: {} {} is {actual}, closed form {} = {} ({:?})",
                case.id,
                ratio.id,
                ratio.formula,
                ratio.value,
                ratio.exact
            );
        }
    }
}

/// R2.6, gate G3 (04 section 6, O-30, O-79): at every checkpoint iteration of the
/// committed `OpenSpiel` curve, the engine's exploitability of its average strategy is
/// within the larger of 0.001 absolute and 10 percent relative of the recorded value.
#[test]
fn r2_6_g3_leduc_exploitability_within_o79_tolerance_at_every_checkpoint() {
    let fixture = load_toy_game("leduc");
    let curve = load_curve(&fixture);
    let abs = fixture.tolerances.curve_abs.as_ref().expect("O-79 absolute part").value;
    let rel = fixture.tolerances.curve_rel.as_ref().expect("O-79 relative part").value;

    let engine = solve_leduc_curve(&curve.iterations());

    assert_eq!(engine.len(), curve.checkpoints.len(), "one engine reading per checkpoint");
    for (expected, (iteration, actual)) in curve.checkpoints.iter().zip(engine) {
        assert_eq!(expected.iteration, iteration, "checkpoints out of step");
        // O-79 pass rule: the larger of the absolute and the relative allowance.
        let allowed = abs.max(rel * expected.exploitability);
        let error = (actual - expected.exploitability).abs();
        assert!(
            error <= allowed,
            "G3: iteration {iteration}: engine {actual} and OpenSpiel {} differ by {error}, \
             allowed {allowed}",
            expected.exploitability
        );
    }
}
