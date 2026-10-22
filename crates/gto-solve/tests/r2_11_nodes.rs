//! R2.11 tests of `root_street_nodes` (O-135): the root-street decision nodes of a solved
//! game with per-hand frequencies, reach and per-action expected values, what gate G4's
//! engine-side dump is built from. The walk is checked against the `gto-tree` skeleton on
//! a flop root, its root figures against the public best-response walk, and its stop at
//! the first chance node on a turn root and a river root (the first river root a test
//! solves; the river has no chance node below it).

#[path = "r2_10_support/mod.rs"]
mod common;

use std::collections::BTreeSet;

use common::{IP_RANGE, OOP_RANGE, narrow_tree, online_config, opened_line, range, small_problem};
use gto_model::{Board, Card, Cbb, Street};
use gto_solve::postflop::{
    NoProgress, NodeStrategy, PostflopProblem, StopRule, best_response, root_street_nodes,
    solve_postflop,
};
use gto_tree::{ActionTree, DecisionNode, Player};

/// A few iterations: nothing below depends on convergence.
const FEW_ITERATIONS: StopRule =
    StopRule { target_exploitability_pct_pot: 0.0, max_iterations: 5, max_seconds: 120 };

/// The turn and river cards of the deeper roots; neither is in a test range.
const TURN: &str = "3h";
const RIVER: &str = "2d";

/// The pot and stack of the deeper roots, in cbb: the flop line `x.b275.c` and the turn
/// line `x.b825.c` at 100 big blinds.
const TURN_POT: Cbb = Cbb(1_100);
const TURN_STACK: Cbb = Cbb(9_475);
const RIVER_POT: Cbb = Cbb(2_750);
const RIVER_STACK: Cbb = Cbb(8_650);

/// Closeness of the reach-weighted root EV to the best-response walk's expected value.
const EV_CLOSE_BB: f64 = 1e-3;
/// Closeness of a hand's frequencies to summing to 1.
const SUM_CLOSE: f64 = 1e-5;

/// Percent per whole, and cbb per big blind.
const HALF: f64 = 0.5;

fn card(text: &str) -> Card {
    text.parse().expect("a valid card")
}

/// The test spot on a turn or river board, the narrow tree and the ten-combo ranges.
fn deeper_problem(river: bool) -> PostflopProblem {
    let flop = common::DRY_FLOP.parse().expect("a valid flop");
    let river_card = river.then(|| card(RIVER));
    let board = Board::new(flop, Some(card(TURN)), river_card).expect("a valid board");
    let (pot, stack) = if river { (RIVER_POT, RIVER_STACK) } else { (TURN_POT, TURN_STACK) };
    let problem = PostflopProblem {
        config: online_config(),
        line: opened_line(common::FLOP_POT, common::FLOP_STACK),
        board,
        ranges: [range(OOP_RANGE), range(IP_RANGE)],
        pot,
        stacks: [stack; 2],
        tree: narrow_tree(),
    };
    problem.validate().expect("a valid problem");
    problem
}

/// The skeleton's decision nodes on the root street, in the engine's order.
fn skeleton_nodes(problem: &PostflopProblem) -> Vec<DecisionNode> {
    let skeleton = ActionTree::build(&problem.tree, problem.root()).expect("a skeleton");
    skeleton
        .decision_nodes()
        .iter()
        .filter(|node| node.street == problem.street())
        .cloned()
        .collect()
}

/// Every walked node matches the skeleton node at the same position: line, player, pot,
/// stacks and actions.
fn assert_matches_skeleton(nodes: &[NodeStrategy], skeleton: &[DecisionNode]) {
    assert_eq!(nodes.len(), skeleton.len(), "one walked node per skeleton node");
    for (walked, expected) in nodes.iter().zip(skeleton) {
        assert_eq!(walked.line, expected.line, "line");
        assert_eq!(walked.player, expected.player, "player at {:?}", expected.line);
        assert_eq!(walked.pot, expected.pot, "pot at {:?}", expected.line);
        assert_eq!(walked.stacks, expected.stacks, "stacks at {:?}", expected.line);
        assert_eq!(walked.actions, expected.actions, "actions at {:?}", expected.line);
        for hand in &walked.hands {
            assert_eq!(hand.frequencies.len(), walked.actions.len(), "{:?}", expected.line);
            assert_eq!(hand.ev_bb.len(), walked.actions.len(), "{:?}", expected.line);
            let sum: f64 = hand.frequencies.iter().map(|f| f64::from(*f)).sum();
            assert!((sum - 1.0).abs() < SUM_CLOSE, "{} sums to {sum}", hand.combo);
        }
    }
}

