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
//! A3's example, `cfg_9_live_13_150/BB-BTN/r300.c|Ah7d2c|x.b250.c|Kh|x`, is BB against BTN,
//! a 3bb open called, a check then a 2.5bb bet called on A72 rainbow, and the turn Kh
//! checked to BTN. Parse and display round-trip exactly, which the R0.11 node-key vector and
//! the proptest in `tests/props.rs` check. Storage hashes the key with 64-bit xxhash; that
//! hash belongs to the library crate, not here.
//!
//! Owner: the keys-and-tokens agent (files `tokens.rs`, `keys.rs` and `spot_class.rs`).

#![allow(
    unused_variables,
    clippy::unused_self,
    clippy::needless_pass_by_value,
    reason = "stub bodies are todo!() until the keys-and-tokens agent fills them in"
)]

use std::fmt;
use std::str::FromStr;

use serde::{Deserialize, Serialize};

use crate::cards::{Board, Card, Flop};
use crate::tokens::ActionToken;
use crate::types::{ConfigId, ModelError, PositionPair, Street};

/// The separator between the config id, the pair and the preflop actions.
pub const PATH_SEPARATOR: char = '/';

/// The separator between street sections.
pub const SECTION_SEPARATOR: char = '|';

/// A dealt street: its new board cards and the actions taken on it so far.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct StreetSection<C> {
    /// The cards dealt on this street: a `Flop`, or one `Card` for the turn and river.
    pub cards: C,
    /// The actions on this street, possibly none yet.
    pub actions: Vec<ActionToken>,
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
        todo!()
    }

    /// Deals the flop with the actions taken on it.
    ///
    /// # Errors
    ///
    /// `ModelError::InvalidNodeKey` when a flop is already dealt.
    pub fn with_flop(self, flop: Flop, actions: Vec<ActionToken>) -> Result<NodeKey, ModelError> {
        todo!()
    }

    /// Deals the turn with the actions taken on it.
    ///
    /// # Errors
    ///
    /// `ModelError::InvalidNodeKey` without a flop or with a turn already dealt,
    /// `ModelError::DuplicateCard` when the card is on the flop.
    pub fn with_turn(self, turn: Card, actions: Vec<ActionToken>) -> Result<NodeKey, ModelError> {
        todo!()
    }

    /// Deals the river with the actions taken on it.
    ///
    /// # Errors
    ///
    /// `ModelError::InvalidNodeKey` without a turn or with a river already dealt,
    /// `ModelError::DuplicateCard` when the card is already on the board.
    pub fn with_river(self, river: Card, actions: Vec<ActionToken>) -> Result<NodeKey, ModelError> {
        todo!()
    }

    /// Checks the invariants on a key built by hand.
    ///
    /// # Errors
    ///
    /// `ModelError::InvalidNodeKey` for a turn without a flop or a river without a turn,
    /// `ModelError::DuplicateCard` when a board card repeats.
    pub fn validate(&self) -> Result<(), ModelError> {
        todo!()
    }

    /// The street the node is on: the last street dealt.
    #[must_use]
    pub fn street(&self) -> Street {
        todo!()
    }

    /// The board, or `None` preflop.
    #[must_use]
    pub fn board(&self) -> Option<Board> {
        todo!()
    }

    /// The actions on a street; empty for a street not reached.
    #[must_use]
    pub fn actions_on(&self, street: Street) -> &[ActionToken] {
        todo!()
    }

    /// The preflop line as text, for example `r300.c`; the manifest and the build paths
    /// name flop trees by it (A3 sections 2 and 3).
    #[must_use]
    pub fn line(&self) -> String {
        todo!()
    }
}

impl fmt::Display for NodeKey {
    /// The key text in the grammar above.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        todo!()
    }
}

impl FromStr for NodeKey {
    type Err = ModelError;

    /// Parses the grammar strictly: exactly three path segments before the first `|`, an odd
    /// number of sections up to seven, the pair in canonical order, three cards for the flop
    /// and one each for the turn and river, no repeated board card.
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        todo!()
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
