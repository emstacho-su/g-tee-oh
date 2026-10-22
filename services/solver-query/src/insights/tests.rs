//! Unit tests of the E3 computations (R2.14, O-153, plan D.2) on hand-built `SolvedNode`
//! values turned into a `NodeView` through `NodeRecord::from_solved`, with expectations
//! computed from the embedded table by the plan C.3 formulas.

use gto_library::{HandSpace, NodeRecord, NodeView, SolvedHand, SolvedNode};
use gto_model::grading;
use gto_model::{ActionToken, Cbb, ComboId, ConfigId, HandClass, NodeKey, Position, PositionPair};

use super::{
    EQUITY_BINS, NUT_EQUITY, compute, equity_distribution, hand_role, nut_advantage,
    range_advantage, rank_in_range, seat_ranges, threshold_card,
};
use crate::api::NoiseFlag;
use crate::api::insights::{HandRole, Relative};
use crate::equity::{CLASSES, EquityTable};
use crate::grade::{IP_SEAT, best_action, hand_numbers, noise_flags};
use crate::hand::{HandRef, parse_hand};

/// The O-22 floor the insights route applies (`routes::insights::floor_for`): the node's
/// accuracy over the pot through `gto_model::grading::floor_pct_pot` with no manifest
/// exploitability, in percent of the pot.
fn floor_pct_pot(pot: Cbb, accuracy: Option<f32>) -> f32 {
    grading::floor_pct_pot(pot, accuracy, None).pct_pot
}

/// The action indexes of every test node: fold, call 2.5 bb, raise to 8 bb.
const FOLD: usize = 0;
const CALL: usize = 1;
const RAISE: usize = 2;
/// The pot of every test node, 5 bb, and its accuracy in percent of the pot.
const POT: Cbb = Cbb(500);
const ACCURACY: f32 = 0.3;
/// How close an f32 answer must be to its f64 expectation.
const TOLERANCE: f64 = 1e-5;
/// The step a stored reach can move by (A3 section 4: reach at 1/65535).
const REACH_STEP: f64 = 1.0 / 65_535.0;

fn pair() -> PositionPair {
    PositionPair::new(Position::Bb, Position::Btn).expect("two seats")
}

/// A node at `cfg_6_online_100/BB-BTN/r250` with the big blind (out of position) to act.
fn node(space: HandSpace, hands: Vec<SolvedHand>) -> NodeView {
    node_with(space, hands, POT, Some(ACCURACY))
}

fn node_with(space: HandSpace, hands: Vec<SolvedHand>, pot: Cbb, acc: Option<f32>) -> NodeView {
    let config_id = ConfigId::new("cfg_6_online_100").expect("a catalog configuration");
    let solved = SolvedNode {
        key: NodeKey::preflop(config_id, pair(), vec![ActionToken::Raise(Cbb(250))]),
        to_act: Position::Bb,
        pot,
        stacks: [Cbb(10_000), Cbb(10_000)],
        actions: vec![
            (ActionToken::Fold, Cbb::ZERO),
            (ActionToken::Call, Cbb(250)),
            (ActionToken::Raise(Cbb(800)), Cbb(800)),
        ],
        hand_space: space,
        hands,
        accuracy_pct_pot: acc,
    };
    NodeView::from(NodeRecord::from_solved(&solved, pair()).expect("the node quantizes"))
}

/// One hand with explicit reach per seat (out of position first) playing `action` purely.
fn pure(index: u16, reach: [f64; 2], action: usize) -> SolvedHand {
    let frequencies = (0..3).map(|a| if a == action { 1.0 } else { 0.0 }).collect();
    let mut ev_bb = vec![-0.5, -1.0, -1.5];
    ev_bb[action] = 1.0;
    SolvedHand { hand: index, reach: Some(reach), frequencies, ev_bb }
}

fn class(name: &str) -> u16 {
    let class: HandClass = name.parse().expect("a hand class");
    u16::from(class.index())
}

fn combo(name: &str) -> u16 {
    let combo: ComboId = name.parse().expect("a combo");
    combo.index()
}

fn hand_ref(text: &str, space: HandSpace) -> HandRef {
    parse_hand(text, space).expect("a hand")
}

/// A reach-per-class range holding the named classes.
fn range_of(classes: &[(&str, f64)]) -> Vec<f64> {
    let mut reach = vec![0.0; CLASSES];
    for (name, value) in classes {
        reach[usize::from(class(name))] = *value;
    }
    reach
}

