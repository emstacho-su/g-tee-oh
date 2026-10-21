//! `POST /v1/deal` and `GET /v1/deal/{id}/reveal` (A5 section 2, R2.13, O-16, O-145,
//! O-152): a seeded server-side deal and the reveal of one street at a time. No board card
//! leaves the service before its street is revealed (A5 rule two). The deal is a pure
//! function of the seed and the filter, so the same request always names the same deal and
//! a deal lost to a restart is recreated by posting it again (R3.6 replay).
//!
//! `Hex64` carries a 64-bit seed or generator state as exactly sixteen lowercase
//! hexadecimal digits in a JavaScript Object Notation (JSON) string, because a JSON number
//! loses the high bits in TypeScript (O-151).

use std::fmt;
use std::str::FromStr;

use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};

/// The digits of a `Hex64` text.
pub const HEX64_DIGITS: usize = 16;

/// A 64-bit value written as sixteen lowercase hexadecimal digits (O-151).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(try_from = "String", into = "String")]
#[schema(value_type = String, example = "00000000deadbeef")]
pub struct Hex64(pub u64);

/// Text that is not sixteen lowercase hexadecimal digits.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct InvalidHex64(pub String);

impl fmt::Display for InvalidHex64 {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "expected {HEX64_DIGITS} lowercase hexadecimal digits, got {:?}", self.0)
    }
}

impl std::error::Error for InvalidHex64 {}

impl Hex64 {
    /// The value.
    #[must_use]
    pub const fn get(self) -> u64 {
        self.0
    }
}

impl fmt::Display for Hex64 {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:016x}", self.0)
    }
}

impl FromStr for Hex64 {
    type Err = InvalidHex64;

    /// Exactly sixteen lowercase hexadecimal digits, so every value has one spelling.
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        let canonical = s.len() == HEX64_DIGITS
            && s.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b));
        if !canonical {
            return Err(InvalidHex64(s.to_owned()));
        }
        u64::from_str_radix(s, 16).map(Hex64).map_err(|_| InvalidHex64(s.to_owned()))
    }
}

impl TryFrom<String> for Hex64 {
    type Error = InvalidHex64;

    fn try_from(s: String) -> Result<Self, Self::Error> {
        s.parse()
    }
}

impl From<Hex64> for String {
    fn from(value: Hex64) -> String {
        value.to_string()
    }
}

/// What to deal (O-145 narrows A5's filters in v1).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct DealFilter {
    /// The configuration identifier.
    #[schema(example = "cfg_6_online_100")]
    pub config_id: String,
    /// The position pair, out of position first.
    #[schema(example = "BB-BTN")]
    pub pair: String,
    /// The street the deal starts on: `preflop` only in v1.
    #[schema(example = "preflop")]
    pub start_street: String,
    /// The dotted preflop action line to start at, for example `r250`; the pair's root
    /// (the empty line) when absent.
    #[schema(example = "r250")]
    pub line: Option<String>,
    /// A spot-class key to start at, resolved through a per-family candidate line table.
    #[schema(example = "preflop/online/100/facing-open/BB-BTN")]
    pub spot_class_key: Option<String>,
    /// A texture family; rejected with 400 in v1 (preflop only).
    pub texture: Option<String>,
}

/// The body of `POST /v1/deal`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct DealRequest {
    /// What to deal.
    pub filter: DealFilter,
    /// The seed of the deal.
    pub seed: Hex64,
}

/// The streets revealed so far, as board text; every entry is null when the deal is made.
#[derive(Clone, Debug, PartialEq, Eq, Default, Serialize, Deserialize, ToSchema)]
pub struct Revealed {
    /// The flop once revealed, for example `Ah7d2c`.
    pub flop: Option<String>,
    /// The turn once revealed.
    pub turn: Option<String>,
    /// The river once revealed.
    pub river: Option<String>,
}

/// The body of a `POST /v1/deal` answer. No board card is here (A5 rule two).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct DealResponse {
    /// The deal id, derived from the seed and the filter, as a UUID string (O-152).
    #[schema(example = "5e7a1c2b-3d4f-8a6b-9c0d-1e2f3a4b5c6d")]
    pub deal_id: String,
    /// The solutions the registry holds for the configuration and pair.
    pub solution_ids: Vec<String>,
    /// The node key the deal starts at.
    pub start_node_key: String,
    /// The seat to act at the start node, as `gto_model::Position::as_str`.
    #[schema(example = "BB")]
    pub hero_position: String,
    /// The other seat.
    #[schema(example = "BTN")]
    pub villain_position: String,
    /// The hero's combo, for example `AhKd`.
    #[schema(example = "AhKd")]
    pub hero_hand: String,
    /// The villain's combo.
    #[schema(example = "QsQc")]
    pub villain_hand: String,
    /// What has been revealed, nothing at this point.
    pub revealed: Revealed,
}

/// The query string of `GET /v1/deal/{id}/reveal`.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct RevealQuery {
    /// The street to reveal: `flop`, `turn` or `river`, in that order.
    #[param(example = "flop")]
    pub street: String,
}

/// The body of a `GET /v1/deal/{id}/reveal` answer.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct RevealResponse {
    /// The deal id.
    pub deal_id: String,
    /// The street revealed.
    #[schema(example = "flop")]
    pub street: String,
    /// The street's cards: three on the flop, one after.
    #[schema(example = json!(["Ah", "7d", "2c"]))]
    pub cards: Vec<String>,
    /// The board revealed so far as text, for example `Ah7d2cKh`.
    #[schema(example = "Ah7d2c")]
    pub board: String,
}

#[cfg(test)]
mod tests {
    use super::{Hex64, InvalidHex64};

    #[test]
    fn r2_13_hex64_has_one_spelling() {
        let value: Hex64 = "00000000deadbeef".parse().expect("sixteen hex digits");
        assert_eq!(value, Hex64(0xdead_beef));
        assert_eq!(value.to_string(), "00000000deadbeef");
        assert_eq!(Hex64(u64::MAX).to_string(), "ffffffffffffffff");
        for bad in ["", "7", "0x0000000000000007", "00000000DEADBEEF", "0000000000000000f", "zz"] {
            assert_eq!(bad.parse::<Hex64>(), Err(InvalidHex64(bad.to_owned())), "{bad:?}");
        }
    }

    #[test]
    fn r2_13_hex64_serializes_as_a_json_string() {
        let json = serde_json::to_string(&Hex64(7)).expect("serializes");
        assert_eq!(json, r#""0000000000000007""#);
        let back: Hex64 = serde_json::from_str(&json).expect("deserializes");
        assert_eq!(back, Hex64(7));
        assert!(serde_json::from_str::<Hex64>("7").is_err(), "a number is not a Hex64");
        assert!(serde_json::from_str::<Hex64>(r#""7""#).is_err(), "a short string is not one");
    }
}
