//! The planner's one error type.

use gto_library::LibraryError;
use gto_tree::TreeError;

/// Why a plan could not be made.
#[derive(Debug, thiserror::Error)]
pub enum PlanError {
    /// A preflop tree or postflop tree configuration could not be built from the spec.
    #[error("tree for {config_id}: {source}")]
    Tree {
        /// The configuration.
        config_id: String,
        /// The tree error.
        source: TreeError,
    },
    /// No reach is known for a line (no published preflop solution and no prior).
    #[error("no equilibrium reach for line {line} of {config_id}")]
    MissingReach {
        /// The configuration.
        config_id: String,
        /// The preflop line.
        line: String,
    },
    /// A reach that is not a probability.
    #[error("reach {value} for line {line} of {config_id} is not within 0 and 1")]
    InvalidReach {
        /// The configuration.
        config_id: String,
        /// The preflop line.
        line: String,
        /// The value read.
        value: f64,
    },
    /// Reading the published preflop solution failed.
    #[error("library: {0}")]
    Library(#[from] LibraryError),
    /// Not implemented yet (the red half of S18).
    #[error("{0} is not implemented yet (S18 lane P)")]
    NotImplemented(&'static str),
}
