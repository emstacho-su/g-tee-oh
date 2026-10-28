//! `POST /v1/grade-range` (R3.17, O-300, ADR 0004): grades a painted range over the
//! committed fixture library (O-62), the root the api integration tests mount, so they can
//! reuse the identifiers below.
//!
//! The node: the synthetic `cfg_6_online_100` big blind against the button solution, the
//! big blind facing the button's open to 2.5 bb (fold, call, raise to 10 bb), a dense
//! 169-class node where the big blind holds every class at reach 1. Two classes carry the
//! cases: 55 mixes call and raise about half and half with the raise 0.05 percent of the
//! pot behind (near indifferent), and 72o folds purely with the raise over 100 percent of
//! the pot behind (a clear fold). Every expected loss comes from `POST /v1/grade` for the
//! same hand and action, so the two routes cannot disagree.

mod common;

use axum::Router;
use axum::http::StatusCode;
use gto_library::HandSpace;
use gto_model::Position;
use serde_json::Value;

use common::plant::{PLANTED_SOLUTION_ID, combo_index, node, plant, pure};
use common::{
    assert_problem, f32_of, fixture_library_root, get_node, grade, grade_range, hand, router_over,
};

/// The synthetic `cfg_6_online_100` BB-BTN solution of the fixture library.
const SOLUTION_ID: &str = "f99b054c-6f19-8e69-8003-24060ce3cef7";
/// The big blind facing the button's open to 2.5 bb: fold, call, raise to 10 bb.
const NODE_KEY: &str = "cfg_6_online_100/BB-BTN/r250";
/// A node of the same solution holding 69 classes, for a painted hand it does not hold.
const SPARSE_NODE_KEY: &str = "cfg_6_online_100/BB-BTN/r250.r1000";
/// The near-indifferent class: call (best) and raise both played.
const NEAR: &str = "55";
/// The clear fold.
const FOLD: &str = "72o";
/// The record index of the fold.
const FOLD_ACTION: usize = 0;
/// The record index of the call.
const CALL_ACTION: usize = 1;
/// The record index of the raise to 10 bb.
const RAISE_ACTION: usize = 2;
/// The mixing epsilon of O-153.
const MIX_EPSILON: f32 = 0.05;
/// How close two f64 sums must be.
const TOLERANCE: f64 = 1e-6;
/// How much more the clear fold painted as a raise must cost than the near-indifferent
/// class painted at its other action.
const CLEAR_OVER_NEAR: f64 = 10.0;

fn router() -> Router {
    router_over(&fixture_library_root())
}

/// The node's rows from `GET /v1/nodes`.
async fn rows(key: &str) -> Vec<Value> {
    let (status, _, json) = get_node(router(), SOLUTION_ID, key, None).await;
    assert_eq!(status, StatusCode::OK, "body was {json}");
    json["hands"].as_array().expect("hands").clone()
}

/// The first action of a row with zero loss: its best action (O-130).
fn best(row: &Value) -> usize {
    row["loss_pct_pot"]
        .as_array()
        .expect("losses")
        .iter()
        .position(|loss| f32_of(loss) == 0.0)
        .expect("a best action")
}

/// The paint that puts every held hand at its best action, then `overrides`.
async fn best_paint(key: &str, overrides: &[(&str, usize)]) -> Vec<(String, usize)> {
    rows(key)
        .await
        .iter()
        .map(|row| {
            let hand = row["hand"].as_str().expect("a hand").to_owned();
            let action = overrides
                .iter()
                .find(|(name, _)| *name == hand)
                .map_or_else(|| best(row), |(_, action)| *action);
            (hand, action)
        })
        .collect()
}

/// The graded entry of `hand`.
fn entry<'a>(json: &'a Value, hand: &str) -> &'a Value {
    json["per_hand"]
        .as_array()
        .expect("per_hand")
        .iter()
        .find(|row| row["hand"] == hand)
        .unwrap_or_else(|| panic!("no {hand} in {json}"))
}

fn sum_of(json: &Value, field: &str) -> f64 {
    json["per_hand"]
        .as_array()
        .expect("per_hand")
        .iter()
        .map(|row| row[field].as_f64().expect("a number"))
        .sum()
}

async fn graded(paint: &[(String, usize)]) -> Value {
    let (status, _, json) = grade_range(router(), SOLUTION_ID, NODE_KEY, paint).await;
    assert_eq!(status, StatusCode::OK, "body was {json}");
    json
}