fn close(actual: f32, expected: f64) -> bool {
    (f64::from(actual) - expected).abs() < TOLERANCE
}

#[test]
fn r2_14_seat_ranges_fill_reach_and_strength_per_class() {
    let table = EquityTable::embedded();
    let view = node(
        HandSpace::Preflop169,
        vec![pure(class("AA"), [1.0, 0.25], CALL), pure(class("KK"), [0.5, 1.0], CALL)],
    );
    let seats = seat_ranges(&table, &view);
    let (aa, kk) = (usize::from(class("AA")), usize::from(class("KK")));
    // Reach is stored at 1/65535, so it reads back within that step.
    assert!(
        (seats[0].reach[aa] - 1.0).abs() < REACH_STEP
            && (seats[0].reach[kk] - 0.5).abs() < REACH_STEP
    );
    assert!(
        (seats[1].reach[aa] - 0.25).abs() < REACH_STEP
            && (seats[1].reach[kk] - 1.0).abs() < REACH_STEP
    );
    assert_eq!(seats[0].held().collect::<Vec<_>>(), vec![aa, kk]);
    let villain = &seats[1].reach;
    assert_eq!(seats[0].strength[aa], table.range_equity(aa, villain));
    assert_eq!(seats[0].live[kk], table.live_weight(kk, villain));
    let weak = usize::from(class("72o"));
    assert_eq!(seats[0].strength[weak], table.range_equity(weak, villain));
    assert_eq!(seats[0].reach[weak], 0.0, "not held");
}

#[test]
fn r2_14_threshold_card_names_the_cut_neighbours_and_places_the_hand() {
    let table = EquityTable::embedded();
    let hands = vec![
        pure(class("AA"), [1.0, 1.0], RAISE),
        pure(class("KK"), [1.0, 1.0], RAISE),
        pure(class("72o"), [1.0, 1.0], FOLD),
        pure(class("32o"), [1.0, 1.0], FOLD),
    ];
    let view = node(HandSpace::Preflop169, hands);
    let seats = seat_ranges(&table, &view);
    let kk = usize::from(class("KK"));
    let rank = rank_in_range(&seats[0], kk);
    assert!((rank - 30.0 / 36.0).abs() < 1e-12, "KK is above 72o and 32o: {rank}");
    let card = threshold_card(&view, &seats[0], kk, "KK", rank);
    assert_eq!(card.actions.len(), 1, "one aggressive action");
    assert_eq!(card.actions[0].index, 2);
    assert_eq!(card.actions[0].token, "r800");
    assert_eq!(card.actions[0].weakest_hand_taking_half.as_deref(), Some("KK"));
    assert!(close(card.actions[0].share_taking, 12.0 / 36.0), "{:?}", card.actions[0]);
    assert_eq!(card.strongest_folding_hand.as_deref(), Some("72o"));
    assert_eq!(card.hand_position.hand, "KK");
    let strength = seats[0].strength[kk].expect("a live matchup");
    assert!(close(card.hand_position.equity_vs_villain, strength));
    assert!(close(card.hand_position.rank_in_range, rank));
    assert_eq!(card.hand_position.relative[0].position, Relative::At);

    let aa = usize::from(class("AA"));
    let card = threshold_card(&view, &seats[0], aa, "AA", rank_in_range(&seats[0], aa));
    assert_eq!(card.hand_position.relative[0].position, Relative::Above);
    assert!(close(card.hand_position.rank_in_range, 1.0), "the strongest ranks 1");
    let weak = usize::from(class("32o"));
    let card = threshold_card(&view, &seats[0], weak, "32o", rank_in_range(&seats[0], weak));
    assert_eq!(card.hand_position.relative[0].position, Relative::Below);
    assert!(close(card.hand_position.rank_in_range, 12.0 / 36.0));
}

#[test]
fn r2_14_threshold_card_is_empty_without_takers() {
    let table = EquityTable::embedded();
    let view = node(HandSpace::Preflop169, vec![pure(class("AA"), [1.0, 1.0], CALL)]);
    let seats = seat_ranges(&table, &view);
    let aa = usize::from(class("AA"));
    let card = threshold_card(&view, &seats[0], aa, "AA", rank_in_range(&seats[0], aa));
    assert_eq!(card.actions[0].weakest_hand_taking_half, None);
    assert_eq!(card.actions[0].share_taking, 0.0);
    assert_eq!(card.strongest_folding_hand, None);
    assert_eq!(card.hand_position.relative[0].position, Relative::Below);
}

