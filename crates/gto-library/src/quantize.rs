//! Quantization of the record's numbers (R2.7, A3 section 4).
//!
//! - Frequencies: one `u8` per action at 1/255, quantized by the largest-remainder method so
//!   a row always sums to exactly 255, and renormalized on read so a dequantized row sums to
//!   one.
//! - Reach: one `u16` per seat at 1/65535.
//! - Loss: how much expected value (EV) an action gives up against the best action, in
//!   0.01% of the pot (10,000 units per pot), saturating at 65,535 units (655.35% of the
//!   pot). The grading noise floor is 0.2% of the pot, so a 10 big blind (bb) pot needs
//!   0.02bb of resolution and one unit there is 0.001bb. The best action's loss is exactly 0.
//!
//! Quantizing a value read back gives the same bytes again, which is what makes a pack of a
//! read-back solution byte-identical to the first pack (O-133).
//!
//! Lane W (writer) owns this file.

use gto_model::Cbb;

use crate::error::LibraryError;

/// The quantized total of one frequency row.
pub const FREQUENCY_SCALE: u8 = u8::MAX;

/// The quantized value of a reach probability of one.
pub const REACH_SCALE: u16 = u16::MAX;

/// Loss units in one pot: one unit is 0.01% of the pot.
pub const LOSS_UNITS_PER_POT: u32 = 10_000;

/// The saturated loss, 655.35% of the pot; every larger loss is stored as this.
pub const LOSS_SATURATED: u16 = u16::MAX;

/// Centi-big-blinds (cbb) in one big blind, as a float for the loss arithmetic.
const CBB_PER_BB: f64 = 100.0;

/// Quantizes one hand's action frequencies to bytes that sum to exactly 255, by the
/// largest-remainder method over `f / sum`: every entry takes the floor of its share of 255,
/// then the entries with the largest remainders (the lower index first on ties) take one
/// more each until the row reaches 255.
///
/// # Errors
///
/// `LibraryError::Quantize` for an empty row, a value that is not finite, negative or above
/// one, or a row that sums to zero.
pub fn quantize_frequencies(row: &[f64]) -> Result<Vec<u8>, LibraryError> {
    if row.is_empty() {
        return Err(LibraryError::Quantize("a frequency row needs at least one action".into()));
    }
    if let Some(bad) = row.iter().find(|f| !is_probability(**f)) {
        return Err(LibraryError::Quantize(format!("frequency {bad} is not in [0, 1]")));
    }
    let sum: f64 = row.iter().sum();
    if sum <= 0.0 {
        return Err(LibraryError::Quantize("a frequency row sums to zero".into()));
    }
    let scaled: Vec<f64> = row.iter().map(|f| f / sum * f64::from(FREQUENCY_SCALE)).collect();
    let floors: Vec<u8> = scaled.iter().map(|s| floor_to_u8(*s)).collect();
    let assigned: u32 = floors.iter().map(|q| u32::from(*q)).sum();
    let deficit = u32::from(FREQUENCY_SCALE)
        .checked_sub(assigned)
        .and_then(|d| usize::try_from(d).ok())
        .filter(|d| *d <= row.len());
    let Some(deficit) = deficit else {
        return Err(LibraryError::Quantize(format!("row {row:?} does not share out 255")));
    };
    let remainder = |i: usize| scaled[i] - f64::from(floors[i]);
    let mut order: Vec<usize> = (0..row.len()).collect();
    order.sort_by(|&a, &b| remainder(b).total_cmp(&remainder(a)).then(a.cmp(&b)));
    let bumped = &order[..deficit];
    Ok(floors.iter().enumerate().map(|(i, q)| q + u8::from(bumped.contains(&i))).collect())
}

/// Dequantizes one frequency row, renormalized so it sums to one. A row of zeros, which no
/// writer produces and the record decoder rejects, reads back as zeros.
#[must_use]
pub fn dequantize_frequencies(row: &[u8]) -> Vec<f32> {
    let total: u32 = row.iter().map(|q| u32::from(*q)).sum();
    if total == 0 {
        return vec![0.0; row.len()];
    }
    row.iter().map(|q| to_f32(f64::from(*q) / f64::from(total))).collect()
}

/// Quantizes a reach probability to 1/65535, rounding to the nearest step.
///
/// # Errors
///
/// `LibraryError::Quantize` when `p` is not finite or lies outside `[0, 1]`.
pub fn quantize_reach(p: f64) -> Result<u16, LibraryError> {
    if !is_probability(p) {
        return Err(LibraryError::Quantize(format!("reach {p} is not in [0, 1]")));
    }
    Ok(round_to_u16(p * f64::from(REACH_SCALE)))
}

/// The reach probability a quantized value stands for.
#[must_use]
pub fn dequantize_reach(q: u16) -> f32 {
    to_f32(f64::from(q) / f64::from(REACH_SCALE))
}

/// The loss of an action against the best one, in units of 0.01% of `pot`, rounded to the
/// nearest unit and saturating at `LOSS_SATURATED`.
///
/// # Errors
///
/// `LibraryError::Quantize` when either EV is not finite, when `ev_bb` exceeds
/// `ev_best_bb`, or when the pot is zero.
pub fn loss_units(ev_best_bb: f64, ev_bb: f64, pot: Cbb) -> Result<u16, LibraryError> {
    if !ev_best_bb.is_finite() || !ev_bb.is_finite() {
        return Err(LibraryError::Quantize(format!(
            "expected values {ev_best_bb} and {ev_bb} must be finite"
        )));
    }
    if ev_bb > ev_best_bb {
        return Err(LibraryError::Quantize(format!(
            "expected value {ev_bb} is above the best action's {ev_best_bb}"
        )));
    }
    if pot == Cbb::ZERO {
        return Err(LibraryError::Quantize("a loss needs a pot above zero".into()));
    }
    let pot_bb = f64::from(pot.get()) / CBB_PER_BB;
    let units = ((ev_best_bb - ev_bb) / pot_bb * f64::from(LOSS_UNITS_PER_POT)).round();
    if units >= f64::from(LOSS_SATURATED) {
        return Ok(LOSS_SATURATED);
    }
    Ok(round_to_u16(units))
}

/// The loss in big blinds that `units` stand for at `pot`.
#[must_use]
pub fn loss_bb(units: u16, pot: Cbb) -> f32 {
    let pot_bb = f64::from(pot.get()) / CBB_PER_BB;
    to_f32(f64::from(units) * pot_bb / f64::from(LOSS_UNITS_PER_POT))
}

/// True for a finite number in `[0, 1]`.
fn is_probability(p: f64) -> bool {
    p.is_finite() && (0.0..=1.0).contains(&p)
}

/// The floor of `x`, clamped to `[0, 255]`; callers pass values already in that range.
#[allow(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    reason = "clamped to the u8 range just before the cast"
)]
fn floor_to_u8(x: f64) -> u8 {
    x.floor().clamp(0.0, f64::from(u8::MAX)) as u8
}

/// `x` rounded to the nearest integer, clamped to `[0, 65535]`.
#[allow(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    reason = "clamped to the u16 range just before the cast"
)]
fn round_to_u16(x: f64) -> u16 {
    x.round().clamp(0.0, f64::from(u16::MAX)) as u16
}

/// `x` as the nearest `f32`, the precision the record stores.
#[allow(clippy::cast_possible_truncation, reason = "f32 is the stored precision")]
fn to_f32(x: f64) -> f32 {
    x as f32
}
