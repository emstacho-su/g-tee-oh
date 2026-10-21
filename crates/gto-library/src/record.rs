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
//! its loss is exactly 0. Absent reach is a cleared flag, never an invented 1.0. Street
//! codes are 0 to 3 in `Street::ALL` order. A sized token (straddle, bet, raise) stores its
//! own size in `size_cbb`, which is how the decoder rebuilds the token.
//!
//! Lane W (writer) owns this file, its `codec` submodule and `view.rs`. The byte layout above
//! is implemented in `codec` (`encoded_len`, `encode`, `decode`); this file holds the types
//! and the quantization of a `SolvedNode` into a `NodeRecord`.

mod codec;

use gto_model::{ActionToken, Bucket, Cbb, NodeKey, Position, PositionPair, Street};
use serde::{Deserialize, Serialize};

use crate::error::LibraryError;
use crate::key_hash::key_hash;
use crate::quantize::{loss_units, narrow_f32, quantize_frequencies, quantize_reach};

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

/// One hand quantized: its strategy column, best EV and loss column.
struct HandColumn {
    strategy: Vec<u8>,
    ev_best: f32,
    loss: Vec<u16>,
}

impl NodeRecord {
    /// Quantizes a solved node. Hands are stored in ascending index order; a node that lists
    /// every hand of its space is stored dense.
    ///
    /// # Errors
    ///
    /// `LibraryError::Quantize` for a number that cannot be quantized, a frequency or EV row
    /// whose length differs from the action count, no actions or more than 255, a sized
    /// token whose size differs from the action's, reach given for some hands only, a hand
    /// index outside the space or listed twice, or a seat to act that is not in `pair`;
    /// `LibraryError::Model` when a bet or raise needs a bucket against a pot of zero.
    pub fn from_solved(n: &SolvedNode, pair: PositionPair) -> Result<Self, LibraryError> {
        let actions = record_actions(n)?;
        let hands = sorted_hands(n)?;
        let columns = hands
            .iter()
            .map(|hand| quantize_hand(hand, actions.len(), n.pot))
            .collect::<Result<Vec<HandColumn>, LibraryError>>()?;
        let dense = hands.len() == usize::from(n.hand_space.size());
        Ok(NodeRecord {
            key_hash: key_hash(&n.key),
            street: n.key.street(),
            to_act: seat_index(n.to_act, pair)?,
            pot: n.pot,
            stacks: n.stacks,
            hand_space: n.hand_space,
            hand_ids: (!dense).then(|| hands.iter().map(|hand| hand.hand).collect()),
            reach: reach_table(&hands)?,
            strategy: transpose(columns.iter().map(|c| c.strategy.as_slice()), actions.len()),
            ev_best: columns.iter().map(|c| c.ev_best).collect(),
            loss: transpose(columns.iter().map(|c| c.loss.as_slice()), actions.len()),
            accuracy_pct_pot: finite_f32(n.accuracy_pct_pot, "accuracy_pct_pot")?,
            actions,
        })
    }

    /// The record's flag byte, derived from its fields.
    #[must_use]
    pub fn flags(&self) -> u8 {
        [
            (self.hand_ids.is_some(), FLAG_SPARSE),
            (self.hand_space == HandSpace::Postflop1326, FLAG_POSTFLOP_1326),
            (self.reach.is_some(), FLAG_REACH),
            (self.accuracy_pct_pot.is_some(), FLAG_ACCURACY),
        ]
        .into_iter()
        .filter(|(on, _)| *on)
        .fold(0, |flags, (_, bit)| flags | bit)
    }

    /// How many hands the tables hold: the listed hands, or the whole space when dense.
    fn hand_count(&self) -> usize {
        self.hand_ids.as_ref().map_or(usize::from(self.hand_space.size()), Vec::len)
    }
}