#[test]
fn r2_14_rank_in_range_weights_classes_by_reach_and_combos() {
    let table = EquityTable::embedded();
    let view = node(
        HandSpace::Preflop169,
        vec![pure(class("AA"), [1.0, 1.0], CALL), pure(class("KK"), [0.5, 1.0], CALL)],
    );
    let seats = seat_ranges(&table, &view);
    let (aa, kk) = (usize::from(class("AA")), usize::from(class("KK")));
    assert!((rank_in_range(&seats[0], kk) - 3.0 / 9.0).abs() < REACH_STEP, "3 of 9 combos");
    assert!((rank_in_range(&seats[0], aa) - 1.0).abs() < 1e-12);
    assert_eq!(rank_in_range(&seats[0], CLASSES), 0.0, "outside the table");
}

#[test]
fn r2_14_equity_distribution_bins_reach_times_live_matchups() {
    let table = EquityTable::embedded();
    let hands = vec![
        pure(class("AA"), [1.0, 0.0], CALL),
        pure(class("72o"), [0.5, 0.0], CALL),
        pure(class("KK"), [0.0, 1.0], CALL),
        pure(class("QQ"), [0.0, 0.25], CALL),
    ];
    let view = node(HandSpace::Preflop169, hands);
    let distribution = equity_distribution(&seat_ranges(&table, &view));
    for (k, edge) in distribution.bin_edges.iter().enumerate() {
        assert!(close(*edge, f64::from(u8::try_from(k).expect("eleven")) / 10.0), "{k}");
    }
    let villain = range_of(&[("KK", 1.0), ("QQ", 0.25)]);
    let mut expected = [0.0_f64; EQUITY_BINS];
    for (name, reach) in [("AA", 1.0), ("72o", 0.5)] {
        let hero = usize::from(class(name));
        let equity = table.range_equity(hero, &villain).expect("live");
        #[expect(clippy::cast_possible_truncation, clippy::cast_sign_loss, reason = "a bin")]
        let bin = ((equity * 10.0).floor() as usize).min(EQUITY_BINS - 1);
        expected[bin] += reach * table.live_weight(hero, &villain);
    }
    let total: f64 = expected.iter().sum();
    for (bin, (actual, expected)) in distribution.oop.iter().zip(&expected).enumerate() {
        assert!(close(*actual, expected / total), "bin {bin}: {:?}", distribution.oop);
    }
    let sum: f64 = distribution.ip.iter().map(|b| f64::from(*b)).sum();
    assert!((sum - 1.0).abs() < 1e-6, "{:?}", distribution.ip);
}

#[test]
fn r2_14_range_and_nut_advantage_on_a_lopsided_node() {
    let table = EquityTable::embedded();
    let (aa, weak) = (usize::from(class("AA")), usize::from(class("72o")));
    let edge = table.equity[aa][weak];
    let view = node(
        HandSpace::Preflop169,
        vec![pure(class("AA"), [1.0, 0.0], RAISE), pure(class("72o"), [0.0, 1.0], FOLD)],
    );
    let seats = seat_ranges(&table, &view);
    let advantage = range_advantage(&seats, 0);
    assert!(close(advantage.oop_mean_equity, edge), "{advantage:?}");
    assert!(close(advantage.ip_mean_equity, 1.0 - edge), "{advantage:?}");
    assert!((f64::from(advantage.to_act_advantage_pct_points) - 100.0 * (edge - 0.5)).abs() < 1e-3);
    let nut = nut_advantage(&seats, 0);
    assert!(close(nut.threshold_equity, NUT_EQUITY));
    assert_eq!((nut.oop_share, nut.ip_share, nut.to_act_advantage), (1.0, 0.0, 1.0), "{nut:?}");
    let swapped = range_advantage(&seats, 1);
    assert!(close(swapped.to_act_advantage_pct_points, 100.0 * (0.5 - edge)), "{swapped:?}");
}

