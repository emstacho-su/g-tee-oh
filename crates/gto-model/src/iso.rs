//! Board isomorphism (R2.1, A2 section 1). Two boards that differ only by relabeling the
//! suits are strategically the same, so the library solves one representative per class
//! (08 glossary, suit isomorphism). A suit permutation relabels the four suits; the
//! canonical flop of any three cards is the representative of its class.
//!
//! The representative is the lexicographically smallest written flop over the 24 suit
//! permutations, comparing the three cards in written order (rank descending, suit
//! ascending) by card integer. The top card of a canonical flop is therefore always a club,
//! and the rainbow A72 class is written `Ac7d2h`. A3's example key `Ah7d2c` is a raw board
//! in that reading; its class weight is 24 either way. A board is canonical when the tuple
//! (flop, turn, river) is smallest, so a canonical board's flop is the canonical flop and
//! later streets break the tie.
//!
//! Texture families come from 06 section 2 (dry ace-high, low connected, paired, monotone,
//! two-tone broadway). They serve v1.5 postflop spot classes and the coverage view; the
//! rules here are the v1 default and are stated on `TextureFamily::of`.
//!
//! Owner: the isomorphism agent (files `iso.rs` and `iso_table.rs`).

use std::fmt;
use std::str::FromStr;
use std::sync::OnceLock;

use serde::{Deserialize, Serialize};

use crate::cards::{Board, Card, Flop, Rank, Suit, first_duplicate};
use crate::types::{ModelError, find_by_name};

/// A relabeling of the four suits: entry `i` is the suit that suit index `i` becomes
/// (A2 section 1, the suit permutation from raw to canonical and back). The derived order
/// compares the mappings entry by entry, which is the order `all` lists them in. Serde
/// reads a mapping through `new`, so a stored mapping is always a bijection.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(try_from = "[Suit; 4]", into = "[Suit; 4]")]
pub struct SuitPermutation([Suit; 4]);

impl SuitPermutation {
    /// The permutation that changes nothing.
    pub const IDENTITY: SuitPermutation =
        SuitPermutation([Suit::Clubs, Suit::Diamonds, Suit::Hearts, Suit::Spades]);

    /// Distinct permutations of four suits.
    pub const COUNT: usize = 24;

    /// Builds a permutation from the image of each suit in `cdhs` order.
    ///
    /// # Errors
    ///
    /// `ModelError::InvalidSuitPermutation` when a suit appears twice.
    pub fn new(mapping: [Suit; 4]) -> Result<SuitPermutation, ModelError> {
        match first_duplicate(&mapping) {
            Some(suit) => Err(ModelError::InvalidSuitPermutation(format!(
                "suit {} appears twice in {}",
                suit.to_char(),
                mapping_text(mapping)
            ))),
            None => Ok(SuitPermutation(mapping)),
        }
    }

    /// The image of each suit in `cdhs` order.
    #[must_use]
    pub fn mapping(self) -> [Suit; 4] {
        self.0
    }

    /// All 24 permutations, identity first, in lexicographic order of their mappings.
    #[must_use]
    pub fn all() -> Vec<SuitPermutation> {
        Self::each().collect()
    }

    /// Every permutation in `all` order, read from a table built once. The table lists the
    /// 256 four-digit base-four codes in ascending order and keeps those whose digits are
    /// distinct: ascending codes are lexicographic order of the mappings, and the identity
    /// `cdhs` is the smallest code with distinct digits.
    fn each() -> impl Iterator<Item = SuitPermutation> {
        static TABLE: OnceLock<Vec<SuitPermutation>> = OnceLock::new();
        TABLE
            .get_or_init(|| {
                const SUITS: usize = Suit::ALL.len();
                (0..SUITS.pow(4))
                    .filter_map(|code| {
                        let digit = |place: u32| Suit::ALL[(code / SUITS.pow(place)) % SUITS];
                        // A code with a repeated digit is not a permutation; the error
                        // only says which digit repeats, so dropping it loses nothing.
                        SuitPermutation::new([digit(3), digit(2), digit(1), digit(0)]).ok()
                    })
                    .collect()
            })
            .iter()
            .copied()
    }

    /// The suit a suit becomes.
    #[must_use]
    pub fn apply_suit(self, suit: Suit) -> Suit {
        self.0[usize::from(suit.index())]
    }

