//! Chips along a preflop line (O-136): each seat's stack behind at a node and the total
//! wager of each action, which a node dump records and `gto_tree::PreflopNode` does not.
//!
//! Mechanism. The line is replayed with `gto_tree::PreflopChips`, the one blind posting and
//! chip replay the tree builders and the preflop solver share (O-136): the blinds of the
//! pair, the stack behind at the depth less the ante, the seats alternating from the first
//! in preflop order, each token setting the actor's total for the round by the
//! `gto_model::ActionToken` semantics. An action's wager is the actor's total after it,
//! zero for a fold or a check, as the node-dump schema records `size_cbb`. The replay must
//! hand the action to the seat the tree names and give the tree's own pot at every node,
//! so a drift from the builder fails the generator instead of writing wrong stacks.

use gto_model::{ActionToken, Cbb, GameConfig, PositionPair};
use gto_tree::{PreflopChips, PreflopNode, TreeError, total_after};

use crate::GenError;

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
    /// The pair's blinds, stack and dead money.
    chips: PreflopChips,
}

impl Replay {
    /// The replay of `pair` at `config`, checked against the tree's root node.
    pub(crate) fn new(
        config: &GameConfig,
        pair: PositionPair,
        root: &PreflopNode,
    ) -> Result<Replay, GenError> {
        let replay = Replay { chips: PreflopChips::new(config, pair).map_err(|err| tree(&err))? };
        replay.chips(root)?;
        Ok(replay)
    }

    /// The chips at `node`, checked against the tree's actor and pot.
    pub(crate) fn chips(&self, node: &PreflopNode) -> Result<Chips, GenError> {
        let state = self.chips.after(&node.line).map_err(|err| tree(&err))?;
        let actor = state.to_act;
        if self.chips.seats()[actor] != node.actor {
            return Err(GenError::Build(format!(
                "line {:?} hands the action to the wrong seat",
                node.line
            )));
        }
        if state.pot != node.pot {
            let line = gto_model::format_line(&node.line);
            return Err(GenError::Build(format!(
                "line {line:?}: pot {}, tree {}",
                state.pot, node.pot
            )));
        }
        let (own, other) = (state.invested[actor], state.invested[1 - actor]);
        let wager = |token: ActionToken| match token {
            ActionToken::Fold | ActionToken::Check => Ok(Cbb::ZERO),
            _ => total_after(token, own, other, self.chips.stack()).map_err(|err| tree(&err)),
        };
        let actions = node
            .actions
            .iter()
            .map(|token| Ok((*token, wager(*token)?)))
            .collect::<Result<Vec<_>, GenError>>()?;
        let stack = self.chips.stack().get();
        Ok(Chips {
            stacks: state.invested.map(|chips| Cbb(stack.saturating_sub(chips.get()))),
            actions,
        })
    }
}

/// A `gto-tree` error as a build error.
fn tree(err: &TreeError) -> GenError {
    GenError::Build(err.to_string())
}

#[cfg(test)]
mod tests {
    use gto_model::{
        ActionToken, Cbb, GameConfig, GameFormat, Position, PositionPair, RakeModel, Stake,
        TableSize,
    };
    use gto_tree::PreflopNode;

    use super::Replay;

    #[test]
    fn r2_20_a_bet_wager_adds_its_size_as_gto_model_defines_it() {
        let rake = RakeModel { percent_bp: 0, cap_cents: 0, no_flop_no_drop: true };
        let stake = Stake::new("test", 50, 100, rake).expect("a stake");
        let config = GameConfig::new(GameFormat::Online, TableSize::SIX_MAX, stake, Cbb(10_000));
        let pair = PositionPair::new(Position::Bb, Position::Sb).expect("a pair");
        let root = PreflopNode {
            actor: Position::Sb,
            pot: Cbb(150),
            line: Vec::new(),
            actions: vec![ActionToken::Fold, ActionToken::Limp],
        };
        let replay = Replay::new(&config, pair, &root).expect("a replay");
        let limped = PreflopNode {
            actor: Position::Bb,
            pot: Cbb(200),
            line: vec![ActionToken::Limp],
            actions: vec![ActionToken::Check, ActionToken::Bet(Cbb(300))],
        };
        let chips = replay.chips(&limped).expect("chips");
        assert_eq!(chips.actions[1], (ActionToken::Bet(Cbb(300)), Cbb(400)), "b300 adds 300");
        assert_eq!(chips.stacks, [Cbb(9_900), Cbb(9_900)]);
    }
}
