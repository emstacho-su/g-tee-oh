//! The builder behind `PreflopTree::build` (R2.9, O-136, O-22).
//!
//! Mechanism: the two seats of the pair act in preflop order, the first seat first, and
//! each node offers its actions in a fixed order: fold, then the passive action (check,
//! limp or call), then at most one raise. The raise size depends only on how many raises
//! came before: the open or the isolation raise, then the 3-bet, the 4-bet and the all-in.
//! Every amount is a whole number of centi-big-blinds (cbb), and a raise-to total at or
//! above the stack is the all-in. The children are built depth first, so a parent comes
//! before its children and each flop line is recorded when its last action is reached.

use gto_model::{ActionToken, Cbb, GameConfig, ModelError, Position, PositionPair};

use crate::error::TreeError;
use crate::preflop::{LineKind, PreflopLine, PreflopNode};
use crate::spec::SizingConventionSpec;
use crate::units::{PreflopUnits, preflop_units};

/// The big blind in cbb.
const BIG_BLIND_CBB: u32 = Cbb::PER_BB;

/// Hundredths in a multiplier.
const MULTIPLIER_SCALE: u64 = 100;

/// The raise count of the all-in: open, 3-bet, 4-bet, then the 5-bet all-in (O-136).
const ALL_IN_RAISE: u8 = 4;

/// What the builder produces.
pub(crate) struct Built {
    pub nodes: Vec<PreflopNode>,
    pub lines: Vec<PreflopLine>,
}

/// The fixed facts of one pair tree.
struct Table {
    pair: PositionPair,
    /// The pair's seats in preflop order: index 0 acts first.
    seats: [Position; 2],
    /// The stack each seat starts with after its ante, blinds included.
    stack: u32,
    /// Blinds of folded seats plus every ante.
    dead: u32,
    sizes: PreflopUnits,
    /// The seats allowed to limp.
    limpers: Vec<Position>,
}

/// The betting state at a node. Seat indexes follow `Table::seats`.
#[derive(Clone, Debug)]
struct Pre {
    invested: [u32; 2],
    to_act: usize,
    raises: u8,
    limped: bool,
    all_in: bool,
    aggressor: Option<usize>,
    line: Vec<ActionToken>,
}

/// Where an action leads.
enum Next {
    /// The hand ends before the flop: a fold, or a called all-in.
    Over,
    /// The action closes and the flop is dealt.
    Flop(Pre),
    /// The other seat acts.
    Act(Pre),
}

/// Builds the nodes and flop lines of `pair` at `config` with the sizes of `spec`.
pub(crate) fn build(
    spec: &SizingConventionSpec,
    config: &GameConfig,
    pair: PositionPair,
) -> Result<Built, TreeError> {
    let table = table(spec, config, pair)?;
    let [first, second] = table.seats;
    let root = Pre {
        invested: [blind_of(first, config)?, blind_of(second, config)?],
        to_act: 0,
        raises: 0,
        limped: false,
        all_in: false,
        aggressor: None,
        line: Vec::new(),
    };
    let mut built = Built { nodes: Vec::new(), lines: Vec::new() };
    table.node(&root, &mut built)?;
    Ok(built)
}

