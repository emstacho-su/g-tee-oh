//! The vector game behind `PreflopGame` (R2.19, R2.21): the tree's decision nodes with
//! their children found by line, the terminals with their payoffs, and the class pair
//! weights of the equity table.
//!
//! Mechanism. The chips each seat has put in are replayed from the blinds along every
//! node's line (a call matches the other seat, a raise or bet goes to its total, an
//! all-in to the stack, a limp to one big blind, every amount capped at the stack), and
//! the replay must give the pot the tree records at every node, so the game and the tree
//! cannot drift apart. A seat's payoff at a terminal is its final stack minus its
//! starting stack, in big blinds (bb), written as `base + scale x equity`: a fold pays
//! `base` only (the folder loses what it put in, the other seat wins the pot), an all-in
//! showdown pays the pot times the seat's equity, and a flop line, only under a
//! `FlopPayout`, pays the flop pot times the equity times the seat's realization factor
//! (A2 section 4, O-227). Both seats lose what they put in, so `base` is minus that.

use std::collections::HashMap;

use gto_model::{ActionToken, Cbb, GameConfig, HandClass, Position, PositionPair, TableSize};
use gto_tree::{PreflopLine, PreflopNode, PreflopTree};

use super::{FlopPayout, PreflopError};
use crate::equity::EquityTable;

/// Hand classes per seat.
pub(super) const CLASSES: usize = HandClass::COUNT as usize;

/// Centi-big-blinds (cbb) in one big blind, as a float.
pub(super) const CBB_PER_BB: f64 = 100.0;

/// The big blind in cbb.
const BIG_BLIND_CBB: u32 = Cbb::PER_BB;

/// Where an action leads.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Child {
    /// Another decision node, by index.
    Node(usize),
    /// A terminal, by index.
    Terminal(usize),
}

/// One decision node of the vector game.
#[derive(Clone, Debug)]
pub(super) struct DecisionNode {
    /// The actor's seat in pair order (0 out of position, 1 in position).
    pub seat: usize,
    /// The chips each seat has put in, in pair order, in cbb.
    pub invested: [u32; 2],
    /// Where each action leads, in the node's action order.
    pub children: Vec<Child>,
}

/// One terminal: seat `s` with class `h` against class `k` is paid
/// `base_bb[s] + scale_bb[s] x equity[h][k]`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct Terminal {
    /// The part of the payoff that does not depend on the cards, per seat.
    pub base_bb: [f64; 2],
    /// The multiplier of the seat's equity, per seat.
    pub scale_bb: [f64; 2],
}

/// The class pair weights: `pairs[h][k]` and `pairs[h][k] x equity[h][k]`, row major.
#[derive(Clone, Debug)]
pub(super) struct Weights {
    /// Disjoint combo pairs per class pair.
    pub pairs: Vec<f64>,
    /// Combo pairs times the row class's equity.
    pub pairs_equity: Vec<f64>,
    /// Every class pair's combo pairs, summed: the number of deals.
    pub total: f64,
}

/// The whole vector game.
#[derive(Clone, Debug)]
pub(super) struct Layout {
    /// The decision nodes in tree order; node 0 is the root.
    pub nodes: Vec<DecisionNode>,
    /// The terminals.
    pub terminals: Vec<Terminal>,
    /// The class pair weights.
    pub weights: Weights,
    /// The stack each seat starts with after its ante, in cbb.
    pub stack: u32,
}

/// The facts of the table the replay needs.
struct Table {
    pair: PositionPair,
    stack: u32,
    dead: u32,
    blinds: [u32; 2],
}

