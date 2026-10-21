//! The node record (R2.7, A3 section 4, O-130) and the solved node it is quantized from.
//!
//! A record is little-endian and sits inside a zstd data frame (see `chunk`):
//!
//! ```text
//! key_hash u64 | street u8 | to_act u8 | n_actions u8 | flags u8 | pot_cbb u32 | stack_cbb[2] u32
//! actions[n_actions] { type u8, size_cbb u32, bucket u8 }
//! n_hands u16 | hand_ids[n_hands] u16 (sparse only)
//! reach[2][n_hands] u16 (flag bit 2) | strategy[n_actions][n_hands] u8
//! ev_best[n_hands] f32 | loss[n_actions][n_hands] u16 | accuracy_pct_pot f32 (flag bit 3)
//! ```
//!
//! O-130 fixes the open details: `to_act` is the seat's index in the pair (0 out of
//! position, 1 in position); action type codes are f0 x1 c2 l3 s4 b5 r6 a7; the bucket byte
//! is 0 for none and 1 to 7 in `Bucket::ALL` order, from `Bucket::of_action` against
//! `pot_cbb`, the total pot at the node including any outstanding bet (lead decision 4);
//! the best action is the one with the highest expected value (EV), the first on ties, and
//! its loss is exactly 0. Absent reach is a cleared flag, never an invented 1.0.
//!
//! Lane W (writer) owns this file and `view.rs`.

#![allow(
    unused_variables,
    clippy::ptr_arg,
    reason = "S14 red skeleton: lane W replaces the todo!() bodies"
)]

use gto_model::{ActionToken, Bucket, Cbb, NodeKey, Position, PositionPair, Street};
use serde::{Deserialize, Serialize};

use crate::error::LibraryError;

/// Flag bit 0: the record lists its hands (`hand_ids` present).
pub const FLAG_SPARSE: u8 = 1;
/// Flag bit 1: hands index the 1,326 combos rather than the 169 classes.
pub const FLAG_POSTFLOP_1326: u8 = 1 << 1;
/// Flag bit 2: per-hand reach is present.
pub const FLAG_REACH: u8 = 1 << 2;
/// Flag bit 3: the node's `accuracy_pct_pot` follows the loss table.
pub const FLAG_ACCURACY: u8 = 1 << 3;
/// Bits 4 to 7, reserved for the terminal-after flags S18's tree supplies; written 0.
pub const FLAG_RESERVED_MASK: u8 = 0xF0;

/// The hand space of a node: the 169 preflop classes or the 1,326 combos.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum HandSpace {
    /// `HandClass` indexes, 0 to 168.
    #[serde(rename = "preflop_169")]
    Preflop169,
    /// `ComboId` indexes, 0 to 1,325.
    #[serde(rename = "postflop_1326")]
    Postflop1326,
}

impl HandSpace {
    /// How many hands the space holds: 169 or 1,326.
    #[must_use]
    pub const fn size(self) -> u16 {
        match self {
            HandSpace::Preflop169 => 169,
            HandSpace::Postflop1326 => 1_326,
        }
    }
}

/// One action as the record stores it: the token, the total wager in centi-big-blinds (cbb)
/// and its bucket.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct RecordAction {
    /// The action token, carrying its size for a straddle, bet or raise.
    pub token: ActionToken,
    /// The total wager in cbb (0 for a fold or check).
    pub size: Cbb,
    /// The bet-size bucket, `None` for an action that is not a bet, raise or all-in.
    pub bucket: Option<Bucket>,
}

/// One hand's solved strategy at a node, before quantization.
#[derive(Clone, Debug, PartialEq)]
pub struct SolvedHand {
    /// The hand index in the node's `HandSpace`.
    pub hand: u16,
    /// Reach probability per seat in pair order (out of position first), when known.
    pub reach: Option<[f64; 2]>,
    /// One frequency per action, in the node's action order.
    pub frequencies: Vec<f64>,
    /// One EV in big blinds (bb) per action, in the node's action order.
    pub ev_bb: Vec<f64>,
}

