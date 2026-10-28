//! Unit tests of the `/v1/grade-range` validation and weighting (R3.17, O-300): hand-built
//! nodes quantized through `NodeRecord::from_solved` and read back as a `NodeView`, so
//! every number passes the real quantization.

use gto_library::{HandSpace, NodeRecord, NodeView, SolvedHand, SolvedNode, loss_bb};
use gto_model::{ActionToken, Cbb, ComboId, ConfigId, HandClass, NodeKey, Position, PositionPair};

use super::{Painted, grade_painted, parse_paint};
use crate::api::grade_range::{PAINT_MAX_ENTRIES, PaintedHand};
use crate::error::ApiError;

/// A 10 bb pot, so 1 percent of the pot is 0.1 bb.
const POT: Cbb = Cbb(1_000);
/// The weight tolerance without reach.
const TOLERANCE: f64 = 1e-6;
/// The weight tolerance with reach, which is stored at 1/65535 (A3 section 4).
const REACH_TOLERANCE: f64 = 1e-4;

fn class(name: &str) -> HandClass {
    name.parse().expect("a class")
}

fn index(name: &str) -> u16 {
    u16::from(class(name).index())
}

fn entry(hand: &str, action_index: u8) -> PaintedHand {
    PaintedHand { hand: hand.to_owned(), action_index }
}

fn painted(hand: &str, action: usize) -> Painted {
    Painted { class: class(hand), action }
}

fn solved(hand: u16, reach: Option<[f64; 2]>, frequencies: Vec<f64>, ev: Vec<f64>) -> SolvedHand {
    SolvedHand { hand, reach, frequencies, ev_bb: ev }
}

/// A fold, call, raise node with `hands`, the big blind (out of position, seat 0) to act.
fn view(space: HandSpace, hands: Vec<SolvedHand>) -> NodeView {
    let pair = PositionPair::new(Position::Bb, Position::Btn).expect("two seats");
    let config_id = ConfigId::new("cfg_6_online_100").expect("a config id");
    let node = SolvedNode {
        key: NodeKey::preflop(config_id, pair, vec![ActionToken::Raise(Cbb(250))]),
        to_act: Position::Bb,
        pot: POT,
        stacks: [Cbb(10_000), Cbb(10_000)],
        actions: vec![
            (ActionToken::Fold, Cbb::ZERO),
            (ActionToken::Call, Cbb(250)),
            (ActionToken::Raise(Cbb(800)), Cbb(800)),
        ],
        hand_space: space,
        hands,
        accuracy_pct_pot: Some(0.5),
    };
    NodeView::from(NodeRecord::from_solved(&node, pair).expect("the node quantizes"))
}

/// AA raises (6 combos, reach 0.5), AKs calls (4 combos, reach 1), 72o folds (12 combos,
/// reach 1): reach-weighted combos 3, 4 and 12 of 19.
fn three_hands(reach: bool) -> NodeView {
    let r = |acting: f64| reach.then_some([acting, 1.0]);
    view(
        HandSpace::Preflop169,
        vec![
            solved(index("AA"), r(0.5), vec![0.0, 0.0, 1.0], vec![-1.0, 1.0, 3.0]),
            solved(index("AKs"), r(1.0), vec![0.0, 1.0, 0.0], vec![-1.0, 1.0, 0.5]),
            solved(index("72o"), r(1.0), vec![1.0, 0.0, 0.0], vec![-1.0, -2.0, -4.0]),
        ],
    )
}

fn bad_request(error: &ApiError) -> &str {
    match error {
        ApiError::BadRequest(message) => message,
        other => panic!("expected a 400, got {other:?}"),
    }
}

#[test]
fn r3_17_paint_over_the_cap_is_rejected_before_any_hand_is_read() {
    let paint = vec![entry("not a hand", 0); PAINT_MAX_ENTRIES + 1];
    let error = parse_paint(&paint).expect_err("over the cap");
    let message = bad_request(&error);
    assert!(message.contains("1327") && message.contains("1326"), "{message}");
    assert!(!message.contains("not a hand"), "the cap is checked first: {message}");
}

#[test]
fn r3_17_a_malformed_hand_or_a_combo_is_rejected_with_a_capped_echo() {
    let long = "x".repeat(500);
    let error = parse_paint(&[entry("AA", 0), entry(&long, 0)]).expect_err("not a class");
    let message = bad_request(&error);
    assert!(message.contains("paint[1]"), "{message}");
    assert!(message.len() < 200, "the echo is capped: {message}");
    let error = parse_paint(&[entry("AhKh", 0)]).expect_err("a combo is not a class");
    assert!(bad_request(&error).contains("AhKh"), "{error:?}");
}

#[test]
fn r3_17_a_duplicate_class_is_rejected() {
    let error =
        parse_paint(&[entry("AA", 0), entry("KK", 1), entry("AA", 2)]).expect_err("AA twice");
    let message = bad_request(&error);
    assert!(message.contains("\"AA\"") && message.contains("paint[2]"), "{message}");
    let parsed = parse_paint(&[entry("AA", 2), entry("KK", 1)]).expect("two classes");
    assert_eq!(parsed, vec![painted("AA", 2), painted("KK", 1)]);
}

