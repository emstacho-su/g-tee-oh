//! The unit boundary of the crate (O-136). The sizing convention spec keeps the units the
//! seed rows write: big blinds (bb), fractions of the pot, multipliers and percents, all as
//! JavaScript Object Notation (JSON) numbers. This module moves each value onto its integer
//! grid: bb to centi-big-blinds (cbb), fractions to basis points (bp), multipliers and
//! percents to hundredths.
//!
//! Mechanism: a value is scaled, rounded to the nearest integer, and kept only when the
//! scaled value sat within `GRID_TOLERANCE` of that integer, else `TreeError::OffGrid`
//! names the field. The tolerance absorbs the binary representation of a decimal such as
//! 0.33 (about 3,300.0000000000005 bp once scaled) and nothing more, so 0.33333 is refused.
//! Past this module every amount is an integer.

use crate::error::TreeError;
use crate::spec::{PostflopSpec, SizingConventionSpec};

/// How far a scaled value may sit from its integer and still count as on the grid.
const GRID_TOLERANCE: f64 = 1e-9;

/// cbb per bb.
const CBB_PER_BB: f64 = 100.0;

/// bp per whole pot.
const BP_PER_POT: f64 = 10_000.0;

/// Hundredths per unit, for multipliers and for percents (a percent in hundredths is bp).
const HUNDREDTHS: f64 = 100.0;

/// The largest percent a threshold may take: all of the stack.
const MAX_PERCENT: f64 = 100.0;

/// The preflop sizes of a spec on their grids.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct PreflopUnits {
    /// The open raise-to total in cbb.
    pub open_cbb: u32,
    /// The isolation raise base in cbb.
    pub iso_base_cbb: u32,
    /// The isolation raise amount per limper in cbb, zero or more.
    pub iso_per_limper_cbb: u32,
    /// The in-position 3-bet multiplier in hundredths.
    pub threebet_ip_x100: u32,
    /// The out-of-position 3-bet multiplier in hundredths.
    pub threebet_oop_x100: u32,
    /// The 4-bet multiplier in hundredths.
    pub fourbet_x100: u32,
    /// The straddle in cbb, when the spec names one.
    pub straddle_cbb: Option<u32>,
}

/// The postflop sizes of a spec on their grids, before the O-136 defaults apply.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct PostflopUnits {
    /// Bet sizes in bp of the pot for the flop, turn and river.
    pub bet_sizes: [Vec<u32>; 3],
    /// Raise sizes in bp per street, or `None` when the spec names none.
    pub raise_sizes: Option<[Vec<u32>; 3]>,
    /// The all-in threshold in bp of the stack behind, when the spec names one.
    pub allin_threshold_bp: Option<u32>,
}

/// The rounded integer of a finite value within the `u32` range, or `None` outside it.
#[allow(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    reason = "the value is rounded and checked to lie in 0..=u32::MAX before the cast"
)]
pub(crate) fn round_to_u32(value: f64) -> Option<u32> {
    let rounded = value.round();
    (rounded.is_finite() && (0.0..=f64::from(u32::MAX)).contains(&rounded))
        .then_some(rounded as u32)
}

/// `value * scale` as an integer, or the error naming `field`.
fn on_grid(field: &'static str, value: f64, scale: f64) -> Result<u32, TreeError> {
    if !value.is_finite() {
        return Err(TreeError::Spec(format!("{field} is {value}, which is not finite")));
    }
    let scaled = value * scale;
    let rounded = round_to_u32(scaled)
        .ok_or_else(|| TreeError::Spec(format!("{field} is {value}, which is out of range")))?;
    if (scaled - f64::from(rounded)).abs() > GRID_TOLERANCE {
        return Err(TreeError::OffGrid { field, value });
    }
    Ok(rounded)
}

/// A positive value on its grid; a value that is zero, negative or rounds to zero fails.
fn positive(field: &'static str, value: f64, scale: f64) -> Result<u32, TreeError> {
    if value.is_nan() || value <= 0.0 {
        return Err(TreeError::Spec(format!("{field} is {value}, which is not above zero")));
    }
    match on_grid(field, value, scale)? {
        0 => Err(TreeError::Spec(format!("{field} is {value}, which rounds to zero"))),
        units => Ok(units),
    }
}

/// An amount in bb above zero, as cbb.
pub(crate) fn positive_cbb(field: &'static str, bb: f64) -> Result<u32, TreeError> {
    positive(field, bb, CBB_PER_BB)
}

