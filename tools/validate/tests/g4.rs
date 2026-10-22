//! Gate G4 tests (R2.11, 04 section 6): the public compare step of `validate g4` over two
//! node dumps and the hand-made spot list; the engine-side dump of one tiny river solve
//! is tested in `g4_engine.rs`, a binary of its own.
//!
//! Mechanism. The compare reads an engine dump and an oracle dump in the node-dump
//! schema (`packages/contracts/schemas/node-dump.schema.json`), refuses a dump that
//! breaks the criterion 2 invariants or whose action set or hand set differs from the
//! other dump's at a node (never a silent partial compare), then judges per gated spot:
//! both sides' exploitability at or below 0.3 percent of the pot, the reach-weighted
//! mean absolute frequency difference at the root strictly under 2 points (O-160), and
//! the root expected value (EV) within 0.3 percent of the pot. The tiny pair under
//! `validation/fixtures/g4/` is hand-made and synthetic (its README states the margins);
//! the failing twin trips each rule once. Identifiers: O-87 (the spot list name), O-125
//! (report names), O-135 (turn and river roots), O-160 to O-171 (the S17 answers).

use std::collections::BTreeSet;
use std::ops::RangeInclusive;
use std::path::{Path, PathBuf};

use gto_model::{NodeKey, Street};
use gto_solve::postflop::Range;
use library_pack::NodeDump;
use validate::fixtures::g4_spots::{
    EXPLOITABILITY_MAX_PCT_POT, FREQUENCY_MAD_MAX_POINTS, G4Spots, ROOT_EV_MAX_PCT_POT, Spot,
};
use validate::fixtures::{FIXTURES_RELATIVE_TO_REPO_ROOT, SCHEMA_VERSION};
use validate::gates::g4::{self, R_ID, REPORT_ID};
use validate::gates::{GateError, GateReport};
use validate::report::Measurement;

/// The committed spot list (O-87) and the tiny pair, relative to the fixture root.
const SPOT_LIST: &str = "g4-spots.json";
const TINY_SPOTS: &str = "g4/tiny-spots.json";
const ENGINE_TINY: &str = "g4/engine-tiny.json";
const ORACLE_TINY: &str = "g4/oracle-tiny.json";
const ORACLE_TINY_FAILING: &str = "g4/oracle-tiny-failing.json";

/// The one spot of the tiny pair and its root key.
const TINY_SPOT: &str = "tiny-river";
const TINY_ROOT_KEY: &str = "cfg_6_online_100/BB-BTN/r250.c|Ah7d2c|x.b275.c|Ks|x.b700.c|9h|";

/// R2.11 asks for at least four gated river and four gated turn spots.
const MIN_GATED_PER_STREET: usize = 4;
/// Live combos a side on each spot's board (plan section C.2).
const COMBOS_PER_SIDE: RangeInclusive<usize> = 100..=300;
/// The phrase the spot list's source entry must carry (O-26, ADR 0017).
const HAND_MADE: &str = "hand-made";

/// The margins the tiny pair's README states.
const TINY_FREQUENCY_MAD_POINTS: f64 = 0.7;
const TINY_EV_ABS_ERROR_PCT_POT: f64 = 0.136;
const TINY_ENGINE_EV_BB: f64 = 25.62;
const TINY_ORACLE_EV_BB: f64 = 25.586;
const TINY_HANDS: f64 = 3.0;
/// The failing twin's values, one edit per rule.
const FAILING_EXPLOITABILITY_PCT_POT: f64 = 0.31;
const FAILING_FREQUENCY_MAD_POINTS: f64 = 3.7;
const FAILING_EV_ABS_ERROR_PCT_POT: f64 = 1.868;

/// Closeness for numbers the fixtures state in decimal and the compare recomputes.
const CLOSE: f64 = 1e-9;

fn fixtures_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..").join(FIXTURES_RELATIVE_TO_REPO_ROOT)
}

fn load_spots(relative: &str) -> G4Spots {
    let path = fixtures_dir().join(relative);
    G4Spots::load(&path).unwrap_or_else(|error| panic!("{error}"))
}

