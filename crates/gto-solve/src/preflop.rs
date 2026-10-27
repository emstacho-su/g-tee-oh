//! Preflop solving over the 169 hand classes (R2.19, R2.21; 04 section 4, A2 section 4).
//!
//! Mechanism. A preflop tree from `gto-tree` (the push/fold tree of gate G6a, or a pair
//! tree from a sizing convention) becomes a vector game: every decision node holds, per
//! hand class, the actor's strategy over the node's actions. A terminal's value for a
//! pair of classes is a fold (the pot goes to the other seat), an all-in showdown (the
//! pot split by equity), or, only when a `FlopPayout` is given, the flop reached under
//! the P2 treatment of A2 section 4 (pot times equity times a realization factor).
//! Class pairs are weighted by their disjoint combo pair counts from the equity table
//! (O-126), so the class game is the combo game with card removal, exactly: every combo
//! of a class is suit-isomorphic and plays the class strategy.
//!
//! `solve` runs counterfactual regret minimization plus (CFR+) with alternating updates
//! and linear averaging to a target. `solve_push_fold` adds the exact refinement of
//! gate G6a: classes whose average strategy is pure stay pure, the mixed classes are
//! solved from their indifference equations, and the result is certified by an exact best
//! response: each seat's gain at or below `CERTIFICATE_GAIN_BB` (O-223).
//!
//! Expected values (EVs) follow O-224 (the O-175 pot-share convention): the EV of an
//! action is the expected final stack of the actor minus the actor's stack behind at the
//! node, in big blinds, so at the root the two seats' EVs sum to the pot and losses are
//! differences of EVs at one node. The opponent's classes are weighted by their reach and
//! the pairs weights, so "equity" in an EV is the class pair equity averaged that way.
//!
//! Submodules: `game` builds the vector game from the tree, `cfr` holds CFR+, the best
//! response and the exact evaluations, `assemble` turns a strategy into a
//! `SolvedPreflop`, `exact` is the push/fold refinement and `linalg` its Gaussian
//! elimination.

mod assemble;
mod cfr;
mod exact;
mod game;
mod linalg;
#[cfg(test)]
mod tests;

use gto_model::{
    ActionToken, Cbb, ConfigId, GameConfig, GameFormat, HandClass, ModelError, NodeKey, Position,
    RakeModel, Stake, TableSize,
};
use gto_tree::{PreflopTree, TreeError};

use crate::equity::EquityTable;
use game::{CBB_PER_BB, Layout, game_error};

/// The rake model of the rake-free stake: zero percent, zero cap (O-220, ADR 0014).
const NO_RAKE: RakeModel = RakeModel { percent_bp: 0, cap_cents: 0, no_flop_no_drop: true };

/// Percent in one whole.
const PERCENT: f64 = 100.0;

/// The largest best-response gain, in big blinds, either seat may have for a push/fold
/// solution to count as the exact equilibrium (O-223).
pub const CERTIFICATE_GAIN_BB: f64 = 1e-9;

/// The larger of the two seats' best-response gains, in big blinds.
///
/// A NaN in either seat gives NaN: `f64::max` returns the other operand and so would
/// hide a NaN gain behind a finite one, which would let a broken evaluation look
/// certified or converged.
#[must_use]
pub fn larger_gain(gains_bb: [f64; 2]) -> f64 {
    let [first, second] = gains_bb;
    if first.is_nan() || second.is_nan() { f64::NAN } else { first.max(second) }
}

/// Whether `gains_bb` certifies an exact push/fold equilibrium (O-223): both gains are
/// finite and both are at or below `CERTIFICATE_GAIN_BB`. A NaN or infinite gain fails.
#[must_use]
pub fn is_certified(gains_bb: [f64; 2]) -> bool {
    gains_bb.iter().all(|gain| gain.is_finite() && *gain <= CERTIFICATE_GAIN_BB)
}

/// The label of the rake-free stake gate G6a solves at (O-220): it reads `norake` in the
/// configuration identifier, as in `cfg_2_online_norake_10`.
pub const NO_RAKE_STAKE_LABEL: &str = "norake";

/// The small and big blind of the rake-free stake in cents (O-220).
pub const NO_RAKE_BLINDS_CENTS: (u32, u32) = (50, 100);

