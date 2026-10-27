//! Build planning (R2.16): compares what the solutions library holds against what the
//! trainer needs and produces the ordered list of flop builds the background builder
//! should solve next. It depends on `gto-model`, `gto-tree` and `gto-library` (A1
//! section 2) and never on a solver; the builder does every database write.
//!
//! Mechanism. [`enumerate`] makes one [`JobSpec`] per configuration in scope, position
//! pair with at least one flop line, and canonical flop (1,755 per pair). Its priority is
//! seat rotation times equilibrium reach (ADR 0013, O-203): `2 / table_size`, the share of
//! hands in which the hero sits in one of the pair's two seats, times the summed reach of
//! the pair's flop lines from a [`ReachSource`], times the flop's natural frequency
//! (`flop_weight / 22,100`, ADR 0023). K is `k_runouts` for the first `k_frequent_pairs`
//! pairs of a configuration by pair priority and `k_runouts_rare` for the rest (O-14,
//! O-191). A job's size is `lines * (bytes_per_flop_tree + k * bytes_per_runout)`, the
//! S14 build formula (O-180). [`schedule`] walks the candidates in priority order from
//! the bytes already committed and queues each while the sum stays within the budget; at
//! the first job that does not fit, scheduling stops and the rest are blocked, so nothing
//! is skipped ahead and nothing already in the queue or the library is touched (02
//! section 5.2, O-204).

#![forbid(unsafe_code)]

mod enumerate;
mod error;
mod reach;
mod schedule;
mod settings;

pub use enumerate::{
    JobKey, JobSpec, RAW_FLOPS, enumerate, estimated_bytes, pair_lines, seat_share,
};
pub use error::PlanError;
pub use reach::{LibraryReach, PriorReach, ReachSource, prior_reach};
pub use schedule::{Plan, plan, schedule};
pub use settings::{
    ConfigScope, DEFAULT_BUDGET_BYTES, DEFAULT_BYTES_PER_FLOP_TREE, DEFAULT_BYTES_PER_RUNOUT,
    DEFAULT_K_FREQUENT_PAIRS, DEFAULT_K_RUNOUTS, DEFAULT_K_RUNOUTS_RARE, PlannerSettings,
};

/// The crate's package name, used by the workspace link tests (R0.1).
pub const CRATE_NAME: &str = "gto-planner";

#[cfg(test)]
mod tests {
    use super::CRATE_NAME;

    #[test]
    fn r0_1_gto_planner_links() {
        assert_eq!(CRATE_NAME, env!("CARGO_PKG_NAME"));
        // Both internal edges are real: these symbols resolve only through those crates.
        assert_eq!(gto_model::CRATE_NAME, "gto-model");
        assert_eq!(gto_library::CRATE_NAME, "gto-library");
    }
}