fn load_dump(relative: &str) -> NodeDump {
    let path = fixtures_dir().join(relative);
    g4::load_dump(&path).unwrap_or_else(|error| panic!("{error}"))
}

fn measurement<'a>(report: &'a GateReport, id: &str) -> &'a Measurement {
    report
        .measurements
        .iter()
        .find(|measurement| measurement.id == id)
        .unwrap_or_else(|| panic!("no measurement {id} in {:?}", report.measurements))
}

fn judged_ids(report: &GateReport) -> BTreeSet<String> {
    report
        .measurements
        .iter()
        .filter(|measurement| measurement.threshold.is_some())
        .map(|measurement| measurement.id.clone())
        .collect()
}

fn failing_ids(report: &GateReport) -> BTreeSet<String> {
    report
        .measurements
        .iter()
        .filter(|measurement| measurement.pass == Some(false))
        .map(|measurement| measurement.id.clone())
        .collect()
}

fn assert_close(report: &GateReport, id: &str, expected: f64) {
    let value = measurement(report, id).value;
    assert!((value - expected).abs() < CLOSE, "{id}: {value} is not {expected}");
}

fn tiny_id(suffix: &str) -> String {
    format!("g4/{TINY_SPOT}/{suffix}")
}

/// A scratch file under cargo's test temp directory.
fn scratch(name: &str) -> PathBuf {
    let dir = Path::new(env!("CARGO_TARGET_TMPDIR")).join("g4");
    std::fs::create_dir_all(&dir).unwrap_or_else(|error| panic!("{}: {error}", dir.display()));
    dir.join(name)
}

/// The spot's ranges parse and leave 100 to 300 live combos a side on the board.
fn assert_ranges(spot: &Spot) {
    let key: NodeKey = spot.node_key.parse().unwrap_or_else(|error| panic!("{}: {error}", spot.id));
    let board = key.board().expect("a postflop key has a board").cards();
    for (notation, side) in [(spot.ranges.oop_notation(), "oop"), (spot.ranges.ip_notation(), "ip")]
    {
        let range = Range::parse(&notation).unwrap_or_else(|error| panic!("{}: {error}", spot.id));
        let live = range.live_combos(&board).len();
        assert!(COMBOS_PER_SIDE.contains(&live), "{} {side}: {live} live combos", spot.id);
    }
}

/// R2.11 (O-87): the committed spot list parses with `schema_version` 1, names at least
/// four gated river and four gated turn spots, every node key parses with a board and a
/// street equal to the spot's, both ranges parse with 100 to 300 live combos, the one
/// source entry says hand-made, and the three rules carry the 04 section 6 values.
#[test]
fn r2_11_g4_spots_fixture_parses_with_schema_version_1() {
    let spots = load_spots(SPOT_LIST);
    assert_eq!(spots.schema_version, SCHEMA_VERSION);
    assert_eq!(
        (spots.id.as_str(), spots.gate.as_str(), spots.r_id.as_str()),
        ("g4-spots", "G4", R_ID)
    );
    assert!(spots.sources.iter().any(|source| source.citation.contains(HAND_MADE)), "hand-made");
    let gated = |street: Street| {
        spots.spots.iter().filter(|spot| spot.gated && spot.street == street.as_str()).count()
    };
    assert!(
        gated(Street::River) >= MIN_GATED_PER_STREET,
        "{} gated river spots",
        gated(Street::River)
    );
    assert!(
        gated(Street::Turn) >= MIN_GATED_PER_STREET,
        "{} gated turn spots",
        gated(Street::Turn)
    );
    assert!(spots.spots.iter().any(|spot| !spot.gated), "the raked twins are informational");
    for spot in &spots.spots {
        let key: NodeKey = spot.node_key.parse().unwrap_or_else(|error| panic!("{error}"));
        let board = key.board().expect("a postflop key has a board");
        assert_eq!(gto_model::format_cards(&board.cards()), spot.board, "{}", spot.id);
        assert_eq!(key.street().as_str(), spot.street, "{}", spot.id);
        assert_eq!(key.config_id.as_str(), spots.config_id, "{}", spot.id);
        assert!(spot.pot_cbb > 0 && spot.stack_cbb > 0, "{}", spot.id);
        assert_ranges(spot);
    }
    let rules = &spots.rules;
    assert_eq!(
        (rules.exploitability_max.value, rules.exploitability_max.unit.as_str()),
        (0.3, "pct_pot")
    );
    assert_eq!(
        (rules.frequency_mad_max.value, rules.frequency_mad_max.unit.as_str()),
        (2.0, "percentage_points")
    );
    assert_eq!((rules.root_ev_max.value, rules.root_ev_max.unit.as_str()), (0.3, "pct_pot"));
    assert_eq!(rules.exploitability_max.value, EXPLOITABILITY_MAX_PCT_POT);
    assert_eq!(rules.frequency_mad_max.value, FREQUENCY_MAD_MAX_POINTS);
    assert_eq!(rules.root_ev_max.value, ROOT_EV_MAX_PCT_POT);
    assert!(!rules.frequency_mad_max.inclusive, "under 2 points is strict (04 section 6)");
}

