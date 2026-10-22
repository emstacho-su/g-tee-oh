//! The node-walk rules of the G4 compare (R2.11, O-160): a spot's deeper nodes are the
//! keys that add actions to its root within the root street, never the nodes of a spot
//! one street on (review finding F2); a deeper node nobody reaches is skipped with a note
//! instead of aborting the run, while an unreached root is still refused (F3); both dumps
//! are held to library-pack's node checks, the in-memory engine dump included (F4); and
//! the report id is the one the command passes (F1). Built on the tiny pair under
//! `validation/fixtures/g4/` with nodes added or edited in memory.

use std::path::{Path, PathBuf};

use library_pack::{DumpAction, DumpNode, NodeDump};
use validate::fixtures::FIXTURES_RELATIVE_TO_REPO_ROOT;
use validate::fixtures::g4_spots::{G4Spots, Spot};
use validate::gates::g4::{self, REPORT_ID, RunExtras};
use validate::gates::{GateError, GateReport};

/// The tiny list and pair, relative to the fixture root.
const TINY_SPOTS: &str = "g4/tiny-spots.json";
const ENGINE_TINY: &str = "g4/engine-tiny.json";
const ORACLE_TINY: &str = "g4/oracle-tiny.json";

/// The tiny river root, its one deeper node, and the turn root one street earlier.
const TINY_SPOT: &str = "tiny-river";
const TINY_RIVER_KEY: &str = "cfg_6_online_100/BB-BTN/r250.c|Ah7d2c|x.b275.c|Ks|x.b700.c|9h|";
const TINY_RIVER_CHECKED_KEY: &str =
    "cfg_6_online_100/BB-BTN/r250.c|Ah7d2c|x.b275.c|Ks|x.b700.c|9h|x";
const TURN_SPOT: &str = "tiny-turn";
const TURN_KEY: &str = "cfg_6_online_100/BB-BTN/r250.c|Ah7d2c|x.b275.c|Ks|";
const TURN_BOARD: &str = "Ah7d2cKs";
const TURN_POT_CBB: u32 = 1_100;
const TURN_STACK_CBB: u32 = 9_475;
/// The 75 percent bet on the turn.
const TURN_BET_CBB: u32 = 825;

/// The index of the in-position seat in pair order.
const IP: usize = 1;

fn fixtures_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..").join(FIXTURES_RELATIVE_TO_REPO_ROOT)
}

fn load_spots() -> G4Spots {
    let path = fixtures_dir().join(TINY_SPOTS);
    G4Spots::load(&path).unwrap_or_else(|error| panic!("{error}"))
}

fn load_dump(relative: &str) -> NodeDump {
    let path = fixtures_dir().join(relative);
    g4::load_dump(&path).unwrap_or_else(|error| panic!("{error}"))
}

fn run(spots: &G4Spots, engine: &NodeDump, oracle: &NodeDump) -> GateReport {
    g4::run(spots, engine, oracle).unwrap_or_else(|error| panic!("{error}"))
}

fn value(report: &GateReport, id: &str) -> f64 {
    report
        .measurements
        .iter()
        .find(|measurement| measurement.id == id)
        .unwrap_or_else(|| panic!("no measurement {id} in {:?}", report.measurements))
        .value
}

fn has(report: &GateReport, id: &str) -> bool {
    report.measurements.iter().any(|measurement| measurement.id == id)
}

/// `dump` with `node` appended.
fn with_node(dump: &NodeDump, node: DumpNode) -> NodeDump {
    let nodes = dump.nodes.iter().cloned().chain(std::iter::once(node)).collect();
    NodeDump { nodes, ..dump.clone() }
}

/// `dump` with the node at `key` replaced by `edit(node)`.
fn edit_node(dump: &NodeDump, key: &str, edit: impl Fn(&DumpNode) -> DumpNode) -> NodeDump {
    let nodes = dump
        .nodes
        .iter()
        .map(|node| if node.node_key == key { edit(node) } else { node.clone() })
        .collect();
    NodeDump { nodes, ..dump.clone() }
}

/// `node` with every hand's reach for `seat` set to zero.
fn unreached(node: &DumpNode, seat: usize) -> DumpNode {
    let hands = node
        .hands
        .iter()
        .map(|hand| {
            let reach = hand.reach.as_ref().map(|reach| {
                reach.iter().enumerate().map(|(i, r)| if i == seat { 0.0 } else { *r }).collect()
            });
            library_pack::DumpHand { reach, ..hand.clone() }
        })
        .collect();
    DumpNode { hands, ..node.clone() }
}

