//! Shared plain data from A2 section 2. Everything here is data with its display form and
//! nothing else, so the four module groups (cards and indexes, isomorphism, keys and tokens,
//! rake and buckets) build on it without touching each other's files. Chips are integer
//! centi-big-blinds (cbb): one big blind (bb) is 100 cbb, so 2.5 bb is `Cbb(250)`.
//!
//! Seat names: under the gun (UTG) and the two seats after it (UTG1, UTG2), lojack (LJ),
//! hijack (HJ), cutoff (CO), button (BTN), small blind (SB) and big blind (BB). A position
//! pair lists the out-of-position (OOP) seat before the in-position (IP) seat (A3 section 1).

use std::fmt;
use std::ops::{Add, Sub};
use std::str::FromStr;

use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Every error this crate reports. One enum, so the modules share it without owning it.
#[derive(Clone, Debug, PartialEq, Eq, Error)]
pub enum ModelError {
    /// A card string is not a rank from `23456789TJQKA` followed by a suit from `cdhs`.
    #[error("invalid card {0:?}: expected a rank from 23456789TJQKA and a suit from cdhs")]
    InvalidCard(String),
    /// The same card appears twice where cards must be distinct.
    #[error("duplicate card {0}")]
    DuplicateCard(String),
    /// An integer index is outside the range of the thing it indexes.
    #[error("{what} index {index} is outside 0..{limit}")]
    IndexOutOfRange {
        /// What was indexed, for example `card` or `hand class`.
        what: &'static str,
        /// The index given.
        index: u32,
        /// The exclusive upper limit.
        limit: u32,
    },
    /// A hand class name is not one of the 169 canonical names such as `AKs`.
    #[error("invalid hand class {0:?}: expected a name such as AA, AKs or AKo")]
    InvalidHandClass(String),
    /// A combo string is not two distinct cards.
    #[error("invalid combo {0:?}: expected two distinct cards such as AsKs")]
    InvalidCombo(String),
    /// A flop or board breaks a rule, named in the message.
    #[error("invalid board: {0}")]
    InvalidBoard(String),
    /// A suit permutation does not list each suit exactly once.
    #[error("invalid suit permutation: {0}")]
    InvalidSuitPermutation(String),
    /// An action token is not one of the A3 section 1 tokens.
    #[error("invalid action token {0:?}")]
    InvalidToken(String),
    /// An action line is not tokens separated by single dots.
    #[error("invalid action line {0:?}: {1}")]
    InvalidLine(String, String),
    /// A node key does not follow the A3 section 1 grammar.
    #[error("invalid node key {0:?}: {1}")]
    InvalidNodeKey(String, String),
    /// A position name is not one of the nine seat names.
    #[error("invalid position {0:?}: expected one of UTG, UTG1, UTG2, LJ, HJ, CO, BTN, SB, BB")]
    InvalidPosition(String),
    /// A position pair names the same seat twice.
    #[error("a position pair needs two different seats, got {0} twice")]
    SamePosition(Position),
    /// A position pair lists the in-position seat first.
    #[error(
        "position pair {given} is not canonical: the out-of-position seat comes first, as in {canonical}"
    )]
    PairOrder {
        /// The pair as written.
        given: String,
        /// The same pair in canonical order.
        canonical: String,
    },
    /// A table size outside 2 to 9 seats.
    #[error("table size {0} is outside 2..=9")]
    InvalidTableSize(u8),
    /// A game format other than `online` or `live`.
    #[error("invalid game format {0:?}: expected online or live")]
    InvalidFormat(String),
    /// A street name other than `preflop`, `flop`, `turn` or `river`.
    #[error("invalid street {0:?}: expected preflop, flop, turn or river")]
    InvalidStreet(String),
    /// A configuration identifier with a character outside `[a-z0-9_]`, or an empty one.
    #[error("invalid config id {0:?}: expected one or more of a-z, 0-9 and _")]
    InvalidConfigId(String),
    /// A stake row that cannot exist, named in the message.
    #[error("invalid stake: {0}")]
    InvalidStake(String),
    /// A spot-class key that does not follow the `spot_class` grammar.
    #[error("invalid spot-class key {0:?}: {1}")]
    InvalidSpotClassKey(String, String),
    /// Spot classes exist for preflop nodes only in v1 (06 section 2).
    #[error("no spot class for a {0} node: postflop spot classes arrive in v1.5")]
    PostflopSpotClass(Street),
    /// A bucket or a rake asked for against an empty pot.
    #[error("the pot is zero, so a size has no percent of pot")]
    ZeroPot,
}

