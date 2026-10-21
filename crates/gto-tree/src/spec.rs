//! The sizing convention spec, read from JavaScript Object Notation (JSON): a serde mirror
//! of `packages/contracts/schemas/sizing-convention.schema.json` (O-76), with unknown fields
//! denied at every level so a spec the schema rejects is rejected here as well.
//!
//! Units stay as the seed rows write them, because those rows are data of record (O-136):
//! `open_bb`, `straddle_bb` and the isolation rule in big blinds (bb); `threebet_ip`,
//! `threebet_oop` and `fourbet` as multiples of the raise they answer; postflop sizes as
//! fractions of the pot; `allin_threshold_pct` as a percent of the stack behind.
//! `SizingConventionSpec::from_json` checks that every value is positive and on its integer
//! grid (bb to 0.01, that is one centi-big-blind (cbb); fractions to 0.0001, one basis point
//! (bp); multipliers and percents to 0.01), so the trees built from a parsed spec only ever
//! convert exact values.
//!
//! Fields the placeholder rows lack default as O-136 says: postflop raises are jam only, a
//! bet carries no all-in unless `bet_allin` says so, the raise cap is
//! `DEFAULT_RAISE_CAP`, the all-in threshold is `DEFAULT_ALLIN_THRESHOLD_BP`, there are no
//! donk sizes, and limps come only from the small blind unless `limp_positions` names seats.

use gto_model::Position;
use serde::{Deserialize, Serialize};

use crate::error::TreeError;
use crate::units::{postflop_units, preflop_units};

/// The spec version this crate reads; a spec without `spec_version` is this version.
pub const SPEC_VERSION: u32 = 1;

/// One sizing convention (02 section 4 `sizing_convention.spec`).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SizingConventionSpec {
    /// The spec version, `SPEC_VERSION` when absent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub spec_version: Option<u32>,
    /// The configuration identifier a seed placeholder row stands in for.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub placeholder_for: Option<String>,
    /// The open raise in bb, for example 2.5.
    pub open_bb: f64,
    /// The isolation raise over limpers.
    pub iso_rule: IsoRule,
    /// A 3-bet made in position, as a multiple of the raise it answers.
    pub threebet_ip: f64,
    /// A 3-bet made out of position, as a multiple of the raise it answers.
    pub threebet_oop: f64,
    /// A 4-bet, as a multiple of the 3-bet it answers.
    pub fourbet: f64,
    /// The straddle in bb, or `None` when the convention has no straddle.
    #[serde(default)]
    pub straddle_bb: Option<f64>,
    /// The seats allowed to limp; `None` means the small blind only (O-136).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limp_positions: Option<Vec<Position>>,
    /// The postflop size tables.
    pub postflop: PostflopSpec,
}

/// The isolation raise: `base_bb` plus `per_limper_bb` for every limper.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct IsoRule {
    /// The raise over one limper's worth of action, in bb.
    pub base_bb: f64,
    /// The amount added per limper, in bb.
    pub per_limper_bb: f64,
}

/// Postflop sizes, the same for both players.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PostflopSpec {
    /// Flop bet sizes as fractions of the pot.
    pub flop: Vec<f64>,
    /// Turn bet sizes as fractions of the pot.
    pub turn: Vec<f64>,
    /// River bet sizes as fractions of the pot.
    pub river: Vec<f64>,
    /// Raise sizes per street as fractions of the pot after the call, the engine's raise
    /// rule; `None` means raises are jam only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub raise: Option<StreetFractions>,
    /// True when an all-in bet is offered beside the bet sizes; `None` means false.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bet_allin: Option<bool>,
    /// True when an all-in raise is offered; `None` means true.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub raise_allin: Option<bool>,
    /// Raises allowed per street after the opening bet; `None` means `DEFAULT_RAISE_CAP`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub raise_cap: Option<u8>,
    /// A size that puts in at least this percent of the stack behind becomes an all-in;
    /// `None` means `DEFAULT_ALLIN_THRESHOLD_BP` (67 percent).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub allin_threshold_pct: Option<f64>,
}

/// Fractions of the pot per postflop street.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StreetFractions {
    /// Flop fractions.
    pub flop: Vec<f64>,
    /// Turn fractions.
    pub turn: Vec<f64>,
    /// River fractions.
    pub river: Vec<f64>,
}

impl SizingConventionSpec {
    /// Parses a spec from JSON and checks every value: positive, finite and on its grid.
    ///
    /// # Errors
    ///
    /// `TreeError::Spec` for text that is not a spec (an unknown field, a missing field, a
    /// value that is zero, negative or not finite, an unsupported `spec_version`), and
    /// `TreeError::OffGrid` for a value off its integer grid.
    pub fn from_json(s: &str) -> Result<Self, TreeError> {
        let spec: SizingConventionSpec =
            serde_json::from_str(s).map_err(|err| TreeError::Spec(err.to_string()))?;
        spec.check()?;
        Ok(spec)
    }

    /// The spec version, `SPEC_VERSION` when the field is absent.
    #[must_use]
    pub fn version(&self) -> u32 {
        self.spec_version.unwrap_or(SPEC_VERSION)
    }

    /// Checks the version, every value against its grid, and the limp seats for repeats.
    fn check(&self) -> Result<(), TreeError> {
        if self.version() != SPEC_VERSION {
            let reason = format!("spec_version {} is not {SPEC_VERSION}", self.version());
            return Err(TreeError::Spec(reason));
        }
        preflop_units(self)?;
        postflop_units(&self.postflop)?;
        if let Some(seats) = &self.limp_positions {
            let repeated = seats.iter().enumerate().find(|(i, seat)| seats[..*i].contains(seat));
            if let Some((_, seat)) = repeated {
                return Err(TreeError::Spec(format!("limp_positions lists {seat} twice")));
            }
        }
        Ok(())
    }
}
