//! The engine side of gate G4 (R2.11, O-135): one tiny river solve through
//! `validate::gates::g4_engine`, its dump written and read back, and the compare of that
//! dump with itself. A test binary of its own, so the compare tests in `g4.rs` could go
//! green before the engine side existed and the one solve here runs on its own clock.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use gto_model::NodeKey;
use gto_solve::postflop::{NoProgress, Range, StopReason};
use library_pack::{check_invariants, parse_dump};
use validate::fixtures::FIXTURES_RELATIVE_TO_REPO_ROOT;
use validate::fixtures::g4_spots::G4Spots;
use validate::gates::g4::{self, RunExtras};
use validate::gates::{GateReport, g4_engine};
use validate::report::Measurement;

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
