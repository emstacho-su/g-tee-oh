//! R2.7 quantization properties (A3 section 4): 8-bit frequencies at 1/255 with rows that
//! sum to 255, 16-bit reach at 1/65535 and 16-bit loss units of 0.01% of the pot that
//! saturate at 655.35%. The tolerances are the format's own: a frequency within 1/255 of
//! its share of the row, a loss within half a unit (0.005% of the pot), a reach within half
//! a step (1/131070). A small allowance for f32 rounding sits on top of each.
//!
//! Lane W (writer) owns this file.

use gto_library::quantize::{LOSS_SATURATED, LOSS_UNITS_PER_POT};
use gto_library::{
    dequantize_frequencies, dequantize_reach, loss_bb, loss_units, quantize_frequencies,
    quantize_reach,
};
use gto_model::Cbb;
use proptest::prelude::*;

/// Slack for the f32 a dequantized value is returned in.
const F32_SLACK: f64 = 1e-6;
/// Cbb in one big blind.
const CBB_PER_BB: f64 = 100.0;
/// The saturated loss as a share of the pot: 65,535 units of 1/10,000.
const SATURATED_SHARE: f64 = 6.5535;

/// A frequency row of one to eight entries with a positive sum.
fn frequency_row() -> impl Strategy<Value = Vec<f64>> {
    prop::collection::vec(0.0_f64..=1.0, 1..=8)
        .prop_filter("the row needs a positive sum", |row| row.iter().sum::<f64>() > 1e-9)
}

/// A pot from 0.01bb to 1,000bb.
fn pot() -> impl Strategy<Value = Cbb> {
    (1_u32..=100_000).prop_map(Cbb)
}

fn pot_bb(pot: Cbb) -> f64 {
    f64::from(pot.get()) / CBB_PER_BB
}

proptest! {
    #[test]
    fn r2_7_frequency_round_trip_within_one_255th(row in frequency_row()) {
        let sum: f64 = row.iter().sum();
        let quantized = quantize_frequencies(&row).expect("a valid row quantizes");
        let back = dequantize_frequencies(&quantized);
        prop_assert_eq!(back.len(), row.len());
        for (original, read) in row.iter().zip(&back) {
            let error = (f64::from(*read) - original / sum).abs();
            prop_assert!(error < 1.0 / 255.0 + F32_SLACK, "error {} on {:?}", error, row);
        }
    }

    #[test]
    fn r2_7_frequency_rows_sum_to_255(row in frequency_row()) {
        let quantized = quantize_frequencies(&row).expect("a valid row quantizes");
        let total: u32 = quantized.iter().map(|q| u32::from(*q)).sum();
        prop_assert_eq!(total, 255);
    }

    #[test]
    fn r2_7_dequantized_row_sums_to_one_within_1e_6(
        row in prop::collection::vec(any::<u8>(), 1..=8)
            .prop_filter("the row needs a positive sum", |row| row.iter().any(|q| *q > 0))
    ) {
        let total: f64 = dequantize_frequencies(&row).iter().map(|f| f64::from(*f)).sum();
        prop_assert!((total - 1.0).abs() <= 1e-6, "sum {} for {:?}", total, row);
    }

    #[test]
    fn r2_7_loss_round_trip_within_half_unit(
        pot in pot(),
        ev_best in -50.0_f64..50.0,
        share in 0.0_f64..7.0,
    ) {
        let loss = share * pot_bb(pot);
        let units = loss_units(ev_best, ev_best - loss, pot).expect("finite EVs quantize");
        if units < LOSS_SATURATED {
            let half_unit = 0.5 * pot_bb(pot) / f64::from(LOSS_UNITS_PER_POT);
            let error = (f64::from(loss_bb(units, pot)) - loss).abs();
            let slack = F32_SLACK * loss.max(1.0);
            prop_assert!(error <= half_unit + slack, "error {} above {}", error, half_unit);
        } else {
            let half_unit = 0.5 * pot_bb(pot) / f64::from(LOSS_UNITS_PER_POT);
            prop_assert!(loss >= SATURATED_SHARE * pot_bb(pot) - half_unit);
        }
    }

    #[test]
    fn r2_7_best_action_loss_is_exactly_zero(pot in pot(), ev in -50.0_f64..50.0) {
        prop_assert_eq!(loss_units(ev, ev, pot).expect("finite EVs quantize"), 0);
        // Bit equality: exactly +0.0, not merely close to it.
        prop_assert_eq!(loss_bb(0, pot).to_bits(), 0.0_f32.to_bits());
    }

    #[test]
    fn r2_7_loss_saturates_at_655_35_pct(pot in pot(), share in 6.5536_f64..100.0) {
        let loss = share * pot_bb(pot);
        prop_assert_eq!(loss_units(1.0, 1.0 - loss, pot).expect("finite EVs"), LOSS_SATURATED);
        let saturated = f64::from(loss_bb(LOSS_SATURATED, pot));
        let expected = SATURATED_SHARE * pot_bb(pot);
        prop_assert!((saturated - expected).abs() <= F32_SLACK * expected.max(1.0));
    }

    #[test]
    fn r2_7_reach_round_trip_within_1_131070th(p in 0.0_f64..=1.0) {
        let back = f64::from(dequantize_reach(quantize_reach(p).expect("p is in [0, 1]")));
        prop_assert!((back - p).abs() <= 1.0 / 131_070.0 + F32_SLACK, "{} read back {}", p, back);
    }
}

#[test]
fn r2_7_quantize_rejects_nan_negative_and_above_one() {
    for p in [f64::NAN, f64::INFINITY, -0.1, 1.0001] {
        assert!(quantize_reach(p).is_err(), "reach {p} must be rejected");
    }
    let bad_rows: [&[f64]; 6] =
        [&[], &[f64::NAN, 0.5], &[-0.1, 1.1], &[0.5, 1.5], &[0.0, 0.0], &[f64::INFINITY, 0.0]];
    for row in bad_rows {
        assert!(quantize_frequencies(row).is_err(), "row {row:?} must be rejected");
    }
    assert!(loss_units(f64::NAN, 0.0, Cbb(100)).is_err(), "a NaN best EV must be rejected");
    assert!(loss_units(1.0, f64::NAN, Cbb(100)).is_err(), "a NaN EV must be rejected");
    assert!(loss_units(0.0, 1.0, Cbb(100)).is_err(), "an EV above the best must be rejected");
    assert!(loss_units(1.0, 0.0, Cbb(0)).is_err(), "a zero pot must be rejected");
}
