//! Node keys (R2.1, A3 section 1). The node key is the human-readable identity of a
//! decision point:
//!
//! ```text
//! <config_id>/<pair>/<preflop actions>|<flop>|<flop actions>|<turn>|<turn actions>|<river>|<river actions>
//! ```
//!
//! The pair lists the out-of-position seat first. Street sections that have not been
//! reached are omitted, so a key has 1, 3, 5 or 7 sections split on `|`. Once a street is
//! dealt its action segment is always present, even when empty: the first decision on the
//! flop is `.../r300.c|Ah7d2c|` and the preflop root is `<config_id>/<pair>/`. Board cards
//! are raw, not canonical; the isomorphism module maps them when a build is looked up.
//!
//! A3's example, `cfg_9_live_13_150/BB-BTN/r300.c|Ah7d2c|x.b250.c|Kh|x`, is the big blind
//! (BB) against the button (BTN), a 3bb open called, a check then a 2.5bb bet called on A72
//! rainbow, and the turn Kh checked to BTN. Parse and display round-trip exactly, which the
//! R0.11 node-key vector and the proptest in `tests/props.rs` check: every part of the key
//! (the configuration identifier, the pair, the tokens, the cards) admits one spelling, so
//! the key text is canonical and storage can index it by a 64-bit xxhash. That hash belongs
//! to the library crate, not here.
//!
//! Owner: the keys-and-tokens agent (files `tokens.rs`, `keys.rs` and `spot_class.rs`).

use std::fmt;
use std::str::FromStr;

use serde::{Deserialize, Serialize};

use crate::cards::{Board, Card, Flop, first_duplicate};
use crate::tokens::{ActionToken, format_line, parse_line};
use crate::types::{ConfigId, ModelError, PositionPair, Street};

/// The separator between the config id, the pair and the preflop actions.
pub const PATH_SEPARATOR: char = '/';

/// The separator between street sections.
pub const SECTION_SEPARATOR: char = '|';

/// Path segments before the first section separator: the config id, the pair and the
/// preflop actions.
const PATH_SEGMENTS: usize = 3;

/// Sections each dealt street adds: its cards and its actions.
const SECTIONS_PER_STREET: usize = 2;

/// Sections in a key with every street dealt: the path plus cards and actions for the
/// flop, the turn and the river.
const MAX_SECTIONS: usize = 1 + 3 * SECTIONS_PER_STREET;

/// A dealt street: its new board cards and the actions taken on it so far.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct StreetSection<C> {
    /// The cards dealt on this street: a `Flop`, or one `Card` for the turn and river.
    pub cards: C,
    /// The actions on this street, possibly none yet.
    pub actions: Vec<ActionToken>,
}

impl<C: fmt::Display> StreetSection<C> {
    /// Writes the section as `|<cards>|<actions>`, the form it takes inside a key.
    fn write_to(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let actions = format_line(&self.actions);
        write!(f, "{SECTION_SEPARATOR}{}{SECTION_SEPARATOR}{actions}", self.cards)
    }
}

impl<C: FromStr<Err = ModelError> + fmt::Display> StreetSection<C> {
    /// Parses one `[cards, actions]` pair of sections cut from a key, blaming `text`, the
    /// whole key, in any error. The cards must be written exactly as they display: a flop
    /// spelled out of canonical order parses as cards but is not a valid key, so the key
    /// text keeps its one spelling and storage can hash the text (A3 section 1).
    fn parse(text: &str, sections: &[&str]) -> Result<Self, ModelError> {
        let [spelled, actions] = sections else {
            return Err(malformed(text, "a street section needs its cards and its actions"));
        };
        let cards = spelled.parse::<C>().map_err(|err| malformed(text, err.to_string()))?;
        let canonical = cards.to_string();
        if canonical != *spelled {
            let reason = format!("cards {spelled:?} must be written {canonical:?}");
            return Err(malformed(text, reason));
        }
        let actions = parse_line(actions).map_err(|err| malformed(text, err.to_string()))?;
        Ok(StreetSection { cards, actions })
    }
}

impl<C> StreetSection<C> {
    /// The actions of a section that may not be dealt yet; empty when it is not.
    fn actions_of(section: Option<&Self>) -> &[ActionToken] {
        section.map_or(&[], |section| section.actions.as_slice())
    }
}