/// The node's actions with their buckets, checked against the record's limits.
fn record_actions(n: &SolvedNode) -> Result<Vec<RecordAction>, LibraryError> {
    if n.actions.is_empty() || n.actions.len() > usize::from(u8::MAX) {
        return Err(LibraryError::Quantize(format!(
            "node {} has {} actions; a record holds 1 to 255",
            n.key,
            n.actions.len()
        )));
    }
    n.actions
        .iter()
        .map(|&(token, size)| {
            if token.size().is_some_and(|carried| carried != size) {
                return Err(LibraryError::Quantize(format!(
                    "action {token} at node {} is listed with size {size}",
                    n.key
                )));
            }
            Ok(RecordAction { token, size, bucket: Bucket::of_action(token, n.pot)? })
        })
        .collect()
}

/// The node's hands in ascending index order, each inside the space and listed once.
fn sorted_hands(n: &SolvedNode) -> Result<Vec<&SolvedHand>, LibraryError> {
    let size = n.hand_space.size();
    if let Some(hand) = n.hands.iter().find(|hand| hand.hand >= size) {
        return Err(LibraryError::Quantize(format!(
            "hand {} at node {} is outside the {size} hands of its space",
            hand.hand, n.key
        )));
    }
    let mut hands: Vec<&SolvedHand> = n.hands.iter().collect();
    hands.sort_by_key(|hand| hand.hand);
    match hands.windows(2).find(|pair| pair[0].hand == pair[1].hand) {
        Some(pair) => Err(LibraryError::Quantize(format!(
            "hand {} is listed twice at node {}",
            pair[0].hand, n.key
        ))),
        None => Ok(hands),
    }
}

/// One hand's strategy column, best EV and loss column.
fn quantize_hand(hand: &SolvedHand, actions: usize, pot: Cbb) -> Result<HandColumn, LibraryError> {
    if hand.frequencies.len() != actions || hand.ev_bb.len() != actions {
        return Err(LibraryError::Quantize(format!(
            "hand {} needs one frequency and one EV for each of {actions} actions",
            hand.hand
        )));
    }
    let strategy = quantize_frequencies(&hand.frequencies)?;
    let best = hand.ev_bb.iter().copied().fold(f64::NEG_INFINITY, f64::max);
    let loss =
        hand.ev_bb.iter().map(|ev| loss_units(best, *ev, pot)).collect::<Result<Vec<_>, _>>()?;
    let ev_best = finite_f32(Some(narrow_f32(best)), "ev_best")?.unwrap_or_default();
    Ok(HandColumn { strategy, ev_best, loss })
}

/// Per-seat reach columns when every hand gives reach, `None` when none does.
fn reach_table(hands: &[&SolvedHand]) -> Result<Option<[Vec<u16>; 2]>, LibraryError> {
    let given: Vec<[f64; 2]> = hands.iter().filter_map(|hand| hand.reach).collect();
    if given.is_empty() {
        return Ok(None);
    }
    if given.len() != hands.len() {
        return Err(LibraryError::Quantize(format!(
            "reach is given for {} of {} hands; give it for every hand or none",
            given.len(),
            hands.len()
        )));
    }
    let seat = |s: usize| given.iter().map(|r| quantize_reach(r[s])).collect::<Result<_, _>>();
    Ok(Some([seat(0)?, seat(1)?]))
}

/// Per-hand columns of `rows` entries each, as `[row][hand]`.
fn transpose<'a, T: Copy + 'a>(columns: impl Iterator<Item = &'a [T]>, rows: usize) -> Vec<Vec<T>> {
    let columns: Vec<&[T]> = columns.collect();
    (0..rows).map(|row| columns.iter().map(|column| column[row]).collect()).collect()
}

/// The seat's index in the pair: 0 out of position, 1 in position.
fn seat_index(to_act: Position, pair: PositionPair) -> Result<u8, LibraryError> {
    match (to_act == pair.oop(), to_act == pair.ip()) {
        (true, _) => Ok(0),
        (_, true) => Ok(1),
        _ => Err(LibraryError::Quantize(format!("seat {to_act} is not in the pair {pair}"))),
    }
}

/// `value` when it is absent or finite; an error naming `what` otherwise.
fn finite_f32(value: Option<f32>, what: &str) -> Result<Option<f32>, LibraryError> {
    match value {
        Some(v) if !v.is_finite() => {
            Err(LibraryError::Quantize(format!("{what} {v} is not a finite f32")))
        }
        _ => Ok(value),
    }
}
