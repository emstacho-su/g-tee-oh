//! The engine side of gate G4 (R2.11, O-135): one tiny river solve through
//! `validate::gates::g4_engine`, its dump written and read back, and the compare of that
//! dump with itself. A test binary of its own, so the compare tests in `g4.rs` could go
//! green before the engine side existed and the one solve here runs on its own clock.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use gto_model::NodeKey;
use gto_solve::postflop::{NoProgress, ProgressSink, Range, StopReason};
use library_pack::{check_dump_structure, check_invariants, parse_dump};
use validate::fixtures::FIXTURES_RELATIVE_TO_REPO_ROOT;
use validate::fixtures::g4_spots::{G4Spots, RAKE_ONLINE, Spot};
use validate::gates::g4::{self, RunExtras};
use validate::gates::{GateError, GateReport, g4_engine};
use validate::report::Measurement;

/// The tiny spot one street earlier, a turn root, and the online rake's percent in basis
/// points (O-112).
const TINY_TURN_KEY: &str = "cfg_6_online_100/BB-BTN/r250.c|Ah7d2c|x.b275.c|Ks|";
const TINY_TURN_BOARD: &str = "Ah7d2cKs";
const TURN_POT_CBB: u32 = 1_100;
const TURN_STACK_CBB: u32 = 9_475;
const ONLINE_RAKE_PERCENT_BP: u16 = 500;
/// A few iterations: the turn test checks keys and conventions, not convergence.
const FEW_ITERATIONS: u32 = 5;

/// The tiny list, relative to the fixture root, its one spot and that spot's root key.
const TINY_SPOTS: &str = "g4/tiny-spots.json";
const TINY_SPOT: &str = "tiny-river";
const TINY_ROOT_KEY: &str = "cfg_6_online_100/BB-BTN/r250.c|Ah7d2c|x.b275.c|Ks|x.b700.c|9h|";
/// The `exported_at` the test writes, so the dump is the same on every run.
const EXPORTED_AT: &str = "2026-10-21T00:00:00Z";

/// Closeness for figures the compare recomputes from the dump it just wrote.
const CLOSE: f64 = 1e-9;
/// Closeness of the dump's root EV to the engine's best-response walk (f32 figures).
const EV_CHECK_BB: f64 = 1e-3;

fn fixtures_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..").join(FIXTURES_RELATIVE_TO_REPO_ROOT)
}

fn measurement<'a>(report: &'a GateReport, id: &str) -> &'a Measurement {
    report
        .measurements
        .iter()
        .find(|measurement| measurement.id == id)
        .unwrap_or_else(|| panic!("no measurement {id} in {:?}", report.measurements))
}