#[tokio::test]
async fn r3_17_the_fixture_node_holds_a_near_indifferent_class_and_a_clear_fold() {
    let rows = rows(NODE_KEY).await;
    assert_eq!(rows.len(), 169, "a dense preflop node");
    let row = |name: &str| rows.iter().find(|row| row["hand"] == name).expect("held").clone();
    let near = row(NEAR);
    let strategy: Vec<f32> =
        near["strategy"].as_array().expect("strategy").iter().map(f32_of).collect();
    assert!(strategy[CALL_ACTION] >= MIX_EPSILON && strategy[RAISE_ACTION] >= MIX_EPSILON);
    assert_eq!(best(&near), CALL_ACTION, "{near}");
    assert!(f32_of(&near["loss_pct_pot"][RAISE_ACTION]) < 0.1, "{near}");
    let fold = row(FOLD);
    assert!(f32_of(&fold["strategy"][FOLD_ACTION]) > 0.99, "{fold}");
    assert!(f32_of(&fold["loss_pct_pot"][RAISE_ACTION]) > 100.0, "{fold}");
}

#[tokio::test]
async fn r3_17_painting_every_hand_at_its_best_action_costs_nothing() {
    let paint = best_paint(NODE_KEY, &[]).await;
    let json = graded(&paint).await;
    assert_eq!(json["solution_id"], SOLUTION_ID, "{json}");
    assert_eq!(json["node_key"], NODE_KEY, "{json}");
    assert_eq!(json["per_hand"].as_array().map(Vec::len), Some(169), "{json}");
    assert_eq!(json["total_weighted_loss_bb"].as_f64(), Some(0.0), "{json}");
    for row in json["per_hand"].as_array().expect("per_hand") {
        assert_eq!(row["action_index"], row["best_action_index"], "{row}");
        assert_eq!(row["loss_bb"].as_f64(), Some(0.0), "{row}");
    }
    assert!((sum_of(&json, "weight") - 1.0).abs() < TOLERANCE, "{json}");
}

#[tokio::test]
async fn r3_17_a_near_indifferent_slip_costs_little_and_a_clear_fold_raised_costs_far_more() {
    let near = graded(&best_paint(NODE_KEY, &[(NEAR, RAISE_ACTION)]).await).await;
    let clear = graded(&best_paint(NODE_KEY, &[(FOLD, RAISE_ACTION)]).await).await;
    let near_total = near["total_weighted_loss_bb"].as_f64().expect("a total");
    let clear_total = clear["total_weighted_loss_bb"].as_f64().expect("a total");
    assert!(near_total > 0.0, "the slip is not free: {near}");
    let near_weighted = entry(&near, NEAR)["weighted_loss_bb"].as_f64().expect("a number");
    let clear_weighted = entry(&clear, FOLD)["weighted_loss_bb"].as_f64().expect("a number");
    assert!(near_weighted < clear_weighted, "{near_weighted} against {clear_weighted}");
    assert!(clear_total >= CLEAR_OVER_NEAR * near_total, "{clear_total} against {near_total}");
    assert!((near_total - near_weighted).abs() < TOLERANCE, "only 55 loses: {near}");
}

#[tokio::test]
async fn r3_17_every_hand_agrees_with_v1_grade_and_the_total_is_the_sum() {
    // Every class painted at action (class index mod 3), so most hands lose something.
    let paint: Vec<(String, usize)> = rows(NODE_KEY)
        .await
        .iter()
        .enumerate()
        .map(|(index, row)| (row["hand"].as_str().expect("a hand").to_owned(), index % 3))
        .collect();
    let json = graded(&paint).await;
    for (hand, action) in &paint {
        let row = entry(&json, hand);
        let (status, _, single) = grade(router(), SOLUTION_ID, NODE_KEY, hand, *action).await;
        assert_eq!(status, StatusCode::OK, "body was {single}");
        assert_eq!(row["action_index"], *action, "{row}");
        assert_eq!(
            f32_of(&row["loss_bb"]).to_bits(),
            f32_of(&single["loss_bb"]).to_bits(),
            "{hand}"
        );
        let pct = f32_of(&single["loss_pct_pot"]).to_bits();
        assert_eq!(f32_of(&row["loss_pct_pot"]).to_bits(), pct, "{hand}");
        assert_eq!(row["best_action_index"], single["best_action_index"], "{hand}");
        let weighted = row["weighted_loss_bb"].as_f64().expect("a number");
        let product =
            row["loss_bb"].as_f64().expect("a number") * row["weight"].as_f64().expect("a number");
        assert!((weighted - product).abs() < TOLERANCE, "{row}");
        assert_eq!(json["floor_pct_pot"], single["floor_pct_pot"], "{json}");
        assert_eq!(json["floor_source"], single["floor_source"], "{json}");
    }
    let total = json["total_weighted_loss_bb"].as_f64().expect("a total");
    assert!(total > 0.0, "{json}");
    assert!((total - sum_of(&json, "weighted_loss_bb")).abs() < TOLERANCE, "{json}");
    assert!((sum_of(&json, "weight") - 1.0).abs() < TOLERANCE, "{json}");
}