/// Checks the configuration and the pair and gathers the facts of the tree.
fn table(
    spec: &SizingConventionSpec,
    config: &GameConfig,
    pair: PositionPair,
) -> Result<Table, TreeError> {
    let sizes = preflop_units(spec)?;
    if config.straddle {
        let reason = match sizes.straddle_cbb {
            None => "the configuration posts a straddle and the spec has no straddle_bb",
            Some(_) => "straddle pots are not built: no v1 configuration posts one",
        };
        return Err(TreeError::Preflop(reason.to_owned()));
    }
    let seated = Position::seated(config.table_size);
    let mut seats = [pair.oop(), pair.ip()];
    if let Some(missing) = seats.iter().find(|seat| !seated.contains(seat)) {
        let reason = format!("{missing} is not seated at a {} table", config.table_size);
        return Err(TreeError::Preflop(reason));
    }
    seats.sort_by_key(|seat| seat.preflop_order());
    let ante = config.ante_cbb;
    let antes = u32::from(config.table_size.get()).checked_mul(ante.get()).ok_or(
        ModelError::CbbOutOfRange {
            op: "*",
            left: ante.get(),
            right: u32::from(config.table_size.get()),
        },
    )?;
    let mut dead = Cbb(antes);
    for seat in seated.iter().filter(|seat| !pair.contains(**seat)) {
        dead = dead.checked_add(Cbb(blind_of(*seat, config)?))?;
    }
    let limpers = match &spec.limp_positions {
        Some(listed) => listed.clone(),
        None => vec![small_blind_seat(config)],
    };
    let stack = config.depth_cbb.checked_sub(ante)?.get();
    Ok(Table { pair, seats, stack, dead: dead.get(), sizes, limpers })
}

/// The seat that posts the small blind: the button heads-up, else the small blind.
fn small_blind_seat(config: &GameConfig) -> Position {
    if config.table_size.get() == 2 { Position::Btn } else { Position::Sb }
}

/// The blind a seat posts in cbb. The small blind is the stake's ratio of blinds, rounded
/// half up to the cbb grid, so the live 1/3 small blind is 33 cbb (O-136).
fn blind_of(seat: Position, config: &GameConfig) -> Result<u32, TreeError> {
    if seat == Position::Bb {
        return Ok(BIG_BLIND_CBB);
    }
    if seat != small_blind_seat(config) {
        return Ok(0);
    }
    let (sb, bb) = (u64::from(config.stake.sb_cents), u64::from(config.stake.bb_cents));
    if bb == 0 {
        return Err(TreeError::Preflop(format!("stake {} has no big blind", config.stake.label)));
    }
    let twice = 2 * sb * u64::from(BIG_BLIND_CBB);
    let rounded = (twice + bb) / (2 * bb);
    u32::try_from(rounded).map_err(|_| TreeError::Preflop("the small blind is too large".into()))
}

/// The raise-to total of a multiplier in hundredths over `raise_to`, rounded half up.
fn multiply(raise_to: u32, multiplier_x100: u32) -> Result<u32, TreeError> {
    let product = u64::from(raise_to) * u64::from(multiplier_x100);
    let rounded = (product + MULTIPLIER_SCALE / 2) / MULTIPLIER_SCALE;
    let overflow = ModelError::CbbOutOfRange { op: "*", left: raise_to, right: multiplier_x100 };
    Ok(u32::try_from(rounded).map_err(|_| overflow)?)
}

/// The kind of pot a line with this many raises takes to the flop.
fn line_kind(raises: u8) -> Result<LineKind, TreeError> {
    match raises {
        0 => Ok(LineKind::Limped),
        1 => Ok(LineKind::SingleRaised),
        2 => Ok(LineKind::ThreeBet),
        3 => Ok(LineKind::FourBet),
        _ => Err(TreeError::Preflop(format!("a line with {raises} raises reached the flop"))),
    }
}

impl Table {
    /// Records the node at `st`, then builds its children depth first.
    fn node(&self, st: &Pre, built: &mut Built) -> Result<(), TreeError> {
        let options = self.options(st)?;
        built.nodes.push(PreflopNode {
            actor: self.seats[st.to_act],
            pot: self.pot(st)?,
            line: st.line.clone(),
            actions: options.iter().map(|(token, _)| *token).collect(),
        });
        for (_, next) in options {
            match next {
                Next::Over => {}
                Next::Flop(flop) => built.lines.push(self.flop_line(&flop)?),
                Next::Act(child) => self.node(&child, built)?,
            }
        }
        Ok(())
    }