/// Builds the vector game of `tree` at `config`.
pub(super) fn layout(
    tree: &PreflopTree,
    config: &GameConfig,
    equity: &EquityTable,
    flop: Option<FlopPayout>,
) -> Result<Layout, PreflopError> {
    let weights = weights(equity)?;
    let root = tree.nodes().first().ok_or_else(|| game_error("the tree has no node"))?;
    let table = table(tree.pair(), config, root)?;
    let by_line: HashMap<&[ActionToken], usize> = tree
        .nodes()
        .iter()
        .enumerate()
        .map(|(index, node)| (node.line.as_slice(), index))
        .collect();
    let mut terminals = Vec::new();
    let mut nodes = Vec::with_capacity(tree.nodes().len());
    for node in tree.nodes() {
        let seat = seat_of(table.pair, node.actor)?;
        let invested = replay(&table, tree, &by_line, &node.line)?;
        check_pot(&table, invested, node.pot, &node.line)?;
        let mut children = Vec::with_capacity(node.actions.len());
        for token in &node.actions {
            let line = [node.line.as_slice(), &[*token]].concat();
            let child = if let Some(index) = by_line.get(line.as_slice()) {
                Child::Node(*index)
            } else {
                let after = Step { seat, invested, token: *token, line: &line };
                terminals.push(terminal(&table, tree.flop_lines(), flop, &after)?);
                Child::Terminal(terminals.len() - 1)
            };
            children.push(child);
        }
        nodes.push(DecisionNode { seat, invested, children });
    }
    Ok(Layout { nodes, terminals, weights, stack: table.stack })
}

/// A `PreflopError::Game` with `message`.
pub(super) fn game_error(message: impl Into<String>) -> PreflopError {
    PreflopError::Game(message.into())
}

/// Cbb as big blinds.
pub(super) fn bb(cbb: u32) -> f64 {
    f64::from(cbb) / CBB_PER_BB
}

/// The class pair weights of `equity`, after checking its shape and labels.
fn weights(equity: &EquityTable) -> Result<Weights, PreflopError> {
    let bad = |message: String| Err(PreflopError::Equity(message));
    if equity.classes.len() != CLASSES || equity.equity.len() != CLASSES {
        return bad(format!("{} classes and {} rows", equity.classes.len(), equity.equity.len()));
    }
    if equity.pairs.len() != CLASSES {
        return bad(format!("{} rows of pairs", equity.pairs.len()));
    }
    for (class, label) in HandClass::all().zip(&equity.classes) {
        if class.to_string() != *label {
            return bad(format!("class {} is labeled {label}", class.index()));
        }
    }
    let mut pairs = Vec::with_capacity(CLASSES * CLASSES);
    let mut pairs_equity = Vec::with_capacity(CLASSES * CLASSES);
    for (row, (equities, counts)) in equity.equity.iter().zip(&equity.pairs).enumerate() {
        if equities.len() != CLASSES || counts.len() != CLASSES {
            return bad(format!("row {row} has {} entries", equities.len().min(counts.len())));
        }
        for (value, count) in equities.iter().zip(counts) {
            if !(0.0..=1.0).contains(value) {
                return bad(format!("row {row} holds the equity {value}"));
            }
            pairs.push(f64::from(*count));
            pairs_equity.push(f64::from(*count) * value);
        }
    }
    let total = pairs.iter().sum();
    Ok(Weights { pairs, pairs_equity, total })
}

/// The seat index of `position` in pair order.
fn seat_of(pair: PositionPair, position: Position) -> Result<usize, PreflopError> {
    if position == pair.oop() {
        Ok(0)
    } else if position == pair.ip() {
        Ok(1)
    } else {
        Err(game_error(format!("{position} acts but is not in the pair {pair}")))
    }
}

/// The stack after the ante, the blinds and the dead money, checked against the root pot.
fn table(
    pair: PositionPair,
    config: &GameConfig,
    root: &PreflopNode,
) -> Result<Table, PreflopError> {
    if config.straddle {
        return Err(game_error("straddle pots are not modeled"));
    }
    let stack = config.depth_cbb.checked_sub(config.ante_cbb)?.get();
    let blinds = [blind_of(pair.oop(), config)?, blind_of(pair.ip(), config)?];
    let dead = root.pot.get().checked_sub(blinds[0] + blinds[1]).ok_or_else(|| {
        game_error(format!("the root pot {} is below the pair's blinds {blinds:?}", root.pot))
    })?;
    Ok(Table { pair, stack, dead, blinds })
}

