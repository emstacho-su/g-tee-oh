//! R2.10 regression (O-194): the G4 turn spot turn-01-dry-ace, which 16-bit storage could
//! not drive below about 0.12 percent of the pot, meets the G4 stop rule's 0.1 target
//! under the default 32-bit storage in a few hundred iterations.
//!
//! Mechanism: the spot is inlined from `validation/fixtures/g4-spots.json` (the list's
//! tree, stop rule, ranges, board, pot and stacks) and built the way the G4 engine side of
//! `validate` builds it: the catalog configuration `cfg_6_online_100` with the rake zeroed
//! for a rake-free spot (O-161), the descriptive preflop line (O-164), and the board and
//! the pair read from the root node key. The test is ignored by default because the solve
//! takes minutes in a debug build; run it once in release with
//! `cargo test -p gto-solve --release --test r2_10_turn_storage -- --ignored --nocapture`.

use gto_model::{Cbb, GameConfig, NodeKey, Position, RakeModel, Stake, v1_configs};
use gto_solve::postflop::{
    PostflopProblem, ProgressSink, Range, SolveOptions, StopReason, StopRule, StorageBits,
    solve_postflop,
};
use gto_tree::{LineKind, PlayerSizes, PreflopLine, SizeTable, StreetSizes, TreeConfig};

/// The configuration the G4 list names (O-112).
const CONFIG_ID: &str = "cfg_6_online_100";
/// The spot: its id, root key, pot and stack behind, as the list spells them.
const SPOT_ID: &str = "turn-01-dry-ace";
const ROOT_KEY: &str = "cfg_6_online_100/BB-BTN/r250.c|Ah7d2c|x.b275.c|Ks|";
const POT: Cbb = Cbb(1_100);
const STACK: Cbb = Cbb(9_475);
/// Both ranges, in the pieces the list holds; joined by commas as the loader joins them.
const OOP_RANGE: &[&str] =
    &["99-22,AQs-A2s,KQs-K9s,QJs-Q9s,JTs,T9s,98s,87s,76s,65s", "AQo-ATo,KQo,KJo,QJo"];
const IP_RANGE: &[&str] = &["66+,A8s+,KTs+,QTs+,JTs,T9s,98s", "ATo+,KJo+,QJo"];
/// The list's tree: a 75 percent bet, a 75 percent donk for the out-of-position player,
/// all-in raises only, a raise cap of 3 and an all-in threshold of 67 percent.
const BET_SIZES_BP: &[u32] = &[7_500];
const DONK_SIZES_BP: &[u32] = &[7_500];
const RAISE_CAP: u8 = 3;
const ALLIN_THRESHOLD_BP: u32 = 6_700;
/// The G4 stop rule (O-168): 0.1 percent of the pot, 50,000 iterations, 600 seconds.
const G4_TARGET_PCT_POT: f32 = 0.1;
const G4_STOP: StopRule = StopRule {
    target_exploitability_pct_pot: G4_TARGET_PCT_POT,
    max_iterations: 50_000,
    max_seconds: 600,
};
/// The 32-bit solve met the target at iteration 240 on the measuring machine (O-194); the
/// bound leaves room for another machine while staying far under the 16-bit floor, which
/// never meets the target at all.
const MAX_ITERATIONS_TO_TARGET: u32 = 1_000;
/// The rake of a rake-free spot: no percent and no cap (O-161).
const NO_RAKE: RakeModel = RakeModel { percent_bp: 0, cap_cents: 0, no_flop_no_drop: false };
/// The separator between the pieces of a range notation.
const RANGE_SEPARATOR: &str = ",";

/// A sink that prints every measured iteration, so a `--nocapture` run shows the descent.
struct Trace;

impl ProgressSink for Trace {
    fn report(&self, iteration: u32, exploitability_pct_pot: Option<[f32; 2]>) {
        if let Some([oop, ip]) = exploitability_pct_pot {
            println!("R2.10 {SPOT_ID}: iteration {iteration}, gains oop {oop} ip {ip}");
        }
    }
}

