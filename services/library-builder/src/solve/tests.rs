//! Unit tests of the two line solvers (R2.12, R2.17): the fake's walk and refusals, and the
//! engine solver's refusal above the cap and its walk of a four-combo flop.

use gto_library::RunoutSpec;
use gto_model::{
    ActionToken, Board, Cbb, GameConfig, GameFormat, Position, PositionPair, Stake, TableSize,
};
use gto_solve::postflop::{
    NoProgress, NodeStrategy, PostflopProblem, Range, SolveOptions, StopRule,
};
use gto_tree::{
    DEFAULT_ALLIN_THRESHOLD_BP, DEFAULT_RAISE_CAP, LineKind, PlayerSizes, PreflopLine, SizeTable,
    StreetSizes, TreeConfig,
};

use super::{CollectWalk, EngineSolver, FakeSolver, LineJob, LineSolver, LineWalk, SolvedLine};
use crate::error::BuilderError;

fn street() -> StreetSizes {
    StreetSizes {
        bet: SizeTable::new(&[7_500], false).expect("a table"),
        raise: SizeTable::new(&[], true).expect("a table"),
        donk: SizeTable::default(),
    }
}

fn job(runouts: &[(&str, &str)]) -> LineJob {
    let player = PlayerSizes { flop: street(), turn: street(), river: street() };
    let tree =
        TreeConfig::new(player.clone(), player, DEFAULT_RAISE_CAP, DEFAULT_ALLIN_THRESHOLD_BP)
            .expect("a tree");
    let line = PreflopLine {
        pair: PositionPair::new(Position::Bb, Position::Btn).expect("two seats"),
        actions: vec![ActionToken::Raise(Cbb(250)), ActionToken::Call],
        kind: LineKind::SingleRaised,
        flop_pot: Cbb(550),
        flop_stack: Cbb(9_750),
        aggressor: Some(Position::Btn),
    };
    let config =
        GameConfig::new(GameFormat::Online, TableSize::SIX_MAX, Stake::online(), Cbb::from_bb(100));
    let ranges = [
        Range::parse("KhQh,KsQd,9h8h,Ah2d").expect("a range"),
        Range::parse("TsTd,JhTh,7h7s").expect("a range"),
    ];
    let flop = "Ah7d2c".parse().expect("a flop");
    let problem = PostflopProblem::from_line(config, line, Board::flop(flop), ranges, tree)
        .expect("a problem");
    LineJob {
        problem,
        line: "r250.c".to_owned(),
        stop: StopRule { target_exploitability_pct_pot: 0.3, max_iterations: 10, max_seconds: 10 },
        options: SolveOptions::default(),
        threads: 1,
        runouts: runouts
            .iter()
            .map(|(t, r)| RunoutSpec {
                turn: t.parse().expect("a card"),
                river: r.parse().expect("a card"),
            })
            .collect(),
        seed: 7,
    }
}

/// Every walked runout of a line, in order.
type Runouts = Vec<(RunoutSpec, Vec<NodeStrategy>)>;

/// The walk of `job` by `solver`, collected: the head and every runout.
fn collect(
    solver: &dyn LineSolver,
    job: &LineJob,
    sink: &dyn gto_solve::postflop::ProgressSink,
) -> Result<(SolvedLine, Runouts), BuilderError> {
    let mut walk = CollectWalk::default();
    solver.solve_line(job, sink, &mut walk)?;
    let head = walk.head.expect("the solver walked the root");
    Ok((head, walk.runouts))
}

/// A walk that records the order of its calls and fails the runout at `fail_at`.
struct Recording {
    calls: Vec<String>,
    fail_at: Option<usize>,
}

impl LineWalk for Recording {
    fn root(&mut self, _solved: SolvedLine) -> Result<(), BuilderError> {
        self.calls.push("root".to_owned());
        Ok(())
    }

