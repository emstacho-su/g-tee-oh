//! Cards and boards (R2.1, A3 section 1). A card is a rank from `23456789TJQKA` and a suit
//! from `cdhs`, written `Ah` or `7d`. Its integer form is `rank * 4 + suit` with deuce as
//! rank 0 and clubs as suit 0, so `2c` is 0 and `As` is 51 (A2 section 2); this is the same
//! encoding the vendored engine uses, cross-checked once and never depended on (A1 section
//! 2). A flop is written in canonical order, rank descending and then suit ascending, so
//! `2c7dAh` is always written `Ah7d2c`.
//!
//! Parsing is strict: only the exact characters above round-trip, so `ah` and `AH` are
//! rejected. Canonical encodings admit one spelling.
//!
//! Owner: the cards-and-indexes agent (files `cards.rs` and `index.rs`).

use std::cmp::Reverse;
use std::fmt;
use std::str::FromStr;

use serde::{Deserialize, Serialize};

use crate::types::{ModelError, Street};

/// Suits per rank, the multiplier in the card integer `rank * 4 + suit`.
const SUITS_PER_RANK: u8 = 4;

/// Ranks in the deck, the exclusive limit of a rank index.
const RANK_COUNT: u32 = 13;

/// Suits in the deck, the exclusive limit of a suit index.
const SUIT_COUNT: u32 = 4;

/// Cards on a flop.
const FLOP_CARDS: usize = 3;

/// A card rank, deuce lowest and ace highest (A3 section 1). The derived order follows that,
/// and the discriminant is the rank index: deuce 0 to ace 12.
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
        Rank::ALL.get(usize::from(index)).copied().ok_or(ModelError::IndexOutOfRange {
            what: "rank",
            index: u32::from(index),
            limit: RANK_COUNT,
        })
    }

    /// The index, deuce 0 to ace 12.
    #[must_use]
    pub const fn index(self) -> u8 {
        self as u8
    }

    /// The rank character.
    #[must_use]
    pub fn to_char(self) -> char {
        Rank::CHARS[usize::from(self.index())]
    }

    /// The rank for a character from `CHARS`, exact case.
    ///
    /// # Errors
    ///
    /// `ModelError::InvalidCard` for any other character.
    pub fn from_char(c: char) -> Result<Rank, ModelError> {
        Rank::ALL
            .into_iter()
            .find(|rank| rank.to_char() == c)
            .ok_or_else(|| ModelError::InvalidCard(c.to_string()))
    }

    /// True for ten through ace, the broadway ranks.
    #[must_use]
    pub fn is_broadway(self) -> bool {
        self >= Rank::Ten
    }
}

impl fmt::Display for Rank {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.to_char())
    }
}

/// A suit in the order `cdhs` (A3 section 1). The discriminant is the suit index: clubs 0 to
/// spades 3.
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
        Suit::ALL.get(usize::from(index)).copied().ok_or(ModelError::IndexOutOfRange {
            what: "suit",
            index: u32::from(index),
            limit: SUIT_COUNT,
        })
    }

    /// The index, clubs 0 to spades 3.
    #[must_use]
    pub const fn index(self) -> u8 {
        self as u8
    }

    /// The suit character.
    #[must_use]
    pub fn to_char(self) -> char {
        Suit::CHARS[usize::from(self.index())]
    }

    /// The suit for a character from `CHARS`, exact case.
    ///
    /// # Errors
    ///
    /// `ModelError::InvalidCard` for any other character.
    pub fn from_char(c: char) -> Result<Suit, ModelError> {
        Suit::ALL
            .into_iter()
            .find(|suit| suit.to_char() == c)
            .ok_or_else(|| ModelError::InvalidCard(c.to_string()))
    }
}

impl fmt::Display for Suit {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.to_char())
    }
}

/// A playing card as `rank * 4 + suit`, 0 to 51 (A2 section 2). The derived order is that
/// integer order, which the 1,326-combo index relies on (A3 section 1).
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(try_from = "u8", into = "u8")]
pub struct Card(u8);

impl Card {
    /// Cards in a deck.
    pub const COUNT: u8 = 52;

    /// The card with this rank and suit.
    #[must_use]
    pub const fn new(rank: Rank, suit: Suit) -> Card {
        Card(rank.index() * SUITS_PER_RANK + suit.index())
    }

    /// The card at an integer index, `2c` 0 to `As` 51.
    ///
    /// # Errors
    ///
    /// `ModelError::IndexOutOfRange` at 52 or above.
    pub fn from_index(index: u8) -> Result<Card, ModelError> {
        if index < Self::COUNT {
            Ok(Card(index))
        } else {
            Err(ModelError::IndexOutOfRange {
                what: "card",
                index: u32::from(index),
                limit: u32::from(Self::COUNT),
            })
        }
    }

