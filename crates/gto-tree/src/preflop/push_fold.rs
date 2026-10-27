//! The builder behind `PreflopTree::push_fold` (R2.19, 04 section 4, O-220).
//!
//! Mechanism: heads-up, the button posts the small blind and acts first with fold or
//! all-in; the big blind facing the all-in folds or calls. Both stacks are the
//! configuration's depth before the blinds. Two decision nodes, no flop line: the root
//! pot is the two blinds, and the pot facing the all-in is the whole stack the button
//! moved in plus the big blind still in front of the big blind.

use gto_model::{ActionToken, Cbb, GameConfig, Position, PositionPair, TableSize};

use crate::error::TreeError;
use crate::preflop::PreflopNode;

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
    let small_blind = small_blind(config)?;
    let root = PreflopNode {
        actor: Position::Btn,
        pot: small_blind.checked_add(BIG_BLIND)?,
        line: Vec::new(),
        actions: vec![ActionToken::Fold, ActionToken::AllIn],
    };
    let facing = PreflopNode {
        actor: Position::Bb,
        pot: config.depth_cbb.checked_add(BIG_BLIND)?,
        line: vec![ActionToken::AllIn],
        actions: vec![ActionToken::Fold, ActionToken::Call],
    };
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

/// The small blind in cbb: the stake's ratio of blinds, rounded half up to the cbb grid,
/// as the pair-tree builder rounds it (O-136).
fn small_blind(config: &GameConfig) -> Result<Cbb, TreeError> {
    let (sb, bb) = (u64::from(config.stake.sb_cents), u64::from(config.stake.bb_cents));
    if bb == 0 {
        return Err(TreeError::Preflop(format!("stake {} has no big blind", config.stake.label)));
    }
    let rounded = (2 * sb * u64::from(Cbb::PER_BB) + bb) / (2 * bb);
    let cbb = u32::try_from(rounded)
        .map_err(|_| TreeError::Preflop("the small blind is too large".to_owned()))?;
    Ok(Cbb::new(cbb))
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
