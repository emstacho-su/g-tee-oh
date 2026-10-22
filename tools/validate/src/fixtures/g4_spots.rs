//! The G4 spot list: `validation/fixtures/g4-spots.json` (R2.11, O-87) and the tiny list
//! under `validation/fixtures/g4/`, in one layout.
//!
//! A list names the game configuration (by its catalog identifier, O-112), the position
//! pair, one postflop tree (sizes in basis points (bp) of the pot, raises all-in only by
//! default, O-136), the stop rule both solvers run under (O-168), the three pass rules of
//! 04 section 6 with their units and sources, and the spots: each a heads-up turn or river
//! root with its board, pot and stack in centi-big-blinds (cbb), the full root node key,
//! the descriptive preflop line (O-164), the rake (`none` for a gated spot, `online` for an
//! informational raked twin, O-161) and both ranges in the notation subset the engine and
//! the oracle both read. Every number is hand-made and names its source (O-26, ADR 0017).
//! The private oracle program reads the same file by path and mirrors these fields.
//!
//! Loading parses with a closed field set, checks the schema version and then the
//! structure: every source reference resolves, the configuration is in the v1 catalog,
//! the tree builds, the rules are the 04 section 6 values in their units, and every spot's
//! key parses and agrees with its street, board, configuration and pair, its ranges parse
//! with a live combo on the board, and its pot and stack are above zero (the `check` child
//! module). The R2.11 minimum of four gated river and four gated turn spots is asserted by
//! the test on the committed list, not here, so the tiny list shares this loader.

use std::path::Path;

use gto_model::{GameConfig, NodeKey, PositionPair, Street};
use gto_solve::postflop::StopRule;
use gto_tree::{PlayerSizes, SizeTable, StreetSizes, TreeConfig, TreeError};
use serde::Deserialize;

use super::toy_game::Source;
use super::{FixtureError, check_schema_version, invalid, read_json};

mod check;

/// The committed spot list, relative to the repository root (O-87).
pub const DEFAULT_PATH: &str = "validation/fixtures/g4-spots.json";

/// The G4 pass rules of 04 section 6: both sides at or below this percent of the pot.
pub const EXPLOITABILITY_MAX_PCT_POT: f64 = 0.3;
/// The mean absolute frequency difference per hand must be under this many points (O-160).
pub const FREQUENCY_MAD_MAX_POINTS: f64 = 2.0;
/// The root expected value (EV) must be within this percent of the pot.
pub const ROOT_EV_MAX_PCT_POT: f64 = 0.3;

/// The unit of a percent-of-pot rule and measurement.
pub const PCT_POT: &str = "pct_pot";
/// The unit of the frequency rule and measurement.
pub const PERCENTAGE_POINTS: &str = "percentage_points";

/// The rake a gated spot carries (O-161) and the rake of an informational twin.
pub const RAKE_NONE: &str = "none";
pub const RAKE_ONLINE: &str = "online";

/// The gate and the requirement every list names.
const GATE: &str = "G4";
const R_ID: &str = "R2.11";

/// The separator between the pieces of a range notation.
const RANGE_SEPARATOR: &str = ",";

/// The spot list file.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct G4Spots {
    /// Always [`super::SCHEMA_VERSION`].
    pub schema_version: u32,
    /// The list identifier, `g4-spots` for the committed list.
    pub id: String,
    /// Always `G4`.
    pub gate: String,
    /// Always `R2.11`.
    pub r_id: String,
    /// Where the numbers come from, referenced by id.
    pub sources: Vec<Source>,
    /// The catalog identifier of the game configuration (O-112).
    pub config_id: String,
    /// The two seats, out of position first.
    pub position_pair: String,
    /// The postflop tree every spot is solved with.
    pub tree: TreeSpec,
    /// The stop rule both solvers run under.
    pub stop: StopSpec,
    /// The three pass rules.
    pub rules: Rules,
    /// The spots.
    pub spots: Vec<Spot>,
    /// Reader notes.
    pub notes: Vec<String>,
}

/// The tree: the same tables on every street for both players, the donk table for the
/// out-of-position player only.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TreeSpec {
    /// Opening bet sizes in bp of the pot.
    pub bet_sizes_bp: Vec<u32>,
    /// Raise sizes in bp of the pot, usually none.
    pub raise_sizes_bp: Vec<u32>,
    /// Whether an all-in raise is offered beside the raise sizes.
    pub raise_allin: bool,
    /// Out-of-position donk lead sizes in bp of the pot.
    pub donk_sizes_bp: Vec<u32>,
    /// Raises allowed per street after the opening bet.
    pub raise_cap: u8,
    /// The all-in threshold in bp of the stack behind.
    pub allin_threshold_bp: u32,
    /// The source id.
    pub source: String,
}

/// The stop rule of both solvers.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StopSpec {
    /// The engine stops once each seat's gain is at or below this percent of the pot.
    pub engine_target_pct_pot: f32,
    /// The oracle stops once its mean gain is at or below this percent of the pot (O-162).
    pub oracle_target_pct_pot: f64,
    /// The iteration cap of each solver.
    pub max_iterations: u32,
    /// The wall-clock cap of each solver in seconds.
    pub max_seconds: u32,
}

/// The three pass rules.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Rules {
    /// Both sides' exploitability, at most the value, inclusive.
    pub exploitability_max: Rule,
    /// The root frequency difference, under the value, strict.
    pub frequency_mad_max: Rule,
    /// The root EV difference, at most the value, inclusive.
    pub root_ev_max: Rule,
}

