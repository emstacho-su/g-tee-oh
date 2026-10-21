//! `GET /v1/insights` (R2.14, plan D.2, O-32, O-153). Written red in S16 step 2: the
//! handler is a stub answering 501 until lane B lands the E3 computations of plan C.3.
//! Expected numbers come from the committed 169 by 169 table read directly
//! (`common::equity`) and the plan C.3 formulas, on planted nodes under
//! `cfg_6_online_100`, big blind (BB, out of position) against the button (BTN).

mod common;

use std::collections::HashSet;

use axum::http::StatusCode;
use gto_library::HandSpace;
use gto_model::{HandClass, Position};
use serde_json::Value;

use common::equity::{
    CLASSES, EquityFixture, combos, full_range, range_of, rank_in_full_range, strengths,
    strongest_first,
};
use common::plant::{
    PLANTED_SOLUTION_ID, class_index, class_name, combo_index, evs_best, insights, node, plant,
    pure,
};
use common::{grade, hand, packed_fixture};

/// How many of the strongest classes raise in the threshold node.
const RAISERS: usize = 40;
/// The action indexes of the planted fold, call, raise nodes.
const FOLD: usize = 0;
const CALL: usize = 1;
const RAISE: usize = 2;
/// Tolerances: f32 values against f64 expectations.
const SHARE_TOLERANCE: f64 = 1e-4;
const EQUITY_TOLERANCE: f64 = 1e-5;
/// The nut equity threshold (O-153).
const NUT_EQUITY: f64 = 0.80;
/// Equity bins (O-153), and the same count as a float for the bin arithmetic.
const BINS: usize = 10;
const BINS_WIDE: f64 = 10.0;

/// A node where every class is held at reach 1 for both seats and plays `strategy(i)`.
fn full_node(cbb: u32, strategy: impl Fn(usize) -> usize) -> gto_library::SolvedNode {
    let hands = (0..CLASSES)
        .map(|i| {
            let action = strategy(i);
            hand(
                u16::try_from(i).expect("a class index"),
                [1.0, 1.0],
                pure(action),
                evs_best(action),
            )
        })
        .collect();
    node(cbb, Position::Bb, HandSpace::Preflop169, hands)
}

#[test]
fn r2_14_equity_table_matches_hand_class_order_and_symmetry() {
    let table = EquityFixture::load();
    for (i, name) in table.classes.iter().enumerate() {
        let class =
            HandClass::from_index(u8::try_from(i).expect("a class index")).expect("a class");
        assert_eq!(name, &class.to_string(), "class {i}");
    }
    for i in 0..CLASSES {
        assert!((table.equity[i][i] - 0.5).abs() < 1e-12, "diagonal {i}");
        for j in 0..CLASSES {
            assert!((table.equity[i][j] + table.equity[j][i] - 1.0).abs() < 1e-9, "{i} {j}");
            assert!((table.pairs[i][j] - table.pairs[j][i]).abs() < 1e-12, "{i} {j}");
        }
    }
    let (aa, kk) = (table.index("AA"), table.index("KK"));
    assert!((0.81..=0.83).contains(&table.equity[aa][kk]), "AA versus KK band");
    assert!((table.pairs[aa][kk] - 36.0).abs() < 1e-12, "36 disjoint matchups");
}

