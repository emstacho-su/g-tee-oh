//! Gate G6a, heads-up push/fold (R2.19, 04 section 6, O-63, O-220 to O-224).
//!
//! Mechanism. For every depth from 1 to 15 big blinds the gate solves push/fold exactly
//! (`gto_solve::preflop::solve_push_fold`) and judges three things: the best-response
//! certificate of each seat (at or below `CERTIFICATE_GAIN_BB`, O-223); the committed
//! library fixture against the recomputation (frequency within 1/255, EV exact as f32,
//! O-133); and, when a chart is given, every hand where the chart and the solution
//! disagree, each with its expected value (EV) gap, which must be at or below
//! `NEAR_INDIFFERENT_BB` (O-222). Without a chart (public CI, O-221) the chart part is
//! reported as run locally and the committed report carries its result. The `library`
//! child module dumps, packs and checks the committed solutions; `notes` writes the
//! report's notes, which always name the chart and its parameters.

mod library;
mod notes;

use std::collections::BTreeMap;
use std::fmt;
use std::path::{Path, PathBuf};

use gto_model::Cbb;
use gto_solve::equity::EquityTable;
use gto_solve::preflop::{
    CERTIFICATE_GAIN_BB, PreflopError, SolvedClass, SolvedPreflop, push_fold_config,
    solve_push_fold,
};
use library_pack::export::FREQUENCY_TOLERANCE;

use crate::fixtures::g6a_chart::Chart;
use crate::gates::GateReport;
use crate::report::{Measurement, Threshold};
pub use library::{EXPORTED_AT, LibraryCheck, SEED};
pub use notes::{CHART_NAME, CHART_PARAMETERS, CHART_URL};

/// The unit of expected values and gains.
const BB: &str = "bb";

/// The unit of frequencies.
const FREQUENCY: &str = "frequency";

/// The unit of counts.
const COUNT: &str = "count";

/// Centi-big-blinds in one big blind, as a float.
const CBB_PER_BB: f64 = 100.0;

/// The action index of fold at both push/fold nodes.
const PASSIVE: usize = 0;

/// The action index of the all-in or the call.
const AGGRESSIVE: usize = 1;

/// A class is in (pushes or calls) when its aggressive frequency is at least this.
const MAJORITY: f64 = 0.5;

/// The report id and file stem.
pub const REPORT_ID: &str = "g6a-pushfold";

/// The requirement this gate closes.
pub const R_ID: &str = "R2.19";

/// The depths solved, in whole big blinds (O-220).
pub const DEPTHS_BB: [u32; 15] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

/// The largest EV gap, in big blinds, a chart disagreement may have to count as
/// near-indifferent (O-222, the O-22 preflop floor fallback).
pub const NEAR_INDIFFERENT_BB: f64 = 0.02;

/// Where the G6a solutions are committed, relative to the repository root.
pub const LIBRARY_RELATIVE_TO_REPO_ROOT: &str = "validation/fixtures/library";

/// The seat a chart row describes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Side {
    /// The small blind's push.
    Push,
    /// The big blind's call.
    Call,
}

/// One hand where the chart and the solution disagree.
#[derive(Debug, Clone, PartialEq)]
pub struct Disagreement {
    /// The depth in big blinds.
    pub depth_bb: u32,
    /// The class label.
    pub hand: String,
    /// Push or call.
    pub side: Side,
    /// The solution's frequency of the aggressive action (push or call).
    pub frequency: f64,
    /// The EV of the chart's action minus the EV of the solution's majority action, in
    /// big blinds (zero or negative at an equilibrium).
    pub ev_gap_bb: f64,
}

/// What one gate run reads.
#[derive(Debug, Clone, Copy)]
pub struct G6aInput<'a> {
    /// The 169 by 169 equity table (O-126).
    pub equity: &'a EquityTable,
    /// The library root holding the committed G6a solutions.
    pub library_root: &'a Path,
    /// The chart, when the local transcription is available (O-221).
    pub chart: Option<&'a Chart>,
    /// The depths to run; `DEPTHS_BB` for the gate, fewer in debug tests.
    pub depths_bb: &'a [u32],
}

/// Why the gate could not run (a failed rule is a report with `pass` false instead).
#[derive(Debug)]
pub struct G6aError {
    message: String,
}

impl G6aError {
    /// An error with `message`.
    #[must_use]
    pub fn new(message: impl Into<String>) -> Self {
        G6aError { message: message.into() }
    }
}

impl fmt::Display for G6aError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for G6aError {}

/// Solves push/fold exactly at every depth of `depths_bb`.
///
/// # Errors
///
/// `G6aError` naming the depth whose solve or certificate failed.
pub fn solve_depths(
    equity: &EquityTable,
    depths_bb: &[u32],
) -> Result<Vec<SolvedPreflop>, G6aError> {
    depths_bb
        .iter()
        .map(|depth| {
            let failed = |error: PreflopError| G6aError::new(format!("depth {depth} bb: {error}"));
            let config = push_fold_config(*depth).map_err(failed)?;
            solve_push_fold(&config, equity).map_err(failed)
        })
        .collect()
}

/// Packs `solutions` into library format under `out_root` through library-pack, one
/// solution per depth, ids deterministic from the dump (O-131); returns the prefixes.
/// The dump carries a fixed export time, seed 0, the CFR+ iterations and the gains as
/// percent of the starting pot (see the `library` child module).
///
/// # Errors
///
/// `G6aError` naming the depth whose dump or pack failed.
pub fn pack_library(
    solutions: &[SolvedPreflop],
    out_root: &Path,
    engine_version: &str,
) -> Result<Vec<PathBuf>, G6aError> {
    library::pack(solutions, out_root, engine_version)
}

