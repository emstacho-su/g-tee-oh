//! Runout draws for a flop build (S18, R2.12, ADR 0023, A2 section 2, O-192).
//!
//! Mechanism: the 49 cards off the flop give 49 times 48 = 2,352 ordered (turn, river)
//! pairs. [`draw_runouts`] lists them in card-index order, then runs a partial
//! Fisher-Yates shuffle driven by an in-crate `SplitMix64` generator seeded with `seed`, and
//! keeps the first `k`: a uniform draw without replacement that depends on the seed alone,
//! so the same seed always yields the same runouts on every machine. No dependency is
//! added to the crate (O-192).

use std::fmt;

use gto_model::{Card, Flop};

use crate::error::LibraryError;

/// The number of ordered (turn, river) pairs a flop leaves: 49 times 48.
pub const ORDERED_RUNOUTS: usize = 2_352;

/// One stored runout: the turn and the river dealt after a flop.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct RunoutSpec {
    /// The turn card.
    pub turn: Card,
    /// The river card.
    pub river: Card,
}

impl fmt::Display for RunoutSpec {
    /// The turn and river as one text, for example `Ks9h`, the directory name of the
    /// runout's files (A3 section 2).
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}{}", self.turn, self.river)
    }
}

/// `k` runouts of `flop` drawn uniformly without replacement by `seed`.
///
/// # Errors
///
/// `LibraryError::InvalidRequest` when `k` exceeds [`ORDERED_RUNOUTS`].
pub fn draw_runouts(flop: Flop, k: usize, seed: u64) -> Result<Vec<RunoutSpec>, LibraryError> {
    let _ = (flop, seed);
    Err(LibraryError::InvalidRequest(format!(
        "draw_runouts({k}) is not implemented yet (S18 lane X)"
    )))
}
