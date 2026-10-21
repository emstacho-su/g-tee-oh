//! The builder behind `ActionTree::build` (R2.9, R2.10). It is a copy of the vendored
//! engine's tree builder (`tree.rs`: `betting_node`, `sizing_amounts`, `aggress_child`,
//! `call_child`, `end_street`, `chance`) with the cards taken out.
//!
//! Mechanism: chips are f64 big blinds (bb) on the engine's 0.01 grid and every operation
//! runs in the engine's order with the engine's constants, so each amount is bit for bit
//! the engine's. A percent is `bp / 100` and the all-in threshold `bp / 100`, the values
//! the solver adapter hands the engine. Where the engine deals every card at a chance node,
//! the builder follows one card, so each count is per runout. Amounts leave the builder as
//! centi-big-blinds (cbb), exact because one grid step is one cbb.

use gto_model::{ActionToken, Bucket, Cbb, Street, format_line};

use crate::error::TreeError;
use crate::player::Player;
use crate::postflop::action_tree::{
    DecisionNode, MAX_SKELETON_NODES, RootState, SkeletonCounts, StreetCounts,
};
use crate::postflop::config::{SizeKind, TreeConfig};
use crate::units::round_to_u32;

/// The engine's smallest chip in bb (`MIN_CHIP`).
const MIN_CHIP: f64 = 0.01;

/// The engine's tolerance when it compares chip amounts (`EPS`).
const EPS: f64 = 1e-6;

/// cbb per bb, which is also the engine's chip steps per bb.
const CBB_PER_BB: f64 = 100.0;

/// The divisor from bp to a percent, and from a percent to a fraction.
const PERCENT: f64 = 100.0;

/// The engine's betting state at a node (`State` in `tree.rs`), without the board.
#[derive(Clone, Copy, Debug)]
struct State {
    street: Street,
    pot: f64,
    stacks: [f64; 2],
    bets: [f64; 2],
    to_act: Player,
    acted: bool,
    raises: u32,
    last_raise: f64,
    street_aggressor: Option<Player>,
    prev_aggressor: Option<Player>,
}

/// One action at a node, with what the child needs.
#[derive(Clone, Copy, Debug)]
enum Move {
    Fold,
    Call { to_call: f64 },
    Check,
    Aggress { to: f64, facing: bool, is_allin: bool },
}

impl Move {
    /// The action token: a bet carries its size, a raise its raise-to total.
    fn token(self) -> Result<ActionToken, TreeError> {
        Ok(match self {
            Move::Fold => ActionToken::Fold,
            Move::Call { .. } => ActionToken::Call,
            Move::Check => ActionToken::Check,
            Move::Aggress { is_allin: true, .. } => ActionToken::AllIn,
            Move::Aggress { to, facing: true, .. } => ActionToken::Raise(to_cbb(to)?),
            Move::Aggress { to, facing: false, .. } => ActionToken::Bet(to_cbb(to)?),
        })
    }
}

/// What the builder produces: the decision nodes in the engine's order and the counts.
pub(crate) struct Skeleton {
    pub nodes: Vec<DecisionNode>,
    pub counts: SkeletonCounts,
}

/// Builds the skeleton of `cfg` from a root that `ActionTree::build` has checked.
pub(crate) fn build(cfg: &TreeConfig, root: RootState) -> Result<Skeleton, TreeError> {
    let mut builder = Builder {
        cfg,
        threshold_pct: f64::from(cfg.allin_threshold_bp()) / PERCENT,
        nodes: Vec::new(),
        counts: SkeletonCounts::default(),
        total: 0,
    };
    let state = State {
        street: root.street,
        pot: to_bb(root.pot),
        stacks: [to_bb(root.stack); 2],
        bets: [0.0; 2],
        to_act: Player::Oop,
        acted: false,
        raises: 0,
        last_raise: 0.0,
        street_aggressor: None,
        prev_aggressor: None,
    };
    builder.betting_node(state, &[])?;
    Ok(Skeleton { nodes: builder.nodes, counts: builder.counts })
}

/// cbb to the engine's bb, the division the solver adapter makes.
fn to_bb(amount: Cbb) -> f64 {
    f64::from(amount.get()) / CBB_PER_BB
}

/// An engine amount in bb to cbb.
fn to_cbb(chips: f64) -> Result<Cbb, TreeError> {
    round_to_u32(chips * CBB_PER_BB)
        .map(Cbb)
        .ok_or_else(|| TreeError::Root(format!("{chips} bb leaves the cbb range")))
}