/// Errors of the preflop solver.
#[derive(Debug, thiserror::Error)]
pub enum PreflopError {
    /// A part of the solver that the session skeleton has not filled yet.
    #[error("not implemented yet: {0}")]
    NotImplemented(&'static str),
    /// The tree could not be built.
    #[error(transparent)]
    Tree(#[from] TreeError),
    /// A configuration or amount was invalid.
    #[error(transparent)]
    Model(#[from] ModelError),
    /// The equity table does not have 169 rows of 169 entries.
    #[error("invalid equity table: {0}")]
    Equity(String),
    /// The tree has a terminal the game cannot value, such as a flop line with no
    /// `FlopPayout`.
    #[error("invalid preflop game: {0}")]
    Game(String),
    /// The exact refinement did not produce a certified equilibrium.
    #[error("the best-response certificate failed: gains {gains_bb:?} bb")]
    Certificate {
        /// Each seat's best-response gain in pair order.
        gains_bb: [f64; 2],
    },
}

/// The P2 flop payout (A2 section 4, O-227): reaching the flop pays the pot times the
/// hand's equity times a realization factor per seat.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FlopPayout {
    /// The out-of-position seat's realization factor.
    pub realization_oop: f64,
    /// The in-position seat's realization factor.
    pub realization_ip: f64,
}

impl FlopPayout {
    /// The labeled placeholder of the spike: realization 1.0 for both seats, since no
    /// equity-realization tables exist yet (O-227).
    pub const PLACEHOLDER: FlopPayout = FlopPayout { realization_oop: 1.0, realization_ip: 1.0 };
}

/// When `solve` stops.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CfrOptions {
    /// The iteration cap.
    pub max_iterations: u32,
    /// Stop once both seats' best-response gains are at or below this percent of the
    /// starting pot (the O-138 measure).
    pub target_gain_pct_pot: f64,
    /// How often, in iterations, the gains are measured.
    pub check_every: u32,
}

/// A preflop tree turned into a vector game over the 169 classes.
#[derive(Clone, Debug)]
pub struct PreflopGame {
    config: GameConfig,
    tree: PreflopTree,
    flop: Option<FlopPayout>,
    layout: Layout,
}

impl PreflopGame {
    /// The game of `tree` at `config`, valued with `equity`; `flop` is required when the
    /// tree has flop lines.
    ///
    /// # Errors
    ///
    /// `PreflopError::Equity` for a table that is not 169 by 169, `PreflopError::Game` for
    /// a flop line without a payout, a straddle, or a tree whose pots the replay of its
    /// lines does not reproduce.
    pub fn new(
        tree: &PreflopTree,
        config: &GameConfig,
        equity: &EquityTable,
        flop: Option<FlopPayout>,
    ) -> Result<Self, PreflopError> {
        let layout = game::layout(tree, config, equity, flop)?;
        Ok(PreflopGame { config: config.clone(), tree: tree.clone(), flop, layout })
    }

    /// The pot at the root in big blinds.
    fn starting_pot_bb(&self) -> f64 {
        self.tree.nodes().first().map_or(0.0, |root| f64::from(root.pot.get()) / CBB_PER_BB)
    }

    /// The configuration.
    #[must_use]
    pub fn config(&self) -> &GameConfig {
        &self.config
    }

    /// The tree.
    #[must_use]
    pub fn tree(&self) -> &PreflopTree {
        &self.tree
    }