    fn runout(
        &mut self,
        runout: RunoutSpec,
        _nodes: Vec<NodeStrategy>,
    ) -> Result<(), BuilderError> {
        if self.fail_at == Some(self.calls.len() - 1) {
            return Err(BuilderError::Usage(format!("stop at {runout}")));
        }
        self.calls.push(runout.to_string());
        Ok(())
    }
}

/// R2.17: the fake hands the root over first and then one runout per call, in order, and
/// stops walking at the first runout the walk refuses.
#[test]
fn r2_17_the_fake_hands_over_one_runout_at_a_time_and_stops_on_an_error() {
    let job = job(&[("Ks", "9h"), ("3d", "Qc"), ("5s", "6h")]);
    let fake = FakeSolver::converging([0.1, 0.2]);
    let mut all = Recording { calls: Vec::new(), fail_at: None };
    fake.solve_line(&job, &NoProgress, &mut all).expect("walks");
    assert_eq!(all.calls, vec!["root", "Ks9h", "3dQc", "5s6h"]);
    let mut stopped = Recording { calls: Vec::new(), fail_at: Some(1) };
    let result = fake.solve_line(&job, &NoProgress, &mut stopped);
    assert!(matches!(result, Err(BuilderError::Usage(_))), "{result:?}");
    assert_eq!(stopped.calls, vec!["root", "Ks9h"], "no runout is walked after the refusal");
}

/// R2.17: one runout's walk is charged per turn and river entry and node, and grows with
/// the live combos.
#[test]
fn r2_17_one_runout_walk_is_charged_from_the_skeleton() {
    let small = job(&[]);
    let bytes = super::runout_walk_bytes(&small.problem).expect("the overhead");
    assert!(bytes >= super::WALK_BYTES_PER_ENTRY + super::WALK_BYTES_PER_NODE, "{bytes}");
    let mut wider = job(&[]);
    wider.problem.ranges[0] = Range::parse("KhQh,KsQd,9h8h,Ah2d,QsJs,Tc9c").expect("a range");
    let more = super::runout_walk_bytes(&wider.problem).expect("the overhead");
    assert!(more > bytes, "{more} against {bytes}");
}

/// R2.17: the fake walks the root and one turn and one river node per runout, over the
/// out-of-position combos live on each board, and is deterministic.
#[test]
fn r2_17_the_fake_walk_is_well_formed_and_deterministic() {
    let job = job(&[("Ks", "9h"), ("3d", "Qc")]);
    let fake = FakeSolver::converging([0.1, 0.2]);
    let (solved, runouts) = collect(&fake, &job, &NoProgress).expect("solves");
    assert_eq!(solved.root_nodes.len(), 1);
    let root = &solved.root_nodes[0];
    assert_eq!(root.actions, vec![ActionToken::Check, ActionToken::Bet(Cbb(275))]);
    assert_eq!(root.hands.len(), 3, "Ah2d is dead on the flop");
    assert_eq!(runouts.len(), 2);
    let (_, nodes) = &runouts[0];
    assert_eq!(nodes[0].street_lines, vec![vec![ActionToken::Check; 2], vec![]]);
    assert_eq!(nodes[1].dealt.len(), 2);
    assert_eq!(nodes[0].hands.len(), 2, "KsQd is dead on the Ks turn");
    for node in solved.root_nodes.iter().chain(nodes) {
        assert_eq!(node.line, node.street_lines.concat());
        for hand in &node.hands {
            let sum: f32 = hand.frequencies.iter().sum();
            assert!((sum - 1.0).abs() < 1e-6, "{sum}");
        }
    }
    assert_eq!(solved.report.iterations, 100);
    assert_eq!(solved.gains_pct_pot, [0.1, 0.2]);
    let (again, again_runouts) = collect(&fake, &job, &NoProgress).expect("solves");
    assert_eq!(again.root_nodes, solved.root_nodes);
    assert_eq!(again_runouts, runouts);
}