/// R2.11: the compare of the tiny pair passes, judging the four rules of its one gated
/// spot, with the margins the fixture README states: frequency-mad 0.7 points, EV error
/// 0.136 percent of the pot, and the two exploitability figures of the dumps.
#[test]
fn r2_11_g4_compare_passes_on_the_tiny_pair() {
    let spots = load_spots(TINY_SPOTS);
    let report = g4::run(&spots, &load_dump(ENGINE_TINY), &load_dump(ORACLE_TINY))
        .unwrap_or_else(|error| panic!("{error}"));
    assert_eq!(report.report, REPORT_ID);
    assert_eq!(report.r_ids, vec![R_ID.to_owned()]);
    assert!(report.pass, "{:?}", failing_ids(&report));
    let expected: BTreeSet<String> = [
        "engine/exploitability",
        "oracle/exploitability",
        "root/frequency-mad",
        "root/ev-abs-error",
    ]
    .into_iter()
    .map(tiny_id)
    .collect();
    assert_eq!(judged_ids(&report), expected);
    assert_eq!(report.thresholds.len(), expected.len());
    assert_close(&report, &tiny_id("engine/exploitability"), 0.12);
    assert_close(&report, &tiny_id("oracle/exploitability"), 0.05);
    assert_close(&report, &tiny_id("root/frequency-mad"), TINY_FREQUENCY_MAD_POINTS);
    assert_close(&report, &tiny_id("root/ev-abs-error"), TINY_EV_ABS_ERROR_PCT_POT);
    assert_close(&report, &tiny_id("root/ev-engine-bb"), TINY_ENGINE_EV_BB);
    assert_close(&report, &tiny_id("root/ev-oracle-bb"), TINY_ORACLE_EV_BB);
    assert_close(&report, &tiny_id("root/hands-compared"), TINY_HANDS);
    assert_close(&report, &tiny_id("root/frequency-mad-unweighted"), 1.0);
    assert_close(&report, &tiny_id("root/frequency-max-abs-diff"), 0.02);
    assert_close(&report, &tiny_id("x/frequency-mad"), 0.5);
    assert_eq!(measurement(&report, &tiny_id("x/frequency-mad")).threshold, None);
    assert!(report.notes.contains("O-138"), "{}", report.notes);
}

