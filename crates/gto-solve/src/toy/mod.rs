//! Toy games for the validation gates G1 to G3 (R2.4, R2.5, R2.6): Kuhn poker, the AKQ
//! (ace, king, queen) half-street game, the polar river toy and Leduc hold'em, solved
//! through the vendored engine and measured by its best-response calculator, behind the
//! vocabulary of the fixtures under `validation/fixtures/toy-games/`.
//!
//! Mechanism. A [`ToyGame`] names a game and its betting parameters. [`solve_dcfr`]
//! builds the engine model of that game, runs discounted counterfactual regret
//! minimization (DCFR) with the engine's default schedule in chunks until the
//! [`StopRule`] holds, measures the average strategy and copies it, widened to `f64`,
//! into a [`ToySolution`]. [`curve`] runs one continuous solve in the chosen
//! [`SolverMode`] and measures the average strategy at each checkpoint iteration, which
//! is how gate G3 compares the engine against the committed `OpenSpiel` curve (O-30,
//! O-79, O-124). Units are chips with the game's own ante as the unit, never
//! centi-big-blinds: toy games have no big blind and every fixture tolerance says
//! `unit: chips`.
//!
//! Layout and ownership. This file holds the public types, the dispatch from
//! [`ToyGame`] to the per-game files and the name lookup; it is shared and is not edited
//! while the gate agents work. Each game file owns its engine model and its name map,
//! the fixture's player, node, holding and action words mapped onto engine node, action
//! and combo slots: `kuhn` and `akq` wrap the engine's own games (G1 and G2 agents),
//! `polar_river` (G2) and `leduc` (G3) add games the engine does not model. `dcfr` (G1)
//! wraps the engine solver under the stop rule, `measure` (G1) is the exploitability
//! measure built from the engine's best-response and expected-value walks without the
//! debug-only assertion in the engine's own measure (O-102) plus the copy of a profile
//! into the `f64` tables, and `plain_cfr` (G3) is the reference traversal with
//! alternating updates and uniform averaging that the `OpenSpiel` curve was produced
//! with (O-109, O-124, O-128).
//!
//! No engine type appears in a public signature. Engine figures are `f32` and are
//! widened to `f64` here, at the adapter boundary.

use std::collections::BTreeMap;

use postflop_engine::cfr::DcfrParams;
use postflop_engine::game::Game;

mod akq;
mod dcfr;
mod kuhn;
mod leduc;
mod measure;
mod plain_cfr;
mod polar_river;

/// A toy game and its betting parameters, in chips.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum ToyGame {
    /// Kuhn poker: cards J, Q, K; ante 1; one bet of 1; player 0 acts first (R2.4).
    Kuhn,
    /// The AKQ half-street game: cards Q, K, A; a dead pot of `pot` chips; player 1 bets
    /// `bet` or checks, then player 0 folds or calls (R2.5).
    Akq {
        /// The dead pot, in chips.
        pot: f64,
        /// The one bet size, in chips.
        bet: f64,
    },
    /// The polar river toy: player 1 holds the nuts or air with equal weight, player 0
    /// one bluff catcher; a dead pot of `pot` chips and one bet of `bet` (R2.5).
    PolarRiver {
        /// The dead pot, in chips.
        pot: f64,
        /// The one bet size, in chips.
        bet: f64,
    },
    /// Leduc hold'em as `OpenSpiel` defines it by default (R2.6).
    Leduc,
}

/// How the tree is solved.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum SolverMode {
    /// The engine's DCFR: alternating updates and the discount schedule with the three
    /// exponents; `floor_regrets_at_zero` is the CFR+ style clamp.
    Dcfr {
        /// Exponent on the discount applied to positive cumulative regret.
        alpha: f64,
        /// Exponent on the discount applied to negative cumulative regret.
        beta: f64,
        /// Exponent on the discount applied to the cumulative strategy.
        gamma: f64,
        /// Clamp cumulative regret at zero after each update.
        floor_regrets_at_zero: bool,
    },
    /// The reference plain CFR traversal: alternating updates as `OpenSpiel`'s
    /// `CFRSolver` runs them (player 0 first, then player 1 against player 0's updated
    /// strategy), uniform averaging, no discounting, no regret floor (O-124, O-128).
    PlainCfr,
}

impl SolverMode {
    /// The engine's default DCFR schedule: alpha 1.5, beta 0, gamma 2, floor off.
    #[must_use]
    pub fn dcfr_default() -> Self {
        let params = DcfrParams::default();
        Self::Dcfr {
            alpha: params.alpha,
            beta: params.beta,
            gamma: params.gamma,
            floor_regrets_at_zero: params.floor_regrets_at_zero,
        }
    }
}