/// The engine's `round_chips`: to the nearest 0.01 bb.
fn round_chips(chips: f64) -> f64 {
    (chips * CBB_PER_BB).round() / CBB_PER_BB
}

/// The engine's `push_unique`: drops an amount already offered.
fn push_unique(out: &mut Vec<(bool, f64)>, is_allin: bool, to: f64) {
    if !out.iter().any(|&(_, offered)| (offered - to).abs() < EPS) {
        out.push((is_allin, to));
    }
}

/// The ADR 0020 check: the sized actions at a node must fall in distinct buckets, each
/// against the pot at the node (O-137).
fn check_buckets(line: &[ActionToken], actions: &[ActionToken], pot: Cbb) -> Result<(), TreeError> {
    let mut seen: Vec<Bucket> = Vec::with_capacity(actions.len());
    for action in actions {
        if let Some(bucket) = Bucket::of_action(*action, pot)? {
            if seen.contains(&bucket) {
                return Err(TreeError::BucketCollision { line: format_line(line), bucket });
            }
            seen.push(bucket);
        }
    }
    Ok(())
}

struct Builder<'a> {
    cfg: &'a TreeConfig,
    threshold_pct: f64,
    nodes: Vec<DecisionNode>,
    counts: SkeletonCounts,
    total: u64,
}