#[tokio::test]
async fn r2_14_threshold_card_finds_weakest_raiser_and_strongest_folder() {
    let table = EquityFixture::load();
    let strength = strengths(&table, &full_range());
    let order = strongest_first(&strength);
    let raisers: HashSet<usize> = order[..RAISERS].iter().copied().collect();
    let weakest_raiser = order[RAISERS - 1];
    let strongest_folder = order[RAISERS];
    let planted = plant(&[full_node(250, |i| if raisers.contains(&i) { RAISE } else { FOLD })]);
    let key = planted.key(250);
    let total: f64 = (0..CLASSES).map(combos).sum();
    let share_raising: f64 = raisers.iter().map(|i| combos(*i)).sum::<f64>() / total;

    let label = class_name(u16::try_from(weakest_raiser).expect("a class index"));
    let (status, _, json) = insights(planted.router(), PLANTED_SOLUTION_ID, &key, &label).await;
    assert_eq!(status, StatusCode::OK, "body was {json}");
    let card = &json["threshold_card"];
    let actions = card["actions"].as_array().expect("one entry per aggressive action");
    assert_eq!(actions.len(), 1, "{card}");
    assert_eq!(actions[0]["index"], RAISE, "{card}");
    assert_eq!(actions[0]["token"], "r800", "{card}");
    assert_eq!(actions[0]["weakest_hand_taking_half"], label, "{card}");
    let share = actions[0]["share_taking"].as_f64().expect("a share");
    assert!((share - share_raising).abs() < SHARE_TOLERANCE, "{card}");
    let folder = class_name(u16::try_from(strongest_folder).expect("a class index"));
    assert_eq!(card["strongest_folding_hand"], folder, "{card}");
    let position = &card["hand_position"];
    assert_eq!(position["hand"], label);
    let equity = position["equity_vs_villain"].as_f64().expect("an equity");
    assert!((equity - strength[weakest_raiser]).abs() < EQUITY_TOLERANCE, "{position}");
    let rank = position["rank_in_range"].as_f64().expect("a rank");
    assert!((rank - rank_in_full_range(&strength, weakest_raiser)).abs() < SHARE_TOLERANCE);
    assert_eq!(position["relative"], serde_json::json!([{ "index": RAISE, "position": "at" }]));

    let top = class_name(u16::try_from(order[0]).expect("a class index"));
    let (_, _, json) = insights(planted.router(), PLANTED_SOLUTION_ID, &key, &top).await;
    let position = &json["threshold_card"]["hand_position"];
    assert_eq!(position["relative"][0]["position"], "above", "{json}");
    assert!((position["rank_in_range"].as_f64().expect("a rank") - 1.0).abs() < EQUITY_TOLERANCE);

    let (_, _, json) = insights(planted.router(), PLANTED_SOLUTION_ID, &key, &folder).await;
    assert_eq!(
        json["threshold_card"]["hand_position"]["relative"][0]["position"], "below",
        "{json}"
    );
}

/// The expected ten-bin histogram of one seat's range against the other's (plan C.3).
fn expected_bins(table: &EquityFixture, own: &[f64], other: &[f64]) -> Vec<f64> {
    let mut bins = [0.0_f64; BINS];
    for (i, reach) in own.iter().enumerate().filter(|(_, r)| **r > 0.0) {
        let equity = table.range_equity(i, other);
        let weight = reach * table.live_weight(i, other);
        #[expect(clippy::cast_possible_truncation, clippy::cast_sign_loss, reason = "a bin index")]
        let bin = ((equity * BINS_WIDE).floor() as usize).min(BINS - 1);
        bins[bin] += weight;
    }
    let total: f64 = bins.iter().sum();
    bins.iter().map(|b| b / total).collect()
}

fn assert_bins(actual: &Value, expected: &[f64]) {
    let actual: Vec<f64> =
        actual.as_array().expect("bins").iter().map(|v| v.as_f64().expect("a bin")).collect();
    assert_eq!(actual.len(), BINS);
    let total: f64 = actual.iter().sum();
    assert!((total - 1.0).abs() < 1e-6, "bins sum to 1: {actual:?}");
    for (bin, (a, e)) in actual.iter().zip(expected).enumerate() {
        assert!((a - e).abs() < SHARE_TOLERANCE, "bin {bin}: {actual:?} versus {expected:?}");
    }
}

#[tokio::test]
async fn r2_14_equity_distribution_weights_reach_and_pairs() {
    let table = EquityFixture::load();
    let hero = range_of(&table, &[("AA", 1.0), ("72o", 0.5)]);
    let villain = range_of(&table, &[("KK", 1.0), ("QQ", 0.25)]);
    let hands = vec![
        hand(class_index("AA"), [1.0, 0.0], pure(CALL), evs_best(CALL)),
        hand(class_index("72o"), [0.5, 0.0], pure(CALL), evs_best(CALL)),
        hand(class_index("KK"), [0.0, 1.0], pure(CALL), evs_best(CALL)),
        hand(class_index("QQ"), [0.0, 0.25], pure(CALL), evs_best(CALL)),
    ];
    let planted = plant(&[node(250, Position::Bb, HandSpace::Preflop169, hands)]);

    let (status, _, json) =
        insights(planted.router(), PLANTED_SOLUTION_ID, &planted.key(250), "AA").await;
    assert_eq!(status, StatusCode::OK, "body was {json}");
    let distribution = &json["equity_distribution"];
    let edges: Vec<f64> = distribution["bin_edges"]
        .as_array()
        .expect("edges")
        .iter()
        .map(|v| v.as_f64().expect("an edge"))
        .collect();
    assert_eq!(edges.len(), BINS + 1);
    for (k, edge) in edges.iter().enumerate() {
        #[expect(clippy::cast_precision_loss, reason = "eleven edges")]
        let expected = k as f64 / BINS_WIDE;
        assert!((edge - expected).abs() < 1e-6, "edge {k}: {edges:?}");
    }
    assert_bins(&distribution["oop"], &expected_bins(&table, &hero, &villain));
    assert_bins(&distribution["ip"], &expected_bins(&table, &villain, &hero));
}

