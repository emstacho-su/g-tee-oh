//! Cards and boards (R2.1, A3 section 1). A card is a rank from `23456789TJQKA` and a suit
//! from `cdhs`, written `Ah` or `7d`. Its integer form is `rank * 4 + suit` with deuce as
//! rank 0 and clubs as suit 0, so `2c` is 0 and `As` is 51; this is the same encoding the
//! vendored engine uses, cross-checked once and never depended on (A1 section 2). A flop is
//! written in canonical order, rank descending and then suit ascending, so `2c7dAh` is
//! always written `Ah7d2c`.
//!
//! Parsing is strict: only the exact characters above round-trip, so `ah` and `AH` are
//! rejected. Canonical encodings admit one spelling.
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

use crate::types::{ModelError, Street};

/// A card rank, deuce lowest and ace highest. The derived order follows that.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum Rank {
    /// `2`
    Two,
    /// `3`
    Three,
    /// `4`
    Four,
    /// `5`
    Five,
    /// `6`
    Six,
    /// `7`
    Seven,
    /// `8`
    Eight,
    /// `9`
    Nine,
    /// `T`
    Ten,
    /// `J`
    Jack,
    /// `Q`
    Queen,
    /// `K`
    King,
    /// `A`
    Ace,
}

impl Rank {
    /// Every rank, deuce first.
    pub const ALL: [Rank; 13] = [
        Rank::Two,
        Rank::Three,
        Rank::Four,
        Rank::Five,
        Rank::Six,
        Rank::Seven,
        Rank::Eight,
        Rank::Nine,
        Rank::Ten,
        Rank::Jack,
        Rank::Queen,
        Rank::King,
        Rank::Ace,
    ];

    /// The rank characters in index order: `23456789TJQKA` (A3 section 1).
    pub const CHARS: [char; 13] = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];

    /// The rank at an index, deuce 0 to ace 12.
    ///
    /// # Errors
    ///
    /// `ModelError::IndexOutOfRange` above 12.
    pub fn from_index(index: u8) -> Result<Rank, ModelError> {
        todo!()
    }

    /// The index, deuce 0 to ace 12.
    #[must_use]
    pub fn index(self) -> u8 {
        todo!()
    }

    /// The rank character.
    #[must_use]
    pub fn to_char(self) -> char {
        todo!()
    }

    /// The rank for a character from `CHARS`, exact case.
    ///
    /// # Errors
    ///
    /// `ModelError::InvalidCard` for any other character.
    pub fn from_char(c: char) -> Result<Rank, ModelError> {
        todo!()
    }

    /// True for ten through ace, the broadway ranks.
    #[must_use]
    pub fn is_broadway(self) -> bool {
        todo!()
    }
}

impl fmt::Display for Rank {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        todo!()
    }
}

/// A suit in the order `cdhs`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum Suit {
    /// `c`
    Clubs,
    /// `d`
    Diamonds,
    /// `h`
    Hearts,
    /// `s`
    Spades,
}

impl Suit {
    /// Every suit, clubs first.
    pub const ALL: [Suit; 4] = [Suit::Clubs, Suit::Diamonds, Suit::Hearts, Suit::Spades];

    /// The suit characters in index order: `cdhs` (A3 section 1).
    pub const CHARS: [char; 4] = ['c', 'd', 'h', 's'];

    /// The suit at an index, clubs 0 to spades 3.
    ///
    /// # Errors
    ///
    /// `ModelError::IndexOutOfRange` above 3.
    pub fn from_index(index: u8) -> Result<Suit, ModelError> {
        todo!()
    }

    /// The index, clubs 0 to spades 3.
    #[must_use]
    pub fn index(self) -> u8 {
        todo!()
    }

    /// The suit character.
    #[must_use]
    pub fn to_char(self) -> char {
        todo!()
    }

    /// The suit for a character from `CHARS`, exact case.
    ///
    /// # Errors
    ///
    /// `ModelError::InvalidCard` for any other character.
    pub fn from_char(c: char) -> Result<Suit, ModelError> {
        todo!()
    }
}

impl fmt::Display for Suit {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        todo!()
    }
}

/// A playing card as `rank * 4 + suit`, 0 to 51 (A2 section 2). The derived order is that
/// integer order, which the 1,326-combo index relies on.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(try_from = "u8", into = "u8")]
pub struct Card(u8);

impl Card {
    /// Cards in a deck.
    pub const COUNT: u8 = 52;

    /// The card with this rank and suit.
    #[must_use]
    pub fn new(rank: Rank, suit: Suit) -> Card {
        todo!()
    }

    /// The card at an integer index, `2c` 0 to `As` 51.
    ///
    /// # Errors
    ///
    /// `ModelError::IndexOutOfRange` at 52 or above.
    pub fn from_index(index: u8) -> Result<Card, ModelError> {
        todo!()
    }

    /// The integer index, `rank * 4 + suit`.
    #[must_use]
    pub fn index(self) -> u8 {
        todo!()
    }