/// Asserts a 400 problem whose detail contains `needle`.
fn assert_bad(answer: &(StatusCode, axum::http::HeaderMap, Value), needle: &str) {
    let (status, headers, json) = answer;
    assert_problem(*status, headers, json, StatusCode::BAD_REQUEST, "bad-request");
    let detail = json["detail"].as_str().expect("a detail");
    assert!(detail.contains(needle), "{needle:?} not in {detail:?}");
}

#[tokio::test]
async fn r3_17_an_incomplete_duplicated_or_malformed_paint_is_a_400() {
    let full = best_paint(NODE_KEY, &[]).await;
    let send = |paint: Vec<(String, usize)>, key: &'static str| async move {
        grade_range(router(), SOLUTION_ID, key, &paint).await
    };

    let missing: Vec<_> = full.iter().filter(|(hand, _)| hand != FOLD).cloned().collect();
    assert_bad(&send(missing, NODE_KEY).await, FOLD);

    let mut duplicated = full.clone();
    duplicated.push((NEAR.to_owned(), CALL_ACTION));
    assert_bad(&send(duplicated, NODE_KEY).await, "more than once");

    let mut bad_index = full.clone();
    bad_index[0].1 = 3;
    assert_bad(&send(bad_index, NODE_KEY).await, "action_index 3");

    let mut unknown = full.clone();
    unknown[0].0 = "ZZ".to_owned();
    assert_bad(&send(unknown, NODE_KEY).await, "\"ZZ\"");

    let mut long = full.clone();
    long[0].0 = "Q".repeat(10_000);
    let answer = send(long, NODE_KEY).await;
    assert_bad(&answer, "paint[0]");
    let detail = answer.2["detail"].as_str().expect("a detail");
    assert!(detail.len() < 200, "the echo is capped: {detail}");

    let over: Vec<_> = (0..1_327).map(|_| (NEAR.to_owned(), CALL_ACTION)).collect();
    assert_bad(&send(over, NODE_KEY).await, "1326");

    let sparse = best_paint(SPARSE_NODE_KEY, &[]).await;
    assert_eq!(sparse.len(), 69, "the sparse node holds 69 classes");
    let mut not_held = sparse.clone();
    let held: Vec<&str> = sparse.iter().map(|(hand, _)| hand.as_str()).collect();
    assert!(!held.contains(&FOLD), "72o folded before this node");
    not_held.push((FOLD.to_owned(), FOLD_ACTION));
    assert_bad(&send(not_held, SPARSE_NODE_KEY).await, "not in the node's range");
    let answer = send(sparse, SPARSE_NODE_KEY).await;
    assert_eq!(answer.0, StatusCode::OK, "a full paint of the sparse node grades: {}", answer.2);
}

#[tokio::test]
async fn r3_17_a_1326_combo_node_is_a_400_because_painting_is_preflop_only() {
    let hands = vec![hand(combo_index("AhKh"), [1.0, 1.0], pure(1), vec![-1.0, 1.0, 0.0])];
    let planted = plant(&[node(250, Position::Bb, HandSpace::Postflop1326, hands)]);
    let paint = [("AKs".to_owned(), 1)];
    let answer =
        grade_range(planted.router(), PLANTED_SOLUTION_ID, &planted.key(250), &paint).await;
    assert_bad(&answer, "preflop");
}

#[tokio::test]
async fn r3_17_an_unknown_solution_or_node_is_a_404() {
    let paint = best_paint(NODE_KEY, &[]).await;
    let other = "aaaaaaaa-1111-4222-8333-444444444444";
    let (status, headers, json) = grade_range(router(), other, NODE_KEY, &paint).await;
    assert_problem(status, &headers, &json, StatusCode::NOT_FOUND, "not-found");
    let missing = "cfg_6_online_100/BB-BTN/r250.r1500";
    let (status, headers, json) = grade_range(router(), SOLUTION_ID, missing, &paint).await;
    assert_problem(status, &headers, &json, StatusCode::NOT_FOUND, "not-found");
}