/// The blind `seat` posts in cbb, as the tree builders post it: the big blind posts one
/// big blind, the small blind seat (the button heads-up) the stake's ratio of blinds
/// rounded half up to the cbb grid (O-136), every other seat nothing.
fn blind_of(seat: Position, config: &GameConfig) -> Result<u32, PreflopError> {
    let small_blind_seat =
        if config.table_size == TableSize::HEADS_UP { Position::Btn } else { Position::Sb };
    if seat == Position::Bb {
        return Ok(BIG_BLIND_CBB);
    }
    if seat != small_blind_seat {
        return Ok(0);
    }
    let (sb, bb) = (u64::from(config.stake.sb_cents), u64::from(config.stake.bb_cents));
    if bb == 0 {
        return Err(game_error(format!("stake {} has no big blind", config.stake.label)));
    }
    let rounded = (2 * sb * u64::from(BIG_BLIND_CBB) + bb) / (2 * bb);
    u32::try_from(rounded).map_err(|_| game_error("the small blind is too large"))
}

/// The chips each seat has put in after `line`, replayed from the blinds.
fn replay(
    table: &Table,
    tree: &PreflopTree,
    by_line: &HashMap<&[ActionToken], usize>,
    line: &[ActionToken],
) -> Result<[u32; 2], PreflopError> {
    line.iter().enumerate().try_fold(table.blinds, |invested, (at, token)| {
        let index = by_line
            .get(&line[..at])
            .ok_or_else(|| game_error(format!("no node for the first {at} actions of {line:?}")))?;
        let seat = seat_of(table.pair, tree.nodes()[*index].actor)?;
        apply(table, invested, seat, *token)
    })
}

/// The chips put in after `seat` takes `token`; a fold changes nothing.
fn apply(
    table: &Table,
    invested: [u32; 2],
    seat: usize,
    token: ActionToken,
) -> Result<[u32; 2], PreflopError> {
    let total = match token {
        ActionToken::Fold | ActionToken::Check => invested[seat],
        ActionToken::Call => invested[1 - seat],
        ActionToken::Limp => BIG_BLIND_CBB,
        ActionToken::Raise(to) | ActionToken::Bet(to) => to.get(),
        ActionToken::AllIn => table.stack,
        ActionToken::Straddle(_) => return Err(game_error("straddle pots are not modeled")),
    };
    let mut next = invested;
    next[seat] = total.min(table.stack);
    Ok(next)
}

/// The pot the replay gives, checked against the pot the tree records.
fn check_pot(
    table: &Table,
    invested: [u32; 2],
    recorded: Cbb,
    line: &[ActionToken],
) -> Result<u32, PreflopError> {
    let pot = table.dead + invested[0] + invested[1];
    if pot == recorded.get() {
        Ok(pot)
    } else {
        Err(game_error(format!(
            "the replayed pot {pot} after {line:?} is not the tree's {recorded}"
        )))
    }
}

/// The action that ends a line: who took it, the chips before it, the token, the line.
struct Step<'a> {
    seat: usize,
    invested: [u32; 2],
    token: ActionToken,
    line: &'a [ActionToken],
}

/// The terminal `step` reaches.
fn terminal(
    table: &Table,
    flop_lines: &[PreflopLine],
    flop: Option<FlopPayout>,
    step: &Step<'_>,
) -> Result<Terminal, PreflopError> {
    let lost = |invested: [u32; 2]| [-bb(invested[0]), -bb(invested[1])];
    if step.token == ActionToken::Fold {
        let pot = bb(table.dead + step.invested[0] + step.invested[1]);
        let mut base_bb = lost(step.invested);
        base_bb[1 - step.seat] += pot;
        return Ok(Terminal { base_bb, scale_bb: [0.0; 2] });
    }
    let after = apply(table, step.invested, step.seat, step.token)?;
    let pot = table.dead + after[0] + after[1];
    if let Some(line) = flop_lines.iter().find(|line| line.actions == step.line) {
        let payout = flop.ok_or_else(|| {
            game_error(format!("the flop line {} needs a FlopPayout", line.text()))
        })?;
        if line.flop_pot.get() != pot {
            return Err(game_error(format!("the flop pot of {} is not {pot}", line.text())));
        }
        let realization = [payout.realization_oop, payout.realization_ip];
        let scale_bb = realization.map(|factor| bb(pot) * factor);
        return Ok(Terminal { base_bb: lost(after), scale_bb });
    }
    if after[0] == after[1] && after[0] == table.stack {
        return Ok(Terminal { base_bb: lost(after), scale_bb: [bb(pot); 2] });
    }
    Err(game_error(format!(
        "the line {:?} ends in neither a fold, an all-in nor a flop",
        step.line
    )))
}