#[test]
fn r3_17_grade_painted_checks_the_space_the_actions_and_the_held_hands() {
    let v = three_hands(true);
    let all = [painted("AA", 2), painted("AKs", 1), painted("72o", 0)];
    assert!(grade_painted(&v, &all).is_ok());

    let out_of_range = [painted("AA", 3), painted("AKs", 1), painted("72o", 0)];
    let error = grade_painted(&v, &out_of_range).expect_err("action 3 of 3");
    assert!(bad_request(&error).contains("action_index 3"), "{error:?}");

    let not_held = [painted("AA", 2), painted("AKs", 1), painted("72o", 0), painted("QQ", 0)];
    let error = grade_painted(&v, &not_held).expect_err("QQ is not held");
    let message = bad_request(&error);
    assert!(message.contains("\"QQ\"") && message.contains("not in the node's range"), "{message}");

    let missing = [painted("AA", 2), painted("AKs", 1)];
    let error = grade_painted(&v, &missing).expect_err("72o is missing");
    let message = bad_request(&error);
    assert!(message.contains("72o") && message.contains("1 held hand"), "{message}");

    let combo = |name: &str| name.parse::<ComboId>().expect("a combo").index();
    let postflop = view(
        HandSpace::Postflop1326,
        vec![solved(combo("AhKh"), None, vec![0.0, 1.0, 0.0], vec![-1.0, 1.0, 0.5])],
    );
    let error = grade_painted(&postflop, &[painted("AKs", 1)]).expect_err("postflop");
    assert!(bad_request(&error).contains("preflop"), "{error:?}");
}

#[test]
fn r3_17_missing_hands_are_listed_up_to_a_cap() {
    let hands = (0..20)
        .map(|hand| solved(hand, None, vec![1.0, 0.0, 0.0], vec![0.0, -1.0, -1.0]))
        .collect();
    let v = view(HandSpace::Preflop169, hands);
    let error = grade_painted(&v, &[]).expect_err("everything is missing");
    let message = bad_request(&error);
    assert!(message.contains("20 held hands") && message.contains("AA"), "{message}");
    assert!(message.len() < 200, "{message}");
}

#[test]
fn r3_17_weights_are_reach_times_combos_over_the_range() {
    let v = three_hands(true);
    let paint = [painted("72o", 2), painted("AA", 1), painted("AKs", 1)];
    let (rows, total) = grade_painted(&v, &paint).expect("a full paint");
    let names: Vec<&str> = rows.iter().map(|row| row.hand.as_str()).collect();
    assert_eq!(names, ["AA", "AKs", "72o"], "record order, whatever the paint order");
    let expected = [3.0 / 19.0, 4.0 / 19.0, 12.0 / 19.0];
    for (row, weight) in rows.iter().zip(expected) {
        assert!((row.weight - weight).abs() < REACH_TOLERANCE, "{row:?}");
        let product = f64::from(row.loss_bb) * row.weight;
        assert_eq!(row.weighted_loss_bb.to_bits(), product.to_bits(), "{row:?}");
    }
    let sum: f64 = rows.iter().map(|row| row.weighted_loss_bb).sum();
    assert_eq!(total.to_bits(), sum.to_bits());
    let weights: f64 = rows.iter().map(|row| row.weight).sum();
    assert!((weights - 1.0).abs() < TOLERANCE, "the shares sum to 1: {weights}");
    let aa = &rows[0];
    let units = v.loss_units(index("AA"), 1).expect("a loss");
    assert_eq!(aa.loss_bb.to_bits(), loss_bb(units, POT).to_bits());
    assert_eq!((aa.action_index, aa.best_action_index), (1, 2));
    assert_eq!(rows[1].loss_bb.to_bits(), 0_f32.to_bits(), "AKs is painted at its best");
}

#[test]
fn r3_17_a_record_without_reach_weighs_every_hand_by_its_combos() {
    let v = three_hands(false);
    let paint = [painted("AA", 2), painted("AKs", 1), painted("72o", 0)];
    let (rows, total) = grade_painted(&v, &paint).expect("a full paint");
    let expected = [6.0 / 22.0, 4.0 / 22.0, 12.0 / 22.0];
    for (row, weight) in rows.iter().zip(expected) {
        assert!((row.weight - weight).abs() < TOLERANCE, "{row:?}");
    }
    assert_eq!(total.to_bits(), 0_f64.to_bits(), "every hand at its best");
}

#[test]
fn r3_17_a_range_the_seat_never_reaches_weighs_nothing() {
    let v = view(
        HandSpace::Preflop169,
        vec![solved(index("AA"), Some([0.0, 1.0]), vec![0.0, 0.0, 1.0], vec![-1.0, 1.0, 3.0])],
    );
    let (rows, total) = grade_painted(&v, &[painted("AA", 0)]).expect("a full paint");
    assert_eq!(rows[0].weight.to_bits(), 0_f64.to_bits(), "{rows:?}");
    assert!(rows[0].loss_bb > 0.0, "the loss is still reported: {rows:?}");
    assert_eq!(total.to_bits(), 0_f64.to_bits());
}
