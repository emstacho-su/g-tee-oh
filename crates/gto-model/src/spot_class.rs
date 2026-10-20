//! Spot-class keys (R2.1, A6 section 1, 06 section 2). A spot class is a knowledge
//! component, a family of decisions that share one rule; it is the unit of scheduling and
//! mastery. In v1 a preflop spot class is defined by the action family, the position pair,
//! the depth band and the format. The key is deterministic from those features and is what
//! `solver-query` returns with a node and what the learning tables key on (A4 section 2):
//!
//! ```text
//! <street>/<format>/<depth band>/<family>/<pair>
//! ```
//!
//! for example `preflop/live/150/facing-open/BB-BTN`. Postflop classes (street, pot type,
//! texture family) arrive in v1.5, so classifying a postflop node is an error here.
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

use crate::keys::NodeKey;
use crate::tokens::ActionToken;
use crate::types::{Cbb, GameConfig, GameFormat, ModelError, PositionPair, Street};

/// The separator between the parts of a spot-class key.
pub const KEY_SEPARATOR: char = '/';

/// The preflop action families of 06 section 2.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ActionFamily {
    /// Raise first in: nobody has raised or limped. Written `rfi`.
    Rfi,
    /// Facing one raise with no caller between. Written `facing-open`.
    FacingOpen,
    /// Facing the second raise. Written `facing-3bet`.
    Facing3Bet,
    /// Facing the third raise or beyond. Written `facing-4bet`.
    Facing4Bet,
    /// Facing one raise and at least one call of it. Written `squeeze`.
    Squeeze,
    /// Small blind against big blind, whatever the line. Written `blind-vs-blind`.
    BlindVsBlind,
    /// A limp before the decision and no raise yet (live). Written `limped-isolation`.
    LimpedIsolation,
    /// A straddle is posted (live). Written `straddled-pot`.
    StraddledPot,
}

impl ActionFamily {
    /// Every family in precedence order.
    pub const ALL: [ActionFamily; 8] = [
        ActionFamily::StraddledPot,
        ActionFamily::BlindVsBlind,
        ActionFamily::LimpedIsolation,
        ActionFamily::Rfi,
        ActionFamily::Squeeze,
        ActionFamily::FacingOpen,
        ActionFamily::Facing3Bet,
        ActionFamily::Facing4Bet,
    ];

    /// Classifies a preflop line for a pair. Folds are ignored. In precedence order: a
    /// straddle token anywhere gives `StraddledPot`; the pair SB and BB gives
    /// `BlindVsBlind`; no raise and at least one limp gives `LimpedIsolation`; no raise and
    /// no limp gives `Rfi`; one raise followed by a call gives `Squeeze`, otherwise
    /// `FacingOpen`; two raises give `Facing3Bet`; three or more give `Facing4Bet`.
    #[must_use]
    pub fn classify(pair: PositionPair, preflop: &[ActionToken]) -> ActionFamily {
        todo!()
    }

    /// The kebab-case name used in keys.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        todo!()
    }
}

impl fmt::Display for ActionFamily {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        todo!()
    }
}

impl FromStr for ActionFamily {
    type Err = ModelError;

    /// A kebab-case name from `as_str`.
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        todo!()
    }
}

/// Effective stack depth bands around the v1 catalog depths of 100, 150, 200 and 300 big
/// blinds (01 section 3), with a short band for push/fold depths. Edges in cbb, lower edge
/// inclusive: below 5,000 is `Short`; 5,000 to 12,499 is `Hundred`; 12,500 to 17,499 is
/// `OneFifty`; 17,500 to 24,999 is `TwoHundred`; 25,000 and above is `Deep`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DepthBand {
    /// Below 50 bb. Written `short`.
    Short,
    /// Around 100 bb. Written `100`.
    #[serde(rename = "100")]
    Hundred,
    /// Around 150 bb. Written `150`.
    #[serde(rename = "150")]
    OneFifty,
    /// Around 200 bb. Written `200`.
    #[serde(rename = "200")]
    TwoHundred,
    /// 250 bb and deeper. Written `deep`.
    Deep,
}

impl DepthBand {
    /// Every band, shallowest first.
    pub const ALL: [DepthBand; 5] = [
        DepthBand::Short,
        DepthBand::Hundred,
        DepthBand::OneFifty,
        DepthBand::TwoHundred,
        DepthBand::Deep,
    ];

    /// The lower edges in cbb of every band after `Short`.
    pub const EDGES_CBB: [u32; 4] = [5_000, 12_500, 17_500, 25_000];

    /// The band holding a depth.
    #[must_use]
    pub fn from_cbb(depth: Cbb) -> DepthBand {
        todo!()
    }

    /// The name used in keys: `short`, `100`, `150`, `200`, `deep`.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        todo!()
    }
}

impl fmt::Display for DepthBand {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        todo!()
    }
}

impl FromStr for DepthBand {
    type Err = ModelError;

    /// A name from `as_str`.
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        todo!()
    }
}

/// The features that define a spot class.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct SpotClass {
    /// The street of the decision; `Preflop` in v1.
    pub street: Street,
    /// Online or live.
    pub format: GameFormat,
    /// The depth band of the configuration.
    pub depth_band: DepthBand,
    /// The action family of the line.
    pub family: ActionFamily,
    /// The two seats, out of position first.
    pub pair: PositionPair,
}

impl SpotClass {
    /// Classifies a node under its configuration.
    ///
    /// # Errors
    ///
    /// `ModelError::PostflopSpotClass` when the node is past preflop.
    pub fn classify(config: &GameConfig, key: &NodeKey) -> Result<SpotClass, ModelError> {
        todo!()
    }

    /// The deterministic key for this class.
    #[must_use]
    pub fn key(self) -> SpotClassKey {
        todo!()
    }

    /// The class a key names. In v1 the street part is always `preflop`; any other street
    /// is rejected until postflop classes exist.
    ///
    /// # Errors
    ///
    /// `ModelError::InvalidSpotClassKey` when the text does not follow the grammar: five
    /// parts, a known street, format, band, family and a canonical pair.
    pub fn from_key(key: &SpotClassKey) -> Result<SpotClass, ModelError> {
        todo!()
    }
}

/// The text form of a spot class (A2 section 2), such as `preflop/live/150/facing-open/BB-BTN`.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct SpotClassKey(String);

impl SpotClassKey {
    /// Validates key text by parsing it into a `SpotClass`.
    ///
    /// # Errors
    ///
    /// `ModelError::InvalidSpotClassKey` when the text does not follow the grammar.
    pub fn new(text: impl Into<String>) -> Result<SpotClassKey, ModelError> {
        todo!()
    }

    /// The key text.
    #[must_use]
    pub fn as_str(&self) -> &str {
        todo!()
    }
}

impl fmt::Display for SpotClassKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        todo!()
    }
}

impl FromStr for SpotClassKey {
    type Err = ModelError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        SpotClassKey::new(s)
    }
}
