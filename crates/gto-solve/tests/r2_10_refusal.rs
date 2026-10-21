//! R2.10 refusal test, in a binary of its own so its global allocator counts only this
//! test's heap.
//!
//! Mechanism: a problem with every combo in one range has an estimate of several
//! megabytes. The thread pool the engine forks onto is started first, since the estimate
//! reads its thread count, so its fixed allocations are not charged to the call. Solved
//! with a 1 KiB memory cap the problem must return `SolveError::OverMemoryCap` carrying
//! that estimate, and the peak heap growth during the call, measured with
//! `peak_alloc::PeakAlloc` from a reset just before it, must stay under 64 KiB: the call
//! built the betting skeleton and nothing of the engine game or the solver.

#[path = "r2_10_support/mod.rs"]
mod common;

use common::{IP_RANGE, flop_board, full_range, narrow_tree, problem_with, range};
use gto_solve::postflop::{
    NoProgress, SolveError, SolveOptions, StopRule, estimate_bytes, solve_postflop_with,
};
use peak_alloc::PeakAlloc;

#[global_allocator]
static PEAK: PeakAlloc = PeakAlloc;

/// The cap the problem is refused at.
const CAP_BYTES: u64 = 1024;
/// The most heap the refused call may grow by.
const MAX_GROWTH_BYTES: u64 = 64 * 1024;
/// The least the estimate must be, so the refusal is not of a trivially small problem.
const MIN_ESTIMATE_BYTES: u64 = 4 * 1024 * 1024;

const STOP: StopRule =
    StopRule { target_exploitability_pct_pot: 0.3, max_iterations: 100, max_seconds: 60 };

/// R2.10: a problem above the memory cap is refused before the engine game or the solver
/// is allocated.
#[test]
fn r2_10_problem_above_cap_refused_before_allocation() {
    let problem =
        problem_with(flop_board(common::DRY_FLOP), narrow_tree(), [full_range(), range(IP_RANGE)]);
    let estimate = estimate_bytes(&problem).expect("the estimate builds");
    assert!(estimate >= MIN_ESTIMATE_BYTES, "estimate {estimate} is too small to test");
    let options = SolveOptions { memory_cap_bytes: CAP_BYTES, ..SolveOptions::default() };
    rayon::broadcast(|_| ());

    let before = PEAK.current_usage() as u64;
    PEAK.reset_peak_usage();
    let result = solve_postflop_with(&problem, STOP, 0, &NoProgress, &options);
    let growth = PEAK.peak_usage() as u64 - before;

    println!("R2.10 refusal: estimate {estimate} bytes, heap growth {growth} bytes");
    assert_eq!(
        result.map(|(_, report)| report).unwrap_err(),
        SolveError::OverMemoryCap { estimate_bytes: estimate, cap_bytes: CAP_BYTES }
    );
    assert!(growth < MAX_GROWTH_BYTES, "the refused call grew the heap by {growth} bytes");
}
