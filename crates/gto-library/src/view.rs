//! `NodeView`: a decoded node record read back as numbers (R2.7). Frequencies come back
//! renormalized, reach at 1/65535, and each action's expected value (EV) as the best
//! action's EV minus the action's loss, so the best action reads back its EV exactly.
//!
//! Lane W (writer) owns this file.

use gto_model::NodeKey;

use crate::error::LibraryError;
use crate::key_hash::key_hash;
use crate::quantize::{dequantize_frequencies, dequantize_reach, loss_bb};
use crate::record::{NodeRecord, RecordAction, SolvedHand, SolvedNode};

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
        &self.record.actions
    }

    /// The hand indexes the node holds, ascending.
    #[must_use]
    pub fn hands(&self) -> Vec<u16> {
        match &self.record.hand_ids {
            Some(ids) => ids.clone(),
            None => (0..self.record.hand_space.size()).collect(),
        }
    }

    /// The table column of `hand`: its index itself when dense, its place in `hand_ids` when
    /// sparse; `None` when the node does not hold it.
    fn column(&self, hand: u16) -> Option<usize> {
        match &self.record.hand_ids {
            Some(ids) => ids.binary_search(&hand).ok(),
            None => (hand < self.record.hand_space.size()).then_some(usize::from(hand)),
        }
    }

    /// One hand's frequencies, renormalized to sum to one; `None` when the node does not
    /// hold the hand.
    #[must_use]
    pub fn frequencies(&self, hand: u16) -> Option<Vec<f32>> {
        let column = self.column(hand)?;
        let row: Option<Vec<u8>> =
            self.record.strategy.iter().map(|action| action.get(column).copied()).collect();
        row.map(|row| dequantize_frequencies(&row))
    }

    /// One hand's reach per seat in pair order; `None` when absent or the hand is not held.
    #[must_use]
    pub fn reach(&self, hand: u16) -> Option<[f32; 2]> {
        let column = self.column(hand)?;
        let [oop, ip] = self.record.reach.as_ref()?;
        Some([dequantize_reach(*oop.get(column)?), dequantize_reach(*ip.get(column)?)])
    }

    /// One hand's EV for one action in big blinds (bb); `None` when either is not held.
    #[must_use]
    pub fn ev_bb(&self, hand: u16, action: usize) -> Option<f32> {
        let ev_best = *self.record.ev_best.get(self.column(hand)?)?;
        Some(ev_best - self.loss_bb(hand, action)?)
    }

    /// One hand's loss for one action in bb; `None` when either is not held.
    #[must_use]
    pub fn loss_bb(&self, hand: u16, action: usize) -> Option<f32> {
        let units = *self.record.loss.get(action)?.get(self.column(hand)?)?;
        Some(loss_bb(units, self.record.pot))
    }

    /// The node as a `SolvedNode` under `key`, the read-back side of a round trip (O-133).
    ///
    /// # Errors
    ///
    /// `LibraryError::Decode` when `key` does not hash to the record's `key_hash`, the
    /// record's seat index is not 0 or 1, or its tables are shorter than its hands.
    pub fn to_solved(&self, key: &NodeKey) -> Result<SolvedNode, LibraryError> {
        if key_hash(key) != self.record.key_hash {
            return Err(LibraryError::Decode(format!(
                "node {key} does not hash to the record's key hash {:016x}",
                self.record.key_hash
            )));
        }
        let to_act = match self.record.to_act {
            0 => key.pair.oop(),
            1 => key.pair.ip(),
            seat => return Err(LibraryError::Decode(format!("seat index {seat} is not 0 or 1"))),
        };
        let hands = self
            .hands()
            .into_iter()
            .map(|hand| self.solved_hand(hand))
            .collect::<Option<Vec<SolvedHand>>>()
            .ok_or_else(|| LibraryError::Decode(format!("node {key} has short tables")))?;
        Ok(SolvedNode {
            key: key.clone(),
            to_act,
            pot: self.record.pot,
            stacks: self.record.stacks,
            actions: self.record.actions.iter().map(|a| (a.token, a.size)).collect(),
            hand_space: self.record.hand_space,
            hands,
            accuracy_pct_pot: self.record.accuracy_pct_pot,
        })
    }

    /// One hand read back as a `SolvedHand`; `None` when a table misses it.
    fn solved_hand(&self, hand: u16) -> Option<SolvedHand> {
        let reach = match self.record.reach {
            Some(_) => Some(self.reach(hand)?.map(f64::from)),
            None => None,
        };
        let frequencies = self.frequencies(hand)?.into_iter().map(f64::from).collect();
        let ev_bb = (0..self.record.actions.len())
            .map(|action| self.ev_bb(hand, action).map(f64::from))
            .collect::<Option<Vec<f64>>>()?;
        Some(SolvedHand { hand, reach, frequencies, ev_bb })
    }
}
