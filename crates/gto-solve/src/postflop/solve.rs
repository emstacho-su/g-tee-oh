//! The heads-up postflop solve (R2.10, A2 section 3, ADR 0023, O-135, O-138, O-139).
//!
//! Mechanism, in order:
//!
//! 1. The problem, the stop rule and the options are checked.
//! 2. The `gto-tree` betting skeleton is built and `estimate::memory_of` turns it into the
//!    modeled peak. Above `SolveOptions::memory_cap_bytes` the solve returns
//!    `SolveError::OverMemoryCap` before the engine game or the solver exists, so a refused
//!    problem allocates only the skeleton.
//! 3. The engine game is built from the mapped configuration (`engine_map`) and the solver
//!    with 16-bit storage unless the options say 32-bit.
//! 4. One exact Discounted CFR iteration at a time: the sink hears every iteration, with
//!    the measured exploitability every `measure_every` iterations (`None` between).
//! 5. The solve stops when both players' unilateral gain, as a percent of the starting
//!    pot, is at or below the target (O-138), or at the iteration or time cap. The report
//!    always carries a measurement of the final profile.
//!
//! Exact DCFR has no sampling, so the seed is recorded and never read, and two solves of
//! one problem give the same strategy bit for bit (the engine's parallel walk reduces in a
//! fixed order). `peak_bytes` is accounted bytes: the engine's own storage and chance map
//! figures plus the estimate's model of the rest, not the resident set size, which S18
//! and S20 measure (O-50).

use std::fmt;
use std::time::Instant;

use gto_tree::ActionTree;
use postflop_engine::cfr::{DcfrParams, Solver, StorageMode};
use postflop_engine::game::Game;
use postflop_engine::nlhe::NlheGame;

use super::engine_map;
use super::error::SolveError;
use super::estimate::{MemoryEstimate, memory_of, worker_threads};
use super::measure::best_response;
use super::problem::PostflopProblem;

/// The default memory cap: 5 GiB, Docker's `5g` limit that stands in for the 5 GB of the
/// target Mac (O-20, O-48).
pub const DEFAULT_MEMORY_CAP_BYTES: u64 = 5 * 1024 * 1024 * 1024;

/// Iterations between exploitability measurements by default (O-138).
pub const DEFAULT_MEASURE_EVERY: u32 = 10;

/// When to stop.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct StopRule {
    /// Stop once both players' gain is at or below this percent of the starting pot.
    pub target_exploitability_pct_pot: f32,
    /// The most iterations to run. Zero builds the game and measures the uniform profile.
    pub max_iterations: u32,
    /// The most wall-clock seconds to iterate, checked after every iteration.
    pub max_seconds: u32,
}

impl StopRule {
    fn validate(self) -> Result<(), SolveError> {
        let target = self.target_exploitability_pct_pot;
        if !(target.is_finite() && target >= 0.0) {
            return Err(SolveError::Problem(format!(
                "the target {target} is not a finite percent at or above 0"
            )));
        }
        if self.max_seconds == 0 {
            return Err(SolveError::Problem("max_seconds must be at least 1".to_owned()));
        }
        Ok(())
    }
}

/// How the solver stores its regret and strategy entries.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub enum StorageBits {
    /// An `i16` per entry and an `f32` scale per node, about half the bytes of 32-bit.
    #[default]
    Sixteen,
    /// An `f32` per entry.
    ThirtyTwo,
}

impl StorageBits {
    fn mode(self) -> StorageMode {
        match self {
            StorageBits::Sixteen => StorageMode::I16,
            StorageBits::ThirtyTwo => StorageMode::F32,
        }
    }
}

/// Solve options beyond the stop rule.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SolveOptions {
    /// Entry storage, 16-bit by default.
    pub storage: StorageBits,
    /// The most bytes the estimate may come to before the solve is refused.
    pub memory_cap_bytes: u64,
    /// Iterations between exploitability measurements; at least 1.
    pub measure_every: u32,
}

impl Default for SolveOptions {
    fn default() -> Self {
        SolveOptions {
            storage: StorageBits::Sixteen,
            memory_cap_bytes: DEFAULT_MEMORY_CAP_BYTES,
            measure_every: DEFAULT_MEASURE_EVERY,
        }
    }
}

/// Why a solve stopped.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum StopReason {
    /// Both gains reached the target.
    Target,
    /// The iteration cap.
    MaxIterations,
    /// The time cap.
    MaxSeconds,
}

