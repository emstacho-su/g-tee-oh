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
//! differences of EVs at one node.

use gto_model::{ActionToken, Cbb, ConfigId, GameConfig, HandClass, ModelError, NodeKey, Position};
use gto_tree::{PreflopTree, TreeError};

use crate::equity::EquityTable;

/// The largest best-response gain, in big blinds, either seat may have for a push/fold
/// solution to count as the exact equilibrium (O-223).
pub const CERTIFICATE_GAIN_BB: f64 = 1e-9;

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
}

impl PreflopGame {
    /// The game of `tree` at `config`, valued with `equity`; `flop` is required when the
    /// tree has flop lines.
    ///
    /// # Errors
    ///
    /// `PreflopError::Equity` for a table that is not 169 by 169, `PreflopError::Game` for
    /// a flop line without a payout.
    pub fn new(
        tree: &PreflopTree,
        config: &GameConfig,
        equity: &EquityTable,
        flop: Option<FlopPayout>,
    ) -> Result<Self, PreflopError> {
        let _ = (tree, config, equity, flop);
        Err(PreflopError::NotImplemented("PreflopGame::new"))
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
/// `PreflopError::Model` when the depth is zero or out of range.
pub fn push_fold_config(depth_bb: u32) -> Result<GameConfig, PreflopError> {
    let _ = depth_bb;
    Err(PreflopError::NotImplemented("push_fold_config"))
}

/// Solves `game` with CFR+ until `options` stop it.
///
/// # Errors
///
/// `PreflopError::Game` when the options are degenerate (zero iterations or check
/// interval).
pub fn solve(game: &PreflopGame, options: &CfrOptions) -> Result<SolvedPreflop, PreflopError> {
    let _ = (game, options);
    Err(PreflopError::NotImplemented("solve"))
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
    let _ = (config, equity);
    Err(PreflopError::NotImplemented("solve_push_fold"))
}

/// Each seat's best-response gain in big blinds against the strategy in `solved`, in
/// pair order.
///
/// # Errors
///
/// `PreflopError::Game` when `solved` does not belong to `game`.
pub fn best_response_gains(
    game: &PreflopGame,
    solved: &SolvedPreflop,
) -> Result<[f64; 2], PreflopError> {
    let _ = (game, solved);
    Err(PreflopError::NotImplemented("best_response_gains"))
}
