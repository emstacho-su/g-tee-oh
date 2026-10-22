//! The grading floor (R2.13, architecture decision record (ADR) 0004, O-22, O-150): the
//! loss in percent of the pot below which a decision counts as within solver noise. It lives
//! here, beside the constants it reads, so that solver-query (S16) and the S29 recompute
//! (O-60) call one function and TypeScript computes nothing (ADR 0004).
//!
//! Precedence (O-150): the node's own accuracy when the record carries one, else the
//! manifest's exploitability (the larger of the two seats), else `PREFLOP_FLOOR_FALLBACK`
//! (0.02 big blinds) as a percent of the pot; and never below `NOISE_FLOOR_PCT_POT`, the 0.2
//! percent of ADR 0008. The answer names which term set it, so a grade can report its
//! `floor_source`. A zero pot has no percent, so the fallback term is skipped there and the
//! noise floor applies.
//!
//! The floor is reported raw beside the raw loss; the grading policy applies
//! `max(0, loss - floor)` (A6 section 4, R3.8) and nothing here clamps.

use std::fmt;

use serde::{Deserialize, Serialize};

use crate::types::{Cbb, NOISE_FLOOR_PCT_POT_X100, PREFLOP_FLOOR_FALLBACK};

/// Loss units per percent of the pot: A3 section 4 stores a loss in units of 0.01 percent.
const UNITS_PER_PCT: f32 = 100.0;

/// Percent in a whole, for a share of the pot written as a percent.
const PCT_PER_WHOLE: f32 = 100.0;

/// The noise floor in percent of the pot: `NOISE_FLOOR_PCT_POT_X100` over 100, that is 0.2
/// (O-22).
#[expect(clippy::cast_precision_loss, reason = "the constant is 20")]
pub const NOISE_FLOOR_PCT_POT: f32 = NOISE_FLOOR_PCT_POT_X100 as f32 / UNITS_PER_PCT;

/// Which term of the O-150 precedence set the floor.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FloorSource {
    /// The 0.2 percent noise floor was the largest term.
    NoiseFloor,
    /// The record's own accuracy was the largest term.
    NodeAccuracy,
    /// The manifest's exploitability (the larger seat) was the largest term.
    Exploitability,
    /// No accuracy was known, so 0.02 bb over the pot was the largest term.
    FallbackBb,
}

impl FloorSource {
    /// Every source, in precedence order after the noise floor.
    pub const ALL: [FloorSource; 4] = [
        FloorSource::NoiseFloor,
        FloorSource::NodeAccuracy,
        FloorSource::Exploitability,
        FloorSource::FallbackBb,
    ];

    /// The lowercase name the contract carries: `noise_floor`, `node_accuracy`,
    /// `exploitability`, `fallback_bb`.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            FloorSource::NoiseFloor => "noise_floor",
            FloorSource::NodeAccuracy => "node_accuracy",
            FloorSource::Exploitability => "exploitability",
            FloorSource::FallbackBb => "fallback_bb",
        }
    }
}

impl fmt::Display for FloorSource {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// The floor at a node and the term that set it.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Floor {
    /// The floor in percent of the pot, never below `NOISE_FLOOR_PCT_POT`.
    pub pct_pot: f32,
    /// Which term set it.
    pub source: FloorSource,
}

/// The floor of a node with `pot` (the total pot at the node in cbb) by the O-150
/// precedence: `accuracy_pct_pot` when the record carries one, else the larger seat of
/// `exploitability_pct_pot` when the manifest carries one, else `PREFLOP_FLOOR_FALLBACK` over
/// the pot as a percent; the noise floor whenever that term is below it, or when the pot is
/// zero and no accuracy is known. A term that is not a number (NaN) is treated as below
/// the noise floor.
#[must_use]
pub fn floor_pct_pot(
    pot: Cbb,
    accuracy_pct_pot: Option<f32>,
    exploitability_pct_pot: Option<[f64; 2]>,
) -> Floor {
    let term = match (accuracy_pct_pot, exploitability_pct_pot) {
        (Some(accuracy), _) => Some((accuracy, FloorSource::NodeAccuracy)),
        (None, Some(seats)) => Some((larger_seat(seats), FloorSource::Exploitability)),
        (None, None) => fallback_pct_pot(pot).map(|pct| (pct, FloorSource::FallbackBb)),
    };
    match term {
        Some((pct_pot, source)) if pct_pot >= NOISE_FLOOR_PCT_POT => Floor { pct_pot, source },
        _ => Floor { pct_pot: NOISE_FLOOR_PCT_POT, source: FloorSource::NoiseFloor },
    }
}

/// The larger seat's exploitability, narrowed to the record's precision.
fn larger_seat(seats: [f64; 2]) -> f32 {
    #[expect(clippy::cast_possible_truncation, reason = "a percent of the pot fits an f32")]
    let larger = seats[0].max(seats[1]) as f32;
    larger
}

/// `PREFLOP_FLOOR_FALLBACK` as a percent of `pot`; `None` at a zero pot, which has no percent.
fn fallback_pct_pot(pot: Cbb) -> Option<f32> {
    if pot == Cbb::ZERO {
        return None;
    }
    #[expect(clippy::cast_precision_loss, reason = "pots are far below 2^24 cbb")]
    let pct = PREFLOP_FLOOR_FALLBACK.get() as f32 / pot.get() as f32 * PCT_PER_WHOLE;
    Some(pct)
}

#[cfg(test)]
mod tests {
    use super::{FloorSource, NOISE_FLOOR_PCT_POT, floor_pct_pot};
    use crate::types::Cbb;

    #[test]
    fn r2_13_floor_source_display_matches_as_str() {
        for source in FloorSource::ALL {
            assert_eq!(source.to_string(), source.as_str());
        }
    }

    #[test]
    fn r2_13_floor_treats_a_nan_term_as_below_the_noise_floor() {
        let floor = floor_pct_pot(Cbb(1_000), Some(f32::NAN), None);
        assert_eq!(floor.pct_pot.to_bits(), NOISE_FLOOR_PCT_POT.to_bits());
        assert_eq!(floor.source, FloorSource::NoiseFloor);
    }
}