    /// The card a card becomes; the rank is unchanged.
    #[must_use]
    pub fn apply(self, card: Card) -> Card {
        Card::new(card.rank(), self.apply_suit(card.suit()))
    }

    /// The flop a flop becomes, re-sorted into written order.
    #[must_use]
    pub fn apply_flop(self, flop: Flop) -> Flop {
        permuted_flop(flop.cards().map(|card| self.apply(card)))
    }

    /// The board a board becomes: the flop re-sorted, the turn and river relabeled in place.
    #[must_use]
    pub fn apply_board(self, board: Board) -> Board {
        permuted_board(
            self.apply_flop(board.flop_cards()),
            board.turn().map(|card| self.apply(card)),
            board.river().map(|card| self.apply(card)),
        )
    }

    /// The permutation that undoes this one: where this one sends suit `i` to `j`, the
    /// inverse sends `j` back to `i`.
    #[must_use]
    pub fn inverse(self) -> SuitPermutation {
        let mut mapping = Self::IDENTITY.0;
        for (index, image) in self.0.into_iter().enumerate() {
            mapping[usize::from(image.index())] = Suit::ALL[index];
        }
        SuitPermutation(mapping)
    }

    /// `self` after `first`: applying the result equals applying `first`, then `self`.
    #[must_use]
    pub fn after(self, first: SuitPermutation) -> SuitPermutation {
        SuitPermutation(first.0.map(|suit| self.apply_suit(suit)))
    }
}

/// The four suit characters of a mapping back to back, for error messages.
fn mapping_text(mapping: [Suit; 4]) -> String {
    mapping.into_iter().map(Suit::to_char).collect()
}

impl TryFrom<[Suit; 4]> for SuitPermutation {
    type Error = ModelError;

    fn try_from(mapping: [Suit; 4]) -> Result<Self, Self::Error> {
        SuitPermutation::new(mapping)
    }
}

impl From<SuitPermutation> for [Suit; 4] {
    fn from(perm: SuitPermutation) -> [Suit; 4] {
        perm.0
    }
}

/// Sorts three relabeled cards into a flop. A permutation is a bijection on cards, so three
/// distinct cards stay distinct and `Flop::new` cannot fail.
fn permuted_flop(cards: [Card; 3]) -> Flop {
    Flop::new(cards).expect("a suit permutation keeps three distinct cards distinct")
}

/// Rebuilds a board from relabeled parts. The parts stay distinct for the same reason as in
/// `permuted_flop`, and the river still follows the turn, so `Board::new` cannot fail.
fn permuted_board(flop: Flop, turn: Option<Card>, river: Option<Card>) -> Board {
    Board::new(flop, turn, river).expect("a suit permutation keeps a valid board valid")
}

/// The canonical flop of any three cards and the permutation that maps the raw flop onto it,
/// so `perm.apply_flop(flop) == canonical` and `perm.inverse().apply_flop(canonical) == flop`
/// (A2 section 1). The 24 permutations are tried in `SuitPermutation::all` order and a
/// candidate replaces the best only when strictly smaller, so when several permutations
/// reach the canonical flop (a suit absent from the flop is free) the one with the
/// lexicographically smallest mapping is returned.
#[must_use]
pub fn canonical_flop(flop: Flop) -> (Flop, SuitPermutation) {
    SuitPermutation::each().fold((flop, SuitPermutation::IDENTITY), |best, perm| {
        let candidate = perm.apply_flop(flop);
        if candidate < best.0 { (candidate, perm) } else { best }
    })
}

/// The canonical board and the permutation that maps the raw board onto it. `Board` derives
/// its order over (flop, turn, river) in that sequence, so the smallest relabeled board has
/// the canonical flop as its flop part and the turn and river only break ties among the
/// permutations that reach it, smallest card first; ties beyond that go to the smallest
/// mapping as in `canonical_flop`.
#[must_use]
pub fn canonical_board(board: Board) -> (Board, SuitPermutation) {
    SuitPermutation::each().fold((board, SuitPermutation::IDENTITY), |best, perm| {
        let candidate = perm.apply_board(board);
        if candidate < best.0 { (candidate, perm) } else { best }
    })
}

/// True when the flop is its own canonical form.
#[must_use]
pub fn is_canonical_flop(flop: Flop) -> bool {
    canonical_flop(flop).0 == flop
}