/// When a chunked solve stops. After each chunk the average strategy is measured; the
/// run ends when its `NashConv` is below the target or the iteration count has reached
/// the maximum, whichever comes first, so a stalled solve still terminates.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct StopRule {
    /// Stop once `gain_0 + gain_1` of the average strategy is below this, in chips.
    pub target_nash_conv_chips: f64,
    /// Never run more iterations than this.
    pub max_iterations: u64,
    /// Iterations between two measurements; at least 1, and 0 is read as 1.
    pub chunk: u64,
}

/// The exploitability of one strategy profile, every figure in chips per hand.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Exploitability {
    /// Each player's unilateral gain: best-response value minus expected value.
    pub gain_chips: [f64; 2],
    /// `gain_chips[0] + gain_chips[1]`, what the engine reports as exploitability.
    pub nash_conv_chips: f64,
    /// `nash_conv_chips / 2`, the mean gain, what `OpenSpiel` reports as exploitability
    /// (O-108).
    pub mean_chips: f64,
    /// `nash_conv_chips` as a percentage of the root pot.
    pub pct_of_pot: f64,
}

/// One measured point of a solve.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CurvePoint {
    /// Iterations run when the point was measured.
    pub iteration: u64,
    /// The exploitability of the average strategy at that point.
    pub exploitability: Exploitability,
    /// The expected value of the average strategy profile to each player, in chips.
    pub value_chips: [f64; 2],
}

/// A solved toy game: the measured average strategy and the tables behind the fixture
/// vocabulary.
#[derive(Debug, Clone, PartialEq)]
pub struct ToySolution {
    /// The game that was solved.
    pub game: ToyGame,
    /// How it was solved.
    pub mode: SolverMode,
    /// Iterations run.
    pub iterations: u64,
    /// The exploitability of the average strategy.
    pub exploitability: Exploitability,
    /// The expected value of the average strategy profile to each player, in chips.
    pub value_chips: [f64; 2],
    /// The average strategy tables and root weights.
    tables: Tables,
    /// The game's fixture vocabulary.
    names: Names,
}

impl ToySolution {
    /// The solved frequency of one strategy fact: the average strategy's probability of
    /// `action` for `player` holding `holding` at `node`, in the fixture's words (the
    /// `node`, `holding` and `action` fields of a strategy fact). `None` when the game's
    /// vocabulary has no such fact.
    #[must_use]
    pub fn frequency(&self, player: u8, node: &str, holding: &str, action: &str) -> Option<f64> {
        let fact = self.names.facts.iter().find(|fact| {
            fact.player == player
                && fact.node == node
                && fact.holding == holding
                && fact.action == action
        })?;
        let strategy = self.tables.strategies.get(&fact.slot.node)?;
        strategy.probabilities.get(fact.slot.action * strategy.combos + fact.slot.combo).copied()
    }

    /// The root weight of `holding` for `player`, as the engine's range states it (1 for
    /// every card of a toy game). `None` when the vocabulary has no such holding.
    #[must_use]
    pub fn root_weight(&self, player: u8, holding: &str) -> Option<f64> {
        let name = self
            .names
            .holdings
            .iter()
            .find(|name| name.player == player && name.holding == holding)?;
        self.tables.root_weights.get(usize::from(player))?.get(name.combo).copied()
    }

    /// The number of information states: the acting player's live combos summed over
    /// every decision node (12 for Kuhn, 936 for Leduc).
    #[must_use]
    pub fn information_states(&self) -> u64 {
        self.tables.information_states
    }

    fn assemble(game: ToyGame, mode: SolverMode, solved: Solved, names: Names) -> Self {
        Self {
            game,
            mode,
            iterations: solved.iterations,
            exploitability: solved.measurement.exploitability,
            value_chips: solved.measurement.value_chips,
            tables: solved.tables,
            names,
        }
    }
}

/// Solve `game` by the engine's DCFR with its default schedule, in chunks, under `stop`.
#[must_use]
pub fn solve_dcfr(game: ToyGame, stop: &StopRule) -> ToySolution {
    let params = DcfrParams::default();
    let (solved, names) = match game {
        ToyGame::Kuhn => (dcfr::solve(kuhn::build(), &params, stop), kuhn::names()),
        ToyGame::Akq { pot, bet } => {
            (dcfr::solve(akq::build(pot, bet), &params, stop), akq::names())
        }
        ToyGame::PolarRiver { pot, bet } => {
            (dcfr::solve(polar_river::build(pot, bet), &params, stop), polar_river::names())
        }
        ToyGame::Leduc => (dcfr::solve(leduc::build(), &params, stop), leduc::names()),
    };
    ToySolution::assemble(game, SolverMode::dcfr_default(), solved, names)
}

