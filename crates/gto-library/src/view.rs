//! `NodeView`: a decoded node record read back as numbers (R2.7). Frequencies come back
//! renormalized, reach at 1/65535, and each action's expected value (EV) as the best
//! action's EV minus the action's loss, so the best action reads back its EV exactly.
//!
//! Lane W (writer) owns this file.

#![allow(unused_variables, reason = "S14 red skeleton: lane W replaces the todo!() bodies")]

use gto_model::NodeKey;

use crate::error::LibraryError;
use crate::record::{NodeRecord, RecordAction, SolvedNode};

/// A dequantized view of one node record. The reader hands these out.
#[derive(Clone, Debug, PartialEq)]
pub struct NodeView {
    record: NodeRecord,
}

impl From<NodeRecord> for NodeView {
    fn from(record: NodeRecord) -> Self {
        NodeView { record }
    }
}

impl NodeView {
    /// The quantized record behind the view.
    #[must_use]
    pub fn record(&self) -> &NodeRecord {
        &self.record
    }

    /// The node's actions in record order.
    #[must_use]
    pub fn actions(&self) -> &[RecordAction] {
        todo!("lane W: actions")
    }

    /// The hand indexes the node holds, ascending.
    #[must_use]
    pub fn hands(&self) -> Vec<u16> {
        todo!("lane W: hand indexes, dense or sparse")
    }

    /// One hand's frequencies, renormalized to sum to one; `None` when the node does not
    /// hold the hand.
    #[must_use]
    pub fn frequencies(&self, hand: u16) -> Option<Vec<f32>> {
        todo!("lane W: dequantized frequencies")
    }

    /// One hand's reach per seat in pair order; `None` when absent or the hand is not held.
    #[must_use]
    pub fn reach(&self, hand: u16) -> Option<[f32; 2]> {
        todo!("lane W: dequantized reach")
    }

    /// One hand's EV for one action in big blinds (bb); `None` when either is not held.
    #[must_use]
    pub fn ev_bb(&self, hand: u16, action: usize) -> Option<f32> {
        todo!("lane W: ev_best minus loss")
    }

    /// One hand's loss for one action in bb; `None` when either is not held.
    #[must_use]
    pub fn loss_bb(&self, hand: u16, action: usize) -> Option<f32> {
        todo!("lane W: loss in bb")
    }

    /// The node as a `SolvedNode` under `key`, the read-back side of a round trip (O-133).
    ///
    /// # Errors
    ///
    /// `LibraryError::Decode` when `key` does not hash to the record's `key_hash` or the
    /// record's seat index is not 0 or 1.
    pub fn to_solved(&self, key: &NodeKey) -> Result<SolvedNode, LibraryError> {
        todo!("lane W: dequantize into a solved node")
    }
}
