//! Unit tests of the grade math (R2.13): hand-built nodes quantized through
//! `NodeRecord::from_solved` and read back as a `NodeView`, so every number passes the
//! real quantization.

use gto_library::{HandSpace, NodeRecord, NodeView, SolvedHand, SolvedNode};
use gto_model::{ActionToken, Cbb, ComboId, ConfigId, HandClass, NodeKey, Position, PositionPair};

use super::{
    MIX_EPSILON, RARE_LINE_REACH, action_shares, best_action, difficulty_features, hand_weight,
    is_mixed, loss_pct_pot, node_noise_flags, noise_flags, seat_totals,
};
use crate::api::NoiseFlag;

/// A 10 bb pot, so 1 percent of the pot is 0.1 bb.
const POT: Cbb = Cbb(1_000);
/// A floor of half a percent of the pot.
const FLOOR: f32 = 0.5;

fn hand(index: u16, reach: [f64; 2], frequencies: Vec<f64>, ev_bb: Vec<f64>) -> SolvedHand {
    SolvedHand { hand: index, reach: Some(reach), frequencies, ev_bb }
}

/// The record index of a class name at a `preflop_169` node.
fn class(name: &str) -> u16 {
    u16::from(name.parse::<HandClass>().expect("a class").index())
}

/// The record index of a combo at a `postflop_1326` node.
fn combo(name: &str) -> u16 {
    name.parse::<ComboId>().expect("a combo").index()
}

/// A fold, call, raise node with `hands`, the big blind to act out of position.
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
        accuracy_pct_pot: Some(FLOOR),
    };
    NodeView::from(NodeRecord::from_solved(&node, pair).expect("the node quantizes"))
}

#[test]
fn r2_13_loss_pct_pot_and_best_action_read_the_stored_units() {
    assert_eq!(loss_pct_pot(30).to_bits(), 0.3_f32.to_bits());
    assert_eq!(loss_pct_pot(0).to_bits(), 0.0_f32.to_bits());
    assert_eq!(best_action(&[2_000, 30, 0]), 2);
    assert_eq!(best_action(&[0, 0, 5]), 0, "the first on ties");
    assert_eq!(best_action(&[7, 3, 3]), 1, "the first smallest without a zero");
    assert_eq!(best_action(&[]), 0);
}

#[test]
fn r2_13_noise_flags_name_a_close_mix_and_a_rare_line() {
    let v = view(
        HandSpace::Preflop169,
        vec![
            hand(0, [1.0, 1.0], vec![0.0, 0.5, 0.5], vec![-1.0, 0.97, 1.0]),
            hand(1, [0.001, 1.0], vec![0.0, 0.0, 1.0], vec![-1.0, -0.5, 1.0]),
            hand(2, [1.0, 1.0], vec![0.0, 0.0, 1.0], vec![-1.0, 0.5, 1.0]),
        ],
    );
    assert_eq!(noise_flags(&v, 0, FLOOR), vec![NoiseFlag::CloseEvMix]);
    assert_eq!(noise_flags(&v, 1, FLOOR), vec![NoiseFlag::RareLine]);
    assert_eq!(noise_flags(&v, 2, FLOOR), Vec::<NoiseFlag>::new());
    assert_eq!(noise_flags(&v, 3, FLOOR), Vec::<NoiseFlag>::new(), "not held");
    assert_eq!(node_noise_flags(&v), Vec::<NoiseFlag>::new(), "two of three hands reach");
    // Just under each threshold the flag drops (O-153): a mix at 4 percent is not a
    // mix, and a reach of exactly the rare-line bound is not rare.
    let under = MIX_EPSILON - 0.01;
    let edge = view(
        HandSpace::Preflop169,
        vec![
            hand(
                0,
                [1.0, 1.0],
                vec![0.0, f64::from(under), 1.0 - f64::from(under)],
                vec![-1.0, 0.97, 1.0],
            ),
            hand(1, [f64::from(RARE_LINE_REACH), 1.0], vec![0.0, 0.0, 1.0], vec![-1.0, 0.5, 1.0]),
        ],
    );
    assert_eq!(noise_flags(&edge, 0, FLOOR), Vec::<NoiseFlag>::new(), "under the epsilon");
    assert_eq!(noise_flags(&edge, 1, FLOOR), Vec::<NoiseFlag>::new(), "at the bound");
}