/// The error for text that is not a node key, with the whole text and the reason.
fn malformed(text: &str, reason: impl Into<String>) -> ModelError {
    ModelError::InvalidNodeKey(text.to_owned(), reason.into())
}

/// A node key. Fields are public so a key is plain data; `validate` checks the invariants
/// (a turn needs a flop, a river needs a turn, every board card distinct), and the `with_*`
/// builders uphold them.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct NodeKey {
    /// The configuration the solution belongs to.
    pub config_id: ConfigId,
    /// The two seats, out of position first.
    pub pair: PositionPair,
    /// The preflop actions.
    pub preflop: Vec<ActionToken>,
    /// The flop, once dealt.
    pub flop: Option<StreetSection<Flop>>,
    /// The turn, once dealt.
    pub turn: Option<StreetSection<Card>>,
    /// The river, once dealt.
    pub river: Option<StreetSection<Card>>,
}

impl NodeKey {
    /// A preflop node.
    #[must_use]
    pub fn preflop(config_id: ConfigId, pair: PositionPair, preflop: Vec<ActionToken>) -> NodeKey {
        NodeKey { config_id, pair, preflop, flop: None, turn: None, river: None }
    }

    /// Deals the flop with the actions taken on it.
    ///
    /// # Errors
    ///
    /// `ModelError::InvalidNodeKey` when a flop is already dealt.
    pub fn with_flop(self, flop: Flop, actions: Vec<ActionToken>) -> Result<NodeKey, ModelError> {
        if self.flop.is_some() {
            return Err(self.invalid("the flop is already dealt"));
        }
        Ok(NodeKey { flop: Some(StreetSection { cards: flop, actions }), ..self })
    }

    /// Deals the turn with the actions taken on it.
    ///
    /// # Errors
    ///
    /// `ModelError::InvalidNodeKey` without a flop or with a turn already dealt,
    /// `ModelError::DuplicateCard` when the card is on the flop.
    pub fn with_turn(self, turn: Card, actions: Vec<ActionToken>) -> Result<NodeKey, ModelError> {
        if self.flop.is_none() {
            return Err(self.invalid("a turn needs a flop"));
        }
        if self.turn.is_some() {
            return Err(self.invalid("the turn is already dealt"));
        }
        if self.dealt_cards().contains(&turn) {
            return Err(ModelError::DuplicateCard(turn.to_string()));
        }
        Ok(NodeKey { turn: Some(StreetSection { cards: turn, actions }), ..self })
    }

    /// Deals the river with the actions taken on it.
    ///
    /// # Errors
    ///
    /// `ModelError::InvalidNodeKey` without a turn or with a river already dealt,
    /// `ModelError::DuplicateCard` when the card is already on the board.
    pub fn with_river(self, river: Card, actions: Vec<ActionToken>) -> Result<NodeKey, ModelError> {
        if self.flop.is_none() || self.turn.is_none() {
            return Err(self.invalid("a river needs a flop and a turn"));
        }
        if self.river.is_some() {
            return Err(self.invalid("the river is already dealt"));
        }
        if self.dealt_cards().contains(&river) {
            return Err(ModelError::DuplicateCard(river.to_string()));
        }
        Ok(NodeKey { river: Some(StreetSection { cards: river, actions }), ..self })
    }

    /// Checks the invariants on a key built by hand.
    ///
    /// # Errors
    ///
    /// `ModelError::InvalidNodeKey` for a turn without a flop or a river without a turn,
    /// `ModelError::DuplicateCard` when a board card repeats.
    pub fn validate(&self) -> Result<(), ModelError> {
        if self.turn.is_some() && self.flop.is_none() {
            return Err(self.invalid("a turn needs a flop"));
        }
        if self.river.is_some() && self.turn.is_none() {
            return Err(self.invalid("a river needs a turn"));
        }
        match first_duplicate(&self.dealt_cards()) {
            Some(card) => Err(ModelError::DuplicateCard(card.to_string())),
            None => Ok(()),
        }
    }

    /// The street the node is on: the last street dealt.
    #[must_use]
    pub fn street(&self) -> Street {
        if self.river.is_some() {
            Street::River
        } else if self.turn.is_some() {
            Street::Turn
        } else if self.flop.is_some() {
            Street::Flop
        } else {
            Street::Preflop
        }
    }

    /// The board, or `None` preflop. A key that fails `validate` has no board either, so
    /// this is `None` for it too.
    #[must_use]
    pub fn board(&self) -> Option<Board> {
        let flop = self.flop.as_ref()?;
        let turn = self.turn.as_ref().map(|section| section.cards);
        let river = self.river.as_ref().map(|section| section.cards);
        Board::new(flop.cards, turn, river).ok()
    }