#[test]
fn r2_14_identical_full_ranges_have_no_advantage() {
    let table = EquityTable::embedded();
    let hands = (0..CLASSES).map(|i| pure(u16::try_from(i).expect("a class"), [1.0, 1.0], CALL));
    let view = node(HandSpace::Preflop169, hands.collect());
    let seats = seat_ranges(&table, &view);
    let advantage = range_advantage(&seats, 0);
    assert!(advantage.to_act_advantage_pct_points.abs() < 1e-4, "{advantage:?}");
    let nut = nut_advantage(&seats, 0);
    assert_eq!(nut.oop_share, nut.ip_share, "{nut:?}");
    assert!(nut.oop_share > 0.0 && nut.oop_share < 1.0, "{nut:?}");
    assert_eq!(nut.to_act_advantage, 0.0);
}

#[test]
fn r2_14_blockers_remove_villain_combos_for_a_combo_and_a_class() {
    let hands = vec![
        pure(class("AKs"), [1.0, 0.0], RAISE),
        pure(class("AA"), [0.0, 1.0], RAISE),
        pure(class("KK"), [0.0, 1.0], RAISE),
    ];
    let view = node(HandSpace::Preflop169, hands);
    let by_combo = super::blockers(&view, IP_SEAT, hand_ref("AhKh", HandSpace::Preflop169), "AhKh");
    assert_eq!(by_combo.hand, "AhKh");
    assert_eq!(by_combo.villain_combos_removed, 6, "{by_combo:?}");
    assert!(close(by_combo.villain_reach_removed_share, 0.5), "{by_combo:?}");
    let top: Vec<(&str, f32)> =
        by_combo.top_blocked.iter().map(|b| (b.hand.as_str(), b.reach_removed)).collect();
    assert_eq!(top, vec![("AA", 3.0), ("KK", 3.0)], "{by_combo:?}");
    let by_class = super::blockers(&view, IP_SEAT, hand_ref("AKs", HandSpace::Preflop169), "AKs");
    assert_eq!(by_class.villain_combos_removed, 6, "the mean over four combos");
    assert!(close(by_class.villain_reach_removed_share, 0.5), "{by_class:?}");
}

#[test]
fn r2_14_blockers_at_a_1326_node_count_held_villain_combos() {
    let hands = vec![
        pure(combo("AhKh"), [1.0, 0.0], RAISE),
        pure(combo("AsKs"), [0.0, 1.0], RAISE),
        pure(combo("AhQh"), [0.0, 0.5], RAISE),
        pure(combo("7c2d"), [0.0, 1.0], FOLD),
    ];
    let view = node(HandSpace::Postflop1326, hands);
    let blockers =
        super::blockers(&view, IP_SEAT, hand_ref("AhKh", HandSpace::Postflop1326), "AhKh");
    assert_eq!(blockers.villain_combos_removed, 1, "{blockers:?}");
    assert!(close(blockers.villain_reach_removed_share, 0.5 / 2.5), "{blockers:?}");
    assert_eq!(blockers.top_blocked.len(), 1);
    assert_eq!(blockers.top_blocked[0].hand, "AQs");
    assert!(close(blockers.top_blocked[0].reach_removed, 0.5));
}

#[test]
fn r2_14_hand_role_covers_every_branch() {
    let hands = vec![
        pure(class("AA"), [1.0, 1.0], RAISE),
        pure(class("KK"), [1.0, 1.0], CALL),
        pure(class("72o"), [1.0, 1.0], FOLD),
    ];
    let view = node(HandSpace::Preflop169, hands);
    let (raiser, caller, folder) = (class("AA"), class("KK"), class("72o"));
    assert_eq!(hand_role(&view, folder, 0.9), HandRole::Fold);
    assert_eq!(hand_role(&view, raiser, 0.75), HandRole::Value);
    assert_eq!(hand_role(&view, raiser, 0.39), HandRole::Bluff);
    assert_eq!(hand_role(&view, raiser, 0.5), HandRole::Marginal);
    assert_eq!(hand_role(&view, caller, 0.75), HandRole::Trap);
    assert_eq!(hand_role(&view, caller, 0.5), HandRole::Marginal);
    assert_eq!(hand_role(&view, class("QQ"), 1.0), HandRole::Marginal, "not held");
}

