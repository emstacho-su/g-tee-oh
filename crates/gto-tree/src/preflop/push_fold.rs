//! The builder behind `PreflopTree::push_fold` (R2.19, 04 section 4, O-220).
//!
//! Mechanism: heads-up, the button posts the small blind and acts first with fold or
//! all-in; the big blind facing the all-in folds or calls. Both stacks are the
//! configuration's depth before the blinds. Two decision nodes, no flop line.

use gto_model::{GameConfig, PositionPair};

use crate::error::TreeError;
use crate::preflop::PreflopNode;

/// What the builder produces.
pub(crate) struct Built {
    pub pair: PositionPair,
    pub nodes: Vec<PreflopNode>,
}

/// Builds the two decision nodes of the push/fold tree at `config`.
pub(crate) fn build(config: &GameConfig) -> Result<Built, TreeError> {
    let _ = config;
    Err(TreeError::Preflop("the push/fold builder is not implemented yet (S19 lane 1)".to_owned()))
}
