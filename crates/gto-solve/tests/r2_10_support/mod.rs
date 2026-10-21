//! Shared fixtures for the R2.10 postflop adapter tests, included by each `r2_10_*` test
//! binary with `#[path]`. The file sits in a directory so cargo does not build it as a test
//! binary of its own.
//!
//! The test spot (plan section D): the online 100 big blind (bb) configuration, the
//! big blind against the button after a 2.5 bb open and a call (`r250.c`, flop pot 550
//! centi-big-blinds (cbb), stack 9,750 cbb), the dry flop `Ks7d2c`, and ten combos a side.
//! The tree bets 33 or 75 percent of the pot on the flop and 75 percent on the turn and
//! river, raises are all-in only, the raise cap is 3 and the all-in threshold 67 percent.

#![allow(dead_code, reason = "each test binary uses a subset of the fixtures")]

use gto_model::{
    ActionToken, Board, Cbb, GameConfig, GameFormat, Position, PositionPair, Stake, TableSize,
};
use gto_solve::postflop::{COMBO_COUNT, PostflopProblem, Range};
use gto_tree::{
    DEFAULT_ALLIN_THRESHOLD_BP, DEFAULT_RAISE_CAP, LineKind, PlayerSizes, PreflopLine, SizeTable,
    StreetSizes, TreeConfig,
};

/// The flop pot and stack of `r250.c` at 100 bb online (plan section D).
pub const FLOP_POT: Cbb = Cbb(550);
pub const FLOP_STACK: Cbb = Cbb(9_750);

/// The dry flop of the test spot.
pub const DRY_FLOP: &str = "Ks7d2c";

/// Ten combos a side: value, draws and air for the big blind, a wider spread for the
/// button.
pub const OOP_RANGE: &str = "KhQh,KdJd,7h7s,AhTh,QsJs,9h8h,6h5h,5d4d,AdQc,Th9c";
pub const IP_RANGE: &str = "KhKd,AsKh,KcQc,TsTd,8s8d,JhTh,AcJc,6s5s,Qd9d,4s3s";

/// The online 6-max configuration at 100 bb.
pub fn online_config() -> GameConfig {
    GameConfig::new(GameFormat::Online, TableSize::SIX_MAX, Stake::online(), Cbb::from_bb(100))
}

/// The preflop line `r250.c` between the big blind and the button.
pub fn opened_line(pot: Cbb, stack: Cbb) -> PreflopLine {
    PreflopLine {
        pair: PositionPair::new(Position::Bb, Position::Btn).expect("two seats"),
        actions: vec![ActionToken::Raise(Cbb(250)), ActionToken::Call],
        kind: LineKind::SingleRaised,
        flop_pot: pot,
        flop_stack: stack,
        aggressor: Some(Position::Btn),
    }
}

/// A size table that must be valid.
pub fn table(sizes_bp: &[u32], allin: bool) -> SizeTable {
    SizeTable::new(sizes_bp, allin).expect("a valid size table")
}

/// One street's tables: bets of the given sizes, all-in raises and no donk leads.
pub fn street(bet_bp: &[u32]) -> StreetSizes {
    StreetSizes { bet: table(bet_bp, false), raise: table(&[], true), donk: SizeTable::default() }
}

/// The test tree, the same for both players.
pub fn small_tree() -> TreeConfig {
    let player = PlayerSizes {
        flop: street(&[3_300, 7_500]),
        turn: street(&[7_500]),
        river: street(&[7_500]),
    };
    TreeConfig::new(player.clone(), player, DEFAULT_RAISE_CAP, DEFAULT_ALLIN_THRESHOLD_BP)
        .expect("the test tree is valid")
}

/// A tree with one bet size per street and one raise, for problems that must stay small
/// in the skeleton however wide the ranges are.
pub fn narrow_tree() -> TreeConfig {
    let player =
        PlayerSizes { flop: street(&[7_500]), turn: street(&[7_500]), river: street(&[7_500]) };
    TreeConfig::new(player.clone(), player, 1, DEFAULT_ALLIN_THRESHOLD_BP)
        .expect("the narrow tree is valid")
}

/// A flop board.
pub fn flop_board(flop: &str) -> Board {
    Board::flop(flop.parse().expect("a valid flop"))
}

/// A range that must parse.
pub fn range(notation: &str) -> Range {
    Range::parse(notation).expect("a valid range")
}

/// Every combo at weight 1.
pub fn full_range() -> Range {
    Range::from_weights(&[1.0; COMBO_COUNT]).expect("weights of 1 are valid")
}

/// The test spot on a board with the given tree and ranges.
pub fn problem_with(board: Board, tree: TreeConfig, ranges: [Range; 2]) -> PostflopProblem {
    PostflopProblem::from_line(
        online_config(),
        opened_line(FLOP_POT, FLOP_STACK),
        board,
        ranges,
        tree,
    )
    .expect("a valid problem")
}

/// The test spot.
pub fn small_problem() -> PostflopProblem {
    problem_with(flop_board(DRY_FLOP), small_tree(), [range(OOP_RANGE), range(IP_RANGE)])
}
