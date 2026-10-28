//! `GET /v1/nodes` over the packed synthetic fixture (R2.13, plan D.1, A5 section 2).
//! Written red in S16 step 2: the handler is a stub answering 501 until lane A lands the
//! reader lookup of plan C.2, so every test here fails on the status until then.

mod common;

use std::fs;

use axum::http::StatusCode;
use gto_library::HandSpace;
use gto_model::{ActionToken, Bucket, Cbb, Position, SpotClass, SpotClassKey, v1_configs};
use serde_json::Value;

use common::plant::{self, node_of_root};
use common::{assert_problem, f32_of, get, get_node, hand, packed_fixture, sum};

/// How close a strategy row's sum must be to 1.
const SUM_TOLERANCE: f64 = 1e-5;
/// Combos in a dense 169-class range.
const COMBOS_IN_FULL_RANGE: u64 = 1_326;
/// The classes a dense preflop node holds.
const CLASSES: usize = 169;

/// The preflop button label of a raise: the exact size (O-22), for example `Raise to 2.5bb`.
fn raise_label(size: Cbb) -> String {
    format!("Raise to {}bb", f64::from(size.get()) / f64::from(Cbb::PER_BB))
}

/// Every action view against the record's actions: token, size, bucket and label.
fn assert_actions(json: &Value, actions: &[(ActionToken, Cbb)], pot: Cbb) {
    let views = json["actions"].as_array().expect("actions is an array");
    assert_eq!(views.len(), actions.len(), "body was {json}");
    for (index, (view, (token, size))) in views.iter().zip(actions).enumerate() {
        assert_eq!(view["index"], index, "action {index}: {view}");
        assert_eq!(view["token"], token.to_string(), "action {index}: {view}");
        assert_eq!(view["size_cbb"], size.get(), "action {index}: {view}");
        let bucket = Bucket::of_action(*token, pot).expect("a bucket").map(Bucket::as_str);
        assert_eq!(view["bucket"].as_str(), bucket, "action {index}: {view}");
        match token {
            ActionToken::Raise(size) => assert_eq!(view["label"], raise_label(*size), "{view}"),
            _ => assert!(view["label"].as_str().is_some_and(|l| !l.is_empty()), "{view}"),
        }
    }
}

#[tokio::test]
async fn r2_13_nodes_returns_the_record_actions_with_buckets_and_strategy() {
    let fixture = packed_fixture();
    let node = &fixture.nodes[0];

    let (status, _, json) =
        get_node(fixture.router(), &fixture.solution_id, &fixture.key(0), None).await;

    assert_eq!(status, StatusCode::OK, "body was {json}");
    assert_eq!(json["solution_id"], fixture.solution_id);
    assert_eq!(json["node_key"], node.key.to_string());
    assert_eq!(json["street"], "preflop");
    assert_eq!(json["config_id"], node.key.config_id.as_str());
    assert_eq!(json["pair"], node.key.pair.to_string());
    assert_eq!(json["to_act"], node.to_act.as_str());
    assert_eq!(json["pot_cbb"], node.pot.get());
    assert_eq!(json["stacks_cbb"], serde_json::json!([node.stacks[0].get(), node.stacks[1].get()]));
    assert_eq!(json["hand_space"], "preflop_169");
    let accuracy = node.accuracy_pct_pot.expect("synthetic nodes carry an accuracy");
    assert_eq!(f32_of(&json["accuracy_pct_pot"]).to_bits(), accuracy.to_bits(), "{json}");
    assert_actions(&json, &node.actions, node.pot);

    let rows = json["hands"].as_array().expect("hands is an array");
    assert_eq!(rows.len(), CLASSES, "all hands by default");
    for row in rows {
        let total = sum(&row["strategy"]);
        assert!((total - 1.0).abs() < SUM_TOLERANCE, "row {row}");
        assert_eq!(row["ev_bb"].as_array().map(Vec::len), Some(node.actions.len()), "row {row}");
        assert_eq!(row["loss_pct_pot"].as_array().map(Vec::len), Some(node.actions.len()));
        assert!(row["reach"].as_array().is_some_and(|r| r.len() == 2), "row {row}");
    }

    let config = v1_configs()
        .into_iter()
        .find(|config| config.config_id() == node.key.config_id)
        .expect("a catalog configuration");
    let expected = SpotClass::classify(&config, &node.key).expect("a preflop node");
    let key = json["spot_class_key"].as_str().expect("a spot class key");
    let parsed = SpotClassKey::new(key).expect("the key parses with SpotClass::from_key");
    assert_eq!(SpotClass::from_key(&parsed).expect("a class"), expected);

    let summary = &json["range_summary"];
    assert_eq!(summary["oop"]["combos"], COMBOS_IN_FULL_RANGE, "{summary}");
    assert_eq!(summary["ip"]["combos"], COMBOS_IN_FULL_RANGE, "{summary}");
    let shares: Vec<&Value> = summary["by_action"].as_array().expect("by_action").iter().collect();
    assert_eq!(shares.len(), node.actions.len());
    let total: f64 = shares.iter().map(|s| s["share"].as_f64().expect("a share")).sum();
    assert!((total - 1.0).abs() < SUM_TOLERANCE, "shares sum to 1: {summary}");
    assert!(json["noise_flags"].is_array(), "{json}");
}

