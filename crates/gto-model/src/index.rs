//! Hand indexes (R2.1, A3 section 1).
//!
//! Preflop hands are 169 classes in a fixed order: the 13 pairs first, `AA` (index 0) down
//! to `22` (12); then the 78 suited hands ordered by high card and then kicker, `AKs` (13)
//! to `32s` (90); then the 78 offsuit hands in the same order, `AKo` (91) to `32o` (168).
//!
//! Postflop hands are the 1,326 combos ordered by (first card, second card) with first
//! below second in card-integer order: `2c2d` is 0, `2c2h` is 1, `2cAs` is 50, `2d2h` is 51
//! and `AhAs` is 1,325. The index of first card `i` and second card `j` is
//! `51 * i - i * (i - 1) / 2 + (j - i - 1)`: the combos whose first card lies below `i`,
//! then the offset of `j` among the cards above `i`.
//!
//! A combo is written rank descending and then suit ascending, the same rule as a flop, so
//! `KcAs` reads back as `AsKc`.
//!
//! Both indexes decode through a table built once at compile time by walking the order
//! above, and encode through the closed forms, so the round-trip tests pin the two against
//! each other.
//!
//! Owner: the cards-and-indexes agent (files `cards.rs` and `index.rs`).

use std::fmt;
use std::str::FromStr;

use serde::{Deserialize, Serialize};

use crate::cards::{Card, Rank, Suit, parse_cards};
use crate::types::ModelError;

/// Hand classes in the preflop index.
const CLASS_COUNT: usize = 169;

/// Two-rank classes of one kind: 13 ranks choose 2.
const UNPAIRED_COUNT: u8 = 78;

/// The first suited class, `AKs`, after the 13 pairs.
const SUITED_START: u8 = 13;

/// The first offsuit class, `AKo`, after the pairs and the suited classes.
const OFFSUIT_START: u8 = SUITED_START + UNPAIRED_COUNT;

/// Combos in the postflop index: 52 cards choose 2.
const COMBO_COUNT: usize = 1326;

/// Whether a hand class is a pair, suited or offsuit (A3 section 1).
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

impl HandClassKind {
    /// The name suffix: nothing for a pair, `s` suited, `o` offsuit.
    const fn suffix(self) -> &'static str {
        match self {
            HandClassKind::Pair => "",
            HandClassKind::Suited => "s",
            HandClassKind::Offsuit => "o",
        }
    }

    /// Combos in a class of this kind.
    const fn combo_count(self) -> u8 {
        match self {
            HandClassKind::Pair => 6,
            HandClassKind::Suited => 4,
            HandClassKind::Offsuit => 12,
        }
    }
}

/// The 169 classes in index order as (high, low, kind), walked exactly as A3 section 1
/// lists them: pairs ace down to deuce, then suited and offsuit by high card then kicker.
static CLASSES: [(Rank, Rank, HandClassKind); CLASS_COUNT] = build_class_table();

const fn build_class_table() -> [(Rank, Rank, HandClassKind); CLASS_COUNT] {
    let mut table = [(Rank::Two, Rank::Two, HandClassKind::Pair); CLASS_COUNT];
    let mut position = 0;
    let mut rank = Rank::ALL.len();
    while rank > 0 {
        rank -= 1;
        table[position] = (Rank::ALL[rank], Rank::ALL[rank], HandClassKind::Pair);
        position += 1;
    }
    let kinds = [HandClassKind::Suited, HandClassKind::Offsuit];
    let mut kind = 0;
    while kind < kinds.len() {
        let mut high = Rank::ALL.len();
        while high > 1 {
            high -= 1;
            let mut low = high;
            while low > 0 {
                low -= 1;
                table[position] = (Rank::ALL[high], Rank::ALL[low], kinds[kind]);
                position += 1;
            }
        }
        kind += 1;
    }
    table
}

