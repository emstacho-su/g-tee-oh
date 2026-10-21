//! The one error type of the heads-up postflop adapter (R2.10). Every fallible function in
//! `postflop` returns `SolveError`, so a caller such as the library builder handles one
//! enum. Engine messages arrive as strings, so no engine type reaches a public signature.

use gto_tree::TreeError;
use thiserror::Error;

/// Every error the postflop adapter reports.
#[derive(Clone, Debug, PartialEq, Error)]
pub enum SolveError {
    /// The tree configuration or the betting skeleton was rejected by `gto-tree`.
    #[error(transparent)]
    Tree(#[from] TreeError),
    /// The problem breaks a rule named in the message: an empty range, a range weight
    /// outside 0 to 1, a pot or stack of zero, or a stop rule that can never stop.
    #[error("invalid postflop problem: {0}")]
    Problem(String),
    /// The vendored engine refused the mapped configuration; the message is the engine's.
    #[error("the engine rejected the problem: {0}")]
    Engine(String),
    /// The memory estimate is above the cap, so nothing was allocated for the solve
    /// (O-139).
    #[error("the solve needs an estimated {estimate_bytes} bytes, above the {cap_bytes} byte cap")]
    OverMemoryCap {
        /// The estimate from `estimate_bytes_with`.
        estimate_bytes: u64,
        /// The cap from `SolveOptions::memory_cap_bytes`.
        cap_bytes: u64,
    },
}