#[test]
fn r2_14_noise_flags_close_ev_mix_rare_line_and_suit_mixing() {
    // A 10 bb pot with a 0.5 percent floor (0.05 bb): AA mixes call and raise 0.03 bb
    // apart, KK reaches the node 0.1 percent of the time, QQ raises purely.
    let pot = Cbb(1_000);
    let hands = vec![
        SolvedHand {
            hand: 0,
            reach: Some([1.0, 1.0]),
            frequencies: vec![0.0, 0.5, 0.5],
            ev_bb: vec![-1.0, 0.97, 1.0],
        },
        pure(1, [0.001, 1.0], RAISE),
        pure(2, [1.0, 1.0], RAISE),
    ];
    let view = node_with(HandSpace::Preflop169, hands, pot, Some(0.5));
    let floor = floor_pct_pot(pot, Some(0.5));
    assert_eq!(noise_flags(&view, 0, floor), vec![NoiseFlag::CloseEvMix]);
    assert_eq!(noise_flags(&view, 1, floor), vec![NoiseFlag::RareLine]);
    assert_eq!(noise_flags(&view, 2, floor), vec![]);
    assert_eq!(noise_flags(&view, 3, floor), vec![], "a hand the node does not hold");
    let best = hand_numbers(&view, 0).map(|numbers| best_action(&numbers.loss_units));
    assert_eq!(best, Some(RAISE), "the first zero-loss action");

    let split = vec![
        pure(combo("AhKh"), [1.0, 1.0], RAISE),
        pure(combo("AsKs"), [1.0, 1.0], CALL),
        pure(combo("AdKd"), [1.0, 1.0], RAISE),
    ];
    let view = node(HandSpace::Postflop1326, split);
    assert_eq!(noise_flags(&view, combo("AhKh"), floor), vec![NoiseFlag::SuitMixing]);
    let united =
        vec![pure(combo("AhKh"), [1.0, 1.0], RAISE), pure(combo("AsKs"), [1.0, 1.0], RAISE)];
    let view = node(HandSpace::Postflop1326, united);
    assert_eq!(noise_flags(&view, combo("AhKh"), floor), vec![]);
}

#[test]
fn r2_14_floor_pct_pot_takes_the_larger_of_noise_floor_accuracy_or_fallback() {
    assert!((floor_pct_pot(Cbb(500), None) - 0.4).abs() < 1e-6, "2 cbb of 500 is 0.4 percent");
    assert!((floor_pct_pot(Cbb(5_000), None) - 0.2).abs() < 1e-6, "the noise floor wins");
    assert!((floor_pct_pot(Cbb(500), Some(0.3)) - 0.3).abs() < 1e-6, "the accuracy");
    assert!((floor_pct_pot(Cbb(500), Some(0.1)) - 0.2).abs() < 1e-6, "never under the floor");
    assert!((floor_pct_pot(Cbb::ZERO, None) - 0.2).abs() < 1e-6, "no pot, no fallback");
}

#[test]
fn r2_14_compute_fills_every_block_at_preflop_and_nulls_equity_blocks_postflop() {
    let table = EquityTable::embedded();
    let hands = vec![pure(class("AA"), [1.0, 1.0], RAISE), pure(class("72o"), [1.0, 1.0], FOLD)];
    let view = node(HandSpace::Preflop169, hands);
    let floor = floor_pct_pot(POT, Some(ACCURACY));
    let hand = hand_ref("AA", HandSpace::Preflop169);
    let preflop = compute(&table, &view, hand, "AA", floor).expect("the big blind acts");
    assert!(preflop.threshold_card.is_some() && preflop.equity_distribution.is_some());
    assert!(preflop.range_advantage.is_some() && preflop.nut_advantage.is_some());
    assert_eq!(preflop.hand_role, Some(HandRole::Value), "AA raises and ranks 1");
    assert_eq!(preflop.blockers.hand, "AA");
    let card = preflop.threshold_card.as_ref().expect("a card");
    assert_eq!(card.hand_position.hand, "AA");
    assert_eq!(preflop.noise_flags, vec![]);

    let combos =
        vec![pure(combo("AhKh"), [1.0, 1.0], RAISE), pure(combo("AsKs"), [1.0, 1.0], CALL)];
    let view = node(HandSpace::Postflop1326, combos);
    let hand = hand_ref("AhKh", HandSpace::Postflop1326);
    let postflop = compute(&table, &view, hand, "AhKh", floor).expect("the big blind acts");
    assert!(postflop.threshold_card.is_none() && postflop.equity_distribution.is_none());
    assert!(postflop.range_advantage.is_none() && postflop.nut_advantage.is_none());
    assert_eq!(postflop.hand_role, None);
    assert_eq!(postflop.blockers.villain_combos_removed, 1, "AhKh removes itself: {postflop:?}");
    assert_eq!(postflop.noise_flags, vec![NoiseFlag::SuitMixing]);
}
