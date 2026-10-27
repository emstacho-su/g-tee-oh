//! The preflop tree of one position pair (R2.9, O-136, O-22).
//!
//! Mechanism: the tree holds only the two seats of the pair; every other seat folds, and a
//! blind posted by a folded seat stays in the pot as dead money. The blinds come from the
//! game configuration's stake in centi-big-blinds (cbb), and a small blind off the cbb grid
//! rounds half up, so the live 1/3 small blind of $1 at a $3 big blind is 33 cbb. Every
//! seat's ante (zero in v1, O-33) is dead money taken from its stack. The sizes come from
//! the sizing convention spec:
//!
//! - The first seat folds, limps or opens; an open raise is `open_bb`. A limp is allowed
//!   from the small blind (SB) only (the button heads-up), or from the seats in
//!   `limp_positions`. The big blind (BB) answers a limp with a check or an isolation raise
//!   of `iso_rule.base_bb` plus `iso_rule.per_limper_bb` per limper; any other seat folds,
//!   limps behind when it may limp, or makes the same isolation raise.
//! - A 3-bet is `threebet_ip` or `threebet_oop` times the raise it answers, chosen by the
//!   3-bettor's postflop position, a 4-bet is `fourbet` times the 3-bet, and the 5-bet is
//!   all-in.
//! - Raise-to totals round to the cbb grid and stop at the effective stack, where the raise
//!   becomes an all-in.
//!
//! Each node therefore offers one raise size, so Grouped mode can show the exact size at a
//! preflop node (O-22). A line that ends with a call, or with the BB's check after a limp,
//! goes to the flop as a `PreflopLine` carrying the flop pot and the stack behind; a line
//! that is all-in before the flop has no flop line.

mod builder;
mod push_fold;

use gto_model::{ActionToken, Cbb, GameConfig, Position, PositionPair, Street, format_line};

use crate::error::TreeError;
use crate::postflop::RootState;
use crate::spec::SizingConventionSpec;

/// The kind of pot a line takes to the flop, by the number of raises before it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum LineKind {
    /// No raise: a limp checked through.
    Limped,
    /// One raise, called (an open or an isolation raise).
    SingleRaised,
    /// Two raises, the second called.
    ThreeBet,
    /// Three raises, the third called.
    FourBet,
}

impl LineKind {
    /// The kebab-case name: `limped`, `single-raised`, `three-bet` or `four-bet`.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            LineKind::Limped => "limped",
            LineKind::SingleRaised => "single-raised",
            LineKind::ThreeBet => "three-bet",
            LineKind::FourBet => "four-bet",
        }
    }
}

/// A preflop line that reaches the flop, with the state a postflop solve starts from.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct PreflopLine {
    /// The two seats, out of position first.
    pub pair: PositionPair,
    /// The pair's actions in order; the folds of the other seats are implied.
    pub actions: Vec<ActionToken>,
    /// The kind of pot.
    pub kind: LineKind,
    /// The pot on the flop, dead blinds included.
    pub flop_pot: Cbb,
    /// The effective stack behind on the flop.
    pub flop_stack: Cbb,
    /// The seat that made the last raise, or `None` in a limped pot.
    pub aggressor: Option<Position>,
}

impl PreflopLine {
    /// The actions as a dotted line, for example `r250.c` (`gto_model::format_line`).
    #[must_use]
    pub fn text(&self) -> String {
        format_line(&self.actions)
    }

    /// The postflop root of this line: the flop, `flop_pot` and `flop_stack`.
    #[must_use]
    pub fn flop_root(&self) -> RootState {
        RootState { street: Street::Flop, pot: self.flop_pot, stack: self.flop_stack }
    }
}

/// One decision node of a preflop tree.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct PreflopNode {
    /// The seat to act.
    pub actor: Position,
    /// The pot at the node, blinds and outstanding bets included.
    pub pot: Cbb,
    /// The pair's actions from the start of the hand to this node.
    pub line: Vec<ActionToken>,
    /// The actions at this node, with at most one raise size.
    pub actions: Vec<ActionToken>,
}

/// The preflop tree of one position pair at one game configuration.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PreflopTree {
    pair: PositionPair,
    nodes: Vec<PreflopNode>,
    lines: Vec<PreflopLine>,
}

impl PreflopTree {
    /// Builds the tree of `pair` at `config` with the sizes of `spec`.
    ///
    /// # Errors
    ///
    /// `TreeError::Preflop` when a seat of the pair is not at the table, when the
    /// configuration posts a straddle (no v1 configuration does, so straddle trees are not
    /// built yet), or when a raise does not exceed the bet it faces, `TreeError::OffGrid` or
    /// `TreeError::Spec` for a spec that did not come through
    /// `SizingConventionSpec::from_json`, and `TreeError::Model` when an amount leaves the
    /// cbb range.
    pub fn build(
        spec: &SizingConventionSpec,
        config: &GameConfig,
        pair: PositionPair,
    ) -> Result<Self, TreeError> {
        let built = builder::build(spec, config, pair)?;
        Ok(PreflopTree { pair, nodes: built.nodes, lines: built.lines })
    }

    /// Builds the heads-up push/fold tree of gate G6a (R2.19, 04 section 4): the button,
    /// who posts the small blind, folds or moves all-in; the big blind facing the all-in
    /// folds or calls. The pair is `BB-BTN`, the stacks are `config.depth_cbb` before the
    /// blinds, and the tree has no flop line, since every non-fold line is all-in.
    ///
    /// # Errors
    ///
    /// `TreeError::Preflop` when the configuration is not heads-up, posts a straddle or an
    /// ante, or its stack does not cover the big blind, and `TreeError::Model` when an
    /// amount leaves the cbb range.
    pub fn push_fold(config: &GameConfig) -> Result<Self, TreeError> {
        let built = push_fold::build(config)?;
        Ok(PreflopTree { pair: built.pair, nodes: built.nodes, lines: Vec::new() })
    }

    /// The pair the tree was built for.
    #[must_use]
    pub fn pair(&self) -> PositionPair {
        self.pair
    }

    /// The decision nodes, depth first, a parent before its children.
    #[must_use]
    pub fn nodes(&self) -> &[PreflopNode] {
        &self.nodes
    }

    /// Every line that reaches the flop, in the depth-first order of the tree.
    #[must_use]
    pub fn flop_lines(&self) -> &[PreflopLine] {
        &self.lines
    }
}

#[cfg(test)]
mod tests {
    use super::LineKind;

    #[test]
    fn r2_9_line_kinds_have_kebab_case_names() {
        let names: Vec<&str> =
            [LineKind::Limped, LineKind::SingleRaised, LineKind::ThreeBet, LineKind::FourBet]
                .iter()
                .map(|kind| kind.as_str())
                .collect();
        assert_eq!(names, ["limped", "single-raised", "three-bet", "four-bet"]);
        assert!(LineKind::Limped < LineKind::FourBet, "kinds order by raises");
    }
}