#[tokio::test]
async fn r2_14_range_and_nut_advantage() {
    let table = EquityFixture::load();
    let (aa, weak) = (table.index("AA"), table.index("72o"));
    let edge = table.equity[aa][weak];
    assert!(edge >= NUT_EQUITY, "AA holds nut equity against 72o: {edge}");
    let lopsided = node(
        250,
        Position::Bb,
        HandSpace::Preflop169,
        vec![
            hand(class_index("AA"), [1.0, 0.0], pure(RAISE), evs_best(RAISE)),
            hand(class_index("72o"), [0.0, 1.0], pure(FOLD), evs_best(FOLD)),
        ],
    );
    let planted = plant(&[lopsided, full_node(300, |_| CALL)]);

    let (status, _, json) =
        insights(planted.router(), PLANTED_SOLUTION_ID, &planted.key(250), "AA").await;
    assert_eq!(status, StatusCode::OK, "body was {json}");
    let advantage = &json["range_advantage"];
    let oop = advantage["oop_mean_equity"].as_f64().expect("a mean");
    let ip = advantage["ip_mean_equity"].as_f64().expect("a mean");
    assert!((oop - edge).abs() < EQUITY_TOLERANCE, "{advantage}");
    assert!((ip - (1.0 - edge)).abs() < EQUITY_TOLERANCE, "{advantage}");
    let points = advantage["to_act_advantage_pct_points"].as_f64().expect("points");
    assert!((points - 100.0 * (edge - 0.5)).abs() < 1e-3, "{advantage}");
    let nut = &json["nut_advantage"];
    assert!((nut["threshold_equity"].as_f64().expect("a threshold") - NUT_EQUITY).abs() < 1e-6);
    assert!((nut["oop_share"].as_f64().expect("a share") - 1.0).abs() < 1e-6, "{nut}");
    assert!(nut["ip_share"].as_f64().expect("a share").abs() < 1e-6, "{nut}");
    assert!((nut["to_act_advantage"].as_f64().expect("a difference") - 1.0).abs() < 1e-6, "{nut}");

    let (_, _, json) =
        insights(planted.router(), PLANTED_SOLUTION_ID, &planted.key(300), "AA").await;
    let advantage = &json["range_advantage"];
    let points = advantage["to_act_advantage_pct_points"].as_f64().expect("points");
    assert!(points.abs() < 1e-4, "identical ranges have no advantage: {advantage}");
    let nut = &json["nut_advantage"];
    let (oop, ip) =
        (nut["oop_share"].as_f64().expect("a share"), nut["ip_share"].as_f64().expect("a share"));
    assert!((oop - ip).abs() < 1e-6, "{nut}");
    assert!(oop > 0.0 && oop < 1.0, "only the hands at or above 0.80 count: {nut}");
}

#[tokio::test]
async fn r2_14_blockers_remove_villain_combos() {
    let hands = vec![
        hand(class_index("AKs"), [1.0, 0.0], pure(RAISE), evs_best(RAISE)),
        hand(class_index("AA"), [0.0, 1.0], pure(RAISE), evs_best(RAISE)),
        hand(class_index("KK"), [0.0, 1.0], pure(RAISE), evs_best(RAISE)),
    ];
    let planted = plant(&[node(250, Position::Bb, HandSpace::Preflop169, hands)]);
    let key = planted.key(250);

    let (status, _, json) = insights(planted.router(), PLANTED_SOLUTION_ID, &key, "AhKh").await;
    assert_eq!(status, StatusCode::OK, "body was {json}");
    let blockers = &json["blockers"];
    assert_eq!(blockers["hand"], "AhKh", "{blockers}");
    assert_eq!(blockers["villain_combos_removed"], 6, "three AA and three KK combos: {blockers}");
    let share = blockers["villain_reach_removed_share"].as_f64().expect("a share");
    assert!((share - 0.5).abs() < 1e-6, "{blockers}");
    let top = blockers["top_blocked"].as_array().expect("top_blocked");
    let names: HashSet<&str> = top.iter().map(|b| b["hand"].as_str().expect("a class")).collect();
    assert_eq!(names, HashSet::from(["AA", "KK"]), "{blockers}");
    for blocked in top {
        let removed = blocked["reach_removed"].as_f64().expect("a reach");
        assert!((removed - 3.0).abs() < 1e-6, "three combos at reach 1: {blocked}");
    }

    let (status, _, json) = insights(planted.router(), PLANTED_SOLUTION_ID, &key, "AKs").await;
    assert_eq!(status, StatusCode::OK, "body was {json}");
    let share = json["blockers"]["villain_reach_removed_share"].as_f64().expect("a share");
    assert!((share - 0.5).abs() < 1e-6, "the mean over the four AKs combos: {json}");
}