/// The smallest gap between adjacent ranks of a dry ace-high flop, high to middle and
/// middle to low: four. The rule reads the flop top down and ignores the wheel, so
/// `Ah7d2c` (gaps of seven and five) is dry even though ace and deuce meet in A2345.
const DRY_MIN_GAP: u8 = 4;

/// The largest spread from top to bottom rank of a low connected flop: four, one straight
/// window.
const CONNECTED_MAX_SPAN: u8 = 4;

/// The highest top card of a low connected flop.
const LOW_TOP_RANK: Rank = Rank::Nine;

/// A flop texture family (06 section 2). Rules, applied in this order so every flop lands
/// in exactly one family:
///
/// 1. `Paired`: two or three cards share a rank.
/// 2. `Monotone`: all three cards share a suit.
/// 3. `TwoToneBroadway`: exactly two cards share a suit and every rank is ten or higher.
/// 4. `DryAceHigh`: ace high, three suits, and each adjacent pair of ranks (high to
///    middle, middle to low) at least four apart. The wheel is ignored, so `Ah7d2c` is
///    dry ace high although ace and deuce connect through A2345.
/// 5. `LowConnected`: top rank nine or lower and the top and bottom ranks at most four
///    apart.
/// 6. `Other`: everything else.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TextureFamily {
    /// A pair or trips on board.
    Paired,
    /// Three cards of one suit.
    Monotone,
    /// Two cards of one suit, all broadway ranks.
    TwoToneBroadway,
    /// Ace high, rainbow, disconnected.
    DryAceHigh,
    /// Low and connected.
    LowConnected,
    /// No named family.
    Other,
}

impl TextureFamily {
    /// Every family in precedence order.
    pub const ALL: [TextureFamily; 6] = [
        TextureFamily::Paired,
        TextureFamily::Monotone,
        TextureFamily::TwoToneBroadway,
        TextureFamily::DryAceHigh,
        TextureFamily::LowConnected,
        TextureFamily::Other,
    ];

    /// The family of a flop, by the rules on the enum. Ranks come highest first, so equal
    /// ranks are adjacent and every gap is a non-negative difference of rank indexes.
    #[must_use]
    pub fn of(flop: Flop) -> TextureFamily {
        let ranks = flop.ranks();
        let suits = flop.suits();
        let distinct_suits = Suit::ALL.iter().filter(|suit| suits.contains(suit)).count();
        let gap = |high: Rank, low: Rank| high.index() - low.index();

        if ranks[0] == ranks[1] || ranks[1] == ranks[2] {
            TextureFamily::Paired
        } else if distinct_suits == 1 {
            TextureFamily::Monotone
        } else if distinct_suits == 2 && ranks.into_iter().all(Rank::is_broadway) {
            TextureFamily::TwoToneBroadway
        } else if ranks[0] == Rank::Ace
            && distinct_suits == 3
            && gap(ranks[0], ranks[1]) >= DRY_MIN_GAP
            && gap(ranks[1], ranks[2]) >= DRY_MIN_GAP
        {
            TextureFamily::DryAceHigh
        } else if ranks[0] <= LOW_TOP_RANK && gap(ranks[0], ranks[2]) <= CONNECTED_MAX_SPAN {
            TextureFamily::LowConnected
        } else {
            TextureFamily::Other
        }
    }

    /// The kebab-case name: `paired`, `monotone`, `two-tone-broadway`, `dry-ace-high`,
    /// `low-connected`, `other`.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            TextureFamily::Paired => "paired",
            TextureFamily::Monotone => "monotone",
            TextureFamily::TwoToneBroadway => "two-tone-broadway",
            TextureFamily::DryAceHigh => "dry-ace-high",
            TextureFamily::LowConnected => "low-connected",
            TextureFamily::Other => "other",
        }
    }
}

impl fmt::Display for TextureFamily {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl FromStr for TextureFamily {
    type Err = ModelError;

    /// A kebab-case name from `as_str`. A texture family is a spot-class feature (06
    /// section 2), so an unknown name is reported as `ModelError::InvalidSpotClassKey`.
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        find_by_name(&TextureFamily::ALL, TextureFamily::as_str, s).ok_or_else(|| {
            ModelError::InvalidSpotClassKey(
                s.to_owned(),
                "expected a texture family such as dry-ace-high".to_owned(),
            )
        })
    }
}
