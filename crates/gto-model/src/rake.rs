//! Rake models (R2.2, architecture decision record (ADR) 0014, extension E2 in 04 section
//! 3). Online uses one profile. Live rake follows the stake the user selects: 10 percent of
//! the pot up to the cap that is normal at that stake, with no flop no drop, so a hand that
//! ends preflop pays nothing. The dollar cap converts to centi-big-blinds (cbb) at the
//! stake's big blind, rounded to the nearest cbb: the 1/3 cap of $5 is 500 cents over a 300
//! cent big blind, 166.67 cbb, so 167 cbb; the 2/5 cap defaults to $5 (O-2) and gives 100
//! cbb until the owner verifies it (O-66). The two caps differ in big blinds either way,
//! which is what R2.2 and criterion 11 rely on.
//!
//! The online profile is a placeholder until reconnaissance names the rake set (O-7): 5
//! percent capped at 3 big blinds, with no flop no drop off, so a hand that ends preflop
//! pays its percent. Those values mirror the database seed row (O-112), which is the
//! catalog of record until O-7 settles; the one online stake is labelled `online` and its
//! cap is 150 cents over a 50 cent big blind. It is one profile, and online
//! configurations never key on a dollar cap.
//!
//! Arithmetic is integer throughout. A percent of the pot is `pot * percent_bp / 10_000`
//! and a cap is `cap_cents * 100 / bb_cents`, each rounded to the nearest cbb with halves
//! rounding up, so 10 percent of 1,005 cbb is 101 and 10 percent of 1,004 cbb is 100.
//!
//! The solver's own rake arithmetic lives in the vendored engine; this module is the one
//! place the catalog numbers and the conversion rule are written down (ADR 0004).
//!
//! Owner: the rake-and-buckets agent (files `rake.rs`, `buckets.rs` and `config.rs`).

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

/// Whether the online profile drops no rake preflop: false in the seed row, a placeholder
/// pending O-7 (O-112). Live stakes are always true (ADR 0014).
pub const ONLINE_NO_FLOP_NO_DROP: bool = false;

/// Basis points in the whole pot: `percent_bp` of 10,000 is 100 percent.
const BASIS_POINTS_PER_WHOLE: u64 = 10_000;

impl RakeModel {
    /// A live model: 10 percent to the cap, no flop no drop (ADR 0014).
    #[must_use]
    pub const fn live(cap_cents: u32) -> RakeModel {
        RakeModel { percent_bp: LIVE_RAKE_PERCENT_BP, cap_cents, no_flop_no_drop: true }
    }

    /// The one online profile at a stake: `ONLINE_RAKE_PERCENT_BP` capped at
    /// `ONLINE_CAP_BB` big blinds, expressed in cents of that stake's big blind, and no flop
    /// no drop as `ONLINE_NO_FLOP_NO_DROP` (ADR 0014, O-7, O-112).
    ///
    /// # Panics
    ///
    /// When `ONLINE_CAP_BB * bb_cents` does not fit in a `u32`. The product is checked
    /// explicitly so the panic is defined in every build profile; a big blind that large is
    /// a caller bug rather than an input to report.
    #[must_use]
    pub const fn online_profile(bb_cents: u32) -> RakeModel {
        let Some(cap_cents) = ONLINE_CAP_BB.checked_mul(bb_cents) else {
            panic!("the online rake cap in cents overflowed a u32")
        };
        RakeModel {
            percent_bp: ONLINE_RAKE_PERCENT_BP,
            cap_cents,
            no_flop_no_drop: ONLINE_NO_FLOP_NO_DROP,
        }
    }

    /// The cap in cbb at a big blind of `bb_cents`, rounded to the nearest cbb with halves
    /// rounding up: `cap_cents * 100 / bb_cents` (ADR 0014). A cap beyond `u32::MAX` cbb
    /// saturates there.
    ///
    /// # Panics
    ///
    /// When `bb_cents` is zero: a cap in cents has no value in big blinds without a big
    /// blind. `Stake::new` rejects a zero big blind and serde reads a stake through it
    /// (O-111), so only a stake built as a struct literal can get here.
    #[must_use]
    pub fn cap_cbb(self, bb_cents: u32) -> Cbb {
        assert!(bb_cents > 0, "a rake cap needs a big blind above zero cents to convert to cbb");
        let cents_x100 = u64::from(self.cap_cents) * u64::from(Cbb::PER_BB);
        saturating_cbb(div_round_half_up(cents_x100, u64::from(bb_cents)))
    }

    /// The rake taken from a pot when the hand ends on `terminal`: zero when no flop no
    /// drop applies and the hand ended preflop, otherwise the percent of the pot rounded to
    /// the nearest cbb (halves up), capped at `cap_cbb` (ADR 0014).
    ///
    /// # Panics
    ///
    /// When `bb_cents` is zero, as `cap_cbb` does.
    #[must_use]
    pub fn rake_cbb(self, pot: Cbb, bb_cents: u32, terminal: Street) -> Cbb {
        if self.no_flop_no_drop && terminal == Street::Preflop {
            return Cbb::ZERO;
        }
        let pot_bp = u64::from(pot.get()) * u64::from(self.percent_bp);
        let percent = div_round_half_up(pot_bp, BASIS_POINTS_PER_WHOLE);
        let cap = u64::from(self.cap_cbb(bb_cents).get());
        saturating_cbb(percent.min(cap))
    }
}

impl Stake {
    /// The rake cap in cbb at this stake: `rake.cap_cbb(bb_cents)`.
    #[must_use]
    pub fn rake_cap_cbb(&self) -> Cbb {
        self.rake.cap_cbb(self.bb_cents)
    }

    /// The rake taken from a pot at this stake when the hand ends on `terminal`.
    #[must_use]
    pub fn rake_cbb(&self, pot: Cbb, terminal: Street) -> Cbb {
        self.rake.rake_cbb(pot, self.bb_cents, terminal)
    }
}

/// `numerator / denominator` rounded to the nearest integer with halves rounding up. Adding
/// half the denominator before the floor division does that: for an even denominator the
/// exact half rounds up, and for an odd one no exact half exists. The denominator must be
/// above zero; both callers guarantee it.
fn div_round_half_up(numerator: u64, denominator: u64) -> u64 {
    (numerator + denominator / 2) / denominator
}

/// A cbb count from 64-bit arithmetic, saturating at `u32::MAX` rather than truncating.
fn saturating_cbb(value: u64) -> Cbb {
    u32::try_from(value).map_or(Cbb(u32::MAX), Cbb)
}

#[cfg(test)]
mod tests {
    use super::{div_round_half_up, saturating_cbb};
    use crate::types::Cbb;

    #[test]
    fn r2_2_division_rounds_halves_up() {
        assert_eq!(div_round_half_up(3, 2), 2);
        assert_eq!(div_round_half_up(1, 2), 1);
        assert_eq!(div_round_half_up(4, 3), 1);
        assert_eq!(div_round_half_up(5, 3), 2);
        assert_eq!(div_round_half_up(50_000, 300), 167);
        assert_eq!(div_round_half_up(0, 7), 0);
    }

    #[test]
    fn r2_2_cbb_conversion_saturates() {
        assert_eq!(saturating_cbb(167), Cbb(167));
        assert_eq!(saturating_cbb(u64::from(u32::MAX) + 1), Cbb(u32::MAX));
    }
}