/// One continuous solve of `game` in `mode`, measured at each checkpoint iteration.
///
/// Checkpoints are iteration counts and are visited in the order given: the run advances
/// to each one and measures the average strategy there. A checkpoint of 0 measures the
/// profile before any iteration, which is uniform in both modes, so it is the model pin
/// gate G3 uses. A checkpoint at or below the iterations already run measures the current
/// average without advancing.
#[must_use]
pub fn curve(game: ToyGame, mode: SolverMode, checkpoints: &[u64]) -> Vec<CurvePoint> {
    match game {
        ToyGame::Kuhn => run_curve(kuhn::build(), mode, checkpoints),
        ToyGame::Akq { pot, bet } => run_curve(akq::build(pot, bet), mode, checkpoints),
        ToyGame::PolarRiver { pot, bet } => {
            run_curve(polar_river::build(pot, bet), mode, checkpoints)
        }
        ToyGame::Leduc => run_curve(leduc::build(), mode, checkpoints),
    }
}

fn run_curve<G: Game + Sync>(engine: G, mode: SolverMode, checkpoints: &[u64]) -> Vec<CurvePoint> {
    match mode {
        SolverMode::Dcfr { alpha, beta, gamma, floor_regrets_at_zero } => {
            let params = DcfrParams { alpha, beta, gamma, floor_regrets_at_zero };
            dcfr::curve(engine, &params, checkpoints)
        }
        SolverMode::PlainCfr => plain_cfr::curve(engine, checkpoints),
    }
}

// The seam between this file and the per-owner files. Every type below crosses a file
// boundary, so it lives here and no owner edits another owner's file.

/// Where one fixture fact lives in the engine's tables: the decision node, the action
/// index and the acting player's combo slot at that node.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Slot {
    /// The engine's decision node index.
    pub node: u32,
    /// The action index at that node.
    pub action: usize,
    /// The acting player's combo slot at that node.
    pub combo: usize,
}

/// One strategy fact of the fixture vocabulary, mapped onto its slot.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct FactName {
    /// The acting player.
    pub player: u8,
    /// The fixture's node name, for example `open` or `facing_bet`.
    pub node: &'static str,
    /// The fixture's holding, a rank such as `J` or a label such as `nuts`.
    pub holding: &'static str,
    /// The fixture's action: `bet`, `check`, `call` or `fold`.
    pub action: &'static str,
    /// Where the engine keeps that probability.
    pub slot: Slot,
}

/// One holding of the fixture vocabulary, mapped onto a root combo slot.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct HoldingName {
    /// The player holding it.
    pub player: u8,
    /// The fixture's holding.
    pub holding: &'static str,
    /// The player's combo slot at the root.
    pub combo: usize,
}

/// The fixture vocabulary of one game. Each game file builds its own.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub(crate) struct Names {
    /// Every strategy fact the fixture can name.
    pub facts: Vec<FactName>,
    /// Every holding the fixture can name.
    pub holdings: Vec<HoldingName>,
}

/// One decision node's average strategy, action-major as the engine lays it out: the
/// entry for `action` and `combo` is at `action * combos + combo`.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct NodeStrategy {
    /// The acting player's live combos at the node.
    pub combos: usize,
    /// `num_actions * combos` probabilities.
    pub probabilities: Vec<f64>,
}

/// The average strategy tables and root weights of a solved game, widened to `f64`.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Tables {
    /// The average strategy at every decision node, keyed by engine node index.
    pub strategies: BTreeMap<u32, NodeStrategy>,
    /// Each player's root weights, one per root combo slot.
    pub root_weights: [Vec<f64>; 2],
    /// The acting player's live combos summed over every decision node.
    pub information_states: u64,
}

/// What `measure::measure` reports about one profile.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct Measurement {
    /// The exploitability of the profile.
    pub exploitability: Exploitability,
    /// The expected value of the profile to each player, in chips.
    pub value_chips: [f64; 2],
}

/// What a solver run hands back to the dispatch.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Solved {
    /// Iterations run.
    pub iterations: u64,
    /// The measured average strategy.
    pub measurement: Measurement,
    /// Its tables.
    pub tables: Tables,
}
