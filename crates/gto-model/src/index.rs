//! Hand indexes (R2.1, A3 section 1).
//!
//! Preflop hands are 169 classes in a fixed order: the 13 pairs first, `AA` (index 0) down
//! to `22` (12); then the 78 suited hands ordered by high card and then kicker, `AKs` (13)
//! to `32s` (90); then the 78 offsuit hands in the same order, `AKo` (91) to `32o` (168).
//!
//! Postflop hands are the 1,326 combos ordered by (first card, second card) with first
//! below second in card-integer order: `2c2d` is 0, `2c2h` is 1, `2cAs` is 50, `2d2h` is 51
//! and `AhAs` is 1,325. The index of first card `i` and second card `j` is
//! `51 * i - i * (i - 1) / 2 + (j - i - 1)`.
//!
//! A combo is written rank descending and then suit ascending, the same rule as a flop, so
//! `KcAs` reads back as `AsKc`.
//!
//! Owner: the cards-and-indexes agent (files `cards.rs` and `index.rs`).

#![allow(
    unused_variables,
    clippy::unused_self,
    reason = "stub bodies are todo!() until the cards-and-indexes agent fills them in"
)]

use std::fmt;
use std::str::FromStr;

use serde::{Deserialize, Serialize};

use crate::cards::{Card, Rank};
use crate::types::ModelError;

/// Whether a hand class is a pair, suited or offsuit.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum HandClassKind {
    /// Two cards of one rank, six combos.
    Pair,
    /// Two ranks of one suit, four combos.
    Suited,
    /// Two ranks of different suits, twelve combos.
    Offsuit,
}

/// One of the 169 preflop hand classes, 0 to 168 in the A3 section 1 order.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(try_from = "u8", into = "u8")]
pub struct HandClass(u8);

impl HandClass {
    /// Hand classes in the index.
    pub const COUNT: u8 = 169;

    /// The class at an index.
    ///
    /// # Errors
    ///
    /// `ModelError::IndexOutOfRange` at 169 or above.
    pub fn from_index(index: u8) -> Result<HandClass, ModelError> {
        todo!()
    }

    /// The index, `AA` 0 to `32o` 168.
    #[must_use]
    pub fn index(self) -> u8 {
        todo!()
    }

    /// The class for two ranks and a kind. A pair needs equal ranks and `Pair`; a suited or
    /// offsuit class needs two different ranks, given in either order.
    ///
    /// # Errors
    ///
    /// `ModelError::InvalidHandClass` when the ranks and the kind disagree.
    pub fn new(high: Rank, low: Rank, kind: HandClassKind) -> Result<HandClass, ModelError> {
        todo!()
    }

    /// The higher rank (both ranks, for a pair).
    #[must_use]
    pub fn high(self) -> Rank {
        todo!()
    }

    /// The lower rank (both ranks, for a pair).
    #[must_use]
    pub fn low(self) -> Rank {
        todo!()
    }

    /// Pair, suited or offsuit.
    #[must_use]
    pub fn kind(self) -> HandClassKind {
        todo!()
    }

    /// Combos in the class: 6 for a pair, 4 suited, 12 offsuit.
    #[must_use]
    pub fn combo_count(self) -> u8 {
        todo!()
    }

    /// The combos in the class, in combo-index order.
    #[must_use]
    pub fn combos(self) -> Vec<ComboId> {
        todo!()
    }

    /// Every class in index order.
    pub fn all() -> impl Iterator<Item = HandClass> {
        (0..Self::COUNT).map(|index| -> HandClass { todo!() })
    }
}

impl fmt::Display for HandClass {
    /// The canonical name: `AA`, `AKs` or `AKo`.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        todo!()
    }
}

impl FromStr for HandClass {
    type Err = ModelError;

    /// A canonical name only: high rank first, then the kinds `s` or `o`, and no suffix for
    /// a pair. `KAs`, `AAs` and `AK` are rejected.
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        todo!()
    }
}

impl TryFrom<u8> for HandClass {
    type Error = ModelError;

    fn try_from(index: u8) -> Result<Self, Self::Error> {
        HandClass::from_index(index)
    }
}

impl From<HandClass> for u8 {
    fn from(class: HandClass) -> u8 {
        class.index()
    }
}

/// One of the 1,326 two-card combos, 0 to 1,325 in the A3 section 1 order.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(try_from = "u16", into = "u16")]
pub struct ComboId(u16);

impl ComboId {
    /// Combos in the index.
    pub const COUNT: u16 = 1326;

    /// The combo at an index.
    ///
    /// # Errors
    ///
    /// `ModelError::IndexOutOfRange` at 1,326 or above.
    pub fn from_index(index: u16) -> Result<ComboId, ModelError> {
        todo!()
    }

    /// The index.
    #[must_use]
    pub fn index(self) -> u16 {
        todo!()
    }

    /// The combo holding two cards, given in either order.
    ///
    /// # Errors
    ///
    /// `ModelError::DuplicateCard` when both cards are the same.
    pub fn from_cards(a: Card, b: Card) -> Result<ComboId, ModelError> {
        todo!()
    }

    /// The two cards, lower card-integer first.
    #[must_use]
    pub fn cards(self) -> (Card, Card) {
        todo!()
    }

    /// The hand class this combo belongs to.
    #[must_use]
    pub fn class(self) -> HandClass {
        todo!()
    }

    /// True when either card is among the given cards (card removal against a board).
    #[must_use]
    pub fn conflicts_with(self, cards: &[Card]) -> bool {
        todo!()
    }

    /// Every combo in index order.
    pub fn all() -> impl Iterator<Item = ComboId> {
        (0..Self::COUNT).map(|index| -> ComboId { todo!() })
    }
}

impl fmt::Display for ComboId {
    /// The two cards back to back, rank descending then suit ascending: `AsKc`, `AcAd`.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        todo!()
    }
}

impl FromStr for ComboId {
    type Err = ModelError;

    /// Two distinct cards back to back, in either order.
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        todo!()
    }
}

impl TryFrom<u16> for ComboId {
    type Error = ModelError;

    fn try_from(index: u16) -> Result<Self, Self::Error> {
        ComboId::from_index(index)
    }
}

impl From<ComboId> for u16 {
    fn from(combo: ComboId) -> u16 {
        combo.index()
    }
}
