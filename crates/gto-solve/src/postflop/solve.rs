//! The heads-up postflop solve (R2.10, A2 section 3, ADR 0023, O-135, O-138, O-139).
//!
//! Mechanism, in order:
//!
//! 1. The problem, the stop rule and the options are checked.
//! 2. `estimate_memory` builds the `gto-tree` betting skeleton and models the peak from
//!    it, unless the caller passes the estimate it already decided on
//!    (`solve_postflop_with_estimate`), which spares the library builder a second
//!    skeleton build per spot. Above `SolveOptions::memory_cap_bytes` the solve returns
//!    `SolveError::OverMemoryCap` before the engine game or the solver exists, so a refused
//!    problem allocates only the skeleton.
//! 3. The engine game is built from the mapped configuration (`engine_map`) and the solver
//!    with 16-bit storage unless the options say 32-bit.
//! 4. One exact Discounted CFR iteration at a time, on the schedule the mapped
//!    configuration carries (`DcfrParams::from_config`), so the configuration the solved
//!    game holds always describes the solve that ran: the sink hears every iteration, with
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

use postflop_engine::cfr::{DcfrParams, Solver};
use postflop_engine::game::Game;
use postflop_engine::nlhe::NlheGame;

use super::engine_map;
use super::error::SolveError;
use super::estimate::{MemoryEstimate, estimate_memory};
use super::measure::best_response;
use super::options::{ProgressSink, SolveOptions, SolveReport, StopReason, StopRule, StorageBits};
use super::problem::PostflopProblem;

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

/// Solves with explicit options, taking the memory estimate first.
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
    validate_options(stop, options)?;
    let estimate = estimate_memory(problem, options.storage)?;
    solve_estimated(problem, &estimate, stop, seed, sink, options, start)
}

/// Solves with explicit options and the estimate the caller already took for this problem
/// with `estimate_memory` and the options' storage, so the betting skeleton is built once
/// per spot. The estimate is taken as this problem's: the cap check and the report's
/// `estimate_bytes` read it as given.
///
/// # Errors
///
/// The errors of `solve_postflop_with` less `SolveError::Tree`, and `SolveError::Problem`
/// when the estimate is for the other storage.
pub fn solve_postflop_with_estimate(
    problem: &PostflopProblem,
    estimate: &MemoryEstimate,
    stop: StopRule,
    seed: u64,
    sink: &dyn ProgressSink,
    options: &SolveOptions,
) -> Result<(SolvedGame, SolveReport), SolveError> {
    let start = Instant::now();
    validate_options(stop, options)?;
    problem.validate()?;
    solve_estimated(problem, estimate, stop, seed, sink, options, start)
}

/// Checks the stop rule and the options before anything is built.
fn validate_options(stop: StopRule, options: &SolveOptions) -> Result<(), SolveError> {
    stop.validate()?;
    if options.measure_every == 0 {
        return Err(SolveError::Problem("measure_every must be at least 1".to_owned()));
    }
    Ok(())
}

/// Steps 2 (the cap) to 5 of the module docs, for a checked problem with its estimate.
fn solve_estimated(
    problem: &PostflopProblem,
    estimate: &MemoryEstimate,
    stop: StopRule,
    seed: u64,
    sink: &dyn ProgressSink,
    options: &SolveOptions,
    start: Instant,
) -> Result<(SolvedGame, SolveReport), SolveError> {
    check_estimate(estimate, options)?;
    let game = NlheGame::new(&engine_map::solve_config(problem)).map_err(SolveError::Engine)?;
    let cfr = Solver::new_with_storage(game, options.storage.mode());
    let tree_hash = gto_tree::tree_hash(&problem.tree);
    let mut solved = SolvedGame { solver: cfr, tree_hash, seed, storage: options.storage };
    let outcome = iterate(&mut solved, stop, options.measure_every, sink, start);
    let report = SolveReport {
        iterations: outcome.iterations,
        exploitability_pct_pot: outcome.measured,
        peak_bytes: accounted_peak(estimate, &solved),
        estimate_bytes: estimate.total_bytes,
        seconds: start.elapsed().as_secs_f32(),
        stop_reason: outcome.reason,
        storage: options.storage,
        tree_hash,
    };
    sink.finished(&report);
    Ok((solved, report))
}