#[test]
fn r2_13_suit_mixing_needs_a_1326_node_whose_combos_split() {
    // AsKs calls while AhKh and AcKc raise: the class splits its best action.
    let (hearts, spades, clubs) = (combo("AhKh"), combo("AsKs"), combo("AcKc"));
    let split = view(
        HandSpace::Postflop1326,
        vec![
            hand(spades, [1.0, 1.0], vec![0.0, 1.0, 0.0], vec![-1.0, 1.0, 0.5]),
            hand(clubs, [1.0, 1.0], vec![0.0, 0.0, 1.0], vec![-1.0, 0.5, 1.0]),
            hand(hearts, [1.0, 1.0], vec![0.0, 0.0, 1.0], vec![-1.0, 0.5, 1.0]),
        ],
    );
    assert_eq!(noise_flags(&split, hearts, FLOOR), vec![NoiseFlag::SuitMixing]);
    assert_eq!(noise_flags(&split, spades, FLOOR), vec![NoiseFlag::SuitMixing]);
    let agreed = view(
        HandSpace::Postflop1326,
        vec![
            hand(spades, [1.0, 1.0], vec![0.0, 0.0, 1.0], vec![-1.0, 0.5, 1.0]),
            hand(hearts, [1.0, 1.0], vec![0.0, 0.0, 1.0], vec![-1.0, 0.5, 1.0]),
        ],
    );
    assert_eq!(noise_flags(&agreed, hearts, FLOOR), Vec::<NoiseFlag>::new());
    let preflop = view(
        HandSpace::Preflop169,
        vec![hand(class("AKs"), [1.0, 1.0], vec![0.0, 0.0, 1.0], vec![-1.0, 0.5, 1.0])],
    );
    assert_eq!(noise_flags(&preflop, class("AKs"), FLOOR), Vec::<NoiseFlag>::new());
}

#[test]
fn r2_13_difficulty_features_read_the_gap_purity_and_mix() {
    let features = difficulty_features(&[0.0, 0.5, 0.5], &[2_000, 30, 0], FLOOR);
    assert_eq!(features.n_actions, 3);
    assert!(features.mixed);
    assert!(!features.all_within_floor, "the fold loses 20 percent");
    assert_eq!(features.ev_gap_pct_pot.to_bits(), 0.3_f32.to_bits());
    assert_eq!(features.purity.to_bits(), 0.5_f32.to_bits());
    let pure = difficulty_features(&[1.0], &[0], FLOOR);
    assert_eq!((pure.ev_gap_pct_pot, pure.mixed, pure.all_within_floor), (0.0, false, true));
    let within = difficulty_features(&[0.0, 1.0], &[40, 0], FLOOR);
    assert!(within.all_within_floor && !within.mixed);
}

#[test]
fn r2_13_range_totals_and_shares_weigh_reach_by_combos() {
    // AA (6 combos) at reach 0.5 calls, AKs (4 combos) at reach 1 raises.
    let v = view(
        HandSpace::Preflop169,
        vec![
            hand(class("AA"), [0.5, 1.0], vec![0.0, 1.0, 0.0], vec![-1.0, 1.0, 0.5]),
            hand(class("AKs"), [1.0, 0.25], vec![0.0, 0.0, 1.0], vec![-1.0, 0.5, 1.0]),
        ],
    );
    assert_eq!(hand_weight(HandSpace::Preflop169, class("AA")), 6);
    assert_eq!(hand_weight(HandSpace::Preflop169, class("AKs")), 4);
    assert_eq!(hand_weight(HandSpace::Preflop169, class("AKo")), 12);
    assert_eq!(hand_weight(HandSpace::Preflop169, 169), 0);
    assert_eq!(hand_weight(HandSpace::Postflop1326, 1_325), 1);
    assert_eq!(hand_weight(HandSpace::Postflop1326, 1_326), 0);
    let (combos, weighted) = seat_totals(&v, 0);
    assert_eq!(combos, 10);
    assert!((weighted - 7.0).abs() < 1e-3, "reach is stored at 1/65535: {weighted}");
    let (_, in_position) = seat_totals(&v, 1);
    assert!((in_position - 7.0).abs() < 1e-3, "{in_position}");
    let shares = action_shares(&v);
    assert_eq!(shares.len(), 3);
    assert!((shares[1] - 3.0 / 7.0).abs() < 1e-4, "{shares:?}");
    assert!((shares[2] - 4.0 / 7.0).abs() < 1e-4, "{shares:?}");
    let rare_hand = hand(0, [0.001, 1.0], vec![0.0, 1.0, 0.0], vec![-1.0, 1.0, 0.5]);
    let rare = view(HandSpace::Preflop169, vec![rare_hand]);
    assert_eq!(node_noise_flags(&rare), vec![NoiseFlag::RareLine]);
}

#[test]
fn r3_16_is_mixed_counts_actions_at_the_mixing_epsilon_or_more() {
    assert!(is_mixed(&[0.0, 0.5, 0.5]));
    assert!(is_mixed(&[0.95, MIX_EPSILON]), "the epsilon itself counts as played");
    assert!(!is_mixed(&[0.96, 0.04]), "a 4 percent line is not a mix");
    assert!(!is_mixed(&[1.0]));
    assert!(!is_mixed(&[]));
    for frequencies in [[0.0, 0.5, 0.5], [0.96, 0.04, 0.0], [0.9, 0.05, 0.05]] {
        let features = difficulty_features(&frequencies, &[0, 10, 20], FLOOR);
        assert_eq!(features.mixed, is_mixed(&frequencies), "{frequencies:?}");
    }
}
