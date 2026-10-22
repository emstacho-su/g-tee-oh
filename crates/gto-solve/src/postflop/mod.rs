//! The heads-up postflop adapter (R2.10, A2 section 3): solves one postflop spot on the
//! vendored engine behind `gto-model` and `gto-tree` types, so no engine type appears in a
//! public signature.
//!
//! Mechanism: a `PostflopProblem` names the game configuration, the preflop line, the
//! board, both ranges, the root pot and stacks and the postflop `TreeConfig`. Before any
//! engine memory is touched, `estimate_bytes` builds only the `gto-tree` betting skeleton
//! and models the engine's peak heap from it (O-139); a solve above the cap is refused
//! there. The solve maps the problem onto the engine's configuration (exact chance, no
//! sampling, ADR 0023), runs Discounted CFR (DCFR) one iteration at a time with 32-bit
//! storage by default (16-bit is an opt-in with a stated floor, O-194), reports progress
//! to a `ProgressSink`, and stops when both players' exact best-response gain is at or
//! below the target percent of the starting pot, or at an iteration or time cap (O-138).
//! The report carries the canonical tree hash of the configuration, which the solved game
//! cross-checks against the engine's own tables.
//! `root_street_nodes` reads the solved game's root-street decision nodes back with
//! per-hand frequencies, reach and per-action values, what gate G4 compares (R2.11).
//!
//! The adapter is heads-up only: the v1 scope keeps postflop at two players, with
//! multiway as extension E7 in v2 (04 section 3).

mod engine_map;
mod error;
mod estimate;
mod layout;
mod measure;
mod nodes;
mod options;
mod problem;
mod runouts;
mod solve;

#[cfg(test)]
mod parity_tests;

pub use error::SolveError;
pub use estimate::{MemoryEstimate, estimate_bytes, estimate_bytes_with, estimate_memory};
pub use measure::{BestResponseReport, best_response};
pub use nodes::{HandStrategy, NodeStrategy, root_street_nodes};
pub use options::{
    DEFAULT_MEASURE_EVERY, DEFAULT_MEMORY_CAP_BYTES, NoProgress, ProgressSink, SolveOptions,
    SolveReport, StopReason, StopRule, StorageBits,
};
pub use problem::{COMBO_COUNT, PostflopProblem, Range};
pub use solve::{SolvedGame, solve_postflop, solve_postflop_with, solve_postflop_with_estimate};
