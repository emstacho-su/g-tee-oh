//! Build-job enumeration and priority (R2.16, ADR 0013, O-203).

use gto_model::{ConfigId, Flop, PositionPair, TableSize};
use gto_tree::PreflopLine;

use crate::error::PlanError;
use crate::reach::ReachSource;
use crate::settings::{ConfigScope, PlannerSettings};

/// The number of raw flops, the denominator of a flop's natural frequency.
pub const RAW_FLOPS: f64 = 22_100.0;

/// The unique key of a `build_job` row: configuration, pair, flop text and tree hash.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct JobKey {
    /// `game_config.id`.
    pub game_config_id: String,
    /// The pair as text, for example `BB-BTN`.
    pub position_pair: String,
    /// The flop as text, for example `Ah7d2c`.
    pub flop: String,
    /// The sha256 of the postflop tree configuration.
    pub tree_config_hash: [u8; 32],
}

/// One planned flop build.
#[derive(Clone, Debug, PartialEq)]
pub struct JobSpec {
    /// The configuration.
    pub game_config_id: ConfigId,
    /// The pair.
    pub position_pair: PositionPair,
    /// The canonical flop.
    pub flop: Flop,
    /// The pair's flop lines as text, for example `r250.c`.
    pub preflop_lines: Vec<String>,
    /// `gto_tree::tree_hash` of the configuration's postflop tree.
    pub tree_config_hash: [u8; 32],
    /// Runouts to keep.
    pub k_runouts: u16,
    /// Seat rotation times equilibrium reach times flop frequency.
    pub priority: f64,
    /// `lines * (bytes_per_flop_tree + k * bytes_per_runout)`.
    pub estimated_bytes: u64,
}

impl JobSpec {
    /// The job's unique key.
    #[must_use]
    pub fn key(&self) -> JobKey {
        JobKey {
            game_config_id: self.game_config_id.to_string(),
            position_pair: self.position_pair.to_string(),
            flop: self.flop.to_string(),
            tree_config_hash: self.tree_config_hash,
        }
    }
}

/// The share of hands in which a hero rotating through every seat sits in one of a
/// pair's two seats: `2 / table_size`.
#[must_use]
pub fn seat_share(table_size: TableSize) -> f64 {
    let _ = table_size;
    0.0
}

/// The estimated bytes of a build: `lines * (bytes_per_flop_tree + k * bytes_per_runout)`.
#[must_use]
pub fn estimated_bytes(lines: usize, k: u16, settings: &PlannerSettings) -> u64 {
    let _ = (lines, k, settings);
    0
}

/// The flop lines of every pair of a configuration with at least one, pairs in
/// `PositionPair` order.
///
/// # Errors
///
/// `PlanError::Tree` when the preflop tree cannot be built.
pub fn pair_lines(scope: &ConfigScope) -> Result<Vec<(PositionPair, Vec<PreflopLine>)>, PlanError> {
    let _ = scope;
    Err(PlanError::NotImplemented("pair_lines"))
}

/// Every candidate job of the configurations in scope, sorted by priority descending with
/// ties broken by `JobKey`, so the order is deterministic.
///
/// # Errors
///
/// `PlanError::Tree` and the reach source's errors.
pub fn enumerate(
    scopes: &[ConfigScope],
    reach: &dyn ReachSource,
    settings: &PlannerSettings,
) -> Result<Vec<JobSpec>, PlanError> {
    let _ = (scopes, reach, settings);
    Err(PlanError::NotImplemented("enumerate"))
}