/// The turn root one street before the tiny river spot, in `dump`'s river root's shape:
/// the same actor and hands, the turn pot, stacks and bet.
fn turn_root(dump: &NodeDump) -> DumpNode {
    let river = dump.nodes.iter().find(|node| node.node_key == TINY_RIVER_KEY).expect("the root");
    DumpNode {
        node_key: TURN_KEY.to_owned(),
        street: "turn".to_owned(),
        board: TURN_BOARD.to_owned(),
        pot_cbb: TURN_POT_CBB,
        stacks_cbb: vec![TURN_STACK_CBB, TURN_STACK_CBB],
        actions: vec![
            DumpAction { token: "x".to_owned(), size_cbb: 0 },
            DumpAction { token: format!("b{TURN_BET_CBB}"), size_cbb: TURN_BET_CBB },
        ],
        ..river.clone()
    }
}

/// The tiny list with the turn spot added before the river spot.
fn list_with_turn(spots: &G4Spots) -> G4Spots {
    let river = spots.spots.first().expect("the tiny list has one spot");
    let turn = Spot {
        id: TURN_SPOT.to_owned(),
        street: "turn".to_owned(),
        board: TURN_BOARD.to_owned(),
        pot_cbb: TURN_POT_CBB,
        stack_cbb: TURN_STACK_CBB,
        node_key: TURN_KEY.to_owned(),
        ..river.clone()
    };
    G4Spots { spots: vec![turn, river.clone()], ..spots.clone() }
}

/// R2.11 (review finding F2): with a turn spot and the river spot that extends it in one
/// list, the river root and its deeper node belong to the river spot only; the turn spot
/// compares its root alone, so its nodes-compared count is 1 and it carries no row for a
/// node on the river.
#[test]
fn r2_11_g4_deeper_nodes_stay_within_the_root_street() {
    let spots = list_with_turn(&load_spots());
    let engine = load_dump(ENGINE_TINY);
    let oracle = load_dump(ORACLE_TINY);
    let turn = turn_root(&engine);
    let engine = with_node(&engine, turn.clone());
    let oracle = with_node(&oracle, turn);
    let report = run(&spots, &engine, &oracle);
    assert!(report.pass, "{:?}", report.measurements);
    assert_eq!(value(&report, &format!("g4/{TURN_SPOT}/nodes/compared")), 1.0);
    assert_eq!(value(&report, &format!("g4/{TINY_SPOT}/nodes/compared")), 2.0);
    let on_river = report
        .measurements
        .iter()
        .filter(|m| m.id.starts_with(&format!("g4/{TURN_SPOT}/")) && m.id.contains('|'))
        .map(|m| m.id.clone())
        .collect::<Vec<_>>();
    assert!(on_river.is_empty(), "the turn spot absorbed river nodes: {on_river:?}");
    assert!(has(&report, &format!("g4/{TINY_SPOT}/x/frequency-mad")));
}

/// R2.11 (review finding F3): a deeper node whose actor has zero reach on either side is
/// skipped, not fatal: the compare passes, the node's informational row is absent, the
/// nodes-compared count leaves it out and the notes name it; an unreached root is still
/// refused with a mismatch naming the spot and the root.
#[test]
fn r2_11_g4_skips_an_unreached_deeper_node_and_refuses_an_unreached_root() {
    let spots = load_spots();
    let engine = load_dump(ENGINE_TINY);
    let oracle = load_dump(ORACLE_TINY);
    let checked = TINY_RIVER_CHECKED_KEY;
    let row = format!("g4/{TINY_SPOT}/x/frequency-mad");
    let compared = format!("g4/{TINY_SPOT}/nodes/compared");
    for (side, engine_side, oracle_side) in [
        ("engine", edit_node(&engine, checked, |n| unreached(n, IP)), oracle.clone()),
        ("oracle", engine.clone(), edit_node(&oracle, checked, |n| unreached(n, IP))),
    ] {
        let report = run(&spots, &engine_side, &oracle_side);
        assert!(report.pass, "{side}: {:?}", report.measurements);
        assert!(!has(&report, &row), "{side}: the unreached node has a row");
        assert_eq!(value(&report, &compared), 1.0, "{side}");
        assert!(report.notes.contains(checked), "{side}: {}", report.notes);
        assert!(report.notes.contains(side), "{side}: {}", report.notes);
    }
    let root = edit_node(&engine, TINY_RIVER_KEY, |n| unreached(n, 0));
    let error = g4::run(&spots, &root, &oracle).expect_err("an unreached root is refused");
    match &error {
        GateError::Mismatch { spot, node, reason } => {
            assert_eq!((spot.as_str(), node.as_str()), (TINY_SPOT, TINY_RIVER_KEY));
            assert!(reason.contains("reach"), "{reason}");
        }
        other => panic!("expected a mismatch, got {other}"),
    }
}

