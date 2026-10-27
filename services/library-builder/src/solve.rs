//! The solve of one preflop line (A2 section 3, ADR 0023): [`LineSolver`] is the seam
//! between the loop and `gto-solve`, so the loop's tests run with [`FakeSolver`] in
//! milliseconds while [`EngineSolver`] runs the real engine.
//!
//! [`EngineSolver::solve_line`], in order: `estimate_memory` on the problem; a refusal
//! when that estimate plus the walk of one runout ([`runout_walk_bytes`]) is above the
//! job's memory cap, before anything is allocated (`BuilderError::OverMemoryCap`, O-187,
//! whose `estimate_bytes` is that sum); `solve_postflop_with_estimate` inside a rayon pool
//! of the job's thread count (the engine uses the ambient pool, so this is how
//! `cpu_share` reaches it); the exact best response for both seats' gains (O-138); then
//! `select_nodes` for the root street and for each runout (O-174). The flop is solved with
//! turn and river unknown and only the drawn runouts are walked (ADR 0023). The
//! exploitability check against the target is the job's, not the solver's, so a fake gain
//! exercises it too.
//!
//! Bounded memory. A solver hands its walk to a [`LineWalk`] piece by piece: first the
//! report, the gains and the root-street nodes, then each runout's nodes by value, and it
//! walks the next runout only after the previous call returned. A walk that writes and
//! drops each piece (the job's) therefore holds at most one runout beside the solved game.

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
mod walk_memory;

pub use self::walk_memory::{WALK_BYTES_PER_ENTRY, WALK_BYTES_PER_NODE, runout_walk_bytes};

/// One line to solve.
#[derive(Clone, Debug)]
pub struct LineJob {
    /// The problem on the canonical flop, ranges in the canonical flop's labels.
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

/// The head of one solved line: everything but its runouts.
#[derive(Clone, Debug)]
pub struct SolvedLine {
    /// The adapter's report.
    pub report: SolveReport,
    /// Both seats' gains from the exact best response, percent of the pot.
    pub gains_pct_pot: [f64; 2],
    /// The root-street nodes.
    pub root_nodes: Vec<NodeStrategy>,
}

/// Receives the walk of one solved line, one piece at a time (module docs).
pub trait LineWalk: Send {
    /// The line's head, before any runout is walked. An error stops the walk and the
    /// solver returns it.
    ///
    /// # Errors
    ///
    /// Whatever the walk refuses, for example a gain above the target.
    fn root(&mut self, solved: SolvedLine) -> Result<(), BuilderError>;

    /// One runout's turn and river nodes, in `LineJob::runouts` order. The solver walks
    /// the next runout only after this returns.
    ///
    /// # Errors
    ///
    /// Whatever the walk fails with; the solver stops and returns it.
    fn runout(&mut self, runout: RunoutSpec, nodes: Vec<NodeStrategy>) -> Result<(), BuilderError>;
}

/// A walk that keeps every piece in memory, for tests and small lines only: it holds every
/// runout at once, which is what the job's own walk avoids.
#[derive(Clone, Debug, Default)]
pub struct CollectWalk {
    /// The head, once walked.
    pub head: Option<SolvedLine>,
    /// Every runout walked, in order.
    pub runouts: Vec<(RunoutSpec, Vec<NodeStrategy>)>,
}

impl LineWalk for CollectWalk {
    fn root(&mut self, solved: SolvedLine) -> Result<(), BuilderError> {
        self.head = Some(solved);
        Ok(())
    }

    fn runout(&mut self, runout: RunoutSpec, nodes: Vec<NodeStrategy>) -> Result<(), BuilderError> {
        self.runouts.push((runout, nodes));
        Ok(())
    }
}

/// Solves and walks one line.
pub trait LineSolver: Send + Sync {
    /// Solves `job`, reporting progress to `sink` and handing the walk to `walk`.
    ///
    /// # Errors
    ///
    /// `BuilderError::OverMemoryCap` for a refusal, `BuilderError::Solve` from the adapter,
    /// and any error `walk` returns.
    fn solve_line(
        &self,
        job: &LineJob,
        sink: &dyn ProgressSink,
        walk: &mut dyn LineWalk,
    ) -> Result<(), BuilderError>;
}

/// The real solver over the vendored engine.
#[derive(Clone, Copy, Debug, Default)]
pub struct EngineSolver;

impl LineSolver for EngineSolver {
    /// The pool is built first so the estimate counts its threads (the estimate's
    /// traversal scratch is per worker thread); the estimate and the refusal still come
    /// before the engine allocates anything. The solve and the walk run on a scoped thread
    /// inside the pool while this thread forwards progress to `sink`, because `sink` need
    /// not be shared across threads.
    fn solve_line(
        &self,
        job: &LineJob,
        sink: &dyn ProgressSink,
        walk: &mut dyn LineWalk,
    ) -> Result<(), BuilderError> {
        let pool =
            rayon::ThreadPoolBuilder::new().num_threads(job.threads).build().map_err(|err| {
                SolveError::Engine(format!("a pool of {} solve threads: {err}", job.threads))
            })?;
        std::thread::scope(|scope| {
            let (sender, receiver) = mpsc::channel();
            let worker = scope.spawn(|| {
                let forward = Forward { sender };
                pool.install(|| solve_in_pool(job, &forward, walk))
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

/// The estimate plus one runout's walk, refused above the cap (O-187), the solve, the
/// exact best response (O-138) and the walks one runout at a time (O-174), all on a
/// thread of the job's pool.
fn solve_in_pool(
    job: &LineJob,
    sink: &dyn ProgressSink,
    walk: &mut dyn LineWalk,
) -> Result<(), BuilderError> {
    let estimate = estimate_memory(&job.problem, job.options.storage)?;
    let needed = estimate.total_bytes.saturating_add(runout_walk_bytes(&job.problem)?);
    if needed > job.options.memory_cap_bytes {
        return Err(BuilderError::OverMemoryCap {
            line: job.line.clone(),
            estimate_bytes: needed,
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
    walk.root(SolvedLine { report, gains_pct_pot, root_nodes })?;
    for runout in &job.runouts {
        let selection = NodeSelection::Runout { turn: runout.turn, river: runout.river };
        walk.runout(*runout, select_nodes(&solved, &selection)?)?;
    }
    Ok(())
}

/// A solver for tests: it never runs the engine and walks a small, well-formed tree on
/// the job's flop (a root decision with check and one bet, then one turn node and one
/// river node per runout) over the live combos of the job's ranges, with the configured
/// gains, or the configured failure.
#[derive(Clone, Debug)]
pub struct FakeSolver {
    /// Both seats' gains to report.
    pub gains_pct_pot: [f64; 2],
    /// An estimate to report, the walk included; above the job's cap the fake refuses
    /// like the engine.
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
        walk: &mut dyn LineWalk,
    ) -> Result<(), BuilderError> {
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
        let report = fake::report(job, self.gains_pct_pot, self.estimate_bytes);
        sink.finished(&report);
        fake::walk_line(job, report, self.gains_pct_pot, walk)
    }
}
