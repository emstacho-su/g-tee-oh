//! `POST /v1/deal` and `GET /v1/deal/{id}/reveal` (R2.13, plan D.3, A5 rule two, O-16,
//! O-145, O-151, O-152). Written red in S16 step 2: both handlers are stubs answering 501
//! until lane C lands the seeded deal of plan C.4, and the request-id and problem-body
//! middleware of commit 4 turns a rejected body into a problem.

mod common;

use std::collections::HashSet;

use axum::Router;
use axum::http::{HeaderMap, StatusCode};
use gto_library::HandSpace;
use gto_model::{Card, ComboId, NodeKey, Position};
use serde_json::{Value, json};
use solver_query::api::deal::Hex64;

use common::equity::CLASSES;
use common::plant::{
    PLANTED_CONFIG_ID, PLANTED_SOLUTION_ID, Planted, evs_best, line, node_of_root, plant, pure,
};
use common::{assert_problem, get, hand, post, post_raw};

/// One seed and its neighbour, as sixteen hexadecimal digits (O-151).
const SEED: &str = "0000000000000007";
const OTHER_SEED: &str = "0000000000000008";
/// The pair every planted key names, out of position first.
const PAIR: &str = "BB-BTN";
/// The deal response's fields, and nothing else (A5 rule two: no board card).
const DEAL_FIELDS: [&str; 8] = [
    "deal_id",
    "solution_ids",
    "start_node_key",
    "hero_position",
    "villain_position",
    "hero_hand",
    "villain_hand",
    "revealed",
];

/// A solution holding the pair's root (the button to act) and the line `r250` (the big
/// blind to act), every class at reach 1.
fn deal_solution() -> Planted {
    let hands = || {
        (0..CLASSES)
            .map(|i| {
                hand(u16::try_from(i).expect("a class index"), [1.0, 1.0], pure(1), evs_best(1))
            })
            .collect::<Vec<_>>()
    };
    let root = node_of_root(Position::Btn, HandSpace::Preflop169, hands());
    let opened = common::plant::node(250, Position::Bb, HandSpace::Preflop169, hands());
    plant(&[root, opened])
}

/// A deal request for `seed` with an optional line and texture.
fn deal_body(seed: &str, line: Option<&str>, texture: Option<&str>) -> Value {
    let mut filter =
        json!({ "config_id": PLANTED_CONFIG_ID, "pair": PAIR, "start_street": "preflop" });
    if let Some(line) = line {
        filter["line"] = Value::from(line);
    }
    if let Some(texture) = texture {
        filter["texture"] = Value::from(texture);
    }
    json!({ "filter": filter, "seed": seed })
}

async fn deal(router: Router, body: &Value) -> (StatusCode, HeaderMap, Value) {
    post(router, "/v1/deal", body).await
}

async fn reveal(router: Router, deal_id: &str, street: &str) -> (StatusCode, HeaderMap, Value) {
    get(router, &format!("/v1/deal/{deal_id}/reveal?street={street}")).await
}

/// The cards of a reveal answer.
fn cards(json: &Value) -> Vec<Card> {
    json["cards"]
        .as_array()
        .expect("cards is an array")
        .iter()
        .map(|card| card.as_str().expect("a card").parse().expect("a card"))
        .collect()
}

/// The two cards of a combo string such as `AhKd`.
fn combo_cards(text: &str) -> [Card; 2] {
    let combo: ComboId = text.parse().expect("a combo");
    let (a, b) = combo.cards();
    [a, b]
}

#[tokio::test]
async fn r2_13_deal_is_deterministic_from_seed() {
    let planted = deal_solution();
    let router = planted.router();

    let (status, _, first) = deal(router.clone(), &deal_body(SEED, None, None)).await;
    assert_eq!(status, StatusCode::OK, "body was {first}");
    let (_, _, second) = deal(router.clone(), &deal_body(SEED, None, None)).await;
    assert_eq!(first, second, "one seed and filter, one deal");
    let deal_id = first["deal_id"].as_str().expect("a deal id");
    let (status, _, flop) = reveal(router.clone(), deal_id, "flop").await;
    assert_eq!(status, StatusCode::OK, "body was {flop}");
    let (_, _, again) = reveal(router.clone(), deal_id, "flop").await;
    assert_eq!(flop, again, "a repeat reveal answers the same cards");

    let (_, _, other) = deal(router, &deal_body(OTHER_SEED, None, None)).await;
    assert_ne!(other["deal_id"], first["deal_id"], "another seed is another deal");

    let fresh = planted.router();
    let (_, _, replayed) = deal(fresh.clone(), &deal_body(SEED, None, None)).await;
    assert_eq!(replayed, first, "the deal reappears after the store is cleared (R3.6)");
    let (_, _, replayed_flop) = reveal(fresh, deal_id, "flop").await;
    assert_eq!(replayed_flop, flop);
}