/// Integer centi-big-blinds. `Cbb(250)` is 2.5 big blinds (A2 section 2). Chips outside the
/// solver's internals are always this type, so node keys and bet sizes stay exact.
#[derive(
    Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize,
)]
#[serde(transparent)]
pub struct Cbb(pub u32);

impl Cbb {
    /// Centi-big-blinds in one big blind.
    pub const PER_BB: u32 = 100;
    /// No chips.
    pub const ZERO: Cbb = Cbb(0);

    /// Wraps a raw cbb count.
    #[must_use]
    pub const fn new(cbb: u32) -> Self {
        Cbb(cbb)
    }

    /// Whole big blinds as cbb: `Cbb::from_bb(100)` is a 100 bb stack.
    #[must_use]
    pub const fn from_bb(bb: u32) -> Self {
        Cbb(bb * Self::PER_BB)
    }

    /// The raw cbb count.
    #[must_use]
    pub const fn get(self) -> u32 {
        self.0
    }

    /// The whole big blinds, discarding any fraction: `Cbb(250).whole_bb()` is 2.
    #[must_use]
    pub const fn whole_bb(self) -> u32 {
        self.0 / Self::PER_BB
    }

    /// True when the amount is a whole number of big blinds.
    #[must_use]
    pub const fn is_whole_bb(self) -> bool {
        self.0 % Self::PER_BB == 0
    }
}

impl Add for Cbb {
    type Output = Cbb;

    fn add(self, rhs: Cbb) -> Cbb {
        Cbb(self.0 + rhs.0)
    }
}

impl Sub for Cbb {
    type Output = Cbb;

    fn sub(self, rhs: Cbb) -> Cbb {
        Cbb(self.0 - rhs.0)
    }
}

impl fmt::Display for Cbb {
    /// The raw integer, which is how sizes appear inside action tokens (`b250`).
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

/// The grading noise floor in units of 0.01 percent of the pot: 0.2 percent (architecture
/// decision record (ADR) 0008, O-22). A loss at or below the larger of this floor and the
/// solution's reported accuracy counts as zero. A3 section 4 stores losses in the same
/// units, so no conversion is needed.
pub const NOISE_FLOOR_PCT_POT_X100: u32 = 20;

/// The preflop floor used when a reference solution reports no accuracy: 0.02 bb (O-22).
pub const PREFLOP_FLOOR_FALLBACK: Cbb = Cbb(2);

/// A betting street. The derived order runs preflop to river.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Street {
    /// Before the flop.
    Preflop,
    /// Three community cards dealt.
    Flop,
    /// Four community cards dealt.
    Turn,
    /// Five community cards dealt.
    River,
}

impl Street {
    /// Every street, preflop first.
    pub const ALL: [Street; 4] = [Street::Preflop, Street::Flop, Street::Turn, Street::River];

    /// The lowercase name used in keys and configuration.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Street::Preflop => "preflop",
            Street::Flop => "flop",
            Street::Turn => "turn",
            Street::River => "river",
        }
    }

    /// The street after this one, or `None` on the river.
    #[must_use]
    pub const fn next(self) -> Option<Street> {
        match self {
            Street::Preflop => Some(Street::Flop),
            Street::Flop => Some(Street::Turn),
            Street::Turn => Some(Street::River),
            Street::River => None,
        }
    }

    /// Community cards dealt by this street: 0, 3, 4 or 5.
    #[must_use]
    pub const fn board_cards(self) -> u8 {
        match self {
            Street::Preflop => 0,
            Street::Flop => 3,
            Street::Turn => 4,
            Street::River => 5,
        }
    }
}

