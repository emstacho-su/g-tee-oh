//! R2.19 push/fold solver tests (04 section 4, O-220, O-223, O-224). R2.19 is a requirement
//! identifier (R ID).
//!
//! Mechanism: the solver reads the committed 169 by 169 equity table (O-126), solves the
//! heads-up push/fold game exactly and certifies it with a best response. These debug-profile
//! tests solve three depths; gate G6a runs all fifteen in release (`just g6a`).

use std::path::Path;

use gto_model::{ActionToken, GameConfig, HandClass, Position, PositionPair};
use gto_solve::equity::EquityTable;
use gto_solve::preflop::{
    CERTIFICATE_GAIN_BB, CfrOptions, FlopPayout, PreflopGame, SolvedPreflop, best_response_gains,
    push_fold_config, solve, solve_push_fold,
};
use gto_tree::{PreflopTree, SizingConventionSpec};

/// Depths the debug tests solve.
const DEPTHS_BB: [u32; 3] = [5, 10, 15];

/// Tolerance for EV comparisons that are exact up to f64 rounding.
const EV_EPSILON_BB: f64 = 1e-9;

fn repo_root() -> &'static Path {
    Path::new(concat!(env!("CARGO_MANIFEST_DIR"), "/../.."))
}

fn equity_table() -> EquityTable {
    let path = repo_root().join("validation/fixtures/equity/preflop-169.json");
    let text = std::fs::read_to_string(&path).expect("the committed equity table");
    let value: serde_json::Value = serde_json::from_str(&text).expect("equity JSON");
    EquityTable {
        classes: serde_json::from_value(value["classes"].clone()).expect("classes"),
        equity: serde_json::from_value(value["equity"].clone()).expect("equity"),
        pairs: serde_json::from_value(value["pairs"].clone()).expect("pairs"),
    }
}

fn solved(depth_bb: u32) -> (GameConfig, SolvedPreflop) {
    let config = push_fold_config(depth_bb).expect("a push/fold config");
    let solution = solve_push_fold(&config, &equity_table()).expect("a certified solve");
    (config, solution)
}

fn class(label: &str) -> usize {
    HandClass::all()
        .into_iter()
        .position(|class| class.to_string() == label)
        .unwrap_or_else(|| panic!("{label} is a hand class"))
}

#[test]
fn r2_19_push_fold_config_is_rake_free_heads_up() {
    let config = push_fold_config(10).expect("a push/fold config");
    assert_eq!(config.config_id().as_str(), "cfg_2_online_norake_10");
    assert_eq!(config.stake.rake.percent_bp, 0);
    assert!(push_fold_config(0).is_err(), "a zero depth is refused");
}

#[test]
fn r2_19_push_fold_is_certified_exact_at_each_depth() {
    for depth_bb in DEPTHS_BB {
        let (_, solution) = solved(depth_bb);
        for gain in solution.gains_bb {
            assert!(gain <= CERTIFICATE_GAIN_BB, "depth {depth_bb}: gain {gain} bb");
        }
        assert_eq!(solution.nodes.len(), 2);
        assert_eq!(solution.nodes[0].hands.len(), usize::from(HandClass::COUNT));
    }
}

#[test]
fn r2_19_best_response_gains_match_the_certificate() {
    let config = push_fold_config(10).expect("a push/fold config");
    let equity = equity_table();
    let tree = PreflopTree::push_fold(&config).expect("a tree");
    let game = PreflopGame::new(&tree, &config, &equity, None).expect("a game");
    let solution = solve_push_fold(&config, &equity).expect("a certified solve");
    let gains = best_response_gains(&game, &solution).expect("gains");
    for (gain, reported) in gains.iter().zip(solution.gains_bb) {
        assert!((gain - reported).abs() <= EV_EPSILON_BB, "{gain} versus {reported}");
    }
}

#[test]
fn r2_19_aces_always_push_and_call_and_the_worst_hands_fold_at_15bb() {
    for depth_bb in DEPTHS_BB {
        let (_, solution) = solved(depth_bb);
        let [push, call] = [&solution.nodes[0], &solution.nodes[1]];
        assert_eq!(push.actions, vec![ActionToken::Fold, ActionToken::AllIn]);
        assert_eq!(call.actions, vec![ActionToken::Fold, ActionToken::Call]);
        assert!((push.hands[class("AA")].frequencies[1] - 1.0).abs() < EV_EPSILON_BB);
        assert!((call.hands[class("AA")].frequencies[1] - 1.0).abs() < EV_EPSILON_BB);
    }
    let (_, solution) = solved(15);
    assert!(solution.nodes[0].hands[class("32o")].frequencies[0] > 1.0 - EV_EPSILON_BB);
    assert!(solution.nodes[1].hands[class("72o")].frequencies[0] > 1.0 - EV_EPSILON_BB);
}

