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

use std::sync::mpsc;

use gto_library::RunoutSpec;
use gto_solve::postflop::{
    NodeSelection, NodeStrategy, PostflopProblem, ProgressSink, SolveError, SolveOptions,
    SolveReport, StopRule, best_response, estimate_memory, select_nodes,
    solve_postflop_with_estimate,
};

use crate::error::BuilderError;

mod fake;
#[cfg(test)]
mod tests;

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
    /// The pool is built first so the estimate counts its threads (the estimate's
    /// traversal scratch is per worker thread); the estimate and the refusal still come
    /// before the engine allocates anything. The solve runs on a scoped thread inside the
    /// pool while this thread forwards its progress to `sink`, because `sink` need not be
    /// shared across threads.
    fn solve_line(
        &self,
        job: &LineJob,
        sink: &dyn ProgressSink,
    ) -> Result<SolvedLine, BuilderError> {
        let pool =
            rayon::ThreadPoolBuilder::new().num_threads(job.threads).build().map_err(|err| {
                SolveError::Engine(format!("a pool of {} solve threads: {err}", job.threads))
            })?;
        std::thread::scope(|scope| {
            let (sender, receiver) = mpsc::channel();
            let worker = scope.spawn(|| {
                let forward = Forward { sender };
                pool.install(|| solve_in_pool(job, &forward))
            });
            for event in receiver {
                match event {
                    Progress::Report(iteration, gains) => sink.report(iteration, gains),
                    Progress::Finished(report) => sink.finished(&report),
                }
            }
            worker.join().map_err(|_| {
                BuilderError::Solve(SolveError::Engine(format!(
                    "the solve of line {} panicked",
                    job.line
                )))
            })?
        })
    }
}

/// One progress event of a solve running on another thread.
enum Progress {
    Report(u32, Option<[f32; 2]>),
    Finished(SolveReport),
}

/// A progress sink that sends every event to the thread that owns the caller's sink. A
/// send fails only when that thread stopped listening, and then the event has no reader.
struct Forward {
    sender: mpsc::Sender<Progress>,
}

impl ProgressSink for Forward {
    fn report(&self, iteration: u32, exploitability_pct_pot: Option<[f32; 2]>) {
        if self.sender.send(Progress::Report(iteration, exploitability_pct_pot)).is_err() {
            tracing::debug!(iteration, "solve progress after the listener stopped");
        }
    }

    fn finished(&self, report: &SolveReport) {
        if self.sender.send(Progress::Finished(*report)).is_err() {
            tracing::debug!("a solve report after the listener stopped");
        }
    }
}

/// The estimate, the refusal above the cap (O-187), the solve, the exact best response
/// (O-138) and the walks (O-174), all on a thread of the job's pool.
fn solve_in_pool(job: &LineJob, sink: &dyn ProgressSink) -> Result<SolvedLine, BuilderError> {
    let estimate = estimate_memory(&job.problem, job.options.storage)?;
    if estimate.total_bytes > job.options.memory_cap_bytes {
        return Err(BuilderError::OverMemoryCap {
            line: job.line.clone(),
            estimate_bytes: estimate.total_bytes,
            cap_bytes: job.options.memory_cap_bytes,
        });
    }
    let (solved, report) = solve_postflop_with_estimate(
        &job.problem,
        &estimate,
        job.stop,
        job.seed,
        sink,
        &job.options,
    )?;
    let gains_pct_pot = best_response(&solved).gain_pct_pot;
    let root_nodes = select_nodes(&solved, &NodeSelection::RootStreet)?;
    let runout_nodes = job
        .runouts
        .iter()
        .map(|runout| {
            let selection = NodeSelection::Runout { turn: runout.turn, river: runout.river };
            Ok((*runout, select_nodes(&solved, &selection)?))
        })
        .collect::<Result<Vec<_>, BuilderError>>()?;
    Ok(SolvedLine { report, gains_pct_pot, root_nodes, runout_nodes })
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
        if self.estimate_bytes > job.options.memory_cap_bytes {
            return Err(BuilderError::OverMemoryCap {
                line: job.line.clone(),
                estimate_bytes: self.estimate_bytes,
                cap_bytes: job.options.memory_cap_bytes,
            });
        }
        if let Some(text) = &self.fail_with {
            return Err(BuilderError::Solve(SolveError::Engine(text.clone())));
        }
        let solved = fake::solved_line(job, self.gains_pct_pot, self.estimate_bytes)?;
        sink.finished(&solved.report);
        Ok(solved)
    }
}