impl fmt::Display for Street {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl FromStr for Street {
    type Err = ModelError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Street::ALL
            .into_iter()
            .find(|street| street.as_str() == s)
            .ok_or_else(|| ModelError::InvalidStreet(s.to_owned()))
    }
}

/// A seat name. The derived order is the preflop order of action: UTG acts first and BB
/// last. `postflop_order` gives the postflop order, where the blinds act first.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum Position {
    /// Under the gun, the first seat to act preflop at a full table.
    Utg,
    /// One seat after UTG (9-handed and 8-handed only).
    Utg1,
    /// Two seats after UTG (9-handed only).
    Utg2,
    /// Lojack.
    Lj,
    /// Hijack.
    Hj,
    /// Cutoff.
    Co,
    /// Button. Heads-up, the button posts the small blind.
    Btn,
    /// Small blind.
    Sb,
    /// Big blind.
    Bb,
}

impl Position {
    /// Every seat name in preflop order.
    pub const ALL: [Position; 9] = [
        Position::Utg,
        Position::Utg1,
        Position::Utg2,
        Position::Lj,
        Position::Hj,
        Position::Co,
        Position::Btn,
        Position::Sb,
        Position::Bb,
    ];

    /// The name used in keys: `UTG`, `UTG1`, `UTG2`, `LJ`, `HJ`, `CO`, `BTN`, `SB`, `BB`.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Position::Utg => "UTG",
            Position::Utg1 => "UTG1",
            Position::Utg2 => "UTG2",
            Position::Lj => "LJ",
            Position::Hj => "HJ",
            Position::Co => "CO",
            Position::Btn => "BTN",
            Position::Sb => "SB",
            Position::Bb => "BB",
        }
    }

    /// Preflop order of action at a full table: UTG is 0 and BB is 8.
    #[must_use]
    pub const fn preflop_order(self) -> u8 {
        match self {
            Position::Utg => 0,
            Position::Utg1 => 1,
            Position::Utg2 => 2,
            Position::Lj => 3,
            Position::Hj => 4,
            Position::Co => 5,
            Position::Btn => 6,
            Position::Sb => 7,
            Position::Bb => 8,
        }
    }

    /// Postflop order of action: SB is 0, BB is 1, then UTG round to BTN at 8. The seat with
    /// the lower number is out of position against any seat with a higher one.
    #[must_use]
    pub const fn postflop_order(self) -> u8 {
        match self {
            Position::Sb => 0,
            Position::Bb => 1,
            Position::Utg => 2,
            Position::Utg1 => 3,
            Position::Utg2 => 4,
            Position::Lj => 5,
            Position::Hj => 6,
            Position::Co => 7,
            Position::Btn => 8,
        }
    }

    /// True for the small blind and the big blind.
    #[must_use]
    pub const fn is_blind(self) -> bool {
        matches!(self, Position::Sb | Position::Bb)
    }

    /// The seats at a table of the given size, in preflop order. Heads-up seats BTN and BB,
    /// because the button posts the small blind; 6-max seats UTG, HJ, CO, BTN, SB, BB.
    #[must_use]
    pub const fn seated(table: TableSize) -> &'static [Position] {
        use Position as P;
        match table.0 {
            2 => &[P::Btn, P::Bb],
            3 => &[P::Btn, P::Sb, P::Bb],
            4 => &[P::Co, P::Btn, P::Sb, P::Bb],
            5 => &[P::Hj, P::Co, P::Btn, P::Sb, P::Bb],
            6 => &[P::Utg, P::Hj, P::Co, P::Btn, P::Sb, P::Bb],
            7 => &[P::Utg, P::Lj, P::Hj, P::Co, P::Btn, P::Sb, P::Bb],
            8 => &[P::Utg, P::Utg1, P::Lj, P::Hj, P::Co, P::Btn, P::Sb, P::Bb],
            _ => &[P::Utg, P::Utg1, P::Utg2, P::Lj, P::Hj, P::Co, P::Btn, P::Sb, P::Bb],
        }
    }
}

