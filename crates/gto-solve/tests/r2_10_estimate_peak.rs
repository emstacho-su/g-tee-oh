//! R2.10 allocator bound on the memory estimate (O-139), in a binary of its own so its
//! global allocator counts only this test's heap.
//!
//! Mechanism: `peak_alloc::PeakAlloc` wraps the system allocator and keeps the current
//! and the peak heap bytes. The thread pool the engine forks onto is started first, so its
//! fixed allocations are not charged to the solve; then the peak is reset to the current
//! bytes and the test spot is solved for 20 iterations, two of them measured, which
//! exercises the parallel traversal and the best-response walk. The growth of the peak
//! over the bytes held before the call is the measured peak. The estimate, taken for the
//! default storage the solve runs in (32-bit, O-194), must be at or above it, and at most
//! 1.3 times it.

#[path = "r2_10_support/mod.rs"]
mod common;

use gto_solve::postflop::{NoProgress, StopRule, StorageBits, estimate_memory, solve_postflop};
use peak_alloc::PeakAlloc;

#[global_allocator]
static PEAK: PeakAlloc = PeakAlloc;

/// The largest the estimate may be over the measured peak (O-139).
const MAX_OVERESTIMATE: f64 = 1.3;

/// Twenty iterations with a measurement every ten.
const TWENTY_ITERATIONS: StopRule =
    StopRule { target_exploitability_pct_pot: 0.0, max_iterations: 20, max_seconds: 120 };

#[allow(clippy::cast_precision_loss, reason = "a ratio of byte counts, read to a few digits")]
fn ratio(numerator: u64, denominator: u64) -> f64 {
    numerator as f64 / denominator as f64
}

/// R2.10 (O-139): the measured allocator peak of a solve is at or below `estimate_bytes`,
/// and the estimate is at most 1.3 times the peak.
#[test]
fn r2_10_estimate_bounds_allocator_peak() {
    let problem = common::small_problem();
    let estimate = estimate_memory(&problem, StorageBits::default()).expect("the estimate builds");
    rayon::broadcast(|_| ());

    let before = PEAK.current_usage() as u64;
    PEAK.reset_peak_usage();
    let solved = solve_postflop(&problem, TWENTY_ITERATIONS, 0, &NoProgress).expect("solves");
    let measured = PEAK.peak_usage() as u64 - before;
    drop(solved);

    println!(
        "R2.10 estimate {} bytes, measured peak {measured} bytes, ratio {:.4}; {estimate:?}",
        estimate.total_bytes,
        ratio(estimate.total_bytes, measured)
    );
    assert!(measured <= estimate.total_bytes, "peak {measured} above {estimate:?}");
    assert!(
        ratio(estimate.total_bytes, measured) <= MAX_OVERESTIMATE,
        "estimate {} over 1.3 times the peak {measured}",
        estimate.total_bytes
    );
}
