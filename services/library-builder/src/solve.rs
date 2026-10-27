//! The solve of one preflop line (A2 section 3, ADR 0023): [`LineSolver`] is the seam
//! between the loop and `gto-solve`, so the loop's tests run with [`FakeSolver`] in
//! milliseconds while [`EngineSolver`] runs the real engine.
//!
//! [`EngineSolver::solve_line`], in order: `estimate_memory` on the problem; a refusal
//! above the job's memory cap before anything is allocated (`BuilderError::OverMemoryCap`,
//! O-187); `solve_postflop_with_estimate` inside a rayon pool of the job's thread count
//! (the engine uses the ambient pool, so this is how `cpu_share` reaches it); the exact
//! best response for both seats' gains (O-138); then `select_nodes` for the root street
//! and for each runout (O-174). The flop is solved with turn and river unknown and only
//! the drawn runouts are walked (ADR 0023). The exploitability check against the target is
//! the job's, not the solver's, so a fake gain exercises it too.

use gto_library::RunoutSpec;
use gto_solve::postflop::{
    NodeStrategy, PostflopProblem, ProgressSink, SolveOptions, SolveReport, StopRule,
};

use crate::error::BuilderError;

/// One line to solve.
#[derive(Clone, Debug)]
pub struct LineJob {
    /// The problem on the canonical flop.
    pub problem: PostflopProblem,
    /// The line's text, for example `r250.c`.
    pub line: String,
    /// The stop rule of this attempt.
    pub stop: StopRule,
    /// Storage and memory cap.
    pub options: SolveOptions,
    /// Solve threads.
    pub threads: usize,
    /// The runouts to walk, on the canonical flop.
    pub runouts: Vec<RunoutSpec>,
    /// The seed recorded with the solve.
    pub seed: u64,
}

/// One solved line, walked.
#[derive(Clone, Debug)]
pub struct SolvedLine {
    /// The adapter's report.
    pub report: SolveReport,
    /// Both seats' gains from the exact best response, percent of the pot.
    pub gains_pct_pot: [f64; 2],
    /// The root-street nodes.
    pub root_nodes: Vec<NodeStrategy>,
    /// Per runout, in `LineJob::runouts` order, its turn and river nodes.
    pub runout_nodes: Vec<(RunoutSpec, Vec<NodeStrategy>)>,
}

/// Solves and walks one line.
pub trait LineSolver: Send + Sync {
    /// Solves `job`, reporting progress to `sink`.
    ///
    /// # Errors
    ///
    /// `BuilderError::OverMemoryCap` for a refusal, `BuilderError::Solve` from the adapter.
    fn solve_line(
        &self,
        job: &LineJob,
        sink: &dyn ProgressSink,
    ) -> Result<SolvedLine, BuilderError>;
}

/// The real solver over the vendored engine.
#[derive(Clone, Copy, Debug, Default)]
pub struct EngineSolver;

impl LineSolver for EngineSolver {
    fn solve_line(
        &self,
        job: &LineJob,
        sink: &dyn ProgressSink,
    ) -> Result<SolvedLine, BuilderError> {
        let _ = (job, sink);
        Err(BuilderError::NotImplemented("EngineSolver::solve_line"))
    }
}

/// A solver for tests: it never runs the engine and returns a small, well-formed tree on
/// the job's flop (a root decision with check and one bet, then one turn node and one
/// river node per runout) over the live combos of the job's ranges, with the configured
/// gains, or the configured failure.
#[derive(Clone, Debug)]
pub struct FakeSolver {
    /// Both seats' gains to report.
    pub gains_pct_pot: [f64; 2],
    /// An estimate to report; above the job's cap the fake refuses like the engine.
    pub estimate_bytes: u64,
    /// When set, every call fails with `BuilderError::Solve` carrying this text.
    pub fail_with: Option<String>,
}

impl FakeSolver {
    /// A fake that converges to `gains_pct_pot` with a one-mebibyte estimate.
    #[must_use]
    pub fn converging(gains_pct_pot: [f64; 2]) -> FakeSolver {
        FakeSolver { gains_pct_pot, estimate_bytes: 1 << 20, fail_with: None }
    }
}

impl LineSolver for FakeSolver {
    fn solve_line(
        &self,
        job: &LineJob,
        sink: &dyn ProgressSink,
    ) -> Result<SolvedLine, BuilderError> {
        let _ = (job, sink);
        Err(BuilderError::NotImplemented("FakeSolver::solve_line"))
    }
}
