//! `POST /v1/grade` (R2.13, plan D.1 and D.6, ADR 0004, O-22). Written red in S16 step 2:
//! the handler is a stub answering 501 until lane A lands the grade math of plan C.2.
//! Every expected number here comes from a second, independent `gto_library::Reader` over
//! the same root or from the `gto-model` floor constants, never from the service.

mod common;

use std::path::Path;

use axum::http::StatusCode;
use gto_library::{FsStore, HandSpace, NodeView, Reader, ReaderOptions, SolutionHandle, loss_bb};
use gto_model::{
    Bucket, Cbb, HandClass, NOISE_FLOOR_PCT_POT_X100, PREFLOP_FLOOR_FALLBACK, Position,
};
use serde_json::Value;

use common::plant::{PLANTED_SOLUTION_ID, class_name, ids, line};
use common::{
    assert_problem, empty_root, f32_of, fold_call_raise, grade, hand, packed_fixture, planted_node,
    preflop_key, router_over, write_solution,
};

/// The grading noise floor in percent of the pot, from the gto-model constant (O-22).
#[expect(clippy::cast_precision_loss, reason = "the constant is 20")]
const NOISE_FLOOR_PCT_POT: f32 = NOISE_FLOOR_PCT_POT_X100 as f32 / 100.0;
/// Loss units per percent of the pot (A3 section 4: a unit is 0.01 percent).
const UNITS_PER_PCT: f32 = 100.0;
/// How close a floor must be to its expected value.
const FLOOR_TOLERANCE: f32 = 1e-5;
/// A second solution id beside the fixture's.
const FALLBACK_ID: &str = "aaaaaaaa-1111-4222-8333-444444444444";
/// A third solution id, with a manifest exploitability.
const EXPLOITABILITY_ID: &str = "bbbbbbbb-1111-4222-8333-444444444444";

/// An independent reader over `root` with `prefix` opened.
fn open(root: &Path, prefix: &str) -> (Reader<FsStore>, SolutionHandle) {
    let store = FsStore::new(root).expect("the root exists");
    let reader = Reader::new(store, ReaderOptions::default());
    let handle = reader.open(prefix).expect("the solution opens");
    (reader, handle)
}

/// The floor the O-22 precedence gives a record with `accuracy`, else the 0.02 bb fallback.
fn expected_floor(accuracy: Option<f32>, pot: Cbb) -> f32 {
    #[expect(clippy::cast_precision_loss, reason = "pots are far below 2^24 cbb")]
    let fallback = PREFLOP_FLOOR_FALLBACK.get() as f32 / pot.get() as f32 * 100.0;
    accuracy.unwrap_or(fallback).max(NOISE_FLOOR_PCT_POT)
}

/// The first action of `hand` with zero loss: the best action (O-130).
fn best_action(view: &NodeView, hand: u16) -> usize {
    (0..view.actions().len())
        .find(|action| view.loss_units(hand, *action) == Some(0))
        .expect("the best action has loss 0")
}

/// A hand and action of the node with a nonzero loss.
fn losing_decision(view: &NodeView) -> (u16, usize, u16) {
    view.hands()
        .into_iter()
        .flat_map(|hand| (0..view.actions().len()).map(move |action| (hand, action)))
        .find_map(|(hand, action)| {
            let units = view.loss_units(hand, action)?;
            (units > 0).then_some((hand, action, units))
        })
        .expect("some action loses")
}

#[tokio::test]
async fn r2_13_grade_reports_loss_in_bb_and_pct_pot_with_the_floor() {
    let fixture = packed_fixture();
    let (reader, handle) = open(&fixture.root, &fixture.prefix);
    let index = fixture
        .nodes
        .iter()
        .position(|n| n.accuracy_pct_pot.is_some_and(|a| a > NOISE_FLOOR_PCT_POT))
        .expect("a node whose accuracy is above the noise floor");
    let node = &fixture.nodes[index];
    let key = node.key.to_string();
    let view = reader.node(handle, &node.key).expect("the node reads");
    let record = view.record();
    let (hand, action, units) = losing_decision(&view);
    let label = class_name(hand);

    let (status, _, json) =
        grade(fixture.router(), &fixture.solution_id, &key, &label, action).await;
    assert_eq!(status, StatusCode::OK, "body was {json}");
    assert_eq!(
        f32_of(&json["loss_pct_pot"]).to_bits(),
        (f32::from(units) / UNITS_PER_PCT).to_bits()
    );
    assert_eq!(f32_of(&json["loss_bb"]).to_bits(), loss_bb(units, record.pot).to_bits(), "{json}");
    let chosen = view.ev_bb(hand, action).expect("an EV");
    assert_eq!(f32_of(&json["ev_chosen_bb"]).to_bits(), chosen.to_bits(), "{json}");
    let best = best_action(&view, hand);
    let best_ev = view.ev_bb(hand, best).expect("an EV");
    assert_eq!(f32_of(&json["ev_best_bb"]).to_bits(), best_ev.to_bits(), "{json}");
    assert_eq!(json["best_action_index"], best, "{json}");
    let token = record.actions[action].token;
    let bucket = Bucket::of_action(token, record.pot).expect("a bucket").map(Bucket::as_str);
    assert_eq!(json["bucket"].as_str(), bucket, "{json}");
    let accuracy = record.accuracy_pct_pot.expect("the record carries an accuracy");
    let floor = f32_of(&json["floor_pct_pot"]);
    assert!((floor - accuracy.max(NOISE_FLOOR_PCT_POT)).abs() < FLOOR_TOLERANCE, "{json}");
    assert_eq!(json["floor_source"], "node_accuracy", "{json}");

    let (status, _, json) = grade(fixture.router(), &fixture.solution_id, &key, &label, best).await;
    assert_eq!(status, StatusCode::OK, "body was {json}");
    assert_eq!(f32_of(&json["loss_bb"]).to_bits(), 0_f32.to_bits(), "{json}");
    assert_eq!(f32_of(&json["loss_pct_pot"]).to_bits(), 0_f32.to_bits(), "{json}");

    let out_of_range = record.actions.len();
    let (status, headers, json) =
        grade(fixture.router(), &fixture.solution_id, &key, &label, out_of_range).await;
    assert_problem(status, &headers, &json, StatusCode::BAD_REQUEST, "bad-request");
}