impl fmt::Display for Position {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl FromStr for Position {
    type Err = ModelError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Position::ALL
            .into_iter()
            .find(|position| position.as_str() == s)
            .ok_or_else(|| ModelError::InvalidPosition(s.to_owned()))
    }
}

/// Two seats in a heads-up line, the out-of-position seat first (A3 section 1), written
/// `BB-BTN`. The constructor orders the seats by `Position::postflop_order`, and parsing
/// rejects a pair written the other way round so that every key is canonical.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct PositionPair {
    oop: Position,
    ip: Position,
}

impl PositionPair {
    /// The separator between the two seats.
    pub const SEPARATOR: char = '-';

    /// Pairs two seats, placing the one that acts first postflop out of position.
    ///
    /// # Errors
    ///
    /// `ModelError::SamePosition` when both seats are the same.
    pub fn new(a: Position, b: Position) -> Result<Self, ModelError> {
        if a == b {
            return Err(ModelError::SamePosition(a));
        }
        if a.postflop_order() < b.postflop_order() {
            Ok(PositionPair { oop: a, ip: b })
        } else {
            Ok(PositionPair { oop: b, ip: a })
        }
    }

    /// The out-of-position seat.
    #[must_use]
    pub const fn oop(self) -> Position {
        self.oop
    }

    /// The in-position seat.
    #[must_use]
    pub const fn ip(self) -> Position {
        self.ip
    }

    /// True when the seat is one of the two.
    #[must_use]
    pub fn contains(self, position: Position) -> bool {
        self.oop == position || self.ip == position
    }

    /// The other seat of the pair, or `None` when the seat is not in it.
    #[must_use]
    pub fn other(self, position: Position) -> Option<Position> {
        if position == self.oop {
            Some(self.ip)
        } else if position == self.ip {
            Some(self.oop)
        } else {
            None
        }
    }
}

impl fmt::Display for PositionPair {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}{}{}", self.oop, Self::SEPARATOR, self.ip)
    }
}

impl FromStr for PositionPair {
    type Err = ModelError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        let (first, second) = s
            .split_once(Self::SEPARATOR)
            .ok_or_else(|| ModelError::InvalidPosition(s.to_owned()))?;
        let first: Position = first.parse()?;
        let second: Position = second.parse()?;
        let pair = PositionPair::new(first, second)?;
        if pair.oop == first {
            Ok(pair)
        } else {
            Err(ModelError::PairOrder { given: s.to_owned(), canonical: pair.to_string() })
        }
    }
}

impl TryFrom<String> for PositionPair {
    type Error = ModelError;

    fn try_from(s: String) -> Result<Self, Self::Error> {
        s.parse()
    }
}

impl From<PositionPair> for String {
    fn from(pair: PositionPair) -> String {
        pair.to_string()
    }
}

/// Seats at the table, 2 to 9. Heads-up is 2, online is 6-max and live is 9-handed in v1
/// (01 section 3).
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(try_from = "u8", into = "u8")]
pub struct TableSize(u8);

impl TableSize {
    /// The fewest seats, heads-up.
    pub const MIN: u8 = 2;
    /// The most seats, a full ring.
    pub const MAX: u8 = 9;
    /// Two seats.
    pub const HEADS_UP: TableSize = TableSize(2);
    /// Six seats, the online format in v1.
    pub const SIX_MAX: TableSize = TableSize(6);
    /// Nine seats, the live format in v1.
    pub const NINE_HANDED: TableSize = TableSize(9);

    /// Validates a seat count.
    ///
    /// # Errors
    ///
    /// `ModelError::InvalidTableSize` outside `2..=9`.
    pub fn new(seats: u8) -> Result<Self, ModelError> {
        if (Self::MIN..=Self::MAX).contains(&seats) {
            Ok(TableSize(seats))
        } else {
            Err(ModelError::InvalidTableSize(seats))
        }
    }

    /// The seat count.
    #[must_use]
    pub const fn get(self) -> u8 {
        self.0
    }
}

impl TryFrom<u8> for TableSize {
    type Error = ModelError;