#[tokio::test]
async fn r2_13_nodes_hands_filter_and_errors() {
    let fixture = packed_fixture();
    let id = fixture.solution_id.clone();
    let key = fixture.key(1);

    let (status, _, json) = get_node(fixture.router(), &id, &key, Some("AKs")).await;
    assert_eq!(status, StatusCode::OK, "body was {json}");
    let rows = json["hands"].as_array().expect("hands");
    assert_eq!(rows.len(), 1, "one row for one hand: {json}");
    assert_eq!(rows[0]["hand"], "AKs");

    let (status, _, json) = get_node(fixture.router(), &id, &key, Some("AhKh")).await;
    assert_eq!(status, StatusCode::OK, "a combo maps to its class at preflop: {json}");
    assert_eq!(json["hands"][0]["hand"], "AKs", "{json}");

    let (status, _, json) = get_node(fixture.router(), &id, &key, Some("class")).await;
    assert_eq!(status, StatusCode::OK, "body was {json}");
    assert_eq!(
        json["hands"].as_array().map(Vec::len),
        Some(CLASSES),
        "class equals all at preflop"
    );

    let (status, headers, json) = get_node(fixture.router(), &id, &key, Some("bogus")).await;
    assert_problem(status, &headers, &json, StatusCode::BAD_REQUEST, "bad-request");

    let absent = format!("{}/{}/r999999", fixture.config_id, fixture.pair);
    let (status, headers, json) = get_node(fixture.router(), &id, &absent, None).await;
    assert_problem(status, &headers, &json, StatusCode::NOT_FOUND, "not-found");

    let (status, headers, json) = get_node(fixture.router(), &id, "nope", None).await;
    assert_problem(status, &headers, &json, StatusCode::BAD_REQUEST, "bad-request");

    let unknown = "00000000-0000-4000-8000-000000000000";
    let (status, headers, json) = get_node(fixture.router(), unknown, &key, None).await;
    assert_problem(status, &headers, &json, StatusCode::NOT_FOUND, "not-found");
}

#[tokio::test]
async fn r3_3_nodes_name_each_action_child_and_carry_the_synthetic_flag() {
    // O-245: an action's next_node_key is the child the solution holds, null when the
    // action ends the solution, so the api walks the tree without the key grammar.
    // O-229: the packed fixture is synthetic, so the node carries the banner flag.
    let pure = || vec![hand(0, [1.0, 1.0], vec![0.0, 1.0, 0.0], vec![-1.0, 0.0, -0.5])];
    // The root offers fold, call and a raise to 8 bb; the solution holds only the raise's
    // child, so the fold and the call end it.
    let planted = plant::plant(&[
        node_of_root(Position::Btn, HandSpace::Preflop169, pure()),
        plant::node(800, Position::Bb, HandSpace::Preflop169, pure()),
    ]);
    let root_key = "cfg_6_online_100/BB-BTN/";

    let (status, _, json) = get_node(planted.router(), &planted.solution_id, root_key, None).await;

    assert_eq!(status, StatusCode::OK, "body was {json}");
    let next: Vec<Option<&str>> = json["actions"]
        .as_array()
        .expect("actions")
        .iter()
        .map(|view| view["next_node_key"].as_str())
        .collect();
    assert_eq!(next, [None, None, Some(planted.key(800).as_str())], "body was {json}");
    // PR #25 re-review: the decision's family comes from gto-model's classify (ADR 0004).
    assert_eq!(json["action_family"], "rfi", "body was {json}");
    let (status, _, child) =
        get_node(planted.router(), &planted.solution_id, &planted.key(800), None).await;
    assert_eq!(status, StatusCode::OK, "body was {child}");
    assert_eq!(child["action_family"], "facing-open", "body was {child}");

    let fixture = packed_fixture();
    let (status, _, json) =
        get_node(fixture.router(), &fixture.solution_id, &fixture.key(0), None).await;
    assert_eq!(status, StatusCode::OK, "body was {json}");
    assert_eq!(json["synthetic"], true, "the packed fixture is synthetic: {json}");
}

