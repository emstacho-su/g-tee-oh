//! Bet buckets (R2.3, architecture decision record (ADR) 0008, 05 section 6.4). Sizes are
//! grouped by percent of the pot at the node. Edges are contiguous and each bucket includes
//! its upper edge:
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
//! centi-big-blind (cbb) above an edge lands in the next bucket at any pot. This module is
//! the only implementation of these numbers (ADR 0004): the grading policy in TypeScript
//! reads the bucket from the node record and never recomputes it. The solver's tree decides
//! which buckets have a button at a node (ADR 0020), and a simple tree holds at most one
//! size per bucket per node, so a bucket names one button and one expected value (EV). At
//! preflop nodes Grouped mode shows the exact size instead of the bucket label (O-22).
//!
//! A raise is bucketed by its raise-to total over the pot at the node; the tree crate
//! decides what pot it passes.
//!
//! Owner: the rake-and-buckets agent (files `rake.rs`, `buckets.rs` and `config.rs`).

use std::fmt;

use serde::{Deserialize, Serialize};

use crate::tokens::ActionToken;
use crate::types::{Cbb, ModelError};

/// The upper edges in percent of pot of the first five buckets (ADR 0008, R0.11).
pub const BUCKET_EDGES_PCT: [u16; 5] = [25, 50, 75, 110, 150];

/// Percent of pot as a multiplier: a size is compared as `size * 100` against
/// `pot * edge`.
const PERCENT: u64 = 100;

/// The bucket at or below each entry of `BUCKET_EDGES_PCT`, in the same order.
const BUCKET_AT_OR_BELOW_EDGE: [Bucket; 5] =
    [Bucket::Tiny, Bucket::Small, Bucket::Medium, Bucket::Pot, Bucket::OverbetSmall];

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
    /// `Overbet small`, `Overbet large`, `All-in` (05 section 6.4).
    #[must_use]
    pub const fn label(self) -> &'static str {
        match self {
            Bucket::Tiny => "Tiny",
            Bucket::Small => "Small",
            Bucket::Medium => "Medium",
            Bucket::Pot => "Pot",
            Bucket::OverbetSmall => "Overbet small",
            Bucket::OverbetLarge => "Overbet large",
            Bucket::AllIn => "All-in",
        }
    }

    /// The kebab-case name used in records and keys: `tiny`, `small`, `medium`, `pot`,
    /// `overbet-small`, `overbet-large`, `all-in`.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Bucket::Tiny => "tiny",
            Bucket::Small => "small",
            Bucket::Medium => "medium",
            Bucket::Pot => "pot",
            Bucket::OverbetSmall => "overbet-small",
            Bucket::OverbetLarge => "overbet-large",
            Bucket::AllIn => "all-in",
        }
    }

    /// The percent-of-pot range as (lower edge, upper inclusive edge), read off
    /// `BUCKET_EDGES_PCT`: `Tiny` is `Some((0, Some(25)))`, `OverbetLarge` has no upper
    /// edge, `Some((150, None))`, and `AllIn` has no range at all, `None`.
    #[must_use]
    pub const fn range_pct(self) -> Option<(u16, Option<u16>)> {
        let edges = BUCKET_EDGES_PCT;
        match self {
            Bucket::Tiny => Some((0, Some(edges[0]))),
            Bucket::Small => Some((edges[0], Some(edges[1]))),
            Bucket::Medium => Some((edges[1], Some(edges[2]))),
            Bucket::Pot => Some((edges[2], Some(edges[3]))),
            Bucket::OverbetSmall => Some((edges[3], Some(edges[4]))),
            Bucket::OverbetLarge => Some((edges[4], None)),
            Bucket::AllIn => None,
        }
    }

    /// The bucket of an action at a node with the given pot: `AllIn` for an all-in, the
    /// size bucket for a bet or a raise, `None` for a fold, check, call, limp or straddle.
    /// An all-in needs no pot, so it never fails (ADR 0008).
    ///
    /// # Errors
    ///
    /// `ModelError::ZeroPot` for a bet or raise against an empty pot.
    pub fn of_action(action: ActionToken, pot: Cbb) -> Result<Option<Bucket>, ModelError> {
        match action {
            ActionToken::AllIn => Ok(Some(Bucket::AllIn)),
            ActionToken::Bet(size) | ActionToken::Raise(size) => bucket_for(size, pot).map(Some),
            ActionToken::Fold
            | ActionToken::Check
            | ActionToken::Call
            | ActionToken::Limp
            | ActionToken::Straddle(_) => Ok(None),
        }
    }
}

impl fmt::Display for Bucket {
    /// The kebab-case name, the same as `as_str`.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// The bucket of a bet size against the pot at the node, upper edge inclusive: the first
/// edge with `size * 100 <= pot * edge`, else `OverbetLarge` (ADR 0008). Never returns
/// `AllIn`; use `Bucket::of_action` for an action token.
///
/// # Errors
///
/// `ModelError::ZeroPot` when the pot is zero.
pub fn bucket_for(size: Cbb, pot: Cbb) -> Result<Bucket, ModelError> {
    if pot == Cbb::ZERO {
        return Err(ModelError::ZeroPot);
    }
    let size_x100 = u64::from(size.get()) * PERCENT;
    let pot = u64::from(pot.get());
    let bucket = BUCKET_EDGES_PCT
        .iter()
        .zip(BUCKET_AT_OR_BELOW_EDGE)
        .find(|(edge, _)| size_x100 <= pot * u64::from(**edge))
        .map_or(Bucket::OverbetLarge, |(_, bucket)| bucket);
    Ok(bucket)
}

#[cfg(test)]
mod tests {
    use super::{BUCKET_AT_OR_BELOW_EDGE, BUCKET_EDGES_PCT, Bucket};

    #[test]
    fn r2_3_ranges_are_contiguous_and_follow_the_edges() {
        let size_buckets = &Bucket::ALL[..6];
        let mut previous_upper = Some(0);
        for bucket in size_buckets {
            let (lower, upper) = bucket.range_pct().expect("size buckets have a range");
            assert_eq!(Some(lower), previous_upper, "{bucket}");
            previous_upper = upper;
        }
        assert_eq!(previous_upper, None);
        for (edge, bucket) in BUCKET_EDGES_PCT.iter().zip(BUCKET_AT_OR_BELOW_EDGE) {
            assert_eq!(bucket.range_pct().and_then(|(_, upper)| upper), Some(*edge));
        }
    }

    #[test]
    fn r2_3_display_matches_as_str_for_every_bucket() {
        for bucket in Bucket::ALL {
            assert_eq!(bucket.to_string(), bucket.as_str());
        }
    }
}