    /// The integer index, `rank * 4 + suit`.
    #[must_use]
    pub const fn index(self) -> u8 {
        self.0
    }

    /// The rank.
    #[must_use]
    pub fn rank(self) -> Rank {
        Rank::ALL[usize::from(self.0 / SUITS_PER_RANK)]
    }

    /// The suit.
    #[must_use]
    pub fn suit(self) -> Suit {
        Suit::ALL[usize::from(self.0 % SUITS_PER_RANK)]
    }

    /// Every card in index order, `2c` first.
    pub fn all() -> impl Iterator<Item = Card> {
        (0..Self::COUNT).map(Card)
    }

    /// Parses exactly two characters, rank then suit. The caller wraps the error with the
    /// text it was parsing.
    fn from_chars(rank: char, suit: char) -> Result<Card, ModelError> {
        let rank = Rank::from_char(rank)?;
        let suit = Suit::from_char(suit)?;
        Ok(Card::new(rank, suit))
    }
}

impl fmt::Display for Card {
    /// Two characters, rank then suit: `Ah`.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}{}", self.rank(), self.suit())
    }
}

impl FromStr for Card {
    type Err = ModelError;

    /// Exactly two characters from `Rank::CHARS` and `Suit::CHARS`.
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        let mut chars = s.chars();
        let parsed = match (chars.next(), chars.next(), chars.next()) {
            (Some(rank), Some(suit), None) => Card::from_chars(rank, suit),
            _ => Err(ModelError::InvalidCard(s.to_owned())),
        };
        parsed.map_err(|_| ModelError::InvalidCard(s.to_owned()))
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
    let chars: Vec<char> = s.chars().collect();
    if chars.len() % 2 != 0 {
        return Err(ModelError::InvalidCard(s.to_owned()));
    }
    let cards = chars
        .chunks_exact(2)
        .map(|pair| {
            Card::from_chars(pair[0], pair[1])
                .map_err(|_| ModelError::InvalidCard(pair.iter().collect()))
        })
        .collect::<Result<Vec<Card>, ModelError>>()?;
    match first_duplicate(&cards) {
        Some(card) => Err(ModelError::DuplicateCard(card.to_string())),
        None => Ok(cards),
    }
}

/// Writes cards back to back with no separator, in the order given.
#[must_use]
pub fn format_cards(cards: &[Card]) -> String {
    cards.iter().map(ToString::to_string).collect()
}

/// The written order of a flop or a combo: rank descending, then suit ascending (A3 section
/// 1). Sorting by this key puts `2c7dAh` into `Ah7d2c` and `KhKc2d` into `KcKh2d`.
fn written_order(card: Card) -> (Reverse<Rank>, Suit) {
    (Reverse(card.rank()), card.suit())
}

/// The first item that repeats an earlier one in the slice, if any. One scan serves every
/// distinctness rule in the crate: a flop's cards, a parsed card string, a node key's
/// board and a suit permutation's mapping.
pub(crate) fn first_duplicate<T: PartialEq + Copy>(items: &[T]) -> Option<T> {
    items
        .iter()
        .enumerate()
        .find(|(position, item)| items[..*position].contains(item))
        .map(|(_, item)| *item)
}

/// Three distinct community cards held in written order: rank descending, then suit
/// ascending (A3 section 1). `Flop::new` sorts, so two flops with the same cards compare
/// equal whatever order they were given in. The derived order over the written cards is
/// the order of the canonical-flop table in `iso_table`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(try_from = "[Card; 3]", into = "[Card; 3]")]
pub struct Flop([Card; 3]);

impl Flop {
    /// Builds a flop from three cards in any order.
    ///
    /// # Errors
    ///
    /// `ModelError::DuplicateCard` when two cards are the same.
    pub fn new(cards: [Card; 3]) -> Result<Flop, ModelError> {
        if let Some(card) = first_duplicate(&cards) {
            return Err(ModelError::DuplicateCard(card.to_string()));
        }
        let mut written = cards;
        written.sort_unstable_by_key(|card| written_order(*card));
        Ok(Flop(written))
    }

    /// The cards in written order.
    #[must_use]
    pub const fn cards(self) -> [Card; 3] {
        self.0
    }

    /// The ranks in written order, highest first.
    #[must_use]
    pub fn ranks(self) -> [Rank; 3] {
        self.0.map(Card::rank)
    }

    /// The suits in written order.
    #[must_use]
    pub fn suits(self) -> [Suit; 3] {
        self.0.map(Card::suit)
    }

    /// True when the card is on the flop.
    #[must_use]
    pub fn contains(self, card: Card) -> bool {
        self.0.contains(&card)
    }
}

impl fmt::Display for Flop {
    /// The three cards back to back in written order: `Ah7d2c`.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&format_cards(&self.0))
    }
}