/// R2.11: on the flop test spot the walk returns exactly the skeleton's flop decision
/// nodes, in the same order, with the same lines, players, pots, stacks and actions, and
/// stops at the turn deal.
#[test]
fn r2_11_root_street_nodes_stop_at_the_first_chance_node() {
    let problem = small_problem();
    let (solved, _) = solve_postflop(&problem, FEW_ITERATIONS, 0, &NoProgress).expect("solves");
    let nodes = root_street_nodes(&solved).expect("the walk");
    let skeleton = skeleton_nodes(&problem);
    let flop_decisions = ActionTree::build(&problem.tree, problem.root())
        .expect("a skeleton")
        .counts()
        .flop
        .decision;
    assert_eq!(nodes.len() as u64, flop_decisions);
    assert_matches_skeleton(&nodes, &skeleton);
    assert_eq!(nodes[0].player, Player::Oop, "the out-of-position player acts first");
    assert!(nodes[0].line.is_empty(), "the root has an empty line");
}

/// R2.11: the root node's frequencies are the solved game's root strategy entry for
/// entry, its hands are the actor's live combos, the actor's reach sums to 1, and the
/// reach-weighted root EV equals the best-response walk's expected value plus half the
/// pot within 1e-3 bb, which checks the reach and the EV conventions together.
#[test]
fn r2_11_root_street_evs_agree_with_root_combo_evs() {
    let problem = small_problem();
    let (solved, _) = solve_postflop(&problem, FEW_ITERATIONS, 0, &NoProgress).expect("solves");
    let nodes = root_street_nodes(&solved).expect("the walk");
    let root = &nodes[0];
    let strategy = solved.root_strategy();
    let combos = root.hands.len();
    for (i, hand) in root.hands.iter().enumerate() {
        for (a, frequency) in hand.frequencies.iter().enumerate() {
            assert_eq!(frequency.to_bits(), strategy[a * combos + i].to_bits(), "{}", hand.combo);
        }
    }
    let live: BTreeSet<_> =
        problem.ranges[0].live_combos(&problem.board.cards()).into_iter().collect();
    let hands: BTreeSet<_> = root.hands.iter().map(|hand| hand.combo).collect();
    assert_eq!(hands, live);
    let reach_sum: f64 = root.hands.iter().map(|hand| hand.reach[0]).sum();
    assert!((reach_sum - 1.0).abs() < SUM_CLOSE, "reach sums to {reach_sum}");
    let root_ev: f64 = root
        .hands
        .iter()
        .map(|hand| {
            let hand_ev: f64 =
                hand.frequencies.iter().zip(&hand.ev_bb).map(|(f, ev)| f64::from(*f) * ev).sum();
            hand.reach[0] * hand_ev
        })
        .sum();
    let response = best_response(&solved);
    let pot_bb = f64::from(problem.pot.get()) / f64::from(Cbb::PER_BB);
    let expected = response.expected_value_bb[0] + HALF * pot_bb;
    assert!((root_ev - expected).abs() < EV_CLOSE_BB, "root EV {root_ev} against {expected}");
}

/// R2.11 (O-135): a turn root's walk stops before the river deal and a river root, which
/// has no chance node below it, is walked whole; both match the skeleton's nodes on the
/// root street with the sizes it gives, and every hand's frequencies sum to 1.
#[test]
fn r2_11_root_street_nodes_on_turn_and_river_roots() {
    for (river, street) in [(false, Street::Turn), (true, Street::River)] {
        let problem = deeper_problem(river);
        assert_eq!(problem.street(), street);
        let (solved, report) =
            solve_postflop(&problem, FEW_ITERATIONS, 0, &NoProgress).expect("solves");
        println!("R2.11 {street} root: {report:?}");
        let nodes = root_street_nodes(&solved).expect("the walk");
        let skeleton = skeleton_nodes(&problem);
        let counts = ActionTree::build(&problem.tree, problem.root()).expect("a skeleton").counts();
        let on_street = counts.street(street).expect("a postflop street").decision;
        assert_eq!(nodes.len() as u64, on_street, "{street}");
        if river {
            assert_eq!(counts.total().decision, on_street, "a river root has no deeper street");
        } else {
            assert!(counts.river.decision > 0, "the turn root deals a river with betting");
        }
        assert_matches_skeleton(&nodes, &skeleton);
    }
}
