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
//! for example `preflop/live/150/facing-open/BB-BTN`, the big blind (BB) facing an open from
//! the button (BTN) at 150 big blinds live. Postflop classes (street, pot type, texture
//! family) arrive in v1.5, so classifying a postflop node is an error here.
//!
//! Owner: the keys-and-tokens agent (files `tokens.rs`, `keys.rs` and `spot_class.rs`).

use std::fmt;
use std::str::FromStr;

use serde::{Deserialize, Serialize};

use crate::keys::NodeKey;
use crate::tokens::ActionToken;
use crate::types::{Cbb, GameConfig, GameFormat, ModelError, Position, PositionPair, Street};

/// The separator between the parts of a spot-class key.
pub const KEY_SEPARATOR: char = '/';

/// Parts of a key split on `KEY_SEPARATOR`: street, format, depth band, family, pair.
const KEY_PARTS: usize = 5;

/// The preflop action families of 06 section 2.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ActionFamily {
    /// Raise first in: nobody has raised or limped. Written `rfi`.
    Rfi,
    /// Facing one raise with no caller between. Written `facing-open`.
    FacingOpen,
    /// Facing the second raise. Written `facing-3bet`.
    #[serde(rename = "facing-3bet")]
    Facing3Bet,
    /// Facing the third raise or beyond. Written `facing-4bet`.
    #[serde(rename = "facing-4bet")]
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
    ///
    /// A raise is any aggressive token (`ActionToken::is_aggressive`), so a preflop all-in
    /// counts as the raise it is: `r300.r900.a` is a 4-bet shove and classifies as
    /// `Facing4Bet`. Only calls after the first raise count toward `Squeeze`.
    #[must_use]
    pub fn classify(pair: PositionPair, preflop: &[ActionToken]) -> ActionFamily {
        if preflop.iter().any(|token| matches!(token, ActionToken::Straddle(_))) {
            return ActionFamily::StraddledPot;
        }
        if pair.contains(Position::Sb) && pair.contains(Position::Bb) {
            return ActionFamily::BlindVsBlind;
        }
        let raises = preflop.iter().filter(|token| token.is_aggressive()).count();
        let limped = preflop.contains(&ActionToken::Limp);
        let called_after_raise = preflop
            .iter()
            .skip_while(|token| !token.is_aggressive())
            .any(|token| *token == ActionToken::Call);
        match raises {
            0 if limped => ActionFamily::LimpedIsolation,
            0 => ActionFamily::Rfi,
            1 if called_after_raise => ActionFamily::Squeeze,
            1 => ActionFamily::FacingOpen,
            2 => ActionFamily::Facing3Bet,
            _ => ActionFamily::Facing4Bet,
        }
    }

    /// The kebab-case name used in keys.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            ActionFamily::Rfi => "rfi",
            ActionFamily::FacingOpen => "facing-open",
            ActionFamily::Facing3Bet => "facing-3bet",
            ActionFamily::Facing4Bet => "facing-4bet",
            ActionFamily::Squeeze => "squeeze",
            ActionFamily::BlindVsBlind => "blind-vs-blind",
            ActionFamily::LimpedIsolation => "limped-isolation",
            ActionFamily::StraddledPot => "straddled-pot",
        }
    }
}

impl fmt::Display for ActionFamily {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl FromStr for ActionFamily {
    type Err = ModelError;

    /// A kebab-case name from `as_str`. The error is `ModelError::InvalidSpotClassKey`,
    /// because a family name only ever appears inside a spot-class key.
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        ActionFamily::ALL.into_iter().find(|family| family.as_str() == s).ok_or_else(|| {
            let names = ActionFamily::ALL.map(ActionFamily::as_str).join(", ");
            ModelError::InvalidSpotClassKey(s.to_owned(), format!("expected a family: {names}"))
        })
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

    /// The band holding a depth: the number of edges at or below the depth is the band's
    /// index in `ALL`, so a depth on an edge belongs to the band the edge opens.
    #[must_use]
    pub fn from_cbb(depth: Cbb) -> DepthBand {
        let edges_passed = Self::EDGES_CBB.iter().filter(|&&edge| depth.get() >= edge).count();
        // Four edges open the four bands after `Short`, so the index is at most four.
        Self::ALL[edges_passed]
    }

    /// The name used in keys: `short`, `100`, `150`, `200`, `deep`.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            DepthBand::Short => "short",
            DepthBand::Hundred => "100",
            DepthBand::OneFifty => "150",
            DepthBand::TwoHundred => "200",
            DepthBand::Deep => "deep",
        }
    }
}

impl fmt::Display for DepthBand {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl FromStr for DepthBand {
    type Err = ModelError;

