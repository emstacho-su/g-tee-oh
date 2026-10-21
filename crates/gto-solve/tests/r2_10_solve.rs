//! R2.10 solve tests: the small flop test spot reaches 0.3 percent of the pot, solves are
//! deterministic, the iteration and time caps stop a solve, and the best response is the
//! exact difference of the engine's two values whatever the rake.
//!
//! The figures printed by `r2_10_small_flop_solve_reaches_target` are a test spot, not
//! evidence for the O-50 rule, which S18 and S20 measure on real flop lines.

#[path = "r2_10_support/mod.rs"]
mod common;

use std::cell::{Cell, RefCell};

use common::small_problem;
use gto_solve::postflop::{
    DEFAULT_MEASURE_EVERY, NoProgress, ProgressSink, SolveError, SolveOptions, SolveReport,
    StopReason, StopRule, StorageBits, best_response, solve_postflop, solve_postflop_with,
};

/// Plan section D: 0.3 percent of the pot within 2,000 iterations. The time cap is 300
/// seconds rather than the plan's 120: the 190 iterations the spot needs took 108 seconds
/// in a debug test build with the sibling solves of this binary sharing the machine, and a
/// cap that a loaded machine can cross would make the gate flaky.
const TARGET_PCT_POT: f32 = 0.3;
const TARGET_STOP: StopRule = StopRule {
    target_exploitability_pct_pot: TARGET_PCT_POT,
    max_iterations: 2_000,
    max_seconds: 300,
};

/// A sink that records every call.
#[derive(Default)]
struct Recorder {
    reports: RefCell<Vec<(u32, Option<[f32; 2]>)>>,
    finished: Cell<u32>,
}

impl ProgressSink for Recorder {
    fn report(&self, iteration: u32, exploitability_pct_pot: Option<[f32; 2]>) {
        self.reports.borrow_mut().push((iteration, exploitability_pct_pot));
    }

    fn finished(&self, _report: &SolveReport) {
        self.finished.set(self.finished.get() + 1);
    }
}

impl Recorder {
    /// Every iteration from 1 was reported once, in order, measured exactly every
    /// `DEFAULT_MEASURE_EVERY` iterations.
    fn assert_in_order(&self, iterations: u32) {
        let reports = self.reports.borrow();
        assert_eq!(reports.len(), iterations as usize);
        for (expected, (iteration, measured)) in (1..=iterations).zip(reports.iter()) {
            assert_eq!(*iteration, expected);
            assert_eq!(measured.is_some(), expected % DEFAULT_MEASURE_EVERY == 0, "{expected}");
        }
    }
}

/// R2.10: the small flop solve stops on the target with both gains at or below 0.3
/// percent of the pot, in 16-bit storage, telling the sink every iteration in order.
#[test]
fn r2_10_small_flop_solve_reaches_target() {
    let problem = small_problem();
    let sink = Recorder::default();
    let (solved, report) = solve_postflop(&problem, TARGET_STOP, 7, &sink).expect("solves");
    println!("R2.10 small flop solve: {report:?}");
    assert_eq!(report.stop_reason, StopReason::Target, "{report:?}");
    assert!(report.exploitability_pct_pot.iter().all(|&gain| gain <= TARGET_PCT_POT));
    assert_eq!(report.storage, StorageBits::Sixteen);
    assert_eq!(solved.storage(), StorageBits::Sixteen);
    assert_eq!(report.tree_hash, gto_tree::tree_hash(&problem.tree));
    assert_eq!(solved.engine_tree_hash().expect("maps back"), report.tree_hash);
    assert_eq!(solved.seed(), 7);
    assert_eq!(u64::from(report.iterations), solved.iterations());
    assert!(report.peak_bytes > 0 && report.peak_bytes <= report.estimate_bytes);
    sink.assert_in_order(report.iterations);
    let last = sink.reports.borrow().last().copied();
    assert_eq!(last, Some((report.iterations, Some(report.exploitability_pct_pot))));
    assert_eq!(sink.finished.get(), 1);
}