/// Refuses an estimate taken for the other storage, and a problem above the cap.
fn check_estimate(estimate: &MemoryEstimate, options: &SolveOptions) -> Result<(), SolveError> {
    if estimate.storage != options.storage {
        return Err(SolveError::Problem(format!(
            "the estimate is for {:?} storage and the options ask for {:?}",
            estimate.storage, options.storage
        )));
    }
    if estimate.total_bytes > options.memory_cap_bytes {
        return Err(SolveError::OverMemoryCap {
            estimate_bytes: estimate.total_bytes,
            cap_bytes: options.memory_cap_bytes,
        });
    }
    Ok(())
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
    let params = dcfr_schedule(solved);
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

/// The DCFR schedule the solver runs: the one its game's configuration carries, so the
/// configuration and the solve cannot disagree.
fn dcfr_schedule(solved: &SolvedGame) -> DcfrParams {
    DcfrParams::from_config(solved.solver.game().config())
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

#[cfg(test)]
mod tests {
    use gto_model::{
        ActionToken, Board, Cbb, GameConfig, GameFormat, Position, PositionPair, Stake, TableSize,
    };
    use gto_tree::{
        DEFAULT_ALLIN_THRESHOLD_BP, LineKind, PlayerSizes, PreflopLine, SizeTable, StreetSizes,
        TreeConfig,
    };
    use postflop_engine::cfr::{DcfrParams, Solver};
    use postflop_engine::config::SolveConfig;
    use postflop_engine::nlhe::NlheGame;

    use super::super::engine_map;
    use super::super::problem::{PostflopProblem, Range};
    use super::{SolvedGame, StorageBits, dcfr_schedule};

    /// The schedule the module docs promise: DCFR 1.5 / 0 / 2 with no regret floor.
    const DOCUMENTED_SCHEDULE: DcfrParams =
        DcfrParams { alpha: 1.5, beta: 0.0, gamma: 2.0, floor_regrets_at_zero: false };

    /// The dry flop with one bet size, one raise and one combo a side.
    fn sample_problem() -> PostflopProblem {
        let street = || StreetSizes {
            bet: SizeTable::new(&[7_500], false).expect("a valid table"),
            raise: SizeTable::new(&[], true).expect("a valid table"),
            donk: SizeTable::default(),
        };
        let player = PlayerSizes { flop: street(), turn: street(), river: street() };
        let tree = TreeConfig::new(player.clone(), player, 1, DEFAULT_ALLIN_THRESHOLD_BP)
            .expect("a valid tree");
        let line = PreflopLine {
            pair: PositionPair::new(Position::Bb, Position::Btn).expect("two seats"),
            actions: vec![ActionToken::Raise(Cbb(250)), ActionToken::Call],
            kind: LineKind::SingleRaised,
            flop_pot: Cbb(550),
            flop_stack: Cbb(9_750),
            aggressor: Some(Position::Btn),
        };
        let stake = Stake::online();
        let config =
            GameConfig::new(GameFormat::Online, TableSize::SIX_MAX, stake, Cbb::from_bb(100));
        let board = Board::flop("Ks7d2c".parse().expect("a valid flop"));
        let ranges =
            [Range::parse("AhKh").expect("a range"), Range::parse("QsQd").expect("a range")];
        PostflopProblem::from_line(config, line, board, ranges, tree).expect("a valid problem")
    }

    /// A solved game on an engine configuration, before any iteration.
    fn solved_on(cfg: &SolveConfig) -> SolvedGame {
        let game = NlheGame::new(cfg).expect("the engine builds the game");
        let solver = Solver::new_with_storage(game, StorageBits::Sixteen.mode());
        SolvedGame { solver, tree_hash: [0; 32], seed: 0, storage: StorageBits::Sixteen }
    }

    /// R2.10: the solver runs the schedule its game's configuration carries, not a default
    /// of its own, so the stored configuration always describes the solve that ran.
    #[test]
    fn r2_10_solver_runs_the_schedule_of_its_config() {
        let altered = SolveConfig {
            alpha: 1.0,
            beta: 0.25,
            gamma: 3.0,
            regret_floor: true,
            ..engine_map::solve_config(&sample_problem())
        };
        let solved = solved_on(&altered);
        assert_eq!(dcfr_schedule(&solved), DcfrParams::from_config(&altered));
        assert_ne!(dcfr_schedule(&solved), DcfrParams::default());
    }

    /// R2.10: the configuration a problem maps to carries the documented schedule.
    #[test]
    fn r2_10_solve_config_carries_the_documented_schedule() {
        let solved = solved_on(&engine_map::solve_config(&sample_problem()));
        assert_eq!(dcfr_schedule(&solved), DOCUMENTED_SCHEDULE);
    }
}