#[tokio::test]
async fn r3_7_grade_returns_the_loss_of_every_action_for_grouped_and_simple_modes() {
    // O-210: the per-action losses come from Rust so packages/learning never recomputes one
    // (ADR 0004); the entry at the chosen index equals the scalar loss_pct_pot.
    let fixture = packed_fixture();
    let (reader, handle) = open(&fixture.root, &fixture.prefix);
    let node = &fixture.nodes[0];
    let key = node.key.to_string();
    let view = reader.node(handle, &node.key).expect("the node reads");
    let (hand, action, _) = losing_decision(&view);

    let (status, _, json) =
        grade(fixture.router(), &fixture.solution_id, &key, &class_name(hand), action).await;

    assert_eq!(status, StatusCode::OK, "body was {json}");
    let by_action = json["loss_pct_pot_by_action"].as_array().expect("an array");
    assert_eq!(by_action.len(), view.actions().len(), "{json}");
    for (index, value) in by_action.iter().enumerate() {
        let units = view.loss_units(hand, index).expect("a loss");
        assert_eq!(f32_of(value).to_bits(), (f32::from(units) / UNITS_PER_PCT).to_bits());
    }
    assert_eq!(by_action[action], json["loss_pct_pot"], "{json}");
}

#[tokio::test]
async fn r2_13_grade_floor_falls_back_to_0_02_bb_without_accuracy() {
    let (_dir, root) = empty_root();
    let (config_id, pair) = ids();
    let pot = Cbb(300);
    let hands = vec![hand(0, [1.0, 1.0], vec![0.0, 1.0, 0.0], vec![-1.0, 0.0, -0.5])];
    let key = preflop_key(&config_id, pair, line(250));
    let node = planted_node(
        key.clone(),
        Position::Bb,
        pot,
        fold_call_raise(),
        HandSpace::Preflop169,
        hands,
        None,
    );
    write_solution(&root, FALLBACK_ID, std::slice::from_ref(&node), None);
    write_solution(&root, EXPLOITABILITY_ID, std::slice::from_ref(&node), Some([0.3, 0.45]));
    let router = router_over(&root);

    let (status, _, json) = grade(router.clone(), FALLBACK_ID, &key.to_string(), "AA", 1).await;
    assert_eq!(status, StatusCode::OK, "body was {json}");
    let floor = f32_of(&json["floor_pct_pot"]);
    assert!((floor - expected_floor(None, pot)).abs() < FLOOR_TOLERANCE, "{json}");
    assert_eq!(json["floor_source"], "fallback_bb", "{json}");

    let (status, _, json) = grade(router, EXPLOITABILITY_ID, &key.to_string(), "AA", 1).await;
    assert_eq!(status, StatusCode::OK, "body was {json}");
    let floor = f32_of(&json["floor_pct_pot"]);
    assert!((floor - 0.45).abs() < FLOOR_TOLERANCE, "the larger seat's exploitability: {json}");
    assert_eq!(json["floor_source"], "exploitability", "{json}");
}

/// The noise flags of a grade answer as strings.
fn flags(json: &Value) -> Vec<String> {
    json["noise_flags"]
        .as_array()
        .expect("noise_flags is an array")
        .iter()
        .map(|flag| flag.as_str().expect("a flag").to_owned())
        .collect()
}