    /// The flop payout, when the game has one.
    #[must_use]
    pub fn flop(&self) -> Option<FlopPayout> {
        self.flop
    }
}

/// One hand class at a solved node.
#[derive(Clone, Debug, PartialEq)]
pub struct SolvedClass {
    /// The class.
    pub class: HandClass,
    /// The probability each seat's own actions reach the node with this class, in pair
    /// order (out of position first).
    pub reach: [f64; 2],
    /// The actor's frequency per action, in the node's action order, summing to 1.
    pub frequencies: Vec<f64>,
    /// The actor's EV per action in big blinds (O-224).
    pub ev_bb: Vec<f64>,
}

/// One solved decision node.
#[derive(Clone, Debug, PartialEq)]
pub struct SolvedPreflopNode {
    /// The node key.
    pub key: NodeKey,
    /// The seat to act.
    pub actor: Position,
    /// The pot at the node.
    pub pot: Cbb,
    /// The stacks behind in pair order.
    pub stacks: [Cbb; 2],
    /// The actions in tree order.
    pub actions: Vec<ActionToken>,
    /// The 169 classes in `HandClass` index order.
    pub hands: Vec<SolvedClass>,
}

/// A solved preflop game.
#[derive(Clone, Debug, PartialEq)]
pub struct SolvedPreflop {
    /// The configuration identifier.
    pub config_id: ConfigId,
    /// The decision nodes, a parent before its children.
    pub nodes: Vec<SolvedPreflopNode>,
    /// Iterations run.
    pub iterations: u32,
    /// Each seat's best-response gain in big blinds, in pair order.
    pub gains_bb: [f64; 2],
    /// The pot at the root, blinds included.
    pub starting_pot: Cbb,
}

/// The heads-up rake-free configuration of gate G6a at `depth_bb` (O-220).
///
/// # Errors
///
/// `PreflopError::Game` when the depth is zero, `PreflopError::Model` when it is out of
/// the cbb range.
pub fn push_fold_config(depth_bb: u32) -> Result<GameConfig, PreflopError> {
    if depth_bb == 0 {
        return Err(game_error("a push/fold depth is at least 1 bb"));
    }
    let depth = depth_bb.checked_mul(Cbb::PER_BB).ok_or(ModelError::CbbOutOfRange {
        op: "*",
        left: depth_bb,
        right: Cbb::PER_BB,
    })?;
    let (sb_cents, bb_cents) = NO_RAKE_BLINDS_CENTS;
    let stake = Stake::new(NO_RAKE_STAKE_LABEL, sb_cents, bb_cents, NO_RAKE)?;
    Ok(GameConfig::new(GameFormat::Online, TableSize::HEADS_UP, stake, Cbb::new(depth)))
}

/// Solves `game` with CFR+ until `options` stop it: the gains of the average strategy
/// are measured every `check_every` iterations and after the last one, and the run stops
/// once both are at or below `target_gain_pct_pot` percent of the starting pot.
///
/// # Errors
///
/// `PreflopError::Game` when the options are degenerate (zero iterations or check
/// interval, or a target that is negative or not finite).
pub fn solve(game: &PreflopGame, options: &CfrOptions) -> Result<SolvedPreflop, PreflopError> {
    let target_ok = options.target_gain_pct_pot.is_finite() && options.target_gain_pct_pot >= 0.0;
    if options.max_iterations == 0 || options.check_every == 0 || !target_ok {
        return Err(game_error(format!("degenerate CFR+ options {options:?}")));
    }
    let target_bb = options.target_gain_pct_pot / PERCENT * game.starting_pot_bb();
    let mut state = cfr::Cfr::new(&game.layout);
    let mut gains_bb = [f64::INFINITY; 2];
    while state.iterations() < options.max_iterations {
        state.iterate(&game.layout);
        let done = state.iterations() == options.max_iterations;
        if done || state.iterations() % options.check_every == 0 {
            gains_bb = cfr::gains(&game.layout, &state.average(&game.layout));
            if gains_bb.iter().all(|gain| *gain <= target_bb) {
                break;
            }
        }
    }
    let average = state.average(&game.layout);
    Ok(assemble::assemble(game, &average, state.iterations(), gains_bb))
}

/// Solves the push/fold game at `config` exactly: CFR+ for the support, the indifference
/// refinement, then the best-response certificate (O-223).
///
/// # Errors
///
/// `PreflopError::Certificate` when no certified equilibrium was found within the bounded
/// retries, plus the errors of `PreflopTree::push_fold` and `PreflopGame::new`.
pub fn solve_push_fold(
    config: &GameConfig,
    equity: &EquityTable,
) -> Result<SolvedPreflop, PreflopError> {
    let tree = PreflopTree::push_fold(config)?;
    let game = PreflopGame::new(&tree, config, equity, None)?;
    let (profile, iterations) = exact::solve(&game.layout)?;
    let gains_bb = certified(cfr::gains(&game.layout, &profile))?;
    Ok(assemble::assemble(&game, &profile, iterations, gains_bb))
}

/// `gains_bb` back when they certify the push/fold solution (`is_certified`, O-223), else
/// `PreflopError::Certificate` carrying them.
fn certified(gains_bb: [f64; 2]) -> Result<[f64; 2], PreflopError> {
    if is_certified(gains_bb) { Ok(gains_bb) } else { Err(PreflopError::Certificate { gains_bb }) }
}

/// Each seat's best-response gain in big blinds per hand dealt against the strategy in
/// `solved`, in pair order: the value of the seat's best response minus the value of
/// its strategy, both against the other seat's strategy.
///
/// # Errors
///
/// `PreflopError::Game` when `solved` does not belong to `game`.
pub fn best_response_gains(
    game: &PreflopGame,
    solved: &SolvedPreflop,
) -> Result<[f64; 2], PreflopError> {
    let profile = assemble::profile_of(game, solved)?;
    Ok(cfr::gains(&game.layout, &profile))
}