/// What a solve did.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SolveReport {
    /// Iterations run.
    pub iterations: u32,
    /// Each player's gain as a percent of the starting pot, `[oop, ip]`, for the final
    /// profile.
    pub exploitability_pct_pot: [f32; 2],
    /// Accounted peak bytes (O-139).
    pub peak_bytes: u64,
    /// The estimate checked against the cap.
    pub estimate_bytes: u64,
    /// Wall-clock seconds from the start of the call to the final measurement.
    pub seconds: f32,
    /// Why the solve stopped.
    pub stop_reason: StopReason,
    /// The entry storage used.
    pub storage: StorageBits,
    /// `gto_tree::tree_hash` of the problem's tree configuration.
    pub tree_hash: [u8; 32],
}

/// Hears a solve's progress.
pub trait ProgressSink {
    /// Called after every iteration, with each player's gain as a percent of the starting
    /// pot on the iterations that measure it.
    fn report(&self, iteration: u32, exploitability_pct_pot: Option<[f32; 2]>);

    /// Called once with the final report.
    fn finished(&self, _report: &SolveReport) {}
}

/// A sink that ignores everything.
#[derive(Clone, Copy, Debug, Default)]
pub struct NoProgress;

impl ProgressSink for NoProgress {
    fn report(&self, _iteration: u32, _exploitability_pct_pot: Option<[f32; 2]>) {}
}

/// A solved game: the engine solver with its average strategy, the tree hash and the seed.
pub struct SolvedGame {
    solver: Solver<NlheGame>,
    tree_hash: [u8; 32],
    seed: u64,
    storage: StorageBits,
}

impl SolvedGame {
    /// `gto_tree::tree_hash` of the tree configuration the problem asked for.
    #[must_use]
    pub fn tree_hash(&self) -> [u8; 32] {
        self.tree_hash
    }

    /// The tree hash of the configuration the engine actually ran, mapped back from its
    /// sizing tables; equal to `tree_hash` when the mapping is faithful.
    ///
    /// # Errors
    ///
    /// `SolveError::Engine` when an engine table does not map back onto the grid.
    pub fn engine_tree_hash(&self) -> Result<[u8; 32], SolveError> {
        let tree = engine_map::tree_config_of(self.solver.game().config())?;
        Ok(gto_tree::tree_hash(&tree))
    }

    /// The seed the solve was given; exact DCFR never reads it.
    #[must_use]
    pub fn seed(&self) -> u64 {
        self.seed
    }

    /// Iterations run.
    #[must_use]
    pub fn iterations(&self) -> u64 {
        self.solver.iterations()
    }

    /// The entry storage used.
    #[must_use]
    pub fn storage(&self) -> StorageBits {
        self.storage
    }

    /// The solver's regret and strategy array bytes, as the engine accounts them.
    #[must_use]
    pub fn storage_bytes(&self) -> u64 {
        self.solver.storage_bytes() as u64
    }

    /// The shared chance map bytes, as the engine accounts them.
    #[must_use]
    pub fn chance_map_bytes(&self) -> u64 {
        self.solver.game().chance_map_bytes() as u64
    }

    /// Engine tree nodes of every kind.
    #[must_use]
    pub fn nodes(&self) -> u64 {
        self.solver.game().num_nodes() as u64
    }

    /// The average strategy at the root, action-major: entry `a * combos + i` is the
    /// probability of action `a` for live combo `i` of the player to act.
    #[must_use]
    pub fn root_strategy(&self) -> Vec<f32> {
        self.solver.average_strategy(self.solver.game().root())
    }

    pub(crate) fn solver(&self) -> &Solver<NlheGame> {
        &self.solver
    }
}

impl fmt::Debug for SolvedGame {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("SolvedGame")
            .field("tree_hash", &self.tree_hash)
            .field("seed", &self.seed)
            .field("storage", &self.storage)
            .field("iterations", &self.solver.iterations())
            .finish_non_exhaustive()
    }
}

/// Solves with the default options: 16-bit storage, the 5 GiB cap and a measurement every
/// 10 iterations.
///
/// # Errors
///
/// The errors of `solve_postflop_with`.
pub fn solve_postflop(
    problem: &PostflopProblem,
    stop: StopRule,
    seed: u64,
    sink: &dyn ProgressSink,
) -> Result<(SolvedGame, SolveReport), SolveError> {
    solve_postflop_with(problem, stop, seed, sink, &SolveOptions::default())
}