/// R2.17: the fake refuses above the memory cap, fails on request, and refuses a
/// runout the board cannot deal.
#[test]
fn r2_17_the_fake_refuses_and_fails_like_the_engine() {
    let mut capped = job(&[]);
    capped.options.memory_cap_bytes = 10;
    let refused = FakeSolver::converging([0.1, 0.1]).solve_line(
        &capped,
        &NoProgress,
        &mut CollectWalk::default(),
    );
    assert!(matches!(refused, Err(BuilderError::OverMemoryCap { .. })), "{refused:?}");
    let failing =
        FakeSolver { fail_with: Some("boom".to_owned()), ..FakeSolver::converging([0.1, 0.1]) };
    let failed = failing.solve_line(&job(&[]), &NoProgress, &mut CollectWalk::default());
    assert!(matches!(failed, Err(BuilderError::Solve(_))), "{failed:?}");
    let on_board = collect(&FakeSolver::converging([0.1, 0.1]), &job(&[("Ah", "9h")]), &NoProgress);
    assert!(matches!(on_board, Err(BuilderError::Solve(_))), "{on_board:?}");
}

/// R2.17: the engine solver refuses a line whose estimate is above the cap before it
/// solves, naming the line, the estimate and the cap.
#[test]
fn r2_17_the_engine_solver_refuses_above_the_cap() {
    let mut capped = job(&[]);
    capped.options.memory_cap_bytes = 1_024;
    let refused = EngineSolver.solve_line(&capped, &NoProgress, &mut CollectWalk::default());
    let Err(BuilderError::OverMemoryCap { line, estimate_bytes, cap_bytes }) = refused else {
        panic!("{refused:?}");
    };
    assert_eq!(line, "r250.c");
    assert_eq!(cap_bytes, 1_024);
    assert!(estimate_bytes > cap_bytes);
}

/// R2.12: the engine solver solves inside its pool, reports progress through the caller's
/// sink, and walks the root street and every asked runout.
#[test]
fn r2_12_the_engine_solver_walks_the_root_and_each_runout() {
    struct Count(std::sync::atomic::AtomicU32);
    impl gto_solve::postflop::ProgressSink for Count {
        fn report(&self, _iteration: u32, _gains: Option<[f32; 2]>) {
            self.0.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        }
    }
    let job = job(&[("Ks", "9h")]);
    let count = Count(std::sync::atomic::AtomicU32::new(0));
    let (solved, runouts) = collect(&EngineSolver, &job, &count).expect("solves");
    assert!(count.0.load(std::sync::atomic::Ordering::Relaxed) > 0, "progress reached the sink");
    assert!(solved.root_nodes.iter().all(|node| node.dealt.is_empty()));
    assert_eq!(runouts.len(), 1);
    let (_, nodes) = &runouts[0];
    assert!(!nodes.is_empty() && nodes.iter().all(|node| !node.dealt.is_empty()));
    assert!(solved.gains_pct_pot.iter().all(|gain| gain.is_finite()));
}

/// R2.17: the memory check counts the walk of one runout on top of the solve's estimate,
/// so a cap just above the estimate alone refuses the line and names the sum.
#[test]
fn r2_17_the_engine_solver_counts_one_runout_walk_against_the_cap() {
    let mut capped = job(&[("Ks", "9h")]);
    let pool = rayon::ThreadPoolBuilder::new().num_threads(capped.threads).build().expect("pool");
    let estimate = pool
        .install(|| gto_solve::postflop::estimate_memory(&capped.problem, capped.options.storage))
        .expect("an estimate")
        .total_bytes;
    capped.options.memory_cap_bytes = estimate + 1;
    let refused = EngineSolver.solve_line(&capped, &NoProgress, &mut CollectWalk::default());
    let Err(BuilderError::OverMemoryCap { estimate_bytes, cap_bytes, .. }) = refused else {
        panic!("a cap one byte above the solve's estimate must refuse: {refused:?}");
    };
    assert_eq!(cap_bytes, estimate + 1);
    assert!(estimate_bytes > estimate + 1, "{estimate_bytes} names the walk on top of {estimate}");
}
