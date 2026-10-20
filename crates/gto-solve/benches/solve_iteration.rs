//! Solve-iteration benchmark (R0.10): the time of one discounted counterfactual regret
//! minimization (DCFR) iteration of the vendored engine on a small simple-tree heads-up
//! flop spot. Bench id `solve_iteration/simple_tree_flop`; `just bench` runs it and
//! `scripts/bench-report.mjs` folds the estimate into `validation/reports/bench-zenbook.json`,
//! the Zenbook baseline that later becomes the latency guard baseline (A9 section 1, O-40).
//!
//! Mechanism: criterion's `iter_batched` calls a setup closure that builds the game and the
//! solver and runs one untimed warm-up iteration, so the tree build, the storage allocation
//! and the first touch of every storage page stay outside the measurement. The routine then
//! runs exactly one more iteration with reporting off (`report_every = 0`), so no
//! best-response walk is included either. The solver is handed back out of the routine so
//! its drop is not timed. `BatchSize::PerIteration` builds one solver per routine call
//! instead of a batch up front, because each solver owns the whole regret and strategy
//! storage of the tree.
//!
//! The spot is kept small on purpose (A9 section 1 asks for the iteration time, not a
//! realistic solve): a 3-bet pot on `Qs Jh 2h`, the 3-bettor out of position with `QQ+,AKs`
//! against the caller's `JJ+,AKs` (19 and 22 live combos after the board blockers), 20 chips
//! in the middle and 80 behind, one bet size of 50 percent of the pot and one raise size of
//! 100 percent on every street, at most one raise per street. The engine's default all-in
//! threshold turns a raise that commits two thirds of the remaining stack into the shove.
//!
//! Sampling is criterion's default with `sample_size` 20 and `measurement_time` 10 seconds,
//! so the whole target stays under a few minutes of wall time including the untimed setups.

#![forbid(unsafe_code)]

use std::num::NonZeroUsize;
use std::time::{Duration, Instant};

use criterion::{BatchSize, Criterion, criterion_group, criterion_main};
use postflop_engine::cfr::{DcfrParams, Solver};
use postflop_engine::config::{Sizings, SolveConfig};
use postflop_engine::game::Game;
use postflop_engine::nlhe::NlheGame;

/// Flop with one broadway pair blocker per range, so both ranges lose a few combos.
const BOARD: &str = "Qs Jh 2h";
/// The 3-bettor, out of position: 19 live combos on this board.
const OOP_RANGE: &str = "QQ+,AKs";
/// The caller, in position: 22 live combos on this board.
const IP_RANGE: &str = "JJ+,AKs";
/// Chips in the middle at the root, a 3-bet pot in big blinds.
const STARTING_POT: f64 = 20.0;
/// Chips behind each player at the root.
const EFFECTIVE_STACK: f64 = 80.0;
/// The single bet size, percent of pot, on every street for both players.
const BET_PERCENT: f64 = 50.0;
/// The single raise size, percent of the pot after calling, on every street.
const RAISE_PERCENT: f64 = 100.0;
/// Raises per street after the opening bet.
const RAISE_CAP: u32 = 1;

/// Criterion samples per run; low because one routine call is tens of milliseconds.
const SAMPLE_SIZE: usize = 20;
/// Criterion measurement budget per run in seconds.
const MEASUREMENT_SECS: u64 = 10;
const MIB: usize = 1024 * 1024;
const BUILDS: &str = "the benchmark spot builds a game";

/// The solve configuration described in the module docs.
fn spot() -> SolveConfig {
    let mut cfg = SolveConfig {
        board: BOARD.to_string(),
        oop_range: OOP_RANGE.to_string(),
        ip_range: IP_RANGE.to_string(),
        effective_stack: EFFECTIVE_STACK,
        starting_pot: STARTING_POT,
        raise_cap: RAISE_CAP,
        ..SolveConfig::default()
    };
    for player in [&mut cfg.sizings.oop, &mut cfg.sizings.ip] {
        for street in [&mut player.flop, &mut player.turn, &mut player.river] {
            street.bet = Sizings::new(&[BET_PERCENT], false);
            street.raise = Sizings::new(&[RAISE_PERCENT], false);
        }
    }
    cfg.validate().expect("the benchmark spot is a valid solve configuration");
    cfg
}

/// Untimed setup: a fresh game and solver with one iteration already run, so the routine
/// measures a steady-state iteration rather than the first touch of the storage pages.
fn warmed_solver(cfg: &SolveConfig, params: &DcfrParams) -> Solver<NlheGame> {
    let game = NlheGame::new(cfg).expect(BUILDS);
    let mut solver = Solver::new(game);
    solver.run(1, params, 0, |_, _, _| {});
    solver
}

/// The timed routine: exactly one DCFR iteration, no exploitability report.
fn one_iteration(mut solver: Solver<NlheGame>, params: &DcfrParams) -> Solver<NlheGame> {
    solver.run(1, params, 0, |_, _, _| {});
    solver
}

/// Prints the spot once so the `just bench` log says what the number measures: the tree
/// size, the boards enumerated, the live combos per player and the solver storage, plus how
/// long one game build takes, which criterion does not time but every batch pays for.
fn describe(cfg: &SolveConfig) {
    let started = Instant::now();
    let game = NlheGame::new(cfg).expect(BUILDS);
    let build = started.elapsed();
    let counts = game.tree().counts();
    let threads = std::thread::available_parallelism().map_or(1, NonZeroUsize::get);
    println!(
        "solve_iteration/simple_tree_flop: board {} pot {} stack {} bet {BET_PERCENT}% \
         raise {RAISE_PERCENT}% raise_cap {RAISE_CAP} oop {OOP_RANGE} ip {IP_RANGE}",
        cfg.board, cfg.starting_pot, cfg.effective_stack
    );
    println!(
        "  tree {} nodes ({} decision, {} chance, {} fold, {} showdown) over {} boards; \
         live combos OOP {} IP {}",
        counts.total,
        counts.decision,
        counts.chance,
        counts.fold,
        counts.showdown,
        game.num_boards(),
        game.combo_count(0, 0),
        game.combo_count(0, 1)
    );
    let solver = Solver::new(game);
    println!(
        "  regret and strategy storage {} MiB; game build {build:?}; threads available {threads}",
        solver.storage_bytes() / MIB
    );
}

fn bench_solve_iteration(c: &mut Criterion) {
    let cfg = spot();
    let params = DcfrParams::from_config(&cfg);
    describe(&cfg);
    let mut group = c.benchmark_group("solve_iteration");
    group.bench_function("simple_tree_flop", |b| {
        b.iter_batched(
            || warmed_solver(&cfg, &params),
            |solver| one_iteration(solver, &params),
            BatchSize::PerIteration,
        );
    });
    group.finish();
}

criterion_group! {
    name = benches;
    config = Criterion::default()
        .sample_size(SAMPLE_SIZE)
        .measurement_time(Duration::from_secs(MEASUREMENT_SECS));
    targets = bench_solve_iteration
}
criterion_main!(benches);