    /// The actions on a street; empty for a street not reached.
    #[must_use]
    pub fn actions_on(&self, street: Street) -> &[ActionToken] {
        match street {
            Street::Preflop => &self.preflop,
            Street::Flop => StreetSection::actions_of(self.flop.as_ref()),
            Street::Turn => StreetSection::actions_of(self.turn.as_ref()),
            Street::River => StreetSection::actions_of(self.river.as_ref()),
        }
    }

    /// The preflop line as text, for example `r300.c`; the manifest and the build paths
    /// name flop trees by it (A3 sections 2 and 3).
    #[must_use]
    pub fn line(&self) -> String {
        format_line(&self.preflop)
    }

    /// Every board card in the key, flop first, whether or not the key is valid.
    fn dealt_cards(&self) -> Vec<Card> {
        let mut cards = Vec::with_capacity(usize::from(Street::River.board_cards()));
        if let Some(flop) = &self.flop {
            cards.extend(flop.cards.cards());
        }
        cards.extend(self.turn.as_ref().map(|section| section.cards));
        cards.extend(self.river.as_ref().map(|section| section.cards));
        cards
    }

    /// The error for a builder or `validate` call on this key.
    fn invalid(&self, reason: &str) -> ModelError {
        malformed(&self.to_string(), reason)
    }
}

impl fmt::Display for NodeKey {
    /// The key text in the grammar above.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let line = self.line();
        write!(f, "{}{PATH_SEPARATOR}{}{PATH_SEPARATOR}{line}", self.config_id, self.pair)?;
        if let Some(flop) = &self.flop {
            flop.write_to(f)?;
        }
        if let Some(turn) = &self.turn {
            turn.write_to(f)?;
        }
        if let Some(river) = &self.river {
            river.write_to(f)?;
        }
        Ok(())
    }
}

impl FromStr for NodeKey {
    type Err = ModelError;

    /// Parses the grammar strictly: exactly three path segments before the first `|`, an odd
    /// number of sections up to seven, the pair in canonical order, three cards for the flop
    /// and one each for the turn and river, no repeated board card. Every failure is
    /// `ModelError::InvalidNodeKey` carrying the whole text and the reason.
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        let sections: Vec<&str> = s.split(SECTION_SEPARATOR).collect();
        let (path, streets) = sections
            .split_first()
            .ok_or_else(|| malformed(s, "expected a path before the first section separator"))?;
        if (sections.len() - 1) % SECTIONS_PER_STREET != 0 || sections.len() > MAX_SECTIONS {
            let found = sections.len();
            let reason = format!(
                "expected 1, 3, 5 or 7 sections split on {SECTION_SEPARATOR:?}, found {found}"
            );
            return Err(malformed(s, reason));
        }
        let segments: Vec<&str> = path.split(PATH_SEPARATOR).collect();
        let [config_id, pair, preflop] = segments.as_slice() else {
            let found = segments.len();
            let reason = format!(
                "expected {PATH_SEGMENTS} path segments split on {PATH_SEPARATOR:?} \
                 (config id, pair, preflop actions), found {found}"
            );
            return Err(malformed(s, reason));
        };
        let wrap = |err: ModelError| malformed(s, err.to_string());
        let config_id = ConfigId::new(*config_id).map_err(wrap)?;
        let pair: PositionPair = pair.parse().map_err(wrap)?;
        let preflop = parse_line(preflop).map_err(wrap)?;
        let mut dealt = streets.chunks_exact(SECTIONS_PER_STREET);
        let flop = dealt.next().map(|section| StreetSection::parse(s, section)).transpose()?;
        let turn = dealt.next().map(|section| StreetSection::parse(s, section)).transpose()?;
        let river = dealt.next().map(|section| StreetSection::parse(s, section)).transpose()?;
        let key = NodeKey { config_id, pair, preflop, flop, turn, river };
        key.validate().map_err(wrap)?;
        Ok(key)
    }
}

impl TryFrom<String> for NodeKey {
    type Error = ModelError;

    fn try_from(s: String) -> Result<Self, Self::Error> {
        s.parse()
    }
}

impl From<NodeKey> for String {
    fn from(key: NodeKey) -> String {
        key.to_string()
    }
}