/// One solved decision point, before quantization: what a solver or a node dump provides.
#[derive(Clone, Debug, PartialEq)]
pub struct SolvedNode {
    /// The node key.
    pub key: NodeKey,
    /// The seat to act.
    pub to_act: Position,
    /// The total pot at the node in cbb, including any outstanding bet.
    pub pot: Cbb,
    /// Remaining stacks in cbb in pair order.
    pub stacks: [Cbb; 2],
    /// The available actions with their total wager in cbb.
    pub actions: Vec<(ActionToken, Cbb)>,
    /// The hand space the hand indexes refer to.
    pub hand_space: HandSpace,
    /// The hands in the node's range.
    pub hands: Vec<SolvedHand>,
    /// The solve's accuracy at this node in percent of the pot, when known (O-22).
    pub accuracy_pct_pot: Option<f32>,
}

/// A quantized node record: the fields of the layout in the module docs. Tables are indexed
/// `[action][hand position]`, where the hand position follows `hand_ids` when the record is
/// sparse and the hand index itself when it is dense.
#[derive(Clone, Debug, PartialEq)]
pub struct NodeRecord {
    /// `key_hash` of the node key.
    pub key_hash: u64,
    /// The street, from the key.
    pub street: Street,
    /// The seat to act as its index in the pair: 0 out of position, 1 in position.
    pub to_act: u8,
    /// The total pot at the node in cbb.
    pub pot: Cbb,
    /// Remaining stacks in cbb in pair order.
    pub stacks: [Cbb; 2],
    /// The actions, at most 255.
    pub actions: Vec<RecordAction>,
    /// The hand space.
    pub hand_space: HandSpace,
    /// The listed hand indexes in ascending order when sparse, `None` when dense.
    pub hand_ids: Option<Vec<u16>>,
    /// Reach per seat per hand at 1/65535, when present.
    pub reach: Option<[Vec<u16>; 2]>,
    /// Frequencies at 1/255, `[action][hand]`; each hand's column sums to 255.
    pub strategy: Vec<Vec<u8>>,
    /// The best action's EV in bb per hand.
    pub ev_best: Vec<f32>,
    /// Loss per action per hand in 0.01% of the pot, `[action][hand]`; 0 for the best action.
    pub loss: Vec<Vec<u16>>,
    /// The node's accuracy in percent of the pot, when known.
    pub accuracy_pct_pot: Option<f32>,
}

impl NodeRecord {
    /// Quantizes a solved node. Hands are stored in ascending index order; a node that lists
    /// every hand of its space is stored dense.
    ///
    /// # Errors
    ///
    /// `LibraryError::Quantize` for a number that cannot be quantized, a frequency or EV row
    /// whose length differs from the action count, more than 255 actions, a hand index
    /// outside the space or listed twice; `LibraryError::Model` when the seat to act is not
    /// in `pair` or a bucket needs a pot of zero.
    pub fn from_solved(n: &SolvedNode, pair: PositionPair) -> Result<Self, LibraryError> {
        todo!("lane W: quantize a solved node (O-130)")
    }

    /// The record's flag byte, derived from its fields.
    #[must_use]
    pub fn flags(&self) -> u8 {
        todo!("lane W: flag byte from the fields")
    }

    /// How many bytes `encode` appends.
    #[must_use]
    pub fn encoded_len(&self) -> usize {
        todo!("lane W: encoded size")
    }

    /// Appends the record's little-endian bytes to `out`.
    ///
    /// # Errors
    ///
    /// `LibraryError::Quantize` when a table's shape disagrees with the action or hand
    /// count, so the bytes would not decode.
    pub fn encode(&self, out: &mut Vec<u8>) -> Result<(), LibraryError> {
        todo!("lane W: little-endian encoding")
    }

    /// Decodes one record from the front of `b`, returning it with the bytes it used.
    /// Every length is bounds-checked, so malformed input is an error and never a panic.
    ///
    /// # Errors
    ///
    /// `LibraryError::Decode` for truncated input, an unknown street, action code or bucket
    /// byte, a reserved flag bit set, or a hand index outside the space.
    pub fn decode(b: &[u8]) -> Result<(Self, usize), LibraryError> {
        todo!("lane W: bounds-checked decoding")
    }
}