/// R2.10: two solves of one problem give the same report figures and the same root
/// strategy bit for bit, whatever the seed.
#[test]
fn r2_10_solve_is_deterministic() {
    let problem = small_problem();
    let stop =
        StopRule { target_exploitability_pct_pot: 0.0, max_iterations: 30, max_seconds: 120 };
    let (first, a) = solve_postflop(&problem, stop, 1, &NoProgress).expect("solves");
    let (second, b) = solve_postflop(&problem, stop, 2, &NoProgress).expect("solves");
    assert_eq!((a.iterations, a.exploitability_pct_pot), (b.iterations, b.exploitability_pct_pot));
    let bits = |strategy: Vec<f32>| strategy.into_iter().map(f32::to_bits).collect::<Vec<u32>>();
    assert_eq!(bits(first.root_strategy()), bits(second.root_strategy()));
}

/// R2.10: an unreachable target stops at the iteration cap, measured on the last
/// iteration even off the measuring interval, and at the time cap.
#[test]
fn r2_10_iteration_and_time_caps_stop() {
    let problem = small_problem();
    let capped =
        StopRule { target_exploitability_pct_pot: 0.0, max_iterations: 7, max_seconds: 120 };
    let sink = Recorder::default();
    let (_, report) = solve_postflop(&problem, capped, 0, &sink).expect("solves");
    assert_eq!((report.stop_reason, report.iterations), (StopReason::MaxIterations, 7));
    assert!(report.exploitability_pct_pot.iter().all(|&gain| gain > 0.0));
    sink.assert_in_order(7);

    let timed =
        StopRule { target_exploitability_pct_pot: 0.0, max_iterations: u32::MAX, max_seconds: 1 };
    let (_, report) = solve_postflop(&problem, timed, 0, &NoProgress).expect("solves");
    assert_eq!(report.stop_reason, StopReason::MaxSeconds, "{report:?}");
    assert!(report.seconds >= 1.0 && report.iterations >= 1, "{report:?}");
}

/// R2.10 (O-138): the gain is best response minus expected value exactly, never below
/// -1e-4 big blinds in this raked game, as a percent of the 5.5 big blind pot; the
/// uniform profile, before any iteration, gains for both players.
#[test]
fn r2_10_best_response_is_exact_and_rake_safe() {
    let problem = small_problem();
    let stop =
        StopRule { target_exploitability_pct_pot: 0.0, max_iterations: 50, max_seconds: 120 };
    let (solved, _) = solve_postflop(&problem, stop, 0, &NoProgress).expect("solves");
    let response = best_response(&solved);
    for player in 0..2 {
        let gain = response.best_response_bb[player] - response.expected_value_bb[player];
        assert_eq!(response.gain_bb[player].to_bits(), gain.to_bits());
        assert!(response.gain_bb[player] >= -1e-4, "{response:?}");
        let pct = 100.0 * response.gain_bb[player] / 5.5;
        assert!((response.gain_pct_pot[player] - pct).abs() < 1e-9, "{response:?}");
    }

    let uniform =
        StopRule { target_exploitability_pct_pot: 0.0, max_iterations: 0, max_seconds: 120 };
    let (untouched, report) = solve_postflop(&problem, uniform, 0, &NoProgress).expect("builds");
    assert_eq!((report.iterations, report.stop_reason), (0, StopReason::MaxIterations));
    let response = best_response(&untouched);
    assert!(response.gain_bb.iter().all(|&gain| gain > 0.0), "{response:?}");
}

/// R2.10: stop rules and options that could never stop, or never measure, are refused.
#[test]
fn r2_10_invalid_stop_rules_are_refused() {
    let problem = small_problem();
    let bad_rules = [
        StopRule { target_exploitability_pct_pot: f32::NAN, ..TARGET_STOP },
        StopRule { target_exploitability_pct_pot: -1.0, ..TARGET_STOP },
        StopRule { max_seconds: 0, ..TARGET_STOP },
    ];
    for rule in bad_rules {
        let result = solve_postflop(&problem, rule, 0, &NoProgress).map(|(_, report)| report);
        assert!(matches!(result, Err(SolveError::Problem(_))), "{rule:?}: {result:?}");
    }
    let options = SolveOptions { measure_every: 0, ..SolveOptions::default() };
    let result =
        solve_postflop_with(&problem, TARGET_STOP, 0, &NoProgress, &options).map(|(_, r)| r);
    assert!(matches!(result, Err(SolveError::Problem(_))), "{result:?}");
}
