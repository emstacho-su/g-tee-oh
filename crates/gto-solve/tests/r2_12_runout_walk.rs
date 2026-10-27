//! R2.12 tests of `select_nodes` (O-173, O-174): the walk past the root street along one
//! chosen turn and river of a solved flop. It must return exactly the skeleton's turn and
//! river decision nodes (every action branch kept), tag each with its dealt cards and
//! per-street lines, hold only hands live on the dealt board, and refuse a runout that a
//! flop root cannot deal.

#[path = "r2_10_support/mod.rs"]
mod common;

use std::collections::BTreeMap;

use common::small_problem;
use gto_model::{ActionToken, Card, Street};
use gto_solve::postflop::{
    NoProgress, NodeSelection, NodeStrategy, SolveError, StopRule, root_street_nodes, select_nodes,
    solve_postflop,
};
use gto_tree::{ActionTree, DecisionNode};

/// A few iterations: nothing below depends on convergence.
const FEW_ITERATIONS: StopRule =
    StopRule { target_exploitability_pct_pot: 0.0, max_iterations: 5, max_seconds: 120 };

/// Closeness of a column of normalised reach, or of a hand's frequencies, to 1.
const SUM_CLOSE: f64 = 1e-4;

fn card(text: &str) -> Card {
    text.parse().expect("a valid card")
}

/// The skeleton's decision nodes on `street`, keyed by their line from the flop root.
fn skeleton_on(street: Street) -> BTreeMap<Vec<ActionToken>, DecisionNode> {
    let problem = small_problem();
    let skeleton = ActionTree::build(&problem.tree, problem.root()).expect("a skeleton");
    skeleton
        .decision_nodes()
        .iter()
        .filter(|node| node.street == street)
        .map(|node| (node.line.clone(), node.clone()))
        .collect()
}

fn assert_node_matches(walked: &NodeStrategy, expected: &DecisionNode) {
    assert_eq!(walked.player, expected.player, "player at {:?}", expected.line);
    assert_eq!(walked.pot, expected.pot, "pot at {:?}", expected.line);
    assert_eq!(walked.stacks, expected.stacks, "stacks at {:?}", expected.line);
    assert_eq!(walked.actions, expected.actions, "actions at {:?}", expected.line);
}

#[test]
fn r2_12_runout_walk_keeps_every_turn_and_river_branch() {
    let problem = small_problem();
    let (solved, _) = solve_postflop(&problem, FEW_ITERATIONS, 0, &NoProgress).expect("solves");
    let (turn, river) = (card("3h"), card("2d"));
    let nodes = select_nodes(&solved, &NodeSelection::Runout { turn, river }).expect("the walk");
    let turns = skeleton_on(Street::Turn);
    let rivers = skeleton_on(Street::River);
    let walked_turns: Vec<&NodeStrategy> = nodes.iter().filter(|n| n.dealt.len() == 1).collect();
    let walked_rivers: Vec<&NodeStrategy> = nodes.iter().filter(|n| n.dealt.len() == 2).collect();
    assert_eq!(walked_turns.len() + walked_rivers.len(), nodes.len(), "only turn and river nodes");
    assert_eq!(walked_turns.len(), turns.len(), "every turn decision node of the runout");
    assert_eq!(walked_rivers.len(), rivers.len(), "every river decision node of the runout");

    let board_cards = problem.board.cards();
    for node in &nodes {
        let street_count = node.dealt.len() + 1;
        assert_eq!(node.street_lines.len(), street_count, "one action list per street");
        assert_eq!(node.line, node.street_lines.concat(), "line is the streets concatenated");
        assert_eq!(node.dealt[0], turn);
        if node.dealt.len() == 2 {
            assert_eq!(node.dealt[1], river);
        }
        let expected = if node.dealt.len() == 1 { &turns } else { &rivers };
        let skeleton = expected.get(&node.line).expect("the walked line is a skeleton node");
        assert_node_matches(node, skeleton);

        let mut board = board_cards.clone();
        board.extend(&node.dealt);
        let mut reach = [0.0_f64; 2];
        for hand in &node.hands {
            assert!(!hand.combo.conflicts_with(&board), "{} is dead on the board", hand.combo);
            assert_eq!(hand.frequencies.len(), node.actions.len());
            assert_eq!(hand.ev_bb.len(), node.actions.len());
            let sum: f64 = hand.frequencies.iter().map(|f| f64::from(*f)).sum();
            assert!((sum - 1.0).abs() < SUM_CLOSE, "{} sums to {sum}", hand.combo);
            reach[node.player.index()] += hand.reach[node.player.index()];
        }
        let actor = reach[node.player.index()];
        assert!(
            actor == 0.0 || (actor - 1.0).abs() < SUM_CLOSE,
            "the actor's reach is normalised at {:?}: {actor}",
            node.line
        );
    }
}

#[test]
fn r2_12_root_street_selection_is_the_root_street_walk() {
    let (solved, _) =
        solve_postflop(&small_problem(), FEW_ITERATIONS, 0, &NoProgress).expect("solves");
    let selected = select_nodes(&solved, &NodeSelection::RootStreet).expect("the walk");
    assert_eq!(selected, root_street_nodes(&solved).expect("the walk"));
    assert!(selected.iter().all(|node| node.dealt.is_empty() && node.street_lines.len() == 1));
}

#[test]
fn r2_12_runout_walk_refuses_cards_a_flop_cannot_deal() {
    let problem = small_problem();
    let (solved, _) = solve_postflop(&problem, FEW_ITERATIONS, 0, &NoProgress).expect("solves");
    let on_board = problem.board.cards()[0];
    for (turn, river) in [(on_board, card("2d")), (card("3h"), on_board), (card("3h"), card("3h"))]
    {
        let result = select_nodes(&solved, &NodeSelection::Runout { turn, river });
        assert!(matches!(result, Err(SolveError::Problem(_))), "{turn}{river}: {result:?}");
    }
}
