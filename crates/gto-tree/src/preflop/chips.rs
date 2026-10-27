//! The chips of a preflop line (R2.9, R2.19, R2.20, O-136): the one place the blinds are
//! posted and an action line is replayed into chips, shared by the pair-tree builder, the
//! push/fold builder, the preflop solver's game and the fixture generator.
//!
//! Mechanism. Only the two seats of a pair play; every other seat folds, and the blind it
//! posted stays in the pot as dead money, with every seat's ante (O-33). The big blind
//! posts one big blind, 100 centi-big-blinds (cbb); the small blind seat (the button
//! heads-up, else the small blind) posts the stake's ratio of blinds rounded half up to the
//! cbb grid, so the live 1/3 small blind of $1 at a $3 big blind is 33 cbb; any other seat
//! posts nothing. Each seat's stack is the depth less its ante, blinds included. The seats
//! then alternate from the first in preflop order, and each token sets the actor's total
//! for the round, following the `gto_model::ActionToken` semantics:
//!
//! - a fold or a check keeps the actor's total, a call matches the other seat's total,
//! - a limp is one big blind,
//! - `r<cbb>` is a raise to that total, `b<cbb>` a bet of that size on top of what the
//!   actor already has in (postflop the two coincide, since a round starts at zero),
//! - an all-in is the whole stack, and a straddle is refused, since no v1 configuration
//!   posts one.
//!
//! Every total is capped at the stack. The pot is the dead money plus both seats' totals.

use gto_model::{ActionToken, Cbb, GameConfig, ModelError, Position, PositionPair, TableSize};

use crate::error::TreeError;

/// The big blind in cbb.
const BIG_BLIND: Cbb = Cbb::new(Cbb::PER_BB);

/// The seat that posts the small blind at a table of `table_size`: the button heads-up,
/// else the small blind.
#[must_use]
pub fn small_blind_seat(table_size: TableSize) -> Position {
    if table_size == TableSize::HEADS_UP { Position::Btn } else { Position::Sb }
}

/// The blind `seat` posts at `config`, in cbb: one big blind for the big blind, the stake's
/// ratio of blinds rounded half up to the cbb grid for the small blind seat (O-136), and
/// nothing for any other seat.
///
/// # Errors
///
/// `TreeError::Preflop` when the stake has no big blind or the small blind leaves the cbb
/// range.
pub fn blind_of(seat: Position, config: &GameConfig) -> Result<Cbb, TreeError> {
    if seat == Position::Bb {
        return Ok(BIG_BLIND);
    }
    if seat != small_blind_seat(config.table_size) {
        return Ok(Cbb::ZERO);
    }
    let (sb, bb) = (u64::from(config.stake.sb_cents), u64::from(config.stake.bb_cents));
    if bb == 0 {
        return Err(TreeError::Preflop(format!("stake {} has no big blind", config.stake.label)));
    }
    let rounded = (2 * sb * u64::from(Cbb::PER_BB) + bb) / (2 * bb);
    let cbb = u32::try_from(rounded)
        .map_err(|_| TreeError::Preflop("the small blind is too large".to_owned()))?;
    Ok(Cbb::new(cbb))
}

/// The actor's total for the round after `token`, given the actor's total `own`, the other
/// seat's total `other` and the stack, by the token semantics of the module docs, capped at
/// the stack.
///
/// # Errors
///
/// `TreeError::Preflop` for a straddle, `TreeError::Model` when a bet leaves the cbb range.
pub fn total_after(token: ActionToken, own: Cbb, other: Cbb, stack: Cbb) -> Result<Cbb, TreeError> {
    let total = match token {
        ActionToken::Fold | ActionToken::Check => own,
        ActionToken::Call => other,
        ActionToken::Limp => BIG_BLIND,
        ActionToken::Raise(to) => to,
        ActionToken::Bet(size) => own.checked_add(size)?,
        ActionToken::AllIn => stack,
        ActionToken::Straddle(_) => {
            return Err(TreeError::Preflop("straddle pots are not modeled".to_owned()));
        }
    };
    Ok(total.min(stack))
}

/// The chips of a pair at one point of a line. Seats are in pair order: index 0 is out of
/// position, index 1 in position.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ChipState {
    /// The seat to act next, in pair order.
    pub to_act: usize,
    /// Each seat's total for the round, blinds included, in pair order.
    pub invested: [Cbb; 2],
    /// The pot: dead money plus both totals.
    pub pot: Cbb,
}

/// The fixed chip facts of a pair at a configuration: the blinds, the stack, the dead
/// money and the seat that acts first.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PreflopChips {
    pair: PositionPair,
    blinds: [Cbb; 2],
    stack: Cbb,
    dead: Cbb,
    first: usize,
}