#[tokio::test]
async fn r3_6_an_off_range_hand_is_its_own_problem_type_and_a_missing_node_is_not_found() {
    // PR #25 re-review LOW 3: the api ends a hand on hand-not-in-range only, and treats a
    // missing solution or node (not-found) as an error.
    let only_aces = || vec![hand(0, [1.0, 1.0], vec![0.0, 1.0, 0.0], vec![-1.0, 0.0, -0.5])];
    let planted = plant::plant(&[node_of_root(Position::Btn, HandSpace::Preflop169, only_aces())]);
    let root = "cfg_6_online_100/BB-BTN/";

    let (status, headers, json) =
        get_node(planted.router(), &planted.solution_id, root, Some("72o")).await;
    assert_problem(status, &headers, &json, StatusCode::NOT_FOUND, "hand-not-in-range");

    let (status, headers, json) =
        common::grade(planted.router(), &planted.solution_id, root, "72o", 0).await;
    assert_problem(status, &headers, &json, StatusCode::NOT_FOUND, "hand-not-in-range");

    let missing = "cfg_6_online_100/BB-BTN/r250";
    let (status, headers, json) =
        get_node(planted.router(), &planted.solution_id, missing, None).await;
    assert_problem(status, &headers, &json, StatusCode::NOT_FOUND, "not-found");
}

#[tokio::test]
async fn r2_13_nodes_unavailable_solution_answers_503() {
    let fixture = packed_fixture();
    let chunk = fixture.root.join(&fixture.prefix).join("chunks").join("0000.bin.zst");
    let mut bytes = fs::read(&chunk).expect("the first chunk exists");
    let middle = bytes.len() / 2;
    bytes[middle] ^= 0x01;
    fs::write(&chunk, bytes).expect("the chunk is rewritten");
    let router = fixture.router();

    let (status, headers, json) =
        get_node(router.clone(), &fixture.solution_id, &fixture.key(0), None).await;
    assert_problem(status, &headers, &json, StatusCode::SERVICE_UNAVAILABLE, "unavailable");

    let (status, _, health) = get(router, "/healthz").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(health["library"]["unavailable"], 1, "body was {health}");
}

/// The synthetic `cfg_6_online_100` BB-BTN solution of the committed fixture library.
const FIXTURE_LIBRARY_SOLUTION_ID: &str = "f99b054c-6f19-8e69-8003-24060ce3cef7";
/// The big blind facing the button's open to 2.5 bb there: fold, call, raise to 10 bb.
const FIXTURE_LIBRARY_NODE_KEY: &str = "cfg_6_online_100/BB-BTN/r250";

#[tokio::test]
async fn r3_16_hand_rows_flag_mixed_classes_as_v1_grade_does() {
    // O-301: 55 calls and raises about half each (mixed), 72o folds purely; every row's
    // flag equals difficulty_features.mixed from /v1/grade for the same hand.
    let router = common::router_over(&common::fixture_library_root());
    let (id, key) = (FIXTURE_LIBRARY_SOLUTION_ID, FIXTURE_LIBRARY_NODE_KEY);
    let (status, _, json) = get_node(router.clone(), id, key, None).await;
    assert_eq!(status, StatusCode::OK, "body was {json}");
    let rows = json["hands"].as_array().expect("hands");
    assert_eq!(rows.len(), CLASSES, "{json}");
    let flag = |name: &str| rows.iter().find(|row| row["hand"] == name).map(|row| &row["mixed"]);
    assert_eq!(flag("55"), Some(&Value::Bool(true)), "55 calls and raises about half each");
    assert_eq!(flag("72o"), Some(&Value::Bool(false)), "72o folds purely");
    for row in rows {
        let hand = row["hand"].as_str().expect("a hand");
        let (status, _, graded) = common::grade(router.clone(), id, key, hand, 0).await;
        assert_eq!(status, StatusCode::OK, "body was {graded}");
        assert_eq!(row["mixed"], graded["difficulty_features"]["mixed"], "{hand}: {row}");
    }

    let (status, _, one) = get_node(router, id, key, Some("55")).await;
    assert_eq!(status, StatusCode::OK, "body was {one}");
    assert_eq!(one["hands"][0]["mixed"], true, "the one-hand filter carries the flag: {one}");
}