    fn try_from(seats: u8) -> Result<Self, Self::Error> {
        TableSize::new(seats)
    }
}

impl From<TableSize> for u8 {
    fn from(table: TableSize) -> u8 {
        table.0
    }
}

impl fmt::Display for TableSize {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

/// Online or live (01 section 3). Online uses the one online rake profile; live rake follows
/// the selected stake (ADR 0014).
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GameFormat {
    /// Online cash, 6-max in v1.
    Online,
    /// Live cash, 9-handed in v1.
    Live,
}

impl GameFormat {
    /// Both formats.
    pub const ALL: [GameFormat; 2] = [GameFormat::Online, GameFormat::Live];

    /// The lowercase name used in keys: `online` or `live`.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            GameFormat::Online => "online",
            GameFormat::Live => "live",
        }
    }
}

impl fmt::Display for GameFormat {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl FromStr for GameFormat {
    type Err = ModelError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        GameFormat::ALL
            .into_iter()
            .find(|format| format.as_str() == s)
            .ok_or_else(|| ModelError::InvalidFormat(s.to_owned()))
    }
}

/// A rake model as ADR 0014 states it: a percent of the pot in basis points (1,000 is 10
/// percent) up to a cap in cents of the stake's currency, which converts to cbb at the
/// stake's big blind, and no rake when the hand ends preflop if no flop no drop applies.
/// Behaviour (the cap in cbb, the rake taken from a pot) lives in the `rake` module.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct RakeModel {
    /// Rake percent in basis points: 1,000 is 10 percent.
    pub percent_bp: u16,
    /// The cap in cents of the stake's currency.
    pub cap_cents: u32,
    /// True when a hand that ends preflop pays no rake.
    pub no_flop_no_drop: bool,
}

/// A stake level with its rake (02 section 4 `stake` row). Live labels read `1/3` and `2/5`;
/// the one online row carries the online profile. Constructors for the v1 catalog live in
/// the `config` module.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Stake {
    /// The label shown to the user, for example `1/3`.
    pub label: String,
    /// The small blind in cents.
    pub sb_cents: u32,
    /// The big blind in cents. Cap conversions divide by this.
    pub bb_cents: u32,
    /// The rake model at this stake.
    pub rake: RakeModel,
}

/// One solvable configuration (A2 section 2, 02 section 4 `game_config`). Ante is kept per
/// O-33 and defaults to zero; straddle is off unless selected (01 section 3). The `config`
/// module derives the `ConfigId`, which differs between stakes so that the same action at
/// 1/3 and at 2/5 resolves to different solutions (ADR 0014).
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct GameConfig {
    /// Online or live.
    pub format: GameFormat,
    /// Seats at the table.
    pub table_size: TableSize,
    /// The stake, which sets the rake.
    pub stake: Stake,
    /// Effective stack depth in cbb.
    pub depth_cbb: Cbb,
    /// True when a straddle is posted.
    pub straddle: bool,
    /// Ante per player in cbb, zero when none (O-33).
    pub ante_cbb: Cbb,
}

/// The first segment of a node key (A3 section 1): lowercase letters, digits and
/// underscores, never empty, such as `cfg_9_live_13_150`.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct ConfigId(String);

impl ConfigId {
    /// Validates an identifier.
    ///
    /// # Errors
    ///
    /// `ModelError::InvalidConfigId` when the string is empty or holds a character outside
    /// `[a-z0-9_]`.
    pub fn new(id: impl Into<String>) -> Result<Self, ModelError> {
        let id = id.into();
        let valid = !id.is_empty()
            && id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_');
        if valid { Ok(ConfigId(id)) } else { Err(ModelError::InvalidConfigId(id)) }
    }

    /// The identifier text.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for ConfigId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl FromStr for ConfigId {
    type Err = ModelError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        ConfigId::new(s)
    }
}

impl TryFrom<String> for ConfigId {
    type Error = ModelError;

    fn try_from(s: String) -> Result<Self, Self::Error> {
        ConfigId::new(s)
    }
}

impl From<ConfigId> for String {
    fn from(id: ConfigId) -> String {
        id.0
    }
}