/// R2.11 (review finding F4): a dump whose node breaks a structural rule (a seat outside
/// the pair, a pot of zero, a bet token whose size differs from its token, a reach with
/// one entry) is refused with `GateError::Dump` naming the node, whether it comes from a
/// file through `load_dump` or sits in memory as the engine dump of this run.
#[test]
fn r2_11_g4_refuses_a_dump_whose_node_breaks_a_structural_rule() {
    let engine = load_dump(ENGINE_TINY);
    let checked = TINY_RIVER_CHECKED_KEY;
    let broken: [(&str, NodeDump); 4] = [
        (
            "seat",
            edit_node(&engine, checked, |n| DumpNode { to_act: "CO".to_owned(), ..n.clone() }),
        ),
        ("pot", edit_node(&engine, checked, |n| DumpNode { pot_cbb: 0, ..n.clone() })),
        (
            "size",
            edit_node(&engine, checked, |n| {
                let actions = n
                    .actions
                    .iter()
                    .map(|a| DumpAction {
                        size_cbb: if a.size_cbb == 0 { 0 } else { 1_900 },
                        ..a.clone()
                    })
                    .collect();
                DumpNode { actions, ..n.clone() }
            }),
        ),
        (
            "reach",
            edit_node(&engine, checked, |n| {
                let hands = n
                    .hands
                    .iter()
                    .map(|h| library_pack::DumpHand { reach: Some(vec![0.5]), ..h.clone() })
                    .collect();
                DumpNode { hands, ..n.clone() }
            }),
        ),
    ];
    for (name, dump) in &broken {
        let label = format!("engine dump {name}");
        let error = g4::check_dump(dump, &label).expect_err("a structural break is refused");
        match &error {
            GateError::Dump { dump: named, violations } => {
                assert_eq!(named, &label, "{name}");
                assert!(
                    violations.iter().any(|v| v.message.contains(checked)),
                    "{name}: {violations:?}"
                );
            }
            other => panic!("{name}: expected a dump error, got {other}"),
        }
        let path = scratch(&format!("engine-broken-{name}.json"));
        let text = serde_json::to_string_pretty(dump).unwrap_or_else(|error| panic!("{error}"));
        std::fs::write(&path, text).unwrap_or_else(|error| panic!("{error}"));
        let error = g4::load_dump(&path).expect_err("a structural break is refused from a file");
        assert!(
            matches!(&error, GateError::Dump { dump, .. } if *dump == path.display().to_string()),
            "{name}: {error}"
        );
        assert!(error.to_string().contains(checked), "{name}: {error}");
    }
    g4::check_dump(&engine, "the tiny engine dump").unwrap_or_else(|error| panic!("{error}"));
}

/// A scratch file under cargo's test temp directory.
fn scratch(name: &str) -> PathBuf {
    let dir = Path::new(env!("CARGO_TARGET_TMPDIR")).join("g4-compare");
    std::fs::create_dir_all(&dir).unwrap_or_else(|error| panic!("{}: {error}", dir.display()));
    dir.join(name)
}

/// R2.11 (review finding F1): the report id is `g4-oracle` by default and the one the
/// extras carry otherwise, so the raked list's run lands beside the gated one under its
/// own name.
#[test]
fn r2_11_g4_report_id_is_the_one_the_extras_carry() {
    let spots = load_spots();
    let engine = load_dump(ENGINE_TINY);
    let oracle = load_dump(ORACLE_TINY);
    assert_eq!(run(&spots, &engine, &oracle).report, REPORT_ID);
    let extras = RunExtras { report_id: "g4-oracle-raked".to_owned(), ..RunExtras::default() };
    let report =
        g4::run_with(&spots, &engine, &oracle, &extras).unwrap_or_else(|error| panic!("{error}"));
    assert_eq!(report.report, "g4-oracle-raked");
    assert_eq!(RunExtras::default().report_id, REPORT_ID);
}