#[test]
fn r2_19_frequencies_sum_to_one_and_mixed_classes_are_indifferent() {
    for depth_bb in DEPTHS_BB {
        let (_, solution) = solved(depth_bb);
        for node in &solution.nodes {
            for hand in &node.hands {
                let sum: f64 = hand.frequencies.iter().sum();
                assert!((sum - 1.0).abs() < EV_EPSILON_BB, "{} sums to {sum}", hand.class);
                let mixed = hand.frequencies.iter().all(|f| *f > EV_EPSILON_BB);
                if mixed {
                    let gap = (hand.ev_bb[0] - hand.ev_bb[1]).abs();
                    assert!(gap <= EV_EPSILON_BB, "{} mixes with an EV gap {gap}", hand.class);
                }
            }
        }
    }
}

#[test]
fn r2_19_evs_follow_the_pot_share_convention() {
    // O-224: an action's EV is the actor's expected final stack minus the stack behind at
    // the node. Folding is 0; the root EVs of the two seats sum to the pot of 1.5 bb.
    let (_, solution) = solved(10);
    let root = &solution.nodes[0];
    let facing = &solution.nodes[1];
    for hand in root.hands.iter().chain(&facing.hands) {
        assert!(hand.ev_bb[0].abs() < EV_EPSILON_BB, "fold is 0 for {}", hand.class);
    }
    // A called all-in at 10 bb: 2 x 10 x equity minus the stack behind (9.5 for the
    // button, 9 for the big blind), so AA's call EV is below 20 - 9 = 11 and above 0.
    let aa_call = facing.hands[class("AA")].ev_bb[1];
    assert!(aa_call > 0.0 && aa_call < 11.0, "AA calls for {aa_call} bb");
}

#[test]
fn r2_19_reach_is_the_product_of_own_frequencies() {
    let (_, solution) = solved(10);
    let pair = PositionPair::new(Position::Bb, Position::Btn).expect("BB-BTN");
    assert_eq!(pair.oop(), Position::Bb);
    let root = &solution.nodes[0];
    let facing = &solution.nodes[1];
    for (index, hand) in facing.hands.iter().enumerate() {
        let pushed = root.hands[index].frequencies[1];
        // Pair order is out of position first: index 1 is the button.
        assert!((hand.reach[1] - pushed).abs() < EV_EPSILON_BB, "{}", hand.class);
        assert!((hand.reach[0] - 1.0).abs() < EV_EPSILON_BB, "the big blind has not acted");
    }
}

#[test]
fn r2_19_a_flop_line_needs_a_payout_and_solves_with_one() {
    let path = repo_root()
        .join("packages/contracts/schemas/examples/sizing-convention/valid/seed-online.json");
    let spec_text = std::fs::read_to_string(path).expect("the online seed spec");
    let spec = SizingConventionSpec::from_json(&spec_text).expect("a valid spec");
    let config = push_fold_config(100).expect("a heads-up 100bb config");
    let pair = PositionPair::new(Position::Bb, Position::Btn).expect("BB-BTN");
    let tree = PreflopTree::build(&spec, &config, pair).expect("a 100bb pair tree");
    assert_ne!(tree.flop_lines().len(), 0);
    let equity = equity_table();
    assert!(PreflopGame::new(&tree, &config, &equity, None).is_err(), "no payout given");
    let game = PreflopGame::new(&tree, &config, &equity, Some(FlopPayout::PLACEHOLDER))
        .expect("a P2 game");
    let options = CfrOptions { max_iterations: 200, target_gain_pct_pot: 0.0, check_every: 50 };
    let solution = solve(&game, &options).expect("a CFR+ run");
    assert_eq!(solution.nodes.len(), tree.nodes().len());
    assert!(solution.iterations <= 200);
    for node in &solution.nodes {
        for hand in &node.hands {
            let sum: f64 = hand.frequencies.iter().sum();
            assert!((sum - 1.0).abs() < 1e-6);
        }
    }
}