impl FromStr for Flop {
    type Err = ModelError;

    /// Exactly three cards back to back, in any order.
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        let cards = parse_cards(s)?;
        let cards: [Card; 3] = cards.try_into().map_err(|cards: Vec<Card>| {
            ModelError::InvalidBoard(format!(
                "a flop needs {FLOP_CARDS} cards, got {} in {s:?}",
                cards.len()
            ))
        })?;
        Flop::new(cards)
    }
}

impl TryFrom<[Card; 3]> for Flop {
    type Error = ModelError;

    fn try_from(cards: [Card; 3]) -> Result<Self, Self::Error> {
        Flop::new(cards)
    }
}

impl From<Flop> for [Card; 3] {
    fn from(flop: Flop) -> [Card; 3] {
        flop.0
    }
}

/// A flop with an optional turn and river. A river needs a turn, and every card is distinct.
/// The constructors enforce both, so a `Board` in hand is always a legal deal; serde reads
/// a board through `Board::new` as well, via `RawBoard`, so a stored board that breaks a
/// rule fails at the read.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(try_from = "RawBoard")]
pub struct Board {
    flop: Flop,
    turn: Option<Card>,
    river: Option<Card>,
}

/// The fields of a `Board` as serde reads them, before `Board::new` checks that a river
/// follows a turn and that no card repeats.
#[derive(Deserialize)]
struct RawBoard {
    flop: Flop,
    turn: Option<Card>,
    river: Option<Card>,
}

impl TryFrom<RawBoard> for Board {
    type Error = ModelError;

    fn try_from(raw: RawBoard) -> Result<Self, Self::Error> {
        Board::new(raw.flop, raw.turn, raw.river)
    }
}

impl Board {
    /// A board with only the flop dealt.
    #[must_use]
    pub const fn flop(flop: Flop) -> Board {
        Board { flop, turn: None, river: None }
    }

    /// A board from its parts.
    ///
    /// # Errors
    ///
    /// `ModelError::InvalidBoard` for a river without a turn, `ModelError::DuplicateCard`
    /// when a card repeats.
    pub fn new(flop: Flop, turn: Option<Card>, river: Option<Card>) -> Result<Board, ModelError> {
        let board = Board::flop(flop);
        let board = match turn {
            Some(card) => board.with_turn(card)?,
            None => board,
        };
        match river {
            Some(card) => board.with_river(card),
            None => Ok(board),
        }
    }

    /// Deals the turn.
    ///
    /// # Errors
    ///
    /// `ModelError::InvalidBoard` when a turn is already dealt, `ModelError::DuplicateCard`
    /// when the card is on the flop.
    pub fn with_turn(self, turn: Card) -> Result<Board, ModelError> {
        if self.turn.is_some() {
            return Err(ModelError::InvalidBoard("the turn is already dealt".to_owned()));
        }
        if self.contains(turn) {
            return Err(ModelError::DuplicateCard(turn.to_string()));
        }
        Ok(Board { turn: Some(turn), ..self })
    }

    /// Deals the river.
    ///
    /// # Errors
    ///
    /// `ModelError::InvalidBoard` when no turn is dealt yet or a river already is,
    /// `ModelError::DuplicateCard` when the card is already on the board.
    pub fn with_river(self, river: Card) -> Result<Board, ModelError> {
        if self.turn.is_none() {
            return Err(ModelError::InvalidBoard("a river needs a turn".to_owned()));
        }
        if self.river.is_some() {
            return Err(ModelError::InvalidBoard("the river is already dealt".to_owned()));
        }
        if self.contains(river) {
            return Err(ModelError::DuplicateCard(river.to_string()));
        }
        Ok(Board { river: Some(river), ..self })
    }

    /// The flop.
    #[must_use]
    pub const fn flop_cards(self) -> Flop {
        self.flop
    }

    /// The turn card, if dealt.
    #[must_use]
    pub const fn turn(self) -> Option<Card> {
        self.turn
    }

    /// The river card, if dealt.
    #[must_use]
    pub const fn river(self) -> Option<Card> {
        self.river
    }

    /// The street this board has reached: flop, turn or river.
    #[must_use]
    pub const fn street(self) -> Street {
        match (self.turn, self.river) {
            (None, _) => Street::Flop,
            (Some(_), None) => Street::Turn,
            (Some(_), Some(_)) => Street::River,
        }
    }

    /// Every card dealt, flop first in written order, then turn, then river.
    #[must_use]
    pub fn cards(self) -> Vec<Card> {
        self.flop.cards().into_iter().chain(self.turn).chain(self.river).collect()
    }

    /// True when the card is anywhere on the board.
    #[must_use]
    pub fn contains(self, card: Card) -> bool {
        self.flop.contains(card) || self.turn == Some(card) || self.river == Some(card)
    }
}
