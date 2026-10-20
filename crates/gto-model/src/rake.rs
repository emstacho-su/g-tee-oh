//! Rake models (R2.2, ADR 0014, extension E2 in 04 section 3). Online uses one profile.
//! Live rake follows the stake the user selects: 10 percent of the pot up to the cap that is
//! normal at that stake, with no flop no drop, so a hand that ends preflop pays nothing. The
//! dollar cap converts to centi-big-blinds (cbb) at the stake's big blind, rounded to the
//! nearest cbb: the 1/3 cap of $5 is 500 cents over a 300 cent big blind, 166.67 cbb, so
//! 167 cbb; the 2/5 cap defaults to $5 (O-2) and gives 100 cbb until the owner verifies it
//! (O-66). The two caps differ in big blinds either way, which is what R2.2 and criterion 11
//! rely on.
//!
//! The online profile is a placeholder until reconnaissance names the rake set (O-7): 5
//! percent capped at 3 big blinds, no flop no drop. It is one profile, and online
//! configurations never key on a dollar cap.
//!
//! The solver's own rake arithmetic lives in the vendored engine; this module is the one
//! place the catalog numbers and the conversion rule are written down (ADR 0004).
//!
//! Owner: the rake-and-buckets agent (files `rake.rs`, `buckets.rs` and `config.rs`).

#![allow(
    unused_variables,
    clippy::unused_self,
    reason = "stub bodies are todo!() until the rake-and-buckets agent fills them in"
)]

use crate::types::{Cbb, RakeModel, Stake, Street};

/// Live rake percent in basis points: 10 percent (ADR 0014).
pub const LIVE_RAKE_PERCENT_BP: u16 = 1_000;

/// The live 1/3 cap in cents: $5 (ADR 0014).
pub const LIVE_CAP_1_3_CENTS: u32 = 500;

/// The live 2/5 cap in cents: $5 by default until verified (O-2, O-66).
pub const LIVE_CAP_2_5_CENTS: u32 = 500;

/// The online profile's percent in basis points: 5 percent, a placeholder pending O-7.
pub const ONLINE_RAKE_PERCENT_BP: u16 = 500;

/// The online profile's cap in big blinds: 3, a placeholder pending O-7.
pub const ONLINE_CAP_BB: u32 = 3;

impl RakeModel {
    /// A live model: 10 percent to the cap, no flop no drop (ADR 0014).
    #[must_use]
    pub fn live(cap_cents: u32) -> RakeModel {
        todo!()
    }

    /// The one online profile at a stake: `ONLINE_RAKE_PERCENT_BP` capped at
    /// `ONLINE_CAP_BB` big blinds, expressed in cents of that stake's big blind, no flop no
    /// drop.
    #[must_use]
    pub fn online_profile(bb_cents: u32) -> RakeModel {
        todo!()
    }

    /// The cap in cbb at a big blind of `bb_cents`, rounded to the nearest cbb with halves
    /// rounding up: `cap_cents * 100 / bb_cents`.
    #[must_use]
    pub fn cap_cbb(self, bb_cents: u32) -> Cbb {
        todo!()
    }

    /// The rake taken from a pot when the hand ends on `terminal`: zero when no flop no
    /// drop applies and the hand ended preflop, otherwise the percent of the pot rounded to
    /// the nearest cbb (halves up), capped at `cap_cbb`.
    #[must_use]
    pub fn rake_cbb(self, pot: Cbb, bb_cents: u32, terminal: Street) -> Cbb {
        todo!()
    }
}

impl Stake {
    /// The rake cap in cbb at this stake.
    #[must_use]
    pub fn rake_cap_cbb(&self) -> Cbb {
        todo!()
    }

    /// The rake taken from a pot at this stake when the hand ends on `terminal`.
    #[must_use]
    pub fn rake_cbb(&self, pot: Cbb, terminal: Street) -> Cbb {
        todo!()
    }
}
