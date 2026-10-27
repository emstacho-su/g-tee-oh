//! Chips along a preflop line (O-136): each seat's stack behind at a node and the total
//! wager of each action, which a node dump records and `gto_tree::PreflopNode` does not.
//!
//! Mechanism. The two seats start with the blinds `gto-tree` posts: the big blind 100
//! centi-big-blinds (cbb), the small blind seat (the button heads-up, else the small blind)
//! the stake's ratio rounded half up to the cbb grid, any other seat nothing; the stack
//! behind starts at the depth less the ante. The seats then alternate from the root's
//! actor, and each token sets the actor's total for the round: a call matches the other
//! seat, a limp is the big blind, a raise is its raise-to total, an all-in is the whole
//! stack, a fold or a check changes nothing. An action's wager is the actor's total after
//! it, zero for a fold or a check, as the node-dump schema records `size_cbb`. The pot the
//! replay implies is checked against the tree's own pot at every node, so a drift from the
//! builder fails the generator instead of writing wrong stacks.

use gto_model::{ActionToken, Cbb, GameConfig, Position, PositionPair};
use gto_tree::PreflopNode;

use crate::GenError;

/// The seat that posts the small blind: the button heads-up, else the small blind.
fn small_blind_seat(config: &GameConfig) -> Position {
    if config.table_size.get() == 2 { Position::Btn } else { Position::Sb }
}

/// The blind a seat of the pair posts, as `gto-tree` posts it.
fn blind_of(seat: Position, config: &GameConfig) -> Result<u32, GenError> {
    if seat == Position::Bb {
        return Ok(Cbb::PER_BB);
    }
    if seat != small_blind_seat(config) {
        return Ok(0);
    }
    let (sb, bb) = (u64::from(config.stake.sb_cents), u64::from(config.stake.bb_cents));
    if bb == 0 {
        return Err(GenError::Build(format!("stake {} has no big blind", config.stake.label)));
    }
    let rounded = (2 * sb * u64::from(Cbb::PER_BB) + bb) / (2 * bb);
    u32::try_from(rounded).map_err(|_| GenError::Build("the small blind is too large".into()))
}

/// The chips of one node: stacks behind in pair order and each action's wager.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Chips {
    /// The stack behind each seat, out of position first.
    pub stacks: [Cbb; 2],
    /// Each action with its total wager, in the node's action order.
    pub actions: Vec<(ActionToken, Cbb)>,
}

/// Replays lines of one pair tree.
pub(crate) struct Replay {
    /// The pair's seats, out of position first.
    seats: [Position; 2],
    /// The blinds of `seats`.
    blinds: [u32; 2],
    /// The stack each seat starts with, blinds included.
    stack: u32,
    /// Blinds of folded seats and antes: the root pot less the pair's blinds.
    dead: u32,
    /// The seat that acts first.
    first: Position,
}

impl Replay {
    /// The replay of `pair` at `config`, anchored on the tree's root node.
    pub(crate) fn new(
        config: &GameConfig,
        pair: PositionPair,
        root: &PreflopNode,
    ) -> Result<Replay, GenError> {
        let seats = [pair.oop(), pair.ip()];
        let blinds = [blind_of(seats[0], config)?, blind_of(seats[1], config)?];
        let stack = config.depth_cbb.checked_sub(config.ante_cbb).map_err(|err| model(&err))?.get();
        let dead = root.pot.get().checked_sub(blinds[0] + blinds[1]).ok_or_else(|| {
            GenError::Build(format!("the root pot {} is below the pair's blinds", root.pot))
        })?;
        Ok(Replay { seats, blinds, stack, dead, first: root.actor })
    }

    /// The chips at `node`, checked against the tree's pot.
    pub(crate) fn chips(&self, node: &PreflopNode) -> Result<Chips, GenError> {
        let mut invested = self.blinds;
        let mut actor = self.seat_index(self.first)?;
        for token in &node.line {
            invested[actor] = self.total_after(*token, invested, actor);
            actor = 1 - actor;
        }
        if self.seats[actor] != node.actor {
            return Err(GenError::Build(format!(
                "line {:?} hands the action to the wrong seat",
                node.line
            )));
        }
        let pot = self.dead + invested[0] + invested[1];
        if pot != node.pot.get() {
            let line = gto_model::format_line(&node.line);
            return Err(GenError::Build(format!("line {line:?}: pot {pot}, tree {}", node.pot)));
        }
        let wager = |token: ActionToken| match token {
            ActionToken::Fold | ActionToken::Check => 0,
            _ => self.total_after(token, invested, actor),
        };
        Ok(Chips {
            stacks: invested.map(|chips| Cbb(self.stack.saturating_sub(chips))),
            actions: node.actions.iter().map(|token| (*token, Cbb(wager(*token)))).collect(),
        })
    }

    /// The actor's total for the round after `token`.
    fn total_after(&self, token: ActionToken, invested: [u32; 2], actor: usize) -> u32 {
        let total = match token {
            ActionToken::Call => invested[1 - actor],
            ActionToken::Limp => Cbb::PER_BB,
            ActionToken::Raise(to) => to.get(),
            ActionToken::AllIn => self.stack,
            ActionToken::Fold
            | ActionToken::Check
            | ActionToken::Straddle(_)
            | ActionToken::Bet(_) => invested[actor],
        };
        total.min(self.stack)
    }

    /// The index of a seat in pair order.
    fn seat_index(&self, seat: Position) -> Result<usize, GenError> {
        self.seats
            .iter()
            .position(|s| *s == seat)
            .ok_or_else(|| GenError::Build(format!("{seat} is not a seat of the pair")))
    }
}

/// A `gto-model` error as a build error.
fn model(err: &gto_model::ModelError) -> GenError {
    GenError::Build(err.to_string())
}