#[tokio::test]
async fn r2_13_grade_noise_flags_on_hand_built_nodes() {
    let (_dir, root) = empty_root();
    let (config_id, pair) = ids();
    // A 10 bb pot with a 0.5 percent floor: 0.05 bb. AA mixes call and raise 0.03 bb apart
    // (0.3 percent, under the floor), KK reaches the node 0.1 percent of the time for the
    // seat to act (the out-of-position seat), QQ raises purely with a 5 percent call loss.
    let pot = Cbb(1_000);
    let hands = vec![
        hand(0, [1.0, 1.0], vec![0.0, 0.5, 0.5], vec![-1.0, 0.97, 1.0]),
        hand(1, [0.001, 1.0], vec![0.0, 0.0, 1.0], vec![-1.0, -0.5, 1.0]),
        hand(2, [1.0, 1.0], vec![0.0, 0.0, 1.0], vec![-1.0, 0.5, 1.0]),
    ];
    let key = preflop_key(&config_id, pair, line(250));
    let node = planted_node(
        key.clone(),
        Position::Bb,
        pot,
        fold_call_raise(),
        HandSpace::Preflop169,
        hands,
        Some(0.5),
    );
    write_solution(&root, PLANTED_SOLUTION_ID, &[node], None);
    let router = router_over(&root);
    let key = key.to_string();

    let (status, _, json) = grade(router.clone(), PLANTED_SOLUTION_ID, &key, "AA", 1).await;
    assert_eq!(status, StatusCode::OK, "body was {json}");
    assert_eq!(flags(&json), vec!["close_ev_mix"], "{json}");
    let features = &json["difficulty_features"];
    assert_eq!(features["mixed"], true, "{json}");
    assert_eq!(features["n_actions"], 3, "{json}");
    assert_eq!(features["all_within_floor"], false, "the fold loses 20 percent: {json}");
    assert!((f32_of(&features["purity"]) - 0.5).abs() < 1e-2, "{json}");
    assert!((f32_of(&features["ev_gap_pct_pot"]) - 0.3).abs() < 1e-3, "{json}");

    let (status, _, json) = grade(router.clone(), PLANTED_SOLUTION_ID, &key, "KK", 2).await;
    assert_eq!(status, StatusCode::OK, "body was {json}");
    assert_eq!(flags(&json), vec!["rare_line"], "{json}");

    let (status, _, json) = grade(router, PLANTED_SOLUTION_ID, &key, "QQ", 2).await;
    assert_eq!(status, StatusCode::OK, "body was {json}");
    assert_eq!(flags(&json), Vec::<String>::new(), "{json}");
}

/// One decision of `view` against its grade answer (plan D.6), returning nothing but
/// panicking on the first difference.
fn assert_recomputed(view: &NodeView, hand: u16, action: usize, json: &Value) {
    let record = view.record();
    let n = view.actions().len();
    let evs: Vec<f32> =
        json["ev_by_action"].as_array().expect("ev_by_action").iter().map(f32_of).collect();
    let freqs: Vec<f32> =
        json["freq_by_action"].as_array().expect("freq_by_action").iter().map(f32_of).collect();
    assert_eq!(evs.len(), n, "{json}");
    assert_eq!(freqs.len(), n, "{json}");
    let frequencies = view.frequencies(hand).expect("the hand is held");
    for a in 0..n {
        let ev = view.ev_bb(hand, a).expect("an EV");
        assert_eq!(evs[a].to_bits(), ev.to_bits(), "hand {hand} action {a}: {json}");
        assert_eq!(freqs[a].to_bits(), frequencies[a].to_bits(), "hand {hand} action {a}: {json}");
    }
    let units = view.loss_units(hand, action).expect("a loss");
    assert_eq!(f32_of(&json["loss_bb"]).to_bits(), loss_bb(units, record.pot).to_bits(), "{json}");
    let pct = f32::from(units) / UNITS_PER_PCT;
    assert_eq!(f32_of(&json["loss_pct_pot"]).to_bits(), pct.to_bits(), "{json}");
    let floor = expected_floor(record.accuracy_pct_pot, record.pot);
    assert!((f32_of(&json["floor_pct_pot"]) - floor).abs() < FLOOR_TOLERANCE, "{json}");
    let token = record.actions[action].token;
    let bucket = Bucket::of_action(token, record.pot).expect("a bucket").map(Bucket::as_str);
    assert_eq!(json["bucket"].as_str(), bucket, "{json}");
    assert_eq!(json["best_action_index"], best_action(view, hand), "{json}");
    assert_eq!(json["action_index"], action, "{json}");
}

#[tokio::test]
async fn r2_13_grade_equals_direct_reader_recomputation() {
    let fixture = packed_fixture();
    let (reader, handle) = open(&fixture.root, &fixture.prefix);
    let router = fixture.router();
    let mut compared: u64 = 0;
    for node in &fixture.nodes {
        let view = reader.node(handle, &node.key).expect("every fixture node reads");
        let key = node.key.to_string();
        for hand in view.hands() {
            let label = HandClass::from_index(u8::try_from(hand).expect("a class index"))
                .expect("a class")
                .to_string();
            for action in 0..view.actions().len() {
                let (status, _, json) =
                    grade(router.clone(), &fixture.solution_id, &key, &label, action).await;
                assert_eq!(status, StatusCode::OK, "{key} {label} {action}: {json}");
                assert_recomputed(&view, hand, action, &json);
                compared += 1;
            }
        }
    }
    println!(
        "r2_13_grade_equals_direct_reader_recomputation: compared {compared} decisions, {} nodes",
        fixture.nodes.len()
    );
    assert!(compared > 0);
}