#[tokio::test]
async fn r2_14_hand_role_labels() {
    let table = EquityFixture::load();
    let strength = strengths(&table, &full_range());
    let order = strongest_first(&strength);
    let (value, trap, bluff, fold) = (order[0], order[1], order[CLASSES - 1], order[100]);
    let marginal = (0..CLASSES)
        .find(|i| (0.45..0.7).contains(&rank_in_full_range(&strength, *i)))
        .expect("a class in the middle of the range");
    let roles = [
        (value, RAISE, "value"),
        (trap, CALL, "trap"),
        (bluff, RAISE, "bluff"),
        (fold, FOLD, "fold"),
        (marginal, CALL, "marginal"),
    ];
    let strategy = |i: usize| {
        roles.iter().find(|(class, _, _)| *class == i).map_or(FOLD, |(_, action, _)| *action)
    };
    let planted = plant(&[full_node(250, strategy)]);

    for (class, _, role) in roles {
        let label = class_name(u16::try_from(class).expect("a class index"));
        let (status, _, json) =
            insights(planted.router(), PLANTED_SOLUTION_ID, &planted.key(250), &label).await;
        assert_eq!(status, StatusCode::OK, "{label}: {json}");
        assert_eq!(json["hand_role"], role, "{label}: {json}");
    }
}

#[tokio::test]
async fn r2_14_noise_flags_suit_mixing_on_a_1326_node() {
    let split = vec![
        hand(combo_index("AhKh"), [1.0, 1.0], pure(RAISE), evs_best(RAISE)),
        hand(combo_index("AsKs"), [1.0, 1.0], pure(CALL), evs_best(CALL)),
        hand(combo_index("AdKd"), [1.0, 1.0], pure(RAISE), evs_best(RAISE)),
        hand(combo_index("AcKc"), [1.0, 1.0], pure(CALL), evs_best(CALL)),
    ];
    let united: Vec<_> = ["AhKh", "AsKs", "AdKd", "AcKc"]
        .iter()
        .map(|combo| hand(combo_index(combo), [1.0, 1.0], pure(RAISE), evs_best(RAISE)))
        .collect();
    let planted = plant(&[
        node(250, Position::Bb, HandSpace::Postflop1326, split),
        node(300, Position::Bb, HandSpace::Postflop1326, united),
    ]);

    let (status, _, json) =
        insights(planted.router(), PLANTED_SOLUTION_ID, &planted.key(250), "AhKh").await;
    assert_eq!(status, StatusCode::OK, "body was {json}");
    assert!(
        json["noise_flags"].as_array().is_some_and(|f| f.contains(&Value::from("suit_mixing"))),
        "{json}"
    );
    let (status, _, json) =
        grade(planted.router(), PLANTED_SOLUTION_ID, &planted.key(250), "AhKh", RAISE).await;
    assert_eq!(status, StatusCode::OK, "body was {json}");
    assert!(
        json["noise_flags"].as_array().is_some_and(|f| f.contains(&Value::from("suit_mixing"))),
        "{json}"
    );

    let (status, _, json) =
        insights(planted.router(), PLANTED_SOLUTION_ID, &planted.key(300), "AhKh").await;
    assert_eq!(status, StatusCode::OK, "body was {json}");
    assert_eq!(json["noise_flags"], serde_json::json!([]), "no split, no flag: {json}");
}

#[tokio::test]
async fn r2_14_insights_route_answers_for_a_fixture_hand() {
    let fixture = packed_fixture();

    let (status, _, json) =
        insights(fixture.router(), &fixture.solution_id, &fixture.key(0), "AKs").await;

    assert_eq!(status, StatusCode::OK, "body was {json}");
    for block in
        ["threshold_card", "equity_distribution", "range_advantage", "nut_advantage", "blockers"]
    {
        assert!(json[block].is_object(), "{block} is present at a preflop node: {json}");
    }
    assert!(json["hand_role"].is_string(), "{json}");
    assert!(json["noise_flags"].is_array(), "{json}");
}