fn failing_ids(report: &GateReport) -> Vec<String> {
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

/// R2.11: the engine side solves the tiny river spot to the list's stop rule, writes a
/// dump that parses back with no invariant violation, whose root hands are the actor's
/// live combos, and that compares with itself at zero frequency-mad and zero EV error;
/// its root EV agrees with the best-response walk within 1e-3 bb.
#[test]
fn r2_11_g4_engine_dump_from_a_river_solve_compares_with_itself() {
    let spots = G4Spots::load(&fixtures_dir().join(TINY_SPOTS)).unwrap_or_else(|e| panic!("{e}"));
    let spot = spots.spots.first().expect("the tiny list has one spot");
    let solve = g4_engine::solve_spot(&spots, spot, &NoProgress).unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(solve.report.stop_reason, StopReason::Target, "{:?}", solve.report);
    let dump = g4_engine::engine_dump(&spots, std::slice::from_ref(&solve), EXPORTED_AT)
        .unwrap_or_else(|error| panic!("{error}"));
    let path = scratch("engine-tiny-solved.json");
    g4_engine::write_dump(&dump, &path).unwrap_or_else(|error| panic!("{error}"));
    let bytes = std::fs::read(&path).unwrap_or_else(|error| panic!("{error}"));
    let reread = parse_dump(&bytes).unwrap_or_else(|violations| panic!("{violations:?}"));
    assert_eq!(check_invariants(&reread), Vec::new(), "the written dump keeps every invariant");
    assert_eq!(check_dump_structure(&reread), Vec::new(), "and every node check (F4)");
    g4::check_dump(&dump, "the solved dump").unwrap_or_else(|error| panic!("{error}"));
    assert_eq!(reread, dump);

    let extras = RunExtras { facts: vec![solve.facts.clone()], ..RunExtras::default() };
    let report = g4::run_with(&spots, &reread, &reread, &extras).unwrap_or_else(|e| panic!("{e}"));
    assert!(report.pass, "{:?}", failing_ids(&report));
    assert_close(&report, &tiny_id("root/frequency-mad"), 0.0);
    assert_close(&report, &tiny_id("root/ev-abs-error"), 0.0);
    let check = measurement(&report, &tiny_id("root/ev-engine-vs-best-response-bb")).value;
    assert!(check.abs() < EV_CHECK_BB, "root EV against best response: {check}");
    assert!(report.notes.contains("stopped on target"), "{}", report.notes);

    let key: NodeKey = TINY_ROOT_KEY.parse().expect("the root key");
    let board = key.board().expect("a river board").cards();
    let range = Range::parse(&spot.ranges.oop_notation()).expect("the oop range");
    let live: BTreeSet<String> =
        range.live_combos(&board).iter().map(ToString::to_string).collect();
    let root = reread.nodes.iter().find(|node| node.node_key == TINY_ROOT_KEY).expect("root");
    let hands: BTreeSet<String> = root.hands.iter().map(|hand| hand.hand.clone()).collect();
    assert_eq!(hands, live);
    assert_eq!(root.to_act, "BB");
    assert_eq!(reread.nodes.len(), 6, "every decision node of the river tree is dumped");
}

/// The tiny spot as a raked turn root (O-161), with the list's stop rule cut to a few
/// iterations.
fn raked_turn_list() -> G4Spots {
    let mut spots =
        G4Spots::load(&fixtures_dir().join(TINY_SPOTS)).unwrap_or_else(|e| panic!("{e}"));
    let base = spots.spots.first().expect("the tiny list has one spot");
    let spot = Spot {
        id: "tiny-turn-raked".to_owned(),
        street: "turn".to_owned(),
        board: TINY_TURN_BOARD.to_owned(),
        pot_cbb: TURN_POT_CBB,
        stack_cbb: TURN_STACK_CBB,
        node_key: TINY_TURN_KEY.to_owned(),
        rake: RAKE_ONLINE.to_owned(),
        gated: false,
        ..base.clone()
    };
    spots.spots = vec![spot];
    spots.stop.engine_target_pct_pot = 0.0;
    spots.stop.max_iterations = FEW_ITERATIONS;
    spots
}

/// R2.11 (O-135, O-161, O-164): a turn root solves to the iteration cap with the online
/// rake on the stake, its deeper node keys append the line to the turn section, every
/// node sits on the turn board, the dump carries the exploitability pair, a preflop kind
/// the tree does not know is a solve error naming the spot, and the progress sink prints
/// only measured iterations.
#[test]
fn r2_11_g4_engine_turn_root_keys_rake_and_errors() {
    let spots = raked_turn_list();
    let spot = &spots.spots[0];
    let problem = g4_engine::problem_for(&spots, spot).unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(problem.config.stake.rake.percent_bp, ONLINE_RAKE_PERCENT_BP, "raked twin");
    let solve = g4_engine::solve_spot(&spots, spot, &NoProgress).unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(solve.facts.stop_reason, "max-iterations");
    assert_eq!(solve.report.stop_reason, StopReason::MaxIterations);
    let dump = g4_engine::engine_dump(&spots, std::slice::from_ref(&solve), EXPORTED_AT)
        .unwrap_or_else(|error| panic!("{error}"));
    assert_eq!(dump.exploitability_pct_pot.as_ref().map(Vec::len), Some(2));
    assert_eq!(dump.nodes[0].node_key, TINY_TURN_KEY);
    assert!(dump.nodes.iter().any(|node| node.node_key == format!("{TINY_TURN_KEY}x")));
    for node in &dump.nodes {
        assert_eq!((node.street.as_str(), node.board.as_str()), ("turn", TINY_TURN_BOARD));
        assert!(node.node_key.starts_with(TINY_TURN_KEY), "{}", node.node_key);
    }
    let report = g4::run(&spots, &dump, &dump).unwrap_or_else(|e| panic!("{e}"));
    assert!(report.pass, "a raked twin is informational, so nothing is judged");
    assert!(report.thresholds.is_empty());

    let mut odd = spots.clone();
    odd.spots[0].preflop.kind = "weird".to_owned();
    let error = g4_engine::problem_for(&odd, &odd.spots[0]).expect_err("an unknown kind");
    assert!(
        matches!(&error, GateError::Solve { spot, .. } if spot == "tiny-turn-raked"),
        "{error}"
    );
    assert!(error.to_string().contains("weird"), "{error}");

    let sink = g4_engine::SpotProgress { spot: spot.id.clone() };
    sink.report(1, None);
    sink.report(10, Some([0.5, 0.25]));
}
