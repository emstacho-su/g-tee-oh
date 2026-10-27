//! Criterion bench `extract/runout_line` (O-190): extraction of one line's runout nodes.
//!
//! The input stands for one walked runout of a single-raised pot: turn and river nodes on
//! the board `Ah7d2c Ks 9h`, each over every live combo with two or three actions, as
//! `select_nodes` returns them for one runout. The measured call is `extract_nodes` with a
//! suit permutation that is not the identity, so the key relabelling and the per-combo
//! re-sort are in the figure.

use criterion::{Criterion, criterion_group, criterion_main};
use gto_model::{
    ActionToken, Card, Cbb, ComboId, ConfigId, Flop, Position, PositionPair, SuitPermutation,
};
use gto_solve::postflop::{HandStrategy, NodeStrategy};
use gto_tree::Player;
use library_builder::extract::{ExtractContext, extract_nodes};

const X: ActionToken = ActionToken::Check;
const C: ActionToken = ActionToken::Call;
const F: ActionToken = ActionToken::Fold;
/// The permutation index the bench relabels by; any but the identity.
const PERMUTATION: usize = 13;

fn parse<T: std::str::FromStr>(text: &str) -> T
where
    T::Err: std::fmt::Debug,
{
    text.parse().expect("a valid literal")
}

/// Every combo live on `board`, with frequencies summing to 1 over `actions`.
fn hands(board: &[Card], actions: usize) -> Vec<HandStrategy> {
    let count = f32::from(u8::try_from(actions).expect("a few actions"));
    ComboId::all()
        .filter(|combo| !combo.conflicts_with(board))
        .map(|combo| HandStrategy {
            combo,
            reach: [0.001, 0.001],
            frequencies: vec![1.0 / count; actions],
            ev_bb: vec![2.75; actions],
        })
        .collect()
}

fn node(
    board: &[Card],
    dealt: &[Card],
    lines: &[&[ActionToken]],
    actions: &[ActionToken],
) -> NodeStrategy {
    NodeStrategy {
        line: lines.concat(),
        street_lines: lines.iter().map(|line| line.to_vec()).collect(),
        dealt: dealt.to_vec(),
        player: if lines.last().map_or(0, |l| l.len()) % 2 == 0 { Player::Oop } else { Player::Ip },
        pot: Cbb(550),
        stacks: [Cbb(9_725), Cbb(9_725)],
        actions: actions.to_vec(),
        hands: hands(board, actions.len()),
    }
}

/// The turn and river nodes of one runout after a checked-through flop.
fn runout_line(flop: Flop, turn: Card, river: Card) -> Vec<NodeStrategy> {
    let bet = ActionToken::Bet(Cbb(400));
    let raise = ActionToken::Raise(Cbb(1_200));
    let turn_board = [flop.cards().to_vec(), vec![turn]].concat();
    let river_board = [turn_board.clone(), vec![river]].concat();
    let open = [X, bet];
    let facing = [F, C, raise];
    let mut nodes = vec![
        node(&turn_board, &[turn], &[&[X, X], &[]], &open),
        node(&turn_board, &[turn], &[&[X, X], &[X]], &open),
        node(&turn_board, &[turn], &[&[X, X], &[bet]], &facing),
        node(&turn_board, &[turn], &[&[X, X], &[X, bet]], &facing),
    ];
    for turn_line in [&[X, X][..], &[bet, C][..], &[X, bet, C][..]] {
        let dealt = [turn, river];
        nodes.push(node(&river_board, &dealt, &[&[X, X], turn_line, &[]], &open));
        nodes.push(node(&river_board, &dealt, &[&[X, X], turn_line, &[X]], &open));
        nodes.push(node(&river_board, &dealt, &[&[X, X], turn_line, &[bet]], &facing));
        nodes.push(node(&river_board, &dealt, &[&[X, X], turn_line, &[X, bet]], &facing));
    }
    nodes
}

fn bench(c: &mut Criterion) {
    let flop: Flop = parse("Ah7d2c");
    let nodes = runout_line(flop, parse("Ks"), parse("9h"));
    let ctx = ExtractContext {
        config_id: ConfigId::new("cfg_6_online_100").expect("a config id"),
        pair: PositionPair::new(Position::Bb, Position::Btn).expect("two seats"),
        preflop: vec![ActionToken::Raise(Cbb(250)), C],
        solved_flop: flop,
        to_raw: SuitPermutation::all()[PERMUTATION],
        accuracy_pct_pot: Some(0.3),
    };
    c.bench_function("extract/runout_line", |b| {
        b.iter(|| extract_nodes(std::hint::black_box(&ctx), std::hint::black_box(&nodes)));
    });
}

criterion_group!(benches, bench);
criterion_main!(benches);