/// Every hand where `chart` and `solutions` disagree, with its EV gap. The solution's
/// action is its majority action (the aggressive action when its frequency is at least
/// 0.5); the gap is the EV of the chart's action minus the EV of that action, read at
/// the push node for the push side and at the call node for the call side.
#[must_use]
pub fn compare(chart: &Chart, solutions: &[SolvedPreflop]) -> Vec<Disagreement> {
    solutions
        .iter()
        .flat_map(|solution| {
            let depth_cbb = solution.nodes.first().map_or(0, library::depth_cbb);
            let sides = [(Side::Push, solution.nodes.first()), (Side::Call, solution.nodes.get(1))];
            sides.into_iter().flat_map(move |(side, node)| {
                node.into_iter().flat_map(move |node| {
                    node.hands
                        .iter()
                        .filter_map(move |hand| disagreement(chart, depth_cbb, side, hand))
                })
            })
        })
        .collect()
}

/// The disagreement of one hand at one side, or `None` when the chart agrees or does not
/// know the hand.
fn disagreement(
    chart: &Chart,
    depth_cbb: u32,
    side: Side,
    hand: &SolvedClass,
) -> Option<Disagreement> {
    let label = hand.class.to_string();
    let depth = f64::from(depth_cbb) / CBB_PER_BB;
    let chart_in = match side {
        Side::Push => chart.pushes(&label, depth)?,
        Side::Call => chart.calls(&label, depth)?,
    };
    let frequency = *hand.frequencies.get(AGGRESSIVE)?;
    let ours_in = frequency >= MAJORITY;
    if chart_in == ours_in {
        return None;
    }
    let ev = |is_in: bool| hand.ev_bb.get(if is_in { AGGRESSIVE } else { PASSIVE }).copied();
    let ev_gap_bb = ev(chart_in)? - ev(ours_in)?;
    Some(Disagreement {
        depth_bb: depth_cbb / Cbb::PER_BB,
        hand: label,
        side,
        frequency,
        ev_gap_bb,
    })
}

/// Runs the gate and builds its report.
///
/// # Errors
///
/// `G6aError` when a solve, the library read or the comparison cannot run; a missing
/// committed solution is such an error.
pub fn run(input: &G6aInput<'_>) -> Result<GateReport, G6aError> {
    let solutions = solve_depths(input.equity, input.depths_bb)?;
    let checks = solutions
        .iter()
        .map(|solution| library::check(input.library_root, solution))
        .collect::<Result<Vec<_>, _>>()?;
    let mut measurements: Vec<Measurement> = input
        .depths_bb
        .iter()
        .zip(&solutions)
        .zip(&checks)
        .flat_map(|((depth, solution), check)| depth_measurements(*depth, solution, check))
        .collect();
    let disagreements = input.chart.map(|chart| compare(chart, &solutions)).unwrap_or_default();
    if input.chart.is_some() {
        let largest = disagreements.iter().map(|row| row.ev_gap_bb.abs()).fold(0.0, f64::max);
        let near = Threshold::at_most(NEAR_INDIFFERENT_BB, BB);
        measurements.push(Measurement::judged("chart/max-ev-gap", largest, BB, near));
        measurements.push(Measurement::informational(
            "chart/disagreements",
            count(disagreements.len()),
            COUNT,
        ));
    }
    let notes = notes::text(&notes::NotesInput {
        solutions: &solutions,
        depths_bb: input.depths_bb,
        library: &checks,
        chart: input.chart,
        disagreements: &disagreements,
    });
    let thresholds: BTreeMap<String, Threshold> = measurements
        .iter()
        .filter_map(|m| m.threshold.clone().map(|threshold| (m.id.clone(), threshold)))
        .collect();
    let pass = measurements.iter().filter(|m| m.threshold.is_some()).all(|m| m.pass == Some(true));
    Ok(GateReport {
        report: REPORT_ID.to_owned(),
        r_ids: vec![R_ID.to_owned()],
        pass,
        thresholds,
        measurements,
        notes,
    })
}

/// The measurements of one depth: the certificate and the library comparison, judged,
/// and the iterations, informational.
fn depth_measurements(
    depth: u32,
    solution: &SolvedPreflop,
    check: &LibraryCheck,
) -> Vec<Measurement> {
    let id = |what: &str| format!("depth-{depth}/{what}");
    let gain = solution.gains_bb.iter().copied().fold(f64::NEG_INFINITY, f64::max);
    vec![
        Measurement::judged(
            &id("certificate-gain"),
            gain,
            BB,
            Threshold::at_most(CERTIFICATE_GAIN_BB, BB),
        ),
        Measurement::judged(
            &id("library-frequency-diff"),
            check.max_frequency_diff,
            FREQUENCY,
            Threshold::at_most(FREQUENCY_TOLERANCE, FREQUENCY),
        ),
        Measurement::judged(
            &id("library-differences"),
            count(check.differences.len()),
            COUNT,
            Threshold::at_most(0.0, COUNT),
        ),
        Measurement::informational(&id("iterations"), f64::from(solution.iterations), COUNT),
    ]
}

/// A count as a report value.
fn count(n: usize) -> f64 {
    u32::try_from(n).map_or(f64::from(u32::MAX), f64::from)
}

#[cfg(test)]
mod tests;