impl PreflopChips {
    /// The chips of `pair` at `config`.
    ///
    /// # Errors
    ///
    /// `TreeError::Preflop` for a straddle configuration, a seat of the pair that is not
    /// at the table, or a stake `blind_of` refuses, and `TreeError::Model` when the antes,
    /// the dead money or the stack leave the cbb range.
    pub fn new(config: &GameConfig, pair: PositionPair) -> Result<Self, TreeError> {
        if config.straddle {
            return Err(TreeError::Preflop("straddle pots are not modeled".to_owned()));
        }
        let seated = Position::seated(config.table_size);
        let seats = [pair.oop(), pair.ip()];
        if let Some(missing) = seats.iter().find(|seat| !seated.contains(seat)) {
            let reason = format!("{missing} is not seated at a {} table", config.table_size);
            return Err(TreeError::Preflop(reason));
        }
        let seat_count = u32::from(config.table_size.get());
        let ante = config.ante_cbb;
        let antes = seat_count.checked_mul(ante.get()).ok_or(ModelError::CbbOutOfRange {
            op: "*",
            left: ante.get(),
            right: seat_count,
        })?;
        let mut dead = Cbb::new(antes);
        for seat in seated.iter().filter(|seat| !pair.contains(**seat)) {
            dead = dead.checked_add(blind_of(*seat, config)?)?;
        }
        let blinds = [blind_of(seats[0], config)?, blind_of(seats[1], config)?];
        let first = usize::from(seats[1].preflop_order() < seats[0].preflop_order());
        let stack = config.depth_cbb.checked_sub(ante)?;
        Ok(PreflopChips { pair, blinds, stack, dead, first })
    }

    /// The pair.
    #[must_use]
    pub fn pair(&self) -> PositionPair {
        self.pair
    }

    /// The pair's seats in pair order.
    #[must_use]
    pub fn seats(&self) -> [Position; 2] {
        [self.pair.oop(), self.pair.ip()]
    }

    /// The blinds of the pair's seats, in pair order.
    #[must_use]
    pub fn blinds(&self) -> [Cbb; 2] {
        self.blinds
    }

    /// The stack each seat starts with after its ante, blinds included.
    #[must_use]
    pub fn stack(&self) -> Cbb {
        self.stack
    }

    /// The dead money: every ante plus the blinds of the seats outside the pair.
    #[must_use]
    pub fn dead(&self) -> Cbb {
        self.dead
    }

    /// The state before the first action: the blinds posted, the first seat in preflop
    /// order to act.
    ///
    /// # Errors
    ///
    /// `TreeError::Model` when the pot leaves the cbb range.
    pub fn start(&self) -> Result<ChipState, TreeError> {
        self.state(self.first, self.blinds)
    }

    /// The state after the seat to act in `state` takes `token`; the other seat acts next.
    ///
    /// # Errors
    ///
    /// The errors of `total_after`, and `TreeError::Model` when the pot leaves the cbb range.
    pub fn apply(&self, state: &ChipState, token: ActionToken) -> Result<ChipState, TreeError> {
        let actor = state.to_act;
        let own = state.invested[actor];
        let total = total_after(token, own, state.invested[1 - actor], self.stack)?;
        let mut invested = state.invested;
        invested[actor] = total;
        self.state(1 - actor, invested)
    }

    /// Every state along `line`, step by step: the start, then the state after each
    /// action, so `line.len() + 1` states.
    ///
    /// # Errors
    ///
    /// The errors of `start` and `apply`.
    pub fn replay(&self, line: &[ActionToken]) -> Result<Vec<ChipState>, TreeError> {
        let mut states = Vec::with_capacity(line.len() + 1);
        let mut state = self.start()?;
        states.push(state);
        for token in line {
            state = self.apply(&state, *token)?;
            states.push(state);
        }
        Ok(states)
    }

    /// The state at the end of `line`.
    ///
    /// # Errors
    ///
    /// The errors of `start` and `apply`.
    pub fn after(&self, line: &[ActionToken]) -> Result<ChipState, TreeError> {
        line.iter().try_fold(self.start()?, |state, token| self.apply(&state, *token))
    }

    /// The state with `to_act` next and `invested` in, its pot added up.
    fn state(&self, to_act: usize, invested: [Cbb; 2]) -> Result<ChipState, TreeError> {
        let pot = self.dead.checked_add(invested[0])?.checked_add(invested[1])?;
        Ok(ChipState { to_act, invested, pot })
    }
}

#[cfg(test)]
mod tests;