/// An amount in bb of zero or more, as cbb.
fn non_negative_cbb(field: &'static str, bb: f64) -> Result<u32, TreeError> {
    if bb.is_nan() || bb < 0.0 {
        return Err(TreeError::Spec(format!("{field} is {bb}, which is below zero")));
    }
    on_grid(field, bb, CBB_PER_BB)
}

/// A multiplier above 1, in hundredths.
fn multiplier_x100(field: &'static str, multiplier: f64) -> Result<u32, TreeError> {
    if multiplier.is_nan() || multiplier <= 1.0 {
        let reason = format!("{field} is {multiplier}, which is not above 1");
        return Err(TreeError::Spec(reason));
    }
    on_grid(field, multiplier, HUNDREDTHS)
}

/// Fractions of the pot above zero, as bp, in the order written.
fn fractions_bp(field: &'static str, fractions: &[f64]) -> Result<Vec<u32>, TreeError> {
    fractions.iter().map(|fraction| positive(field, *fraction, BP_PER_POT)).collect()
}

/// A percent above zero and at most 100, as bp.
fn percent_bp(field: &'static str, percent: f64) -> Result<u32, TreeError> {
    if percent > MAX_PERCENT {
        return Err(TreeError::Spec(format!("{field} is {percent}, which is above 100")));
    }
    positive(field, percent, HUNDREDTHS)
}

/// The preflop sizes of `spec` on their grids.
pub(crate) fn preflop_units(spec: &SizingConventionSpec) -> Result<PreflopUnits, TreeError> {
    let straddle_cbb = spec.straddle_bb.map(|bb| positive_cbb("straddle_bb", bb)).transpose()?;
    Ok(PreflopUnits {
        open_cbb: positive_cbb("open_bb", spec.open_bb)?,
        iso_base_cbb: positive_cbb("iso_rule.base_bb", spec.iso_rule.base_bb)?,
        iso_per_limper_cbb: non_negative_cbb(
            "iso_rule.per_limper_bb",
            spec.iso_rule.per_limper_bb,
        )?,
        threebet_ip_x100: multiplier_x100("threebet_ip", spec.threebet_ip)?,
        threebet_oop_x100: multiplier_x100("threebet_oop", spec.threebet_oop)?,
        fourbet_x100: multiplier_x100("fourbet", spec.fourbet)?,
        straddle_cbb,
    })
}

/// The postflop sizes of `postflop` on their grids.
pub(crate) fn postflop_units(postflop: &PostflopSpec) -> Result<PostflopUnits, TreeError> {
    let bet_sizes = [
        fractions_bp("postflop.flop", &postflop.flop)?,
        fractions_bp("postflop.turn", &postflop.turn)?,
        fractions_bp("postflop.river", &postflop.river)?,
    ];
    let raise_sizes = match &postflop.raise {
        Some(raise) => Some([
            fractions_bp("postflop.raise.flop", &raise.flop)?,
            fractions_bp("postflop.raise.turn", &raise.turn)?,
            fractions_bp("postflop.raise.river", &raise.river)?,
        ]),
        None => None,
    };
    let allin_threshold_bp = postflop
        .allin_threshold_pct
        .map(|percent| percent_bp("postflop.allin_threshold_pct", percent))
        .transpose()?;
    Ok(PostflopUnits { bet_sizes, raise_sizes, allin_threshold_bp })
}

#[cfg(test)]
mod tests {
    use super::{on_grid, round_to_u32};
    use crate::error::TreeError;

    #[test]
    fn r2_9_decimal_fractions_land_on_the_bp_grid() {
        assert_eq!(on_grid("f", 0.33, 10_000.0), Ok(3_300));
        assert_eq!(on_grid("f", 0.29, 10_000.0), Ok(2_900));
        assert_eq!(on_grid("f", 1.15, 100.0), Ok(115));
        let off = on_grid("f", 0.333_33, 10_000.0);
        assert_eq!(off, Err(TreeError::OffGrid { field: "f", value: 0.333_33 }));
    }

    #[test]
    fn r2_9_out_of_range_values_are_refused() {
        assert_eq!(round_to_u32(-1.0), None);
        assert_eq!(round_to_u32(f64::from(u32::MAX) + 1.0), None);
        assert_eq!(round_to_u32(f64::NAN), None);
        assert!(matches!(on_grid("f", f64::INFINITY, 1.0), Err(TreeError::Spec(_))));
        assert!(matches!(on_grid("f", 1e12, 100.0), Err(TreeError::Spec(_))));
    }
}