    /// A name from `as_str`. The error is `ModelError::InvalidSpotClassKey`, because a band
    /// name only ever appears inside a spot-class key.
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        DepthBand::ALL.into_iter().find(|band| band.as_str() == s).ok_or_else(|| {
            let names = DepthBand::ALL.map(DepthBand::as_str).join(", ");
            ModelError::InvalidSpotClassKey(s.to_owned(), format!("expected a depth band: {names}"))
        })
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
    /// Classifies a node under its configuration: the street comes from the key, the
    /// format and depth band from the configuration, and the family from the preflop line.
    ///
    /// # Errors
    ///
    /// `ModelError::PostflopSpotClass` when the node is past preflop.
    pub fn classify(config: &GameConfig, key: &NodeKey) -> Result<SpotClass, ModelError> {
        let street = key.street();
        if street != Street::Preflop {
            return Err(ModelError::PostflopSpotClass(street));
        }
        Ok(SpotClass {
            street,
            format: config.format,
            depth_band: DepthBand::from_cbb(config.depth_cbb),
            family: ActionFamily::classify(key.pair, &key.preflop),
            pair: key.pair,
        })
    }

    /// The deterministic key for this class.
    #[must_use]
    pub fn key(self) -> SpotClassKey {
        SpotClassKey(self.to_string())
    }

    /// The class a key names. In v1 the street part is always `preflop`; any other street
    /// is rejected until postflop classes exist.
    ///
    /// # Errors
    ///
    /// `ModelError::InvalidSpotClassKey` when the text does not follow the grammar: five
    /// parts, a known street, format, band, family and a canonical pair.
    pub fn from_key(key: &SpotClassKey) -> Result<SpotClass, ModelError> {
        parse_class(key.as_str())
    }
}

impl fmt::Display for SpotClass {
    /// The key text: `<street>/<format>/<depth band>/<family>/<pair>`.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let SpotClass { street, format, depth_band, family, pair } = self;
        write!(
            f,
            "{street}{KEY_SEPARATOR}{format}{KEY_SEPARATOR}{depth_band}{KEY_SEPARATOR}\
             {family}{KEY_SEPARATOR}{pair}"
        )
    }
}

/// The error for text that is not a spot-class key, with the whole text and the reason.
fn bad_key(text: &str, reason: impl Into<String>) -> ModelError {
    ModelError::InvalidSpotClassKey(text.to_owned(), reason.into())
}

/// Re-blames a part's parse error on the whole key text, keeping the reason when the part
/// already reported a key error and using the error's message otherwise.
fn blame_key(text: &str, err: ModelError) -> ModelError {
    match err {
        ModelError::InvalidSpotClassKey(_, reason) => bad_key(text, reason),
        other => bad_key(text, other.to_string()),
    }
}

/// Parses key text into its class: five parts split on `/`, the street `preflop`, then the
/// format, band, family and canonical pair, each by its own `FromStr`.
fn parse_class(text: &str) -> Result<SpotClass, ModelError> {
    let parts: Vec<&str> = text.split(KEY_SEPARATOR).collect();
    let [street, format, depth_band, family, pair] = parts.as_slice() else {
        let found = parts.len();
        let reason =
            format!("expected {KEY_PARTS} parts split on {KEY_SEPARATOR:?}, found {found}");
        return Err(bad_key(text, reason));
    };
    let wrap = |err: ModelError| blame_key(text, err);
    let street: Street = street.parse().map_err(wrap)?;
    if street != Street::Preflop {
        let reason = format!("spot classes exist for preflop only in v1, not {street}");
        return Err(bad_key(text, reason));
    }
    Ok(SpotClass {
        street,
        format: format.parse().map_err(wrap)?,
        depth_band: depth_band.parse().map_err(wrap)?,
        family: family.parse().map_err(wrap)?,
        pair: pair.parse().map_err(wrap)?,
    })
}

/// The text form of a spot class (A2 section 2), such as `preflop/live/150/facing-open/BB-BTN`.
/// Serde reads it through `new`, so a stored key is always one that parses.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct SpotClassKey(String);

impl SpotClassKey {
    /// Validates key text by parsing it into a `SpotClass`.
    ///
    /// # Errors
    ///
    /// `ModelError::InvalidSpotClassKey` when the text does not follow the grammar.
    pub fn new(text: impl Into<String>) -> Result<SpotClassKey, ModelError> {
        let text = text.into();
        parse_class(&text)?;
        Ok(SpotClassKey(text))
    }

    /// The key text.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for SpotClassKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl FromStr for SpotClassKey {
    type Err = ModelError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        SpotClassKey::new(s)
    }
}

impl TryFrom<String> for SpotClassKey {
    type Error = ModelError;

    fn try_from(s: String) -> Result<Self, Self::Error> {
        SpotClassKey::new(s)
    }
}

impl From<SpotClassKey> for String {
    fn from(key: SpotClassKey) -> String {
        key.0
    }
}
