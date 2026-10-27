//! Gate G6a, heads-up push/fold (R2.19, 04 section 6, O-63, O-220 to O-224).
//!
//! Mechanism. For every depth from 1 to 15 big blinds the gate solves push/fold exactly
//! (`gto_solve::preflop::solve_push_fold`) and judges three things: the best-response
//! certificate of each seat (at or below `CERTIFICATE_GAIN_BB`, O-223); the committed
//! library fixture against the recomputation (frequency within 1/255, EV exact as f32,
//! O-133); and, when a chart is given, every hand where the chart and the solution
//! disagree, each with its expected value (EV) gap, which must be at or below
//! `NEAR_INDIFFERENT_BB` (O-222). Without a chart (public CI, O-221) the chart part is
//! reported as run locally and the committed report carries its result.

use std::fmt;
use std::path::{Path, PathBuf};

use gto_solve::equity::EquityTable;
use gto_solve::preflop::SolvedPreflop;

use crate::fixtures::g6a_chart::Chart;
use crate::gates::GateReport;

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
    let _ = (equity, depths_bb);
    Err(G6aError::new("solve_depths is not implemented yet (S19 lane 1)"))
}

/// Packs `solutions` into library format under `out_root` through library-pack, one
/// solution per depth, ids deterministic from the dump (O-131); returns the prefixes.
///
/// # Errors
///
/// `G6aError` naming the depth whose dump or pack failed.
pub fn pack_library(
    solutions: &[SolvedPreflop],
    out_root: &Path,
    engine_version: &str,
) -> Result<Vec<PathBuf>, G6aError> {
    let _ = (solutions, out_root, engine_version);
    Err(G6aError::new("pack_library is not implemented yet (S19 lane 1)"))
}

/// Every hand where `chart` and `solutions` disagree, with its EV gap.
#[must_use]
pub fn compare(chart: &Chart, solutions: &[SolvedPreflop]) -> Vec<Disagreement> {
    let _ = (chart, solutions);
    Vec::new()
}

/// Runs the gate and builds its report.
///
/// # Errors
///
/// `G6aError` when a solve, the library read or the comparison cannot run.
pub fn run(input: &G6aInput<'_>) -> Result<GateReport, G6aError> {
    let _ = input;
    Err(G6aError::new("g6a::run is not implemented yet (S19 lane 1)"))
}
