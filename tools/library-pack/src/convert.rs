//! Dump to library input (R2.8, O-131, O-132): a checked `NodeDump` becomes a
//! `SolutionMeta` and the solved nodes `gto-library` writes.
//!
//! O-131 defaults: `tree_hash` is the sha256 over the sorted (node key, action tokens)
//! list; the solution id is the dump's sha256 formatted as a version-8 universally unique
//! identifier (UUID) and `created_at` is the dump's `exported_at`, so packing one dump twice
//! gives the same bytes; `PackOptions` overrides both. `engine_version`, `seed` and
//! `iterations` come from the options and are required when the source is `own`. The
//! `config_id` comes from the node keys and must equal the dump's when it has one; it is
//! never derived from the stake label (plan G7).
//!
//! Lane P (pack) owns this file.

#![allow(unused_variables, reason = "S14 red skeleton: lane P replaces the todo!() bodies")]

use gto_library::{SolutionMeta, SolvedNode};

use crate::dump::NodeDump;
use crate::invariants::Violation;

/// What the command line adds to a dump.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct PackOptions {
    /// Overrides the default id derived from the dump's sha256.
    pub solution_id: Option<String>,
    /// Overrides the default timestamp, the dump's `exported_at`.
    pub created_at: Option<String>,
    /// The engine version; required for an own dump.
    pub engine_version: Option<String>,
    /// The solve's seed; required for an own dump.
    pub seed: Option<u64>,
    /// The solve's iteration count; required for an own dump.
    pub iterations: Option<u64>,
    /// Marks the solution as synthetic test data.
    pub synthetic: bool,
}

/// Converts a dump that passed `check_invariants` and `check_structure`.
///
/// # Errors
///
/// Every violation found, for example a missing `engine_version` on an own dump, a hand
/// space other than `preflop_169`, or a value `gto-model` rejects.
pub fn to_solution(
    d: &NodeDump,
    o: &PackOptions,
) -> Result<(SolutionMeta, Vec<SolvedNode>), Vec<Violation>> {
    todo!("lane P: dump to SolutionMeta and SolvedNode")
}