#[tokio::test]
async fn r2_13_deal_keeps_the_board_server_side() {
    let planted = deal_solution();
    let router = planted.router();

    let (status, _, json) = deal(router.clone(), &deal_body(SEED, None, None)).await;
    assert_eq!(status, StatusCode::OK, "body was {json}");
    let fields: HashSet<&str> =
        json.as_object().expect("an object").keys().map(String::as_str).collect();
    assert_eq!(fields, HashSet::from(DEAL_FIELDS), "{json}");
    assert_eq!(json["revealed"], json!({ "flop": null, "turn": null, "river": null }), "{json}");
    let hero = combo_cards(json["hero_hand"].as_str().expect("a combo"));
    let villain = combo_cards(json["villain_hand"].as_str().expect("a combo"));
    let held: HashSet<Card> = hero.iter().chain(&villain).copied().collect();
    assert_eq!(held.len(), 4, "four distinct hole cards: {json}");
    let deal_id = json["deal_id"].as_str().expect("a deal id").to_owned();

    let (status, headers, json) = reveal(router.clone(), &deal_id, "turn").await;
    assert_problem(status, &headers, &json, StatusCode::CONFLICT, "conflict");

    let (status, _, json) = reveal(router.clone(), &deal_id, "flop").await;
    assert_eq!(status, StatusCode::OK, "body was {json}");
    let flop = cards(&json);
    assert_eq!(flop.len(), 3, "{json}");
    let distinct: HashSet<Card> = flop.iter().copied().collect();
    assert_eq!(distinct.len(), 3, "three distinct cards: {json}");
    assert!(distinct.is_disjoint(&held), "the flop shares no card with the hands: {json}");
    assert_eq!(json["street"], "flop");
    assert_eq!(json["deal_id"], deal_id);
    assert_eq!(json["board"].as_str().map(str::len), Some(6), "{json}");

    let (_, _, again) = reveal(router.clone(), &deal_id, "flop").await;
    assert_eq!(cards(&again), flop, "a repeat reveal answers the same cards");

    let (status, _, json) = reveal(router.clone(), &deal_id, "turn").await;
    assert_eq!(status, StatusCode::OK, "body was {json}");
    let turn = cards(&json);
    assert_eq!(turn.len(), 1, "{json}");
    assert!(!distinct.contains(&turn[0]) && !held.contains(&turn[0]), "{json}");
    assert_eq!(json["board"].as_str().map(str::len), Some(8), "{json}");

    let (status, headers, json) =
        reveal(router.clone(), "00000000-0000-4000-8000-000000000000", "flop").await;
    assert_problem(status, &headers, &json, StatusCode::NOT_FOUND, "not-found");

    let (status, headers, json) = deal(router, &deal_body(SEED, None, Some("rainbow-dry"))).await;
    assert_problem(status, &headers, &json, StatusCode::BAD_REQUEST, "bad-request");
}

#[tokio::test]
async fn r2_13_deal_starts_at_the_root_or_the_given_line() {
    let planted = deal_solution();
    let router = planted.router();
    let root_key = NodeKey::preflop(planted.config_id.clone(), planted.pair, vec![]).to_string();
    let line_key = NodeKey::preflop(planted.config_id.clone(), planted.pair, line(250)).to_string();

    let (status, _, json) = deal(router.clone(), &deal_body(SEED, None, None)).await;
    assert_eq!(status, StatusCode::OK, "body was {json}");
    assert_eq!(json["start_node_key"], root_key, "{json}");
    assert_eq!(json["hero_position"], "BTN", "the seat to act at the root: {json}");
    assert_eq!(json["villain_position"], "BB", "{json}");
    assert_eq!(json["solution_ids"], json!([PLANTED_SOLUTION_ID]), "{json}");

    let (status, _, json) = deal(router.clone(), &deal_body(SEED, Some("r250"), None)).await;
    assert_eq!(status, StatusCode::OK, "body was {json}");
    assert_eq!(json["start_node_key"], line_key, "{json}");
    assert_eq!(json["hero_position"], "BB", "{json}");

    let (status, headers, json) = deal(router.clone(), &deal_body(SEED, Some("r999"), None)).await;
    assert_problem(status, &headers, &json, StatusCode::NOT_FOUND, "not-found");

    let mut flop_start = deal_body(SEED, None, None);
    flop_start["filter"]["start_street"] = Value::from("flop");
    let (status, headers, json) = deal(router, &flop_start).await;
    assert_problem(status, &headers, &json, StatusCode::BAD_REQUEST, "bad-request");
}

#[tokio::test]
async fn r2_13_hex64_round_trips() {
    let value: Hex64 = SEED.parse().expect("sixteen hex digits");
    assert_eq!(value.get(), 7);
    assert_eq!(value.to_string(), SEED);
    for bad in ["7", "0x0000000000000007", "0000000000000007f", "000000000000000G", ""] {
        assert!(bad.parse::<Hex64>().is_err(), "{bad:?} is not a Hex64");
    }

    let planted = deal_solution();
    let (status, headers, json) = deal(planted.router(), &deal_body("zz", None, None)).await;
    assert_problem(status, &headers, &json, StatusCode::BAD_REQUEST, "bad-request");
    let numeric = deal_body(SEED, None, None).to_string().replace(&format!("\"{SEED}\""), "7");
    let (status, headers, json) = post_raw(planted.router(), "/v1/deal", &numeric).await;
    assert_problem(status, &headers, &json, StatusCode::BAD_REQUEST, "bad-request");
}

#[test]
#[ignore = "R2.13: rng.rs (SplitMix64 with the published reference vectors) lands with lane C"]
fn r2_13_rng_splitmix64_reference_vectors() {
    unimplemented!("seed 1234567 gives 6457827717110365317, 3203168211198807973, ... (plan C.4)");
}