/// Solves with explicit options.
///
/// # Errors
///
/// `SolveError::Problem` for an invalid problem, stop rule or options,
/// `SolveError::Tree` when the skeleton cannot be built, `SolveError::OverMemoryCap` when
/// the estimate is above the cap (nothing is allocated for the engine then), and
/// `SolveError::Engine` when the engine refuses the mapped configuration.
pub fn solve_postflop_with(
    problem: &PostflopProblem,
    stop: StopRule,
    seed: u64,
    sink: &dyn ProgressSink,
    options: &SolveOptions,
) -> Result<(SolvedGame, SolveReport), SolveError> {
    let start = Instant::now();
    stop.validate()?;
    if options.measure_every == 0 {
        return Err(SolveError::Problem("measure_every must be at least 1".to_owned()));
    }
    problem.validate()?;
    let estimate = checked_estimate(problem, options)?;
    let game = NlheGame::new(&engine_map::solve_config(problem)).map_err(SolveError::Engine)?;
    let cfr = Solver::new_with_storage(game, options.storage.mode());
    let tree_hash = gto_tree::tree_hash(&problem.tree);
    let mut solved = SolvedGame { solver: cfr, tree_hash, seed, storage: options.storage };
    let outcome = iterate(&mut solved, stop, options.measure_every, sink, start);
    let report = SolveReport {
        iterations: outcome.iterations,
        exploitability_pct_pot: outcome.measured,
        peak_bytes: accounted_peak(&estimate, &solved),
        estimate_bytes: estimate.total_bytes,
        seconds: start.elapsed().as_secs_f32(),
        stop_reason: outcome.reason,
        storage: options.storage,
        tree_hash,
    };
    sink.finished(&report);
    Ok((solved, report))
}

/// Builds the skeleton, estimates, drops the skeleton and refuses a problem above the cap.
fn checked_estimate(
    problem: &PostflopProblem,
    options: &SolveOptions,
) -> Result<MemoryEstimate, SolveError> {
    let estimate = {
        let skeleton = ActionTree::build(&problem.tree, problem.root())?;
        memory_of(&skeleton, problem, options.storage, worker_threads())
    };
    if estimate.total_bytes > options.memory_cap_bytes {
        return Err(SolveError::OverMemoryCap {
            estimate_bytes: estimate.total_bytes,
            cap_bytes: options.memory_cap_bytes,
        });
    }
    Ok(estimate)
}

/// The engine's own storage and chance map figures plus the estimate's model of the rest.
fn accounted_peak(estimate: &MemoryEstimate, solved: &SolvedGame) -> u64 {
    let modeled_rest = estimate
        .total_bytes
        .saturating_sub(estimate.storage_bytes)
        .saturating_sub(estimate.chance_map_bytes);
    modeled_rest + solved.storage_bytes() + solved.chance_map_bytes()
}

/// How the iteration loop ended.
struct Outcome {
    iterations: u32,
    measured: [f32; 2],
    reason: StopReason,
}

/// The iteration loop: steps 4 and 5 of the module docs.
fn iterate(
    solved: &mut SolvedGame,
    stop: StopRule,
    measure_every: u32,
    sink: &dyn ProgressSink,
    start: Instant,
) -> Outcome {
    let params = DcfrParams::default();
    let mut last: Option<(u32, [f32; 2])> = None;
    for iteration in 1..=stop.max_iterations {
        solved.solver.run(1, &params, 0, |_, _, _| {});
        let measured = (iteration % measure_every == 0).then(|| gain_pct(solved));
        sink.report(iteration, measured);
        if let Some(gains) = measured {
            last = Some((iteration, gains));
            if gains.iter().all(|&gain| gain <= stop.target_exploitability_pct_pot) {
                return Outcome {
                    iterations: iteration,
                    measured: gains,
                    reason: StopReason::Target,
                };
            }
        }
        if start.elapsed().as_secs() >= u64::from(stop.max_seconds) {
            let measured = final_measure(solved, last, iteration);
            return Outcome { iterations: iteration, measured, reason: StopReason::MaxSeconds };
        }
    }
    let iterations = stop.max_iterations;
    let measured = final_measure(solved, last, iterations);
    Outcome { iterations, measured, reason: StopReason::MaxIterations }
}

/// The measurement of the final profile, reused when the last iteration measured it.
fn final_measure(solved: &SolvedGame, last: Option<(u32, [f32; 2])>, iteration: u32) -> [f32; 2] {
    match last {
        Some((measured_at, gains)) if measured_at == iteration => gains,
        _ => gain_pct(solved),
    }
}

/// Each player's gain as a percent of the starting pot, narrowed to the report's `f32`.
#[allow(clippy::cast_possible_truncation, reason = "a report figure, read to a few digits")]
fn gain_pct(solved: &SolvedGame) -> [f32; 2] {
    best_response(solved).gain_pct_pot.map(|gain| gain as f32)
}