/// One pass rule with its unit, whether the bound is inclusive, and its source.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Rule {
    /// The bound.
    pub value: f64,
    /// `pct_pot` or `percentage_points`.
    pub unit: String,
    /// True when a value equal to the bound passes.
    pub inclusive: bool,
    /// The source id.
    pub source: String,
}

/// One heads-up turn or river spot.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Spot {
    /// Identifier, unique within the list.
    pub id: String,
    /// `turn` or `river`.
    pub street: String,
    /// The board as the key spells it.
    pub board: String,
    /// The pot at the root in cbb.
    pub pot_cbb: u32,
    /// The stack behind each player at the root in cbb.
    pub stack_cbb: u32,
    /// The full root node key.
    pub node_key: String,
    /// The preflop line, descriptive only (O-164).
    pub preflop: PreflopSpec,
    /// `none` or `online` (O-161).
    pub rake: String,
    /// Both ranges.
    pub ranges: Ranges,
    /// True when the three rules are judged on this spot.
    pub gated: bool,
    /// The source id.
    pub source: String,
    /// What the spot is for, in words.
    pub notes: String,
}

/// The preflop line that reached the board, as `PreflopLine` names it.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PreflopSpec {
    /// The dotted line, for example `r250.c`.
    pub actions: String,
    /// `limped`, `single-raised`, `three-bet` or `four-bet`.
    pub kind: String,
    /// The seat that made the last raise.
    pub aggressor: String,
}

/// Both ranges, each as pieces of notation joined by commas.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Ranges {
    /// The out-of-position range.
    pub oop: Vec<String>,
    /// The in-position range.
    pub ip: Vec<String>,
}

impl Ranges {
    /// The out-of-position notation, the pieces joined by commas.
    #[must_use]
    pub fn oop_notation(&self) -> String {
        self.oop.join(RANGE_SEPARATOR)
    }

    /// The in-position notation, the pieces joined by commas.
    #[must_use]
    pub fn ip_notation(&self) -> String {
        self.ip.join(RANGE_SEPARATOR)
    }
}

impl TreeSpec {
    /// The tree configuration: the bet, raise and donk tables on every street for the
    /// out-of-position player, the bet and raise tables for the in-position player.
    ///
    /// # Errors
    ///
    /// The errors of `SizeTable::new` and `TreeConfig::new`.
    pub fn tree_config(&self) -> Result<TreeConfig, TreeError> {
        let street = |donk: &[u32]| -> Result<StreetSizes, TreeError> {
            Ok(StreetSizes {
                bet: SizeTable::new(&self.bet_sizes_bp, false)?,
                raise: SizeTable::new(&self.raise_sizes_bp, self.raise_allin)?,
                donk: SizeTable::new(donk, false)?,
            })
        };
        let oop = PlayerSizes {
            flop: street(&self.donk_sizes_bp)?,
            turn: street(&self.donk_sizes_bp)?,
            river: street(&self.donk_sizes_bp)?,
        };
        let ip = PlayerSizes { flop: street(&[])?, turn: street(&[])?, river: street(&[])? };
        TreeConfig::new(oop, ip, self.raise_cap, self.allin_threshold_bp)
    }
}

impl StopSpec {
    /// The engine's stop rule.
    #[must_use]
    pub fn engine_stop_rule(&self) -> StopRule {
        StopRule {
            target_exploitability_pct_pot: self.engine_target_pct_pot,
            max_iterations: self.max_iterations,
            max_seconds: self.max_seconds,
        }
    }
}

/// The v1 catalog configuration with this identifier (O-112), if any.
#[must_use]
pub fn catalog_config(config_id: &str) -> Option<GameConfig> {
    gto_model::v1_configs().into_iter().find(|config| config.config_id().as_str() == config_id)
}

impl G4Spots {
    /// Load and validate a spot list.
    ///
    /// # Errors
    ///
    /// Any [`FixtureError`]: unreadable file, parse failure or unknown field, a
    /// `schema_version` other than [`super::SCHEMA_VERSION`], or a structural rule of the
    /// module docs that fails, named in the reason.
    pub fn load(path: &Path) -> Result<Self, FixtureError> {
        let spots: Self = read_json(path)?;
        check_schema_version(path, spots.schema_version)?;
        check::check_structure(&spots).map_err(|reason| invalid(path, reason))?;
        Ok(spots)
    }

    /// The game configuration the list names.
    #[must_use]
    pub fn game_config(&self) -> Option<GameConfig> {
        catalog_config(&self.config_id)
    }

    /// The position pair the list names.
    ///
    /// # Errors
    ///
    /// `gto_model::ModelError` for a pair the loader did not check.
    pub fn pair(&self) -> Result<PositionPair, gto_model::ModelError> {
        self.position_pair.parse()
    }

    /// The gated spots on `street`.
    pub fn gated_on(&self, street: Street) -> impl Iterator<Item = &Spot> {
        self.spots.iter().filter(move |spot| spot.gated && spot.street == street.as_str())
    }
}

impl Spot {
    /// The spot's street.
    ///
    /// # Errors
    ///
    /// `gto_model::ModelError` for a street name the loader did not check.
    pub fn street(&self) -> Result<Street, gto_model::ModelError> {
        self.street.parse()
    }

    /// The spot's root key.
    ///
    /// # Errors
    ///
    /// `gto_model::ModelError` for a key the loader did not check.
    pub fn key(&self) -> Result<NodeKey, gto_model::ModelError> {
        self.node_key.parse()
    }
}