/// A range from the list's pieces.
fn range(pieces: &[&str]) -> Range {
    Range::parse(&pieces.join(RANGE_SEPARATOR)).expect("a range of the G4 list parses")
}

/// One street's tables: the list's bets, all-in raises and the given donk sizes.
fn street(donk_bp: &[u32]) -> StreetSizes {
    StreetSizes {
        bet: SizeTable::new(BET_SIZES_BP, false).expect("a valid bet table"),
        raise: SizeTable::new(&[], true).expect("a valid raise table"),
        donk: SizeTable::new(donk_bp, false).expect("a valid donk table"),
    }
}

/// The list's tree as the loader builds it: donks for the out-of-position player only.
fn g4_tree() -> TreeConfig {
    let oop = PlayerSizes {
        flop: street(DONK_SIZES_BP),
        turn: street(DONK_SIZES_BP),
        river: street(DONK_SIZES_BP),
    };
    let ip = PlayerSizes { flop: street(&[]), turn: street(&[]), river: street(&[]) };
    TreeConfig::new(oop, ip, RAISE_CAP, ALLIN_THRESHOLD_BP).expect("the G4 tree is valid")
}

/// The catalog configuration with its rake zeroed, as the G4 engine side does (O-161).
fn rake_free_config() -> GameConfig {
    let base = v1_configs()
        .into_iter()
        .find(|config| config.config_id().as_str() == CONFIG_ID)
        .expect("the online 100 bb configuration is in the v1 catalog");
    let stake =
        Stake::new(base.stake.label.clone(), base.stake.sb_cents, base.stake.bb_cents, NO_RAKE)
            .expect("a rake-free stake is valid");
    GameConfig { stake, ..base }
}

/// The spot as a problem, built as `validate::gates::g4_engine::problem_for` builds it.
fn turn_01_dry_ace() -> PostflopProblem {
    let key: NodeKey = ROOT_KEY.parse().expect("the root key parses");
    let board = key.board().expect("the root key has a board");
    let line = PreflopLine {
        pair: key.pair,
        actions: key.preflop.clone(),
        kind: LineKind::SingleRaised,
        flop_pot: POT,
        flop_stack: STACK,
        aggressor: Some(Position::Btn),
    };
    let problem = PostflopProblem {
        config: rake_free_config(),
        line,
        board,
        ranges: [range(OOP_RANGE), range(IP_RANGE)],
        pot: POT,
        stacks: [STACK; 2],
        tree: g4_tree(),
    };
    problem.validate().expect("the spot is a valid problem");
    problem
}

/// R2.10 (O-194): under the default 32-bit storage the turn spot stops on the G4 target
/// with both gains at or below 0.1 percent of the pot, in under 1,000 iterations.
#[test]
#[ignore = "R2.10 (O-194): a turn solve of minutes in a debug build; run once in release"]
fn r2_10_turn_spot_meets_g4_target_in_default_storage() {
    let problem = turn_01_dry_ace();
    assert_eq!(SolveOptions::default().storage, StorageBits::ThirtyTwo);
    let (solved, report) = solve_postflop(&problem, G4_STOP, 0, &Trace).expect("solves");
    println!(
        "R2.10 {SPOT_ID} in {:?} storage: {} iterations, gains oop {} ip {} percent of the \
         pot, {:.1} seconds, stopped on {:?}",
        report.storage,
        report.iterations,
        report.exploitability_pct_pot[0],
        report.exploitability_pct_pot[1],
        report.seconds,
        report.stop_reason
    );
    assert_eq!(report.storage, StorageBits::ThirtyTwo);
    assert_eq!(solved.storage(), StorageBits::ThirtyTwo);
    assert_eq!(report.stop_reason, StopReason::Target, "{report:?}");
    assert!(
        report.exploitability_pct_pot.iter().all(|&gain| gain <= G4_TARGET_PCT_POT),
        "{report:?}"
    );
    assert!(report.iterations < MAX_ITERATIONS_TO_TARGET, "{report:?}");
}
