//! From a strategy profile to a `SolvedPreflop`, and back (R2.19, O-224).
//!
//! Mechanism. Each seat's reach at a node is the product of its own frequencies along the
//! line, propagated from the root in tree order (a parent comes before its children). An
//! action's expected value (EV) for the actor's class is its counterfactual value under
//! the profile divided by the opponent's reach weighted with the class pair weights, plus
//! the chips the actor has already put in: the expected final stack minus the stack
//! behind at the node, in big blinds (bb), as O-224 sets. A node the opponent never
//! reaches has no conditional EV, so there the opponent's reach is taken as uniform.

use gto_model::{Cbb, HandClass, NodeKey};

use super::cfr::{Own, Profile, action_row, mat_vec, values};
use super::game::{CLASSES, Child, bb, game_error};
use super::{PreflopError, PreflopGame, SolvedClass, SolvedPreflop, SolvedPreflopNode};

/// Builds the solved game of `profile`, with the given iterations and gains.
pub(super) fn assemble(
    game: &PreflopGame,
    profile: &Profile,
    iterations: u32,
    gains_bb: [f64; 2],
) -> SolvedPreflop {
    let layout = &game.layout;
    let reaches = reaches(game, profile);
    let config_id = game.config.config_id();
    let classes: Vec<HandClass> = HandClass::all().collect();
    let mut nodes = Vec::with_capacity(layout.nodes.len());
    for (index, (tree_node, node)) in game.tree.nodes().iter().zip(&layout.nodes).enumerate() {
        let reach = &reaches[index];
        let evs = action_evs(game, profile, index, &reach[1 - node.seat]);
        let strategy = &profile[index];
        let hands = classes
            .iter()
            .enumerate()
            .map(|(class_index, class)| SolvedClass {
                class: *class,
                reach: [reach[0][class_index], reach[1][class_index]],
                frequencies: (0..node.children.len())
                    .map(|action| strategy[action * CLASSES + class_index])
                    .collect(),
                ev_bb: evs.iter().map(|ev| ev[class_index]).collect(),
            })
            .collect();
        let stacks = node.invested.map(|chips| Cbb::new(layout.stack.saturating_sub(chips)));
        nodes.push(SolvedPreflopNode {
            key: NodeKey::preflop(config_id.clone(), game.tree.pair(), tree_node.line.clone()),
            actor: tree_node.actor,
            pot: tree_node.pot,
            stacks,
            actions: tree_node.actions.clone(),
            hands,
        });
    }
    let starting_pot = game.tree.nodes().first().map_or(Cbb::ZERO, |root| root.pot);
    SolvedPreflop { config_id, nodes, iterations, gains_bb, starting_pot }
}

/// Each seat's reach at every node, in pair order.
fn reaches(game: &PreflopGame, profile: &Profile) -> Vec<[Vec<f64>; 2]> {
    let layout = &game.layout;
    let ones = vec![1.0; CLASSES];
    let mut out = vec![[ones.clone(), ones]; layout.nodes.len()];
    for (index, node) in layout.nodes.iter().enumerate() {
        for (action, child) in node.children.iter().enumerate() {
            if let Child::Node(next) = child {
                let mut reach = out[index].clone();
                let row = action_row(&profile[index], action);
                reach[node.seat].iter_mut().zip(row).for_each(|(r, f)| *r *= f);
                out[*next] = reach;
            }
        }
    }
    out
}

/// The actor's EV per action and class at node `index`, against `opp_reach`.
fn action_evs(
    game: &PreflopGame,
    profile: &Profile,
    index: usize,
    opp_reach: &[f64],
) -> Vec<Vec<f64>> {
    let layout = &game.layout;
    let node = &layout.nodes[index];
    let reached = opp_reach.iter().any(|r| *r > 0.0);
    let uniform = vec![1.0; CLASSES];
    let opp = if reached { opp_reach } else { &uniform };
    let weight = mat_vec(&layout.weights.pairs, opp);
    let put_in = bb(node.invested[node.seat]);
    node.children
        .iter()
        .map(|child| {
            let value = values(layout, profile, *child, node.seat, opp, Own::Follow);
            value
                .iter()
                .zip(&weight)
                .map(|(v, w)| if *w > 0.0 { v / w + put_in } else { put_in })
                .collect()
        })
        .collect()
}

/// The profile a solved game plays, after checking it belongs to `game`.
pub(super) fn profile_of(
    game: &PreflopGame,
    solved: &SolvedPreflop,
) -> Result<Profile, PreflopError> {
    let layout = &game.layout;
    if solved.nodes.len() != layout.nodes.len() {
        let message =
            format!("{} solved nodes for a game of {}", solved.nodes.len(), layout.nodes.len());
        return Err(game_error(message));
    }
    solved
        .nodes
        .iter()
        .zip(game.tree.nodes())
        .map(|(solved_node, tree_node)| {
            if solved_node.actions != tree_node.actions || solved_node.hands.len() != CLASSES {
                return Err(game_error(format!(
                    "the solved node {} is not the game's",
                    solved_node.key
                )));
            }
            let actions = tree_node.actions.len();
            let mut strategy = vec![0.0; actions * CLASSES];
            for (class, hand) in solved_node.hands.iter().enumerate() {
                if usize::from(hand.class.index()) != class || hand.frequencies.len() != actions {
                    return Err(game_error(format!(
                        "{} at {} is malformed",
                        hand.class, solved_node.key
                    )));
                }
                for (action, frequency) in hand.frequencies.iter().enumerate() {
                    strategy[action * CLASSES + class] = *frequency;
                }
            }
            Ok(strategy)
        })
        .collect()
}
