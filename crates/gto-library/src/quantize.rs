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
//! Lane W (writer) owns this file.

#![allow(unused_variables, reason = "S14 red skeleton: lane W replaces the todo!() bodies")]

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

/// Quantizes one hand's action frequencies to bytes that sum to exactly 255, by the
/// largest-remainder method over `f / sum`.
///
/// # Errors
///
/// `LibraryError::Quantize` for an empty row, a value that is not finite, negative or above
/// one, or a row that sums to zero.
pub fn quantize_frequencies(row: &[f64]) -> Result<Vec<u8>, LibraryError> {
    todo!("lane W: largest-remainder quantization to 255")
}

/// Dequantizes one frequency row, renormalized so it sums to one.
#[must_use]
pub fn dequantize_frequencies(row: &[u8]) -> Vec<f32> {
    todo!("lane W: renormalized dequantization")
}

/// Quantizes a reach probability to 1/65535.
///
/// # Errors
///
/// `LibraryError::Quantize` when `p` is not finite or lies outside `[0, 1]`.
pub fn quantize_reach(p: f64) -> Result<u16, LibraryError> {
    todo!("lane W: reach at 1/65535")
}

/// The reach probability a quantized value stands for.
#[must_use]
pub fn dequantize_reach(q: u16) -> f32 {
    todo!("lane W: reach dequantization")
}

/// The loss of an action against the best one, in units of 0.01% of `pot`, rounded to the
/// nearest unit and saturating at `LOSS_SATURATED`.
///
/// # Errors
///
/// `LibraryError::Quantize` when either EV is not finite, when `ev_bb` exceeds
/// `ev_best_bb`, or when the pot is zero.
pub fn loss_units(ev_best_bb: f64, ev_bb: f64, pot: Cbb) -> Result<u16, LibraryError> {
    todo!("lane W: saturating loss units")
}

/// The loss in big blinds that `units` stand for at `pot`.
#[must_use]
pub fn loss_bb(units: u16, pot: Cbb) -> f32 {
    todo!("lane W: loss units to bb")
}