    /// The rank.
    #[must_use]
    pub fn rank(self) -> Rank {
        todo!()
    }

    /// The suit.
    #[must_use]
    pub fn suit(self) -> Suit {
        todo!()
    }

    /// Every card in index order, `2c` first.
    pub fn all() -> impl Iterator<Item = Card> {
        (0..Self::COUNT).map(|index| -> Card { todo!() })
    }
}

impl fmt::Display for Card {
    /// Two characters, rank then suit: `Ah`.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        todo!()
    }
}

impl FromStr for Card {
    type Err = ModelError;

    /// Exactly two characters from `Rank::CHARS` and `Suit::CHARS`.
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        todo!()
    }
}

impl TryFrom<u8> for Card {
    type Error = ModelError;

    fn try_from(index: u8) -> Result<Self, Self::Error> {
        Card::from_index(index)
    }
}

impl From<Card> for u8 {
    fn from(card: Card) -> u8 {
        card.index()
    }
}

/// Parses cards written back to back with no separator, as in a node key: `Ah7d2c`.
///
/// # Errors
///
/// `ModelError::InvalidCard` for an odd length or a bad card, `ModelError::DuplicateCard`
/// when a card repeats.
pub fn parse_cards(s: &str) -> Result<Vec<Card>, ModelError> {
    todo!()
}

/// Writes cards back to back with no separator, in the order given.
#[must_use]
pub fn format_cards(cards: &[Card]) -> String {
    todo!()
}

/// Three distinct community cards held in written order: rank descending, then suit
/// ascending (A3 section 1). `Flop::new` sorts, so two flops with the same cards compare
/// equal whatever order they were given in. The derived order over the written cards is
/// the order of the canonical-flop table in `iso_table`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct Flop([Card; 3]);

impl Flop {
    /// Builds a flop from three cards in any order.
    ///
    /// # Errors
    ///
    /// `ModelError::DuplicateCard` when two cards are the same.
    pub fn new(cards: [Card; 3]) -> Result<Flop, ModelError> {
        todo!()
    }

    /// The cards in written order.
    #[must_use]
    pub fn cards(self) -> [Card; 3] {
        todo!()
    }

    /// The ranks in written order, highest first.
    #[must_use]
    pub fn ranks(self) -> [Rank; 3] {
        todo!()
    }

    /// The suits in written order.
    #[must_use]
    pub fn suits(self) -> [Suit; 3] {
        todo!()
    }

    /// True when the card is on the flop.
    #[must_use]
    pub fn contains(self, card: Card) -> bool {
        todo!()
    }
}

impl fmt::Display for Flop {
    /// The three cards back to back in written order: `Ah7d2c`.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        todo!()
    }
}

impl FromStr for Flop {
    type Err = ModelError;

    /// Exactly three cards back to back, in any order.
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        todo!()
    }
}

/// A flop with an optional turn and river. A river needs a turn, and every card is distinct.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct Board {
    flop: Flop,
    turn: Option<Card>,
    river: Option<Card>,
}

impl Board {
    /// A board with only the flop dealt.
    #[must_use]
    pub fn flop(flop: Flop) -> Board {
        todo!()
    }

    /// A board from its parts.
    ///
    /// # Errors
    ///
    /// `ModelError::InvalidBoard` for a river without a turn, `ModelError::DuplicateCard`
    /// when a card repeats.
    pub fn new(flop: Flop, turn: Option<Card>, river: Option<Card>) -> Result<Board, ModelError> {
        todo!()
    }

    /// Deals the turn.
    ///
    /// # Errors
    ///
    /// `ModelError::InvalidBoard` when a turn is already dealt, `ModelError::DuplicateCard`
    /// when the card is on the flop.
    pub fn with_turn(self, turn: Card) -> Result<Board, ModelError> {
        todo!()
    }

    /// Deals the river.
    ///
    /// # Errors
    ///
    /// `ModelError::InvalidBoard` when no turn is dealt yet or a river already is,
    /// `ModelError::DuplicateCard` when the card is already on the board.
    pub fn with_river(self, river: Card) -> Result<Board, ModelError> {
        todo!()
    }

    /// The flop.
    #[must_use]
    pub fn flop_cards(self) -> Flop {
        todo!()
    }

    /// The turn card, if dealt.
    #[must_use]
    pub fn turn(self) -> Option<Card> {
        todo!()
    }

    /// The river card, if dealt.
    #[must_use]
    pub fn river(self) -> Option<Card> {
        todo!()
    }

    /// The street this board has reached: flop, turn or river.
    #[must_use]
    pub fn street(self) -> Street {
        todo!()
    }

    /// Every card dealt, flop first in written order, then turn, then river.
    #[must_use]
    pub fn cards(self) -> Vec<Card> {
        todo!()
    }

    /// True when the card is anywhere on the board.
    #[must_use]
    pub fn contains(self, card: Card) -> bool {
        todo!()
    }
}
