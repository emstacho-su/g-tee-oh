//! R2.13 vectors for the grading floor (architecture decision record (ADR) 0004, O-22,
//! O-150): the precedence node accuracy, then manifest exploitability, then 0.02 big blinds
//! over the pot, never below the 0.2 percent noise floor, with the source named.

use gto_model::grading::{Floor, FloorSource, NOISE_FLOOR_PCT_POT, floor_pct_pot};
use gto_model::{Cbb, NOISE_FLOOR_PCT_POT_X100, PREFLOP_FLOOR_FALLBACK};

/// How close a floor must be to its expected value.
const TOLERANCE: f32 = 1e-6;

/// A pot of 3 bb, where the 0.02 bb fallback is two thirds of a percent.
const SMALL_POT: Cbb = Cbb(300);
/// A pot of 20 bb, where the 0.02 bb fallback is a tenth of a percent, under the noise floor.
const LARGE_POT: Cbb = Cbb(2_000);

fn assert_floor(floor: Floor, pct_pot: f32, source: FloorSource) {
    assert!((floor.pct_pot - pct_pot).abs() < TOLERANCE, "{floor:?} is not {pct_pot}");
    assert_eq!(floor.source, source, "{floor:?}");
}

#[test]
fn r2_13_noise_floor_is_the_x100_constant_over_100() {
    #[expect(clippy::cast_precision_loss, reason = "the constant is 20")]
    let expected = NOISE_FLOOR_PCT_POT_X100 as f32 / 100.0;
    assert_eq!(NOISE_FLOOR_PCT_POT.to_bits(), expected.to_bits());
    assert_eq!(NOISE_FLOOR_PCT_POT_X100, 20, "0.2 percent of the pot (ADR 0008)");
    assert_eq!(PREFLOP_FLOOR_FALLBACK, Cbb(2), "0.02 bb (O-22)");
}

#[test]
fn r2_13_floor_prefers_the_node_accuracy() {
    let floor = floor_pct_pot(SMALL_POT, Some(0.5), Some([0.3, 0.9]));
    assert_floor(floor, 0.5, FloorSource::NodeAccuracy);
    let alone = floor_pct_pot(LARGE_POT, Some(0.25), None);
    assert_floor(alone, 0.25, FloorSource::NodeAccuracy);
}

#[test]
fn r2_13_floor_takes_the_larger_seat_of_the_exploitability() {
    let floor = floor_pct_pot(SMALL_POT, None, Some([0.3, 0.45]));
    assert_floor(floor, 0.45, FloorSource::Exploitability);
    let reversed = floor_pct_pot(SMALL_POT, None, Some([0.45, 0.3]));
    assert_floor(reversed, 0.45, FloorSource::Exploitability);
}

#[test]
fn r2_13_floor_falls_back_to_0_02_bb_over_the_pot() {
    #[expect(clippy::cast_precision_loss, reason = "pots are far below 2^24 cbb")]
    let expected = PREFLOP_FLOOR_FALLBACK.get() as f32 / SMALL_POT.get() as f32 * 100.0;
    let floor = floor_pct_pot(SMALL_POT, None, None);
    assert_floor(floor, expected, FloorSource::FallbackBb);
    assert!(floor.pct_pot > NOISE_FLOOR_PCT_POT, "two thirds of a percent is above 0.2");
}

#[test]
fn r2_13_floor_never_drops_below_the_noise_floor() {
    let cases = [
        floor_pct_pot(LARGE_POT, Some(0.05), Some([0.9, 0.9])),
        floor_pct_pot(LARGE_POT, None, Some([0.1, 0.19])),
        floor_pct_pot(LARGE_POT, None, None),
        floor_pct_pot(Cbb::ZERO, None, None),
        floor_pct_pot(SMALL_POT, Some(-1.0), None),
    ];
    for floor in cases {
        assert_floor(floor, NOISE_FLOOR_PCT_POT, FloorSource::NoiseFloor);
    }
    let at_the_floor = floor_pct_pot(LARGE_POT, Some(NOISE_FLOOR_PCT_POT), None);
    assert_floor(at_the_floor, NOISE_FLOOR_PCT_POT, FloorSource::NodeAccuracy);
}

#[test]
fn r2_13_floor_source_serializes_to_its_contract_name() {
    for source in FloorSource::ALL {
        let json = serde_json::to_string(&source).expect("a source serializes");
        assert_eq!(json, format!("\"{}\"", source.as_str()));
        let back: FloorSource = serde_json::from_str(&json).expect("a source parses");
        assert_eq!(back, source);
    }
    assert_eq!(FloorSource::FallbackBb.as_str(), "fallback_bb");
}
