//! The planner's inputs from `builder_setting` (O-180, O-188, O-191) and the scope of one
//! configuration.

use gto_model::GameConfig;
use gto_tree::SizingConventionSpec;

/// The library budget: about 650 GB (ADR 0018, 02 section 5.2).
pub const DEFAULT_BUDGET_BYTES: u64 = 650_000_000_000;

/// Bytes per runout per line until S20 measures real builds: the S14 central estimate
/// (`validation/reports/library-size-estimate.md`, O-143, O-180).
pub const DEFAULT_BYTES_PER_RUNOUT: u64 = 14_156_873;

/// Bytes per flop tree per line, the S14 central estimate (O-180).
pub const DEFAULT_BYTES_PER_FLOP_TREE: u64 = 752_365;

/// Runouts per flop for the frequent pairs (O-14).
pub const DEFAULT_K_RUNOUTS: u16 = 20;

/// Runouts per flop for the other pairs (O-191, O-51).
pub const DEFAULT_K_RUNOUTS_RARE: u16 = 10;

/// How many pairs per configuration count as frequent: the top one (O-51, O-191).
pub const DEFAULT_K_FREQUENT_PAIRS: u16 = 1;

/// The planner's settings.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PlannerSettings {
    /// The library budget in bytes.
    pub budget_bytes: u64,
    /// Estimated bytes of one runout file of one line.
    pub bytes_per_runout: u64,
    /// Estimated bytes of one flop tree file of one line.
    pub bytes_per_flop_tree: u64,
    /// K for the frequent pairs.
    pub k_runouts: u16,
    /// K for the other pairs.
    pub k_runouts_rare: u16,
    /// How many pairs of a configuration, by pair priority, take `k_runouts`.
    pub k_frequent_pairs: u16,
}

impl Default for PlannerSettings {
    fn default() -> Self {
        PlannerSettings {
            budget_bytes: DEFAULT_BUDGET_BYTES,
            bytes_per_runout: DEFAULT_BYTES_PER_RUNOUT,
            bytes_per_flop_tree: DEFAULT_BYTES_PER_FLOP_TREE,
            k_runouts: DEFAULT_K_RUNOUTS,
            k_runouts_rare: DEFAULT_K_RUNOUTS_RARE,
            k_frequent_pairs: DEFAULT_K_FREQUENT_PAIRS,
        }
    }
}

/// One configuration the planner enumerates, with the sizing convention its trees come
/// from (read from the database by the builder).
#[derive(Clone, Debug, PartialEq)]
pub struct ConfigScope {
    /// The configuration, from `gto_model::v1_configs` (O-182).
    pub config: GameConfig,
    /// Its sizing convention.
    pub convention: SizingConventionSpec,
}