impl Builder<'_> {
    /// The counts of a street. A preflop root is refused before the build, so preflop
    /// never arrives here; it shares the flop's slot only to keep the match total.
    fn street_counts(&mut self, street: Street) -> &mut StreetCounts {
        match street {
            Street::Preflop | Street::Flop => &mut self.counts.flop,
            Street::Turn => &mut self.counts.turn,
            Street::River => &mut self.counts.river,
        }
    }

    /// Counts one more node of any kind against `MAX_SKELETON_NODES`.
    fn add_node(&mut self) -> Result<(), TreeError> {
        self.total += 1;
        if self.total > MAX_SKELETON_NODES {
            return Err(TreeError::TooLarge { limit: MAX_SKELETON_NODES });
        }
        Ok(())
    }

    /// The engine's `betting_node`: records the node, then builds each child in order.
    fn betting_node(&mut self, st: State, line: &[ActionToken]) -> Result<(), TreeError> {
        self.add_node()?;
        let moves = self.moves(&st);
        let actions = moves.iter().map(|mv| mv.token()).collect::<Result<Vec<_>, _>>()?;
        let pot = to_cbb(st.pot)?;
        check_buckets(line, &actions, pot)?;
        let counts = self.street_counts(st.street);
        counts.decision += 1;
        counts.actions += actions.len() as u64;
        self.nodes.push(DecisionNode {
            street: st.street,
            player: st.to_act,
            pot,
            stacks: [to_cbb(st.stacks[0])?, to_cbb(st.stacks[1])?],
            line: line.to_vec(),
            actions: actions.clone(),
        });
        for (mv, token) in moves.into_iter().zip(actions) {
            self.child(&st, mv, &[line, &[token]].concat())?;
        }
        Ok(())
    }

    /// The actions at a node in the engine's order: fold and call, or check, then sizes.
    fn moves(&self, st: &State) -> Vec<Move> {
        let p = st.to_act.index();
        let o = 1 - p;
        let to_call = (st.bets[o] - st.bets[p]).clamp(0.0, st.stacks[p]);
        let facing = to_call > EPS;
        let mut moves =
            if facing { vec![Move::Fold, Move::Call { to_call }] } else { vec![Move::Check] };
        let under_cap = !facing || st.raises < u32::from(self.cfg.raise_cap());
        if under_cap && st.stacks[p] > to_call + EPS && st.stacks[o] > EPS {
            let sized = self.sizing_amounts(st).into_iter();
            moves.extend(sized.map(|(is_allin, to)| Move::Aggress { to, facing, is_allin }));
        }
        moves
    }

    /// The engine's `sizing_amounts`: each size of the table that applies, rounded to the
    /// chip grid, floored at the min-raise, capped at the stack and turned into an all-in
    /// past the threshold, without repeats, then the table's own all-in.
    fn sizing_amounts(&self, st: &State) -> Vec<(bool, f64)> {
        let p = st.to_act.index();
        let o = 1 - p;
        let to_call = (st.bets[o] - st.bets[p]).max(0.0);
        let facing = to_call > EPS;
        let kind = if facing {
            SizeKind::Raise
        } else if st.to_act == Player::Oop && st.prev_aggressor == Some(Player::Ip) {
            SizeKind::Donk
        } else {
            SizeKind::Bet
        };
        let Some(tables) = self.cfg.player(st.to_act).street(st.street) else {
            return Vec::new();
        };
        let table = tables.kind(kind);
        let shove_to = st.bets[p] + st.stacks[p];
        let min_to = if facing {
            (st.bets[o] + st.last_raise.max(MIN_CHIP)).min(shove_to)
        } else {
            MIN_CHIP.min(shove_to)
        };
        let allin_at = self.threshold_pct / PERCENT * st.stacks[p];
        let mut out: Vec<(bool, f64)> = Vec::new();
        for &size_bp in table.sizes_bp() {
            let pct = f64::from(size_bp) / PERCENT;
            let raw = if facing {
                st.bets[o] + (st.pot + to_call) * pct / PERCENT
            } else {
                st.bets[p] + st.pot * pct / PERCENT
            };
            let to = round_chips(raw).clamp(min_to, shove_to);
            let added = to - st.bets[p];
            if added <= EPS {
                continue;
            }
            let is_allin = added + EPS >= allin_at || to >= shove_to - EPS;
            push_unique(&mut out, is_allin, if is_allin { shove_to } else { to });
        }
        if table.allin() {
            push_unique(&mut out, true, shove_to);
        }
        out
    }

    /// Builds the child of one action.
    fn child(&mut self, st: &State, mv: Move, line: &[ActionToken]) -> Result<(), TreeError> {
        match mv {
            Move::Fold => {
                self.add_node()?;
                self.street_counts(st.street).fold += 1;
                Ok(())
            }
            Move::Call { to_call } => self.call_child(st, to_call, line),
            Move::Check if st.acted => self.end_street(*st, line),
            Move::Check => {
                let next = State { to_act: st.to_act.other(), acted: true, ..*st };
                self.betting_node(next, line)
            }
            Move::Aggress { to, facing, .. } => self.aggress_child(st, to, facing, line),
        }
    }

    /// The engine's `aggress_child`.
    fn aggress_child(
        &mut self,
        st: &State,
        to: f64,
        facing: bool,
        line: &[ActionToken],
    ) -> Result<(), TreeError> {
        let p = st.to_act.index();
        let o = 1 - p;
        let added = to - st.bets[p];
        let mut next = *st;
        next.bets[p] = to;
        next.stacks[p] = (st.stacks[p] - added).max(0.0);
        next.pot = st.pot + added;
        next.last_raise = to - st.bets[o];
        next.to_act = st.to_act.other();
        next.acted = true;
        next.street_aggressor = Some(st.to_act);
        if facing {
            next.raises += 1;
        }
        self.betting_node(next, line)
    }

    /// The engine's `call_child`.
    fn call_child(
        &mut self,
        st: &State,
        to_call: f64,
        line: &[ActionToken],
    ) -> Result<(), TreeError> {
        let p = st.to_act.index();
        let mut next = *st;
        next.bets[p] += to_call;
        next.stacks[p] = (st.stacks[p] - to_call).max(0.0);
        next.pot = st.pot + to_call;
        self.end_street(next, line)
    }

    /// The engine's `end_street`: a showdown after the river, else a chance node.
    fn end_street(&mut self, st: State, line: &[ActionToken]) -> Result<(), TreeError> {
        let all_in = st.stacks[0] <= EPS || st.stacks[1] <= EPS;
        match st.street.next() {
            None => {
                self.add_node()?;
                self.street_counts(st.street).showdown += 1;
                Ok(())
            }
            Some(next) => self.chance(st, next, all_in, line),
        }
    }

    /// The engine's `chance`, following one card. The node is counted on the street it
    /// closes; with no chips behind the next street is dealt with no betting.
    fn chance(
        &mut self,
        st: State,
        next: Street,
        betless: bool,
        line: &[ActionToken],
    ) -> Result<(), TreeError> {
        self.add_node()?;
        self.street_counts(st.street).chance += 1;
        let dealt = State {
            street: next,
            bets: [0.0; 2],
            to_act: Player::Oop,
            acted: false,
            raises: 0,
            last_raise: 0.0,
            prev_aggressor: st.street_aggressor,
            street_aggressor: None,
            ..st
        };
        if betless { self.end_street(dealt, line) } else { self.betting_node(dealt, line) }
    }
}