/// The offset of a two-rank class among the 78 ordered by high card then kicker: the
/// classes whose high card ranks above `high`, then how far `low` sits below `high`.
/// Requires `high > low`.
fn unpaired_offset(high: Rank, low: Rank) -> u8 {
    let h = high.index();
    let above = UNPAIRED_COUNT - h * (h + 1) / 2;
    above + (h - 1 - low.index())
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
        if index < Self::COUNT {
            Ok(HandClass(index))
        } else {
            Err(ModelError::IndexOutOfRange {
                what: "hand class",
                index: u32::from(index),
                limit: u32::from(Self::COUNT),
            })
        }
    }

    /// The index, `AA` 0 to `32o` 168.
    #[must_use]
    pub const fn index(self) -> u8 {
        self.0
    }

    /// The class for two ranks and a kind. A pair needs equal ranks and `Pair`; a suited or
    /// offsuit class needs two different ranks, given in either order.
    ///
    /// # Errors
    ///
    /// `ModelError::InvalidHandClass` when the ranks and the kind disagree.
    pub fn new(high: Rank, low: Rank, kind: HandClassKind) -> Result<HandClass, ModelError> {
        let valid = match kind {
            HandClassKind::Pair => high == low,
            HandClassKind::Suited | HandClassKind::Offsuit => high != low,
        };
        if !valid {
            return Err(ModelError::InvalidHandClass(format!("{high}{low}{}", kind.suffix())));
        }
        Ok(match kind {
            HandClassKind::Pair => HandClass::pair(high),
            HandClassKind::Suited | HandClassKind::Offsuit => {
                HandClass::unpaired(high.max(low), high.min(low), kind)
            }
        })
    }

    /// The pair of a rank: `AA` is 0 and `22` is 12.
    fn pair(rank: Rank) -> HandClass {
        HandClass(Rank::Ace.index() - rank.index())
    }

    /// A suited or offsuit class. Requires `high > low` and a kind other than `Pair`.
    fn unpaired(high: Rank, low: Rank, kind: HandClassKind) -> HandClass {
        let start = match kind {
            HandClassKind::Suited => SUITED_START,
            HandClassKind::Pair | HandClassKind::Offsuit => OFFSUIT_START,
        };
        HandClass(start + unpaired_offset(high, low))
    }

    /// The (high, low, kind) row of this class.
    fn parts(self) -> (Rank, Rank, HandClassKind) {
        CLASSES[usize::from(self.0)]
    }

    /// The higher rank (both ranks, for a pair).
    #[must_use]
    pub fn high(self) -> Rank {
        self.parts().0
    }

    /// The lower rank (both ranks, for a pair).
    #[must_use]
    pub fn low(self) -> Rank {
        self.parts().1
    }

    /// Pair, suited or offsuit.
    #[must_use]
    pub fn kind(self) -> HandClassKind {
        self.parts().2
    }

    /// Combos in the class: 6 for a pair, 4 suited, 12 offsuit.
    #[must_use]
    pub fn combo_count(self) -> u8 {
        self.kind().combo_count()
    }

    /// The combos in the class, in combo-index order.
    #[must_use]
    pub fn combos(self) -> Vec<ComboId> {
        let (high, low, kind) = self.parts();
        let suit_pairs =
            Suit::ALL.into_iter().flat_map(|a| Suit::ALL.into_iter().map(move |b| (a, b)));
        let mut combos: Vec<ComboId> = suit_pairs
            .filter(|(a, b)| match kind {
                HandClassKind::Pair => a < b,
                HandClassKind::Suited => a == b,
                HandClassKind::Offsuit => a != b,
            })
            .map(|(a, b)| ComboId::of_distinct(Card::new(high, a), Card::new(low, b)))
            .collect();
        combos.sort_unstable();
        combos
    }

    /// Every class in index order.
    pub fn all() -> impl Iterator<Item = HandClass> {
        (0..Self::COUNT).map(HandClass)
    }
}

impl fmt::Display for HandClass {
    /// The canonical name: `AA`, `AKs` or `AKo`.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let (high, low, kind) = self.parts();
        write!(f, "{high}{low}{}", kind.suffix())
    }
}

impl FromStr for HandClass {
    type Err = ModelError;

