//! The builder behind `PreflopTree::build` (R2.9, O-136, O-22).
//!
//! Mechanism: the two seats of the pair act in preflop order, the first seat first, and
//! each node offers its actions in a fixed order: fold, then the passive action (check,
//! limp or call), then at most one raise. The raise size depends only on how many raises
//! came before: the open or the isolation raise, then the 3-bet, the 4-bet and the all-in.
//! Every amount is a whole number of centi-big-blinds (cbb), and a raise-to total at or
//! above the stack is the all-in. The blinds, the dead money and every action's chips come
//! from the shared chip replay (`PreflopChips`), the one the preflop solver and the fixture
//! generator use too. The children are built depth first, so a parent comes before its
//! children and each flop line is recorded when its last action is reached.

use gto_model::{ActionToken, Cbb, GameConfig, ModelError, Position, PositionPair};

use crate::error::TreeError;
use crate::preflop::{ChipState, LineKind, PreflopChips, PreflopLine, PreflopNode};
use crate::spec::SizingConventionSpec;
use crate::units::{PreflopUnits, preflop_units};

use super::chips::small_blind_seat;

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
    /// The pair's seats in pair order: index 0 is out of position.
    seats: [Position; 2],
    /// The blinds, the stack and the dead money of the pair.
    chips: PreflopChips,
    sizes: PreflopUnits,
    /// The seats allowed to limp.
    limpers: Vec<Position>,
}

/// The betting state at a node. Seat indexes are in pair order, as in `ChipState`.
#[derive(Clone, Debug)]
struct Pre {
    chips: ChipState,
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
    let root = Pre {
        chips: table.chips.start()?,
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
    let chips = PreflopChips::new(config, pair)?;
    let limpers = match &spec.limp_positions {
        Some(listed) => listed.clone(),
        None => vec![small_blind_seat(config.table_size)],
    };
    Ok(Table { pair, seats: chips.seats(), chips, sizes, limpers })
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
            actor: self.seats[st.chips.to_act],
            pot: st.chips.pot,
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

    /// The actions at a node with where each leads, in the order fold, passive, raise.
    fn options(&self, st: &Pre) -> Result<Vec<(ActionToken, Next)>, TreeError> {
        let actor = self.seats[st.chips.to_act];
        let can_limp = self.limpers.contains(&actor);
        let mut options = Vec::new();
        if st.raises == 0 && !st.limped {
            options.push((ActionToken::Fold, Next::Over));
            if can_limp {
                let limp = self.put_in(st, ActionToken::Limp)?;
                options.push((ActionToken::Limp, Next::Act(Pre { limped: true, ..limp })));
            }
        } else if st.raises == 0 {
            if actor == Position::Bb {
                let check = self.put_in(st, ActionToken::Check)?;
                options.push((ActionToken::Check, Next::Flop(check)));
            } else {
                options.push((ActionToken::Fold, Next::Over));
                if can_limp {
                    let limp = self.put_in(st, ActionToken::Limp)?;
                    options.push((ActionToken::Limp, Next::Flop(limp)));
                }
            }
        } else {
            options.push((ActionToken::Fold, Next::Over));
            let call = self.put_in(st, ActionToken::Call)?;
            options
                .push((ActionToken::Call, if st.all_in { Next::Over } else { Next::Flop(call) }));
        }
        if !st.all_in && st.raises < ALL_IN_RAISE {
            options.push(self.raise(st)?);
        }
        Ok(options)
    }

    /// The state after the actor takes `token`, its chips from the shared replay.
    fn put_in(&self, st: &Pre, token: ActionToken) -> Result<Pre, TreeError> {
        let chips = self.chips.apply(&st.chips, token)?;
        let line = [st.line.as_slice(), &[token]].concat();
        Ok(Pre { chips, line, ..st.clone() })
    }

    /// The one raise at a node: its size by the raises before it, all-in at the stack.
    fn raise(&self, st: &Pre) -> Result<(ActionToken, Next), TreeError> {
        let p = st.chips.to_act;
        let stack = self.chips.stack().get();
        let faced = st.chips.invested[1 - p].get().max(BIG_BLIND_CBB);
        let to = match st.raises {
            0 if st.limped => {
                let per_limper = self.sizes.iso_per_limper_cbb;
                Cbb(self.sizes.iso_base_cbb).checked_add(Cbb(per_limper))?.get()
            }
            0 => self.sizes.open_cbb,
            1 if self.seats[p] == self.pair.ip() => multiply(faced, self.sizes.threebet_ip_x100)?,
            1 => multiply(faced, self.sizes.threebet_oop_x100)?,
            2 => multiply(faced, self.sizes.fourbet_x100)?,
            _ => stack,
        };
        if to <= faced {
            let reason = format!("a raise to {to} cbb does not exceed the {faced} cbb it faces");
            return Err(TreeError::Preflop(reason));
        }
        let all_in = to >= stack;
        let token = if all_in { ActionToken::AllIn } else { ActionToken::Raise(Cbb(to)) };
        let raised = self.put_in(st, token)?;
        let next = Pre { raises: st.raises + 1, all_in, aggressor: Some(p), ..raised };
        Ok((token, Next::Act(next)))
    }

    /// The flop line a closed action reaches; both seats have the same chips in by then.
    fn flop_line(&self, st: &Pre) -> Result<PreflopLine, TreeError> {
        Ok(PreflopLine {
            pair: self.pair,
            actions: st.line.clone(),
            kind: line_kind(st.raises)?,
            flop_pot: st.chips.pot,
            flop_stack: self.chips.stack().checked_sub(st.chips.invested[0])?,
            aggressor: st.aggressor.map(|seat| self.seats[seat]),
        })
    }
}