    /// The pot at a node: dead money plus both seats' chips.
    fn pot(&self, st: &Pre) -> Result<Cbb, TreeError> {
        let invested = Cbb(st.invested[0]).checked_add(Cbb(st.invested[1]))?;
        Ok(Cbb(self.dead).checked_add(invested)?)
    }

    /// The actions at a node with where each leads, in the order fold, passive, raise.
    fn options(&self, st: &Pre) -> Result<Vec<(ActionToken, Next)>, TreeError> {
        let p = st.to_act;
        let can_limp = self.limpers.contains(&self.seats[p]);
        let mut options = Vec::new();
        if st.raises == 0 && !st.limped {
            options.push((ActionToken::Fold, Next::Over));
            if can_limp {
                let limp = self.put_in(st, ActionToken::Limp, BIG_BLIND_CBB);
                options.push((ActionToken::Limp, Next::Act(Pre { limped: true, ..limp })));
            }
        } else if st.raises == 0 {
            if self.seats[p] == Position::Bb {
                let check = self.put_in(st, ActionToken::Check, st.invested[p]);
                options.push((ActionToken::Check, Next::Flop(check)));
            } else {
                options.push((ActionToken::Fold, Next::Over));
                if can_limp {
                    let limp = self.put_in(st, ActionToken::Limp, BIG_BLIND_CBB);
                    options.push((ActionToken::Limp, Next::Flop(limp)));
                }
            }
        } else {
            options.push((ActionToken::Fold, Next::Over));
            let call = self.put_in(st, ActionToken::Call, st.invested[1 - p]);
            options
                .push((ActionToken::Call, if st.all_in { Next::Over } else { Next::Flop(call) }));
        }
        if !st.all_in && st.raises < ALL_IN_RAISE {
            options.push(self.raise(st)?);
        }
        Ok(options)
    }

    /// The state after the actor puts its total for the round at `total` with `token`.
    fn put_in(&self, st: &Pre, token: ActionToken, total: u32) -> Pre {
        let mut invested = st.invested;
        invested[st.to_act] = total.min(self.stack);
        let line = [st.line.as_slice(), &[token]].concat();
        Pre { invested, to_act: 1 - st.to_act, line, ..st.clone() }
    }

    /// The one raise at a node: its size by the raises before it, all-in at the stack.
    fn raise(&self, st: &Pre) -> Result<(ActionToken, Next), TreeError> {
        let p = st.to_act;
        let faced = st.invested[1 - p].max(BIG_BLIND_CBB);
        let to = match st.raises {
            0 if st.limped => {
                let per_limper = self.sizes.iso_per_limper_cbb;
                Cbb(self.sizes.iso_base_cbb).checked_add(Cbb(per_limper))?.get()
            }
            0 => self.sizes.open_cbb,
            1 if self.seats[p] == self.pair.ip() => multiply(faced, self.sizes.threebet_ip_x100)?,
            1 => multiply(faced, self.sizes.threebet_oop_x100)?,
            2 => multiply(faced, self.sizes.fourbet_x100)?,
            _ => self.stack,
        };
        if to <= faced {
            let reason = format!("a raise to {to} cbb does not exceed the {faced} cbb it faces");
            return Err(TreeError::Preflop(reason));
        }
        let all_in = to >= self.stack;
        let token = if all_in { ActionToken::AllIn } else { ActionToken::Raise(Cbb(to)) };
        let raised = self.put_in(st, token, to);
        let next = Pre { raises: st.raises + 1, all_in, aggressor: Some(p), ..raised };
        Ok((token, Next::Act(next)))
    }

    /// The flop line a closed action reaches.
    fn flop_line(&self, st: &Pre) -> Result<PreflopLine, TreeError> {
        Ok(PreflopLine {
            pair: self.pair,
            actions: st.line.clone(),
            kind: line_kind(st.raises)?,
            flop_pot: self.pot(st)?,
            flop_stack: Cbb(self.stack).checked_sub(Cbb(st.invested[0]))?,
            aggressor: st.aggressor.map(|seat| self.seats[seat]),
        })
    }
}
