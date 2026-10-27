//! The walk along one runout of a solved flop (S18, O-173, O-174, R2.12). Crate-private;
//! [`super::select_nodes`] with `NodeSelection::Runout` is the public door.
//!
//! Mechanism. The walk starts at the flop root like the root-street walk of `nodes` and
//! follows every decision branch, multiplying the actor's reach by the average strategy.
//! At a chance node it follows only the child dealt the chosen card: the engine's
//! `NodeKind::Chance { child_for_card }` names that child, and the matching outcome of
//! `Game::chance_outcome` carries `parent_of_child`, the map from each of the child's
//! combo slots back to the parent's. Both reach vectors are compacted through it,
//! `child[k] = parent[parent_of_child[p][k]]`, so combos the dealt card kills drop out.
//! The dealt card is pushed and a new street line starts. Only turn and river decision
//! nodes are recorded (one or two cards dealt); the flop nodes are what
//! `NodeSelection::RootStreet` returns. Reach is normalised per node and the EV keeps the
//! half-root-pot offset of the root-street walk (O-175, O-202), both through the shared
//! `Walk::record`.

use gto_model::{ActionToken, Card};
use postflop_engine::game::{Game, NodeInfo};
use postflop_engine::tree::{NO_CHILD, NodeKind};

use super::error::SolveError;
use super::nodes::{NodeStrategy, Walk};
use super::solve::SolvedGame;

/// Cards on a flop board, the only root a runout can be walked from.
const FLOP_CARDS: usize = 3;

/// The turn and river decision nodes of the runout `turn` then `river` of a flop root,
/// depth first with a parent before its children and children in action order.
pub(super) fn runout_nodes(
    game_solved: &SolvedGame,
    turn: Card,
    river: Card,
) -> Result<Vec<NodeStrategy>, SolveError> {
    let walk = Walk::new(game_solved);
    check_runout(walk.game.board_at(walk.game.root()), turn, river)?;
    let runout = RunoutWalk { walk, cards: [turn, river] };
    let start = Path { street_lines: vec![Vec::new()], dealt: Vec::new() };
    let mut nodes = Vec::new();
    runout.visit(runout.walk.game.root(), &start, &runout.walk.root_reach(), &mut nodes)?;
    Ok(nodes)
}

/// Refuses a root that is not a flop and a runout a flop cannot deal: a card on the board
/// or the same card twice.
fn check_runout(root_board: &[u8], turn: Card, river: Card) -> Result<(), SolveError> {
    if root_board.len() != FLOP_CARDS {
        return Err(SolveError::Problem(format!(
            "a runout walk needs a flop root; this root has {} board cards",
            root_board.len()
        )));
    }
    if turn == river {
        return Err(SolveError::Problem(format!("the runout deals {turn} twice")));
    }
    for card in [turn, river] {
        if root_board.contains(&card.index()) {
            return Err(SolveError::Problem(format!("{card} is already on the board")));
        }
    }
    Ok(())
}

/// The actions and cards from the root to a node.
#[derive(Clone)]
struct Path {
    /// One action list per street from the root street.
    street_lines: Vec<Vec<ActionToken>>,
    /// The cards dealt below the root, in deal order.
    dealt: Vec<Card>,
}

impl Path {
    /// The path after `token` on the current street.
    fn with_action(&self, token: ActionToken) -> Path {
        let mut street_lines = self.street_lines.clone();
        if let Some(current) = street_lines.last_mut() {
            current.push(token);
        }
        Path { street_lines, dealt: self.dealt.clone() }
    }

    /// The path after `card` is dealt: a new, empty street line.
    fn with_card(&self, card: Card) -> Path {
        let street_lines = [self.street_lines.clone(), vec![Vec::new()]].concat();
        let dealt = [self.dealt.as_slice(), &[card]].concat();
        Path { street_lines, dealt }
    }
}

/// The root-street walk's state plus the two cards of the runout.
struct RunoutWalk<'a> {
    walk: Walk<'a>,
    cards: [Card; 2],
}

impl RunoutWalk<'_> {
    /// Records `node` when it is a turn or river decision node, descends every action, and
    /// at a chance node follows only the chosen card.
    fn visit(
        &self,
        node: u32,
        path: &Path,
        reach: &[Vec<f32>; 2],
        out: &mut Vec<NodeStrategy>,
    ) -> Result<(), SolveError> {
        if let NodeInfo::Chance { num_outcomes } = self.walk.game.node(node) {
            return self.deal(node, num_outcomes, path, reach, out);
        }
        let Some(decision) = self.walk.decision(node)? else {
            return Ok(());
        };
        if !path.dealt.is_empty() {
            let recorded = self.walk.record(
                node,
                &decision,
                path.street_lines.clone(),
                path.dealt.clone(),
                reach,
            )?;
            out.push(recorded);
        }
        for (action, token) in decision.actions.iter().enumerate() {
            let next = self.walk.after_action(node, &decision, action, reach);
            let child = self.walk.game.child(node, action);
            self.visit(child, &path.with_action(*token), &next, out)?;
        }
        Ok(())
    }

    /// Follows the chance node `node` into the child dealt the next card of the runout,
    /// with both reach vectors compacted to the child's live combos.
    fn deal(
        &self,
        node: u32,
        num_outcomes: usize,
        path: &Path,
        reach: &[Vec<f32>; 2],
        out: &mut Vec<NodeStrategy>,
    ) -> Result<(), SolveError> {
        let card = *self.cards.get(path.dealt.len()).ok_or_else(|| {
            SolveError::Engine(format!("chance node {node} deals past the river"))
        })?;
        let child = self.child_for(node, card)?;
        let edge = (0..num_outcomes)
            .map(|outcome| self.walk.game.chance_outcome(node, outcome))
            .find(|edge| edge.child == child)
            .ok_or_else(|| {
                SolveError::Engine(format!("chance node {node} lists no outcome for {card}"))
            })?;
        let compacted = [
            compact(&reach[0], edge.parent_of_child[0], node)?,
            compact(&reach[1], edge.parent_of_child[1], node)?,
        ];
        self.visit(child, &path.with_card(card), &compacted, out)
    }

    /// The engine child of chance node `node` dealt `card`.
    fn child_for(&self, node: u32, card: Card) -> Result<u32, SolveError> {
        let NodeKind::Chance { child_for_card, .. } = &self.walk.game.node_at(node).kind else {
            return Err(SolveError::Engine(format!("node {node} is not a chance node")));
        };
        match child_for_card.get(usize::from(card.index())) {
            Some(&child) if child != NO_CHILD => Ok(child),
            _ => Err(SolveError::Problem(format!("chance node {node} cannot deal {card}"))),
        }
    }
}

/// The child's reach vector: `child[k] = parent[parent_of_child[k]]`.
fn compact(parent: &[f32], parent_of_child: &[u32], node: u32) -> Result<Vec<f32>, SolveError> {
    parent_of_child
        .iter()
        .map(|&slot| {
            parent.get(slot as usize).copied().ok_or_else(|| {
                SolveError::Engine(format!("chance node {node} maps to parent slot {slot}"))
            })
        })
        .collect()
}
