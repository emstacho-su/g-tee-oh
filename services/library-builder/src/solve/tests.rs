//! Unit tests of the two line solvers (R2.12, R2.17): the fake's walk and refusals, and the
//! engine solver's refusal above the cap and its walk of a four-combo flop.

use gto_library::RunoutSpec;
use gto_model::{
    ActionToken, Board, Cbb, GameConfig, GameFormat, Position, PositionPair, Stake, TableSize,
};
use gto_solve::postflop::{NoProgress, PostflopProblem, Range, SolveOptions, StopRule};
use gto_tree::{
    DEFAULT_ALLIN_THRESHOLD_BP, DEFAULT_RAISE_CAP, LineKind, PlayerSizes, PreflopLine, SizeTable,
    StreetSizes, TreeConfig,
};

use super::{EngineSolver, FakeSolver, LineJob, LineSolver};
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

/// R2.17: the fake walks the root and one turn and one river node per runout, over the
/// out-of-position combos live on each board, and is deterministic.
#[test]
fn r2_17_the_fake_walk_is_well_formed_and_deterministic() {
    let job = job(&[("Ks", "9h"), ("3d", "Qc")]);
    let fake = FakeSolver::converging([0.1, 0.2]);
    let solved = fake.solve_line(&job, &NoProgress).expect("solves");
    assert_eq!(solved.root_nodes.len(), 1);
    let root = &solved.root_nodes[0];
    assert_eq!(root.actions, vec![ActionToken::Check, ActionToken::Bet(Cbb(275))]);
    assert_eq!(root.hands.len(), 3, "Ah2d is dead on the flop");
    assert_eq!(solved.runout_nodes.len(), 2);
    let (_, nodes) = &solved.runout_nodes[0];
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
    let again = fake.solve_line(&job, &NoProgress).expect("solves");
    assert_eq!(again.root_nodes, solved.root_nodes);
    assert_eq!(again.runout_nodes, solved.runout_nodes);
}

/// R2.17: the fake refuses above the memory cap, fails on request, and refuses a
/// runout the board cannot deal.
#[test]
fn r2_17_the_fake_refuses_and_fails_like_the_engine() {
    let mut capped = job(&[]);
    capped.options.memory_cap_bytes = 10;
    let refused = FakeSolver::converging([0.1, 0.1]).solve_line(&capped, &NoProgress);
    assert!(matches!(refused, Err(BuilderError::OverMemoryCap { .. })), "{refused:?}");
    let failing =
        FakeSolver { fail_with: Some("boom".to_owned()), ..FakeSolver::converging([0.1, 0.1]) };
    let failed = failing.solve_line(&job(&[]), &NoProgress);
    assert!(matches!(failed, Err(BuilderError::Solve(_))), "{failed:?}");
    let on_board =
        FakeSolver::converging([0.1, 0.1]).solve_line(&job(&[("Ah", "9h")]), &NoProgress);
    assert!(matches!(on_board, Err(BuilderError::Solve(_))), "{on_board:?}");
}

/// R2.17: the engine solver refuses a line whose estimate is above the cap before it
/// solves, naming the line, the estimate and the cap.
#[test]
fn r2_17_the_engine_solver_refuses_above_the_cap() {
    let mut capped = job(&[]);
    capped.options.memory_cap_bytes = 1_024;
    let refused = EngineSolver.solve_line(&capped, &NoProgress);
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
    let solved = EngineSolver.solve_line(&job, &count).expect("solves");
    assert!(count.0.load(std::sync::atomic::Ordering::Relaxed) > 0, "progress reached the sink");
    assert!(solved.root_nodes.iter().all(|node| node.dealt.is_empty()));
    assert_eq!(solved.runout_nodes.len(), 1);
    let (_, nodes) = &solved.runout_nodes[0];
    assert!(!nodes.is_empty() && nodes.iter().all(|node| !node.dealt.is_empty()));
    assert!(solved.gains_pct_pot.iter().all(|gain| gain.is_finite()));
}
