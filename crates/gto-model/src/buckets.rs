//! Bet buckets (R2.3, ADR 0008, 05 section 6.4). Sizes are grouped by percent of the pot
//! at the node. Edges are contiguous and each bucket includes its upper edge:
//!
//! | Bucket | Percent of pot |
//! |---|---|
//! | Tiny | 0 to 25 |
//! | Small | above 25 to 50 |
//! | Medium | above 50 to 75 |
//! | Pot | above 75 to 110 |
//! | Overbet small | above 110 to 150 |
//! | Overbet large | above 150 |
//! | All-in | its own bucket, whatever its size, because an all-in ends the betting |
//!
//! The comparison is exact integer arithmetic, `size * 100 <= pot * edge`, so a size one
//! centi-big-blind above an edge lands in the next bucket at any pot. This module is the
//! only implementation of these numbers (ADR 0004): the grading policy in TypeScript reads
//! the bucket from the node record and never recomputes it. The solver's tree decides which
//! buckets have a button at a node (ADR 0020), and a simple tree holds at most one size per
//! bucket per node, so a bucket names one button and one expected value. At preflop nodes
//! Grouped mode shows the exact size instead of the bucket label (O-22).
//!
//! A raise is bucketed by its raise-to total over the pot at the node; the tree crate
//! decides what pot it passes.
//!
//! Owner: the rake-and-buckets agent (files `rake.rs`, `buckets.rs` and `config.rs`).

#![allow(
    unused_variables,
    clippy::unused_self,
    reason = "stub bodies are todo!() until the rake-and-buckets agent fills them in"
)]

use std::fmt;

use serde::{Deserialize, Serialize};

use crate::tokens::ActionToken;
use crate::types::{Cbb, ModelError};

/// The upper edges in percent of pot of the first five buckets (ADR 0008, R0.11).
pub const BUCKET_EDGES_PCT: [u16; 5] = [25, 50, 75, 110, 150];

/// A bet-size bucket.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Bucket {
    /// 0 to 25 percent of pot.
    Tiny,
    /// Above 25 to 50 percent.
    Small,
    /// Above 50 to 75 percent.
    Medium,
    /// Above 75 to 110 percent.
    Pot,
    /// Above 110 to 150 percent.
    OverbetSmall,
    /// Above 150 percent.
    OverbetLarge,
    /// An all-in of any size.
    AllIn,
}

impl Bucket {
    /// Every bucket, smallest first, all-in last.
    pub const ALL: [Bucket; 7] = [
        Bucket::Tiny,
        Bucket::Small,
        Bucket::Medium,
        Bucket::Pot,
        Bucket::OverbetSmall,
        Bucket::OverbetLarge,
        Bucket::AllIn,
    ];

    /// The label shown on a button in Grouped mode: `Tiny`, `Small`, `Medium`, `Pot`,
    /// `Overbet small`, `Overbet large`, `All-in`.
    #[must_use]
    pub fn label(self) -> &'static str {
        todo!()
    }

    /// The kebab-case name used in records and keys: `tiny`, `small`, `medium`, `pot`,
    /// `overbet-small`, `overbet-large`, `all-in`.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        todo!()
    }

    /// The percent-of-pot range as (lower edge, upper inclusive edge): `Tiny` is
    /// `Some((0, Some(25)))`, `OverbetLarge` has no upper edge, `Some((150, None))`, and
    /// `AllIn` has no range at all, `None`.
    #[must_use]
    pub fn range_pct(self) -> Option<(u16, Option<u16>)> {
        todo!()
    }

    /// The bucket of an action at a node with the given pot: `AllIn` for an all-in, the
    /// size bucket for a bet or a raise, `None` for a fold, check, call, limp or straddle.
    ///
    /// # Errors
    ///
    /// `ModelError::ZeroPot` for a bet or raise against an empty pot.
    pub fn of_action(action: ActionToken, pot: Cbb) -> Result<Option<Bucket>, ModelError> {
        todo!()
    }
}

impl fmt::Display for Bucket {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        todo!()
    }
}

/// The bucket of a bet size against the pot at the node, upper edge inclusive. Never
/// returns `AllIn`; use `Bucket::of_action` for an action token.
///
/// # Errors
///
/// `ModelError::ZeroPot` when the pot is zero.
pub fn bucket_for(size: Cbb, pot: Cbb) -> Result<Bucket, ModelError> {
    todo!()
}
