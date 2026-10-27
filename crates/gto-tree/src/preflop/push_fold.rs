//! The builder behind `PreflopTree::push_fold` (R2.19, 04 section 4, O-220).
//!
//! Mechanism: heads-up, the button posts the small blind and acts first with fold or
//! all-in; the big blind facing the all-in folds or calls. Both stacks are the
//! configuration's depth before the blinds. Two decision nodes, no flop line: the root
//! pot is the two blinds, and the pot facing the all-in is the whole stack the button
//! moved in plus the big blind still in front of the big blind. The blinds, the actors and
//! the pots come from the shared chip replay (`PreflopChips`, O-136).

use gto_model::{ActionToken, Cbb, GameConfig, Position, PositionPair, TableSize};

use crate::error::TreeError;
use crate::preflop::{ChipState, PreflopChips, PreflopNode};

/// The big blind in centi-big-blinds (cbb).
const BIG_BLIND: Cbb = Cbb::new(Cbb::PER_BB);

/// What the builder produces.
pub(crate) struct Built {
    pub pair: PositionPair,
    pub nodes: Vec<PreflopNode>,
}

/// Builds the two decision nodes of the push/fold tree at `config`.
pub(crate) fn build(config: &GameConfig) -> Result<Built, TreeError> {
    check(config)?;
    let pair = PositionPair::new(Position::Bb, Position::Btn)?;
    let chips = PreflopChips::new(config, pair)?;
    let start = chips.start()?;
    let pushed = chips.apply(&start, ActionToken::AllIn)?;
    let node = |state: &ChipState, line: Vec<ActionToken>, aggressive: ActionToken| PreflopNode {
        actor: chips.seats()[state.to_act],
        pot: state.pot,
        line,
        actions: vec![ActionToken::Fold, aggressive],
    };
    let root = node(&start, Vec::new(), ActionToken::AllIn);
    let facing = node(&pushed, vec![ActionToken::AllIn], ActionToken::Call);
    Ok(Built { pair, nodes: vec![root, facing] })
}

/// Refuses every configuration the push/fold game does not model.
fn check(config: &GameConfig) -> Result<(), TreeError> {
    let refuse = |reason: String| Err(TreeError::Preflop(reason));
    if config.table_size != TableSize::HEADS_UP {
        return refuse(format!("push/fold is heads-up only, not {} seats", config.table_size));
    }
    if config.straddle {
        return refuse("push/fold has no straddle".to_owned());
    }
    if config.ante_cbb != Cbb::ZERO {
        return refuse(format!("push/fold has no ante, not {}", config.ante_cbb));
    }
    if config.depth_cbb < BIG_BLIND {
        return refuse(format!("a {} stack does not cover the big blind", config.depth_cbb));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use gto_model::{GameFormat, RakeModel, Stake};

    use super::*;

    fn config(depth: Cbb) -> GameConfig {
        let rake = RakeModel { percent_bp: 0, cap_cents: 0, no_flop_no_drop: true };
        let stake = Stake::new("norake", 50, 100, rake).expect("a stake");
        GameConfig::new(GameFormat::Online, TableSize::HEADS_UP, stake, depth)
    }

    #[test]
    fn r2_19_push_fold_refuses_a_straddle_and_a_short_stack() {
        let straddled = GameConfig { straddle: true, ..config(Cbb::from_bb(10)) };
        assert!(build(&straddled).is_err());
        assert!(build(&config(Cbb::new(99))).is_err(), "below the big blind");
        assert!(build(&config(Cbb::from_bb(1))).is_ok(), "exactly the big blind is covered");
    }

    #[test]
    fn r2_19_push_fold_root_pot_is_the_two_blinds() {
        let built = build(&config(Cbb::from_bb(3))).expect("a tree");
        assert_eq!(built.nodes[0].pot, Cbb::new(150));
        assert_eq!(built.nodes[1].pot, Cbb::new(400));
    }
}