    /// A canonical name only: high rank first, then the kinds `s` or `o`, and no suffix for
    /// a pair. `KAs`, `AAs` and `AK` are rejected.
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        let invalid = || ModelError::InvalidHandClass(s.to_owned());
        let chars: Vec<char> = s.chars().collect();
        let (high, low, kind) = match chars.as_slice() {
            [high, low] => (*high, *low, HandClassKind::Pair),
            [high, low, 's'] => (*high, *low, HandClassKind::Suited),
            [high, low, 'o'] => (*high, *low, HandClassKind::Offsuit),
            _ => return Err(invalid()),
        };
        let high = Rank::from_char(high).map_err(|_| invalid())?;
        let low = Rank::from_char(low).map_err(|_| invalid())?;
        let canonical = match kind {
            HandClassKind::Pair => high == low,
            HandClassKind::Suited | HandClassKind::Offsuit => high > low,
        };
        if !canonical {
            return Err(invalid());
        }
        HandClass::new(high, low, kind).map_err(|_| invalid())
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

/// The 1,326 combos in index order as (first, second) with first below second in
/// card-integer order, walked exactly as A3 section 1 lists them.
static COMBOS: [(Card, Card); COMBO_COUNT] = build_combo_table();

const fn card_at(index: usize) -> Card {
    Card::new(Rank::ALL[index / Suit::ALL.len()], Suit::ALL[index % Suit::ALL.len()])
}

const fn build_combo_table() -> [(Card, Card); COMBO_COUNT] {
    let deck = Rank::ALL.len() * Suit::ALL.len();
    let mut table = [(card_at(0), card_at(1)); COMBO_COUNT];
    let mut position = 0;
    let mut first = 0;
    while first < deck {
        let mut second = first + 1;
        while second < deck {
            table[position] = (card_at(first), card_at(second));
            position += 1;
            second += 1;
        }
        first += 1;
    }
    table
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
        if index < Self::COUNT {
            Ok(ComboId(index))
        } else {
            Err(ModelError::IndexOutOfRange {
                what: "combo",
                index: u32::from(index),
                limit: u32::from(Self::COUNT),
            })
        }
    }

    /// The index.
    #[must_use]
    pub const fn index(self) -> u16 {
        self.0
    }

    /// The combo holding two cards, given in either order.
    ///
    /// # Errors
    ///
    /// `ModelError::DuplicateCard` when both cards are the same.
    pub fn from_cards(a: Card, b: Card) -> Result<ComboId, ModelError> {
        if a == b {
            return Err(ModelError::DuplicateCard(a.to_string()));
        }
        Ok(ComboId::of_distinct(a, b))
    }

    /// The combo of two cards known to differ, in either order. The closed form from the
    /// module docs: combos whose first card lies below `i`, then the offset of `j` above `i`.
    fn of_distinct(a: Card, b: Card) -> ComboId {
        let i = u16::from(a.min(b).index());
        let j = u16::from(a.max(b).index());
        let cards_above_first = u16::from(Card::COUNT) - 1;
        // i * (i - 1) / 2 combos are skipped twice in the row sum; saturating keeps i = 0 at 0.
        let before_first = cards_above_first * i - i * i.saturating_sub(1) / 2;
        ComboId(before_first + (j - i - 1))
    }

    /// The two cards, lower card-integer first.
    #[must_use]
    pub fn cards(self) -> (Card, Card) {
        COMBOS[usize::from(self.0)]
    }

    /// The hand class this combo belongs to.
    #[must_use]
    pub fn class(self) -> HandClass {
        let (low, high) = self.cards();
        if low.rank() == high.rank() {
            HandClass::pair(low.rank())
        } else {
            let kind = if low.suit() == high.suit() {
                HandClassKind::Suited
            } else {
                HandClassKind::Offsuit
            };
            HandClass::unpaired(high.rank(), low.rank(), kind)
        }
    }

    /// True when either card is among the given cards (card removal against a board).
    #[must_use]
    pub fn conflicts_with(self, cards: &[Card]) -> bool {
        let (a, b) = self.cards();
        cards.contains(&a) || cards.contains(&b)
    }

    /// Every combo in index order.
    pub fn all() -> impl Iterator<Item = ComboId> {
        (0..Self::COUNT).map(ComboId)
    }
}

impl fmt::Display for ComboId {
    /// The two cards back to back, rank descending then suit ascending: `AsKc`, `AcAd`.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let (low, high) = self.cards();
        if low.rank() == high.rank() { write!(f, "{low}{high}") } else { write!(f, "{high}{low}") }
    }
}

impl FromStr for ComboId {
    type Err = ModelError;

    /// Two distinct cards back to back, in either order.
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        let invalid = || ModelError::InvalidCombo(s.to_owned());
        let cards = parse_cards(s).map_err(|_| invalid())?;
        match cards.as_slice() {
            [a, b] => ComboId::from_cards(*a, *b).map_err(|_| invalid()),
            _ => Err(invalid()),
        }
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