/// R2.11: the failing twin fails exactly its three edited measurements, and the rule
/// boundaries hold: exploitability of exactly 0.3 passes, a frequency-mad of exactly 2.0
/// fails (strict), an EV error of exactly 0.3 passes.
#[test]
fn r2_11_g4_compare_fails_each_rule_on_the_failing_twin() {
    let spots = load_spots(TINY_SPOTS);
    let report = g4::run(&spots, &load_dump(ENGINE_TINY), &load_dump(ORACLE_TINY_FAILING))
        .unwrap_or_else(|error| panic!("{error}"));
    assert!(!report.pass);
    let expected: BTreeSet<String> =
        ["oracle/exploitability", "root/frequency-mad", "root/ev-abs-error"]
            .into_iter()
            .map(tiny_id)
            .collect();
    assert_eq!(failing_ids(&report), expected);
    assert_close(&report, &tiny_id("oracle/exploitability"), FAILING_EXPLOITABILITY_PCT_POT);
    assert_close(&report, &tiny_id("root/frequency-mad"), FAILING_FREQUENCY_MAD_POINTS);
    assert_close(&report, &tiny_id("root/ev-abs-error"), FAILING_EV_ABS_ERROR_PCT_POT);
    let rules = &spots.rules;
    assert_eq!(g4::judge(&rules.exploitability_max, "x", 0.3).pass, Some(true));
    assert_eq!(g4::judge(&rules.exploitability_max, "x", 0.31).pass, Some(false));
    assert_eq!(g4::judge(&rules.frequency_mad_max, "x", 2.0).pass, Some(false));
    assert_eq!(g4::judge(&rules.frequency_mad_max, "x", 1.99).pass, Some(true));
    assert_eq!(g4::judge(&rules.root_ev_max, "x", 0.3).pass, Some(true));
    assert_eq!(g4::judge(&rules.root_ev_max, "x", 0.31).pass, Some(false));
}

/// R2.11: an oracle dump whose root offers a renamed action, or lacks one of the engine's
/// hands, is refused with `GateError::Mismatch` naming the spot and the node.
#[test]
fn r2_11_g4_refuses_a_mismatched_action_set_or_hand_set() {
    let spots = load_spots(TINY_SPOTS);
    let engine = load_dump(ENGINE_TINY);
    let oracle = load_dump(ORACLE_TINY);
    let mut renamed = oracle.clone();
    let bet = root(&mut renamed).actions.iter_mut().find(|action| action.token == "b1875");
    let bet = bet.expect("the bet action");
    bet.token = "b1900".to_owned();
    bet.size_cbb = 1_900;
    let error = g4::run(&spots, &engine, &renamed).expect_err("a renamed token is refused");
    assert_mismatch(&error, "token");

    let mut short = oracle;
    root(&mut short).hands.retain(|hand| hand.hand != "6s5s");
    let error = g4::run(&spots, &engine, &short).expect_err("a missing hand is refused");
    assert_mismatch(&error, "hand");
}

/// The tiny spot's root node of `dump`, to edit.
fn root(dump: &mut NodeDump) -> &mut library_pack::DumpNode {
    let index = dump.nodes.iter().position(|node| node.node_key == TINY_ROOT_KEY);
    &mut dump.nodes[index.expect("the root node")]
}

fn assert_mismatch(error: &GateError, needle: &str) {
    match error {
        GateError::Mismatch { spot, node, reason } => {
            assert_eq!((spot.as_str(), node.as_str()), (TINY_SPOT, TINY_ROOT_KEY));
            assert!(reason.contains(needle), "{reason}");
        }
        other => panic!("expected a mismatch, got {other}"),
    }
}

/// R2.11: a dump whose hand frequencies sum to 1.01 is refused with `GateError::Dump`
/// carrying library-pack's rule 2 sentence.
#[test]
fn r2_11_g4_refuses_a_dump_that_breaks_the_node_dump_invariants() {
    let path = fixtures_dir().join(ENGINE_TINY);
    let text = std::fs::read_to_string(&path).unwrap_or_else(|error| panic!("{error}"));
    let sound = "\"frequencies\": [0.6, 0.4]";
    assert_eq!(text.matches(sound).count(), 1, "the air hand's row is written once");
    let broken = text.replace(sound, "\"frequencies\": [0.61, 0.4]");
    let bad = scratch("engine-bad-sum.json");
    std::fs::write(&bad, broken).unwrap_or_else(|error| panic!("{error}"));
    let error = g4::load_dump(&bad).expect_err("a broken dump is refused");
    match &error {
        GateError::Dump { path, violations } => {
            assert_eq!(path, &bad);
            let sentence = "has frequencies summing to 1.01, not 1 within 0.001.";
            assert!(violations.iter().any(|v| v.message.contains(sentence)), "{violations:?}");
        }
        other => panic!("expected a dump error, got {other}"),
    }
    assert!(error.to_string().contains("1.01"), "{error}");
}
