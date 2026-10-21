//! Unit tests of the `/v1/nodes` assembly (R2.13): the hands filter, the button labels, the
//! spot-class key and the class aggregation of a 1,326-combo node (O-159).

use gto_library::{HandSpace, NodeRecord, NodeView, RecordAction, SolvedHand, SolvedNode};
use gto_model::{
    ActionToken, Bucket, Cbb, ComboId, ConfigId, NodeKey, Position, PositionPair, Street,
};

use super::{HandsFilter, action_label, class_rows, exact_label, spot_class_key};
use crate::error::ApiError;

fn action(token: ActionToken, bucket: Option<Bucket>) -> RecordAction {
    RecordAction { token, size: token.size().unwrap_or(Cbb::ZERO), bucket }
}

#[test]
fn r2_13_hands_filter_parses_all_class_and_one_hand() {
    assert_eq!(HandsFilter::parse(None).expect("default"), HandsFilter::All);
    assert_eq!(HandsFilter::parse(Some("all")).expect("all"), HandsFilter::All);
    assert_eq!(HandsFilter::parse(Some("class")).expect("class"), HandsFilter::Class);
    let one = HandsFilter::parse(Some("AhKh")).expect("a combo");
    assert_eq!(one, HandsFilter::One("AhKh".to_owned()));
    let error = HandsFilter::parse(Some("bogus")).expect_err("not a hand");
    assert!(matches!(error, ApiError::BadRequest(_)), "{error}");
}

#[test]
fn r2_13_labels_show_the_exact_size_preflop_and_the_bucket_postflop() {
    let raise = action(ActionToken::Raise(Cbb(250)), Some(Bucket::OverbetLarge));
    assert_eq!(action_label(&raise, Street::Preflop), "Raise to 2.5bb");
    assert_eq!(action_label(&raise, Street::Flop), "Overbet large");
    let bet = action(ActionToken::Bet(Cbb(800)), Some(Bucket::Small));
    assert_eq!(action_label(&bet, Street::Turn), "Small");
    assert_eq!(exact_label(ActionToken::Bet(Cbb(800))), "Bet 8bb");
    let call = action(ActionToken::Call, None);
    assert_eq!(action_label(&call, Street::River), "Call");
    assert_eq!(exact_label(ActionToken::Straddle(Cbb(200))), "Straddle 2bb");
    assert_eq!(exact_label(ActionToken::AllIn), "All-in");
    assert_eq!(exact_label(ActionToken::Limp), "Limp");
    assert_eq!(exact_label(ActionToken::Check), "Check");
}

#[test]
fn r2_13_spot_class_key_is_null_outside_the_catalog_and_postflop() {
    let pair = PositionPair::new(Position::Bb, Position::Btn).expect("two seats");
    let catalog = ConfigId::new("cfg_6_online_100").expect("an id");
    let key = NodeKey::preflop(catalog, pair, vec![ActionToken::Raise(Cbb(250))]);
    assert!(spot_class_key(&key).is_some_and(|k| k.starts_with("preflop/online/")));
    let other = NodeKey::preflop(ConfigId::new("cfg_x").expect("an id"), pair, Vec::new());
    assert_eq!(spot_class_key(&other), None);
}

#[test]
fn r2_13_class_rows_weigh_a_class_by_the_acting_seats_reach() {
    // AsKs and AhKh, both AKs: the first reaches twice as often for the acting seat.
    let pair = PositionPair::new(Position::Bb, Position::Btn).expect("two seats");
    let combo = |name: &str| name.parse::<ComboId>().expect("a combo").index();
    let hand = |name: &str, reach, ev_bb| SolvedHand {
        hand: combo(name),
        reach: Some(reach),
        frequencies: vec![0.0, 0.5, 0.5],
        ev_bb,
    };
    let node = SolvedNode {
        key: NodeKey::preflop(ConfigId::new("cfg_6_online_100").expect("id"), pair, vec![]),
        to_act: Position::Bb,
        pot: Cbb(1_000),
        stacks: [Cbb(10_000), Cbb(10_000)],
        actions: vec![
            (ActionToken::Fold, Cbb::ZERO),
            (ActionToken::Call, Cbb(250)),
            (ActionToken::Raise(Cbb(800)), Cbb(800)),
        ],
        hand_space: HandSpace::Postflop1326,
        hands: vec![
            hand("AsKs", [1.0, 0.5], vec![-1.0, 1.0, 0.0]),
            hand("AhKh", [0.5, 0.5], vec![-1.0, 0.0, 1.0]),
        ],
        accuracy_pct_pot: None,
    };
    let view = NodeView::from(NodeRecord::from_solved(&node, pair).expect("quantizes"));
    let rows = class_rows(&view);
    assert_eq!(rows.len(), 1);
    let row = &rows[0];
    assert_eq!(row.hand, "AKs");
    assert_eq!(row.reach.map(|r| r.map(|x| (x * 100.0).round())), Some([75.0, 50.0]));
    // Weights 2/3 and 1/3: call EV 2/3, raise EV 1/3, best EV 1.
    assert!((row.ev_bb[1] - 2.0 / 3.0).abs() < 1e-3 && (row.ev_bb[2] - 1.0 / 3.0).abs() < 1e-3);
    assert!((row.ev_best_bb - 1.0).abs() < 1e-6, "{row:?}");
    assert!((row.loss_pct_pot[0] - 20.0).abs() < 1e-3, "{row:?}");
}
