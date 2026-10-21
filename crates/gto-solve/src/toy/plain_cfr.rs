//! Plain counterfactual regret minimization (CFR) over the engine's `Game` trait: the
//! reference traversal gate G3 runs so the Leduc curve is comparable with the committed
//! `OpenSpiel` run. Owner: the G3 agent (R2.6, O-109, O-124).
//!
//! Why not the engine solver: `Solver::run` hard-codes alternating updates, and its
//! discount step multiplies every cumulative regret by 0.5 at iteration 1 whatever the
//! exponents are; neither can be switched off through `DcfrParams`, and the vendored
//! crate is not edited (O-102). So this file carries a small vector-form CFR of its own
//! and the engine's best-response calculator measures it, which is what makes G3 a check
//! of the Leduc model, of the engine's exploitability measure and of the traversal
//! invariants against `OpenSpiel` (O-124).
//!
//! Mechanism. One iteration is two hero walks, player 0 first. Before each walk every
//! decision node's regret-matching strategy is snapshotted, uniform where no regret is
//! positive, so player 1's walk already sees player 0's regrets from the same iteration:
//! alternating updates, which is what `OpenSpiel`'s `CFRSolver` runs (its constructor
//! passes `alternating_updates=True` to the base solver, which the fixture's `generator`
//! block records since O-128; matching it reproduces the committed curve to about 1e-7
//! at iterations 10 and 100, where simultaneous updates miss by 0.08 at 100). In a walk
//! the opponent's reach is root weights times opponent strategy times chance weights,
//! the hero's reach is the hero's own strategy only (chance weights excluded, as
//! `OpenSpiel` does); cumulative regret gains the instantaneous regret with no floor and
//! no discount; the strategy sum gains hero reach times strategy, uniform weights, no
//! linear averaging. The average strategy is the normalised sum, uniform where the sum
//! is zero, and is exposed through `postflop_engine::br::StrategyProfile` so
//! `measure::measure` reads it. `curve` runs one continuous solve and measures at each
//! checkpoint with the rules `super::curve` documents: a checkpoint of 0 is the uniform
//! profile before any iteration, which equals the average after one iteration.
//!
//! Numbers. The walks carry `f32` vectors, the engine's own width, since the `Game`
//! trait hands terminal utilities over as `f32`; the two cumulative arrays are `f64` so
//! five thousand additions lose nothing. Toy games lock no node, and this traversal does
//! not honour `Game::locked_strategy`; a locked game is refused when the solver is built.

use postflop_engine::br::StrategyProfile;
use postflop_engine::game::{Game, NodeInfo};

use super::{CurvePoint, measure};

/// Where one decision node's regrets and strategy sums live in the flat arrays.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Region {
    offset: usize,
    num_actions: usize,
    combos: usize,
}

impl Region {
    fn size(self) -> usize {
        self.num_actions * self.combos
    }
}

/// A plain CFR solve in progress.
pub(crate) struct PlainCfr<G: Game> {
    game: G,
    /// One region per decision node, `None` for chance and terminal nodes.
    regions: Vec<Option<Region>>,
    regrets: Vec<f64>,
    strategy_sum: Vec<f64>,
    /// The regret-matching strategy snapshotted before the current hero walk.
    current: Vec<f32>,
    iterations: u64,
}

impl<G: Game> PlainCfr<G> {
    /// Size the arrays for `game`.
    ///
    /// # Panics
    ///
    /// When `game` locks a decision node: this traversal does not honour locks.
    pub(crate) fn new(game: G) -> Self {
        let mut total = 0;
        let regions = (0..game.num_nodes())
            .map(|index| {
                let node = u32::try_from(index).expect("the engine addresses nodes by u32");
                let NodeInfo::Decision { player, num_actions } = game.node(node) else {
                    return None;
                };
                assert!(game.locked_strategy(node).is_none(), "node {node} is locked");
                let region =
                    Region { offset: total, num_actions, combos: game.combo_count(node, player) };
                total += region.size();
                Some(region)
            })
            .collect();
        Self {
            game,
            regions,
            regrets: vec![0.0; total],
            strategy_sum: vec![0.0; total],
            current: vec![0.0; total],
            iterations: 0,
        }
    }

    pub(crate) fn game(&self) -> &G {
        &self.game
    }

    pub(crate) fn iterations(&self) -> u64 {
        self.iterations
    }

    /// The average strategy so far, for the engine's best-response walks.
    pub(crate) fn average(&self) -> Average<'_, G> {
        Average { solver: self }
    }

    /// Run iterations until `target` have been run; none when that many already have.
    pub(crate) fn advance_to(&mut self, target: u64) {
        while self.iterations < target {
            self.iterate();
        }
    }

    /// One iteration: for each hero in turn, snapshot every node's regret-matching
    /// strategy and walk the tree once against it (alternating updates).
    pub(crate) fn iterate(&mut self) {
        for hero in [0u8, 1] {
            self.snapshot();
            self.walk_from_root(hero);
        }
        self.iterations += 1;
    }

    fn snapshot(&mut self) {
        for region in self.regions.iter().flatten() {
            let span = region.offset..region.offset + region.size();
            normalised(&self.regrets[span.clone()], *region, &mut self.current[span]);
        }
    }

    fn walk_from_root(&mut self, hero: u8) {
        let root = self.game.root();
        let hero_reach = vec![1.0f32; self.game.combo_count(root, hero)];
        let opp_reach = self.game.root_weights(1 - hero).to_vec();
        let mut walk = Walk {
            game: &self.game,
            regions: &self.regions,
            current: &self.current,
            regrets: &mut self.regrets,
            strategy_sum: &mut self.strategy_sum,
        };
        walk.values(root, hero, &hero_reach, &opp_reach);
    }

    fn region(&self, node: u32) -> Region {
        self.regions[node as usize].unwrap_or_else(|| panic!("node {node} is not a decision node"))
    }
}

/// One hero walk: the borrowed pieces of a [`PlainCfr`], split so the recursion can read
/// the game and the snapshot while it writes the two cumulative arrays.
struct Walk<'a, G: Game> {
    game: &'a G,
    regions: &'a [Option<Region>],
    current: &'a [f32],
    regrets: &'a mut [f64],
    strategy_sum: &'a mut [f64],
}

impl<'a, G: Game> Walk<'a, G> {
    /// Hero's counterfactual value vector for the subtree at `node`, updating hero's
    /// regrets and strategy sums on the way.
    fn values(&mut self, node: u32, hero: u8, hero_reach: &[f32], opp_reach: &[f32]) -> Vec<f32> {
        let game = self.game;
        match game.node(node) {
            NodeInfo::Terminal => {
                let mut out = vec![0.0; hero_reach.len()];
                game.terminal_utility(node, hero, opp_reach, &mut out);
                out
            }
            NodeInfo::Chance { num_outcomes } => {
                let mut out = vec![0.0; hero_reach.len()];
                for outcome in 0..num_outcomes {
                    let edge = game.chance_outcome(node, outcome);
                    let map_hero = edge.parent_of_child[usize::from(hero)];
                    let map_opp = edge.parent_of_child[usize::from(1 - hero)];
                    let child_hero: Vec<f32> =
                        map_hero.iter().map(|&parent| hero_reach[parent as usize]).collect();
                    let child_opp: Vec<f32> = map_opp
                        .iter()
                        .map(|&parent| opp_reach[parent as usize] * edge.weight)
                        .collect();
                    let child = self.values(edge.child, hero, &child_hero, &child_opp);
                    for (&parent, value) in map_hero.iter().zip(child) {
                        out[parent as usize] += value;
                    }
                }
                out
            }
            NodeInfo::Decision { player, num_actions } if player == hero => {
                self.hero_decision(node, hero, num_actions, hero_reach, opp_reach)
            }
            NodeInfo::Decision { num_actions, .. } => {
                let sigma = self.strategy(node);
                let combos = opp_reach.len();
                let mut out = vec![0.0; hero_reach.len()];
                for action in 0..num_actions {
                    let weights = &sigma[action * combos..(action + 1) * combos];
                    let reach: Vec<f32> = opp_reach
                        .iter()
                        .zip(weights)
                        .map(|(reach, weight)| reach * weight)
                        .collect();
                    let child = self.values(game.child(node, action), hero, hero_reach, &reach);
                    for (slot, value) in out.iter_mut().zip(child) {
                        *slot += value;
                    }
                }
                out
            }
        }
    }

    /// The hero's own node: per-action values under the snapshot, the node value as their
    /// mix, instantaneous regret into the regrets and reach times strategy into the sums.
    fn hero_decision(
        &mut self,
        node: u32,
        hero: u8,
        num_actions: usize,
        hero_reach: &[f32],
        opp_reach: &[f32],
    ) -> Vec<f32> {
        let game = self.game;
        let sigma = self.strategy(node);
        let combos = hero_reach.len();
        let action_values: Vec<Vec<f32>> = (0..num_actions)
            .map(|action| {
                let weights = &sigma[action * combos..(action + 1) * combos];
                let reach: Vec<f32> =
                    hero_reach.iter().zip(weights).map(|(reach, weight)| reach * weight).collect();
                self.values(game.child(node, action), hero, &reach, opp_reach)
            })
            .collect();
        let value: Vec<f32> = (0..combos)
            .map(|combo| {
                (0..num_actions)
                    .map(|action| sigma[action * combos + combo] * action_values[action][combo])
                    .sum()
            })
            .collect();
        let offset = self.region_of(node).offset;
        for (action, values) in action_values.iter().enumerate() {
            for (combo, (&action_value, &node_value)) in values.iter().zip(&value).enumerate() {
                let slot = action * combos + combo;
                self.regrets[offset + slot] += f64::from(action_value - node_value);
                self.strategy_sum[offset + slot] += f64::from(hero_reach[combo] * sigma[slot]);
            }
        }
        value
    }

    fn region_of(&self, node: u32) -> Region {
        self.regions[node as usize].unwrap_or_else(|| panic!("node {node} is not a decision node"))
    }

    /// The snapshotted strategy at `node`, borrowed for the walk's lifetime.
    fn strategy(&self, node: u32) -> &'a [f32] {
        let region = self.region_of(node);
        &self.current[region.offset..region.offset + region.size()]
    }
}

/// Read-only view of a [`PlainCfr`]'s average strategy.
pub(crate) struct Average<'a, G: Game> {
    solver: &'a PlainCfr<G>,
}

impl<G: Game> StrategyProfile for Average<'_, G> {
    fn strategy_into(&self, node: u32, out: &mut [f32]) {
        let region = self.solver.region(node);
        let span = region.offset..region.offset + region.size();
        normalised(&self.solver.strategy_sum[span], region, &mut out[..region.size()]);
    }
}

/// Per combo, the positive part of `values` scaled to sum to 1 over the actions, uniform
/// when nothing is positive. Regret matching when `values` are regrets; the average
/// strategy when they are strategy sums.
fn normalised(values: &[f64], region: Region, out: &mut [f32]) {
    let Region { num_actions, combos, .. } = region;
    for combo in 0..combos {
        let positive: f64 =
            (0..num_actions).map(|action| values[action * combos + combo].max(0.0)).sum();
        for action in 0..num_actions {
            let slot = action * combos + combo;
            out[slot] = if positive > 0.0 {
                narrow(values[slot].max(0.0) / positive)
            } else {
                uniform(num_actions)
            };
        }
    }
}

#[allow(clippy::cast_possible_truncation, reason = "a probability in [0, 1] narrows safely")]
fn narrow(probability: f64) -> f32 {
    probability as f32
}

#[allow(clippy::cast_precision_loss, reason = "action counts are tiny")]
fn uniform(num_actions: usize) -> f32 {
    1.0 / num_actions as f32
}

/// One continuous plain CFR run on `game`, measured at each checkpoint.
pub(crate) fn curve<G: Game>(game: G, checkpoints: &[u64]) -> Vec<CurvePoint> {
    let mut solver = PlainCfr::new(game);
    checkpoints
        .iter()
        .map(|&checkpoint| {
            solver.advance_to(checkpoint);
            let measurement = measure::measure(solver.game(), &solver.average());
            CurvePoint {
                iteration: solver.iterations(),
                exploitability: measurement.exploitability,
                value_chips: measurement.value_chips,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use postflop_engine::br;
    use postflop_engine::games::kuhn::Kuhn;

    use super::*;

    const KUHN_VALUE_PLAYER_0: f32 = -1.0 / 18.0;

    fn nash_conv(solver: &PlainCfr<Kuhn>) -> f32 {
        let profile = solver.average();
        let gain = |player: u8| {
            br::best_response_value(solver.game(), player, &profile)
                - br::expected_value(solver.game(), player, &profile)
        };
        gain(0) + gain(1)
    }

    /// The integration test `r2_6_plain_cfr_on_kuhn_converges` through the engine's
    /// walks directly, independent of `measure::measure`.
    #[test]
    fn kuhn_nash_conv_falls_below_a_hundredth_by_ten_thousand_iterations() {
        let mut solver = PlainCfr::new(Kuhn::new());
        solver.advance_to(1);
        let first = nash_conv(&solver);
        solver.advance_to(10_000);
        let last = nash_conv(&solver);
        println!("plain cfr on kuhn: NashConv {first} at 1, {last} at 10000");
        assert!(last < 0.01, "NashConv {last} after 10000 iterations");
        assert!(last < first, "NashConv rose from {first} to {last}");
        let value = br::expected_value(solver.game(), 0, &solver.average());
        assert!((value - KUHN_VALUE_PLAYER_0).abs() < 0.01, "value to player 0 {value}");
    }

    /// After one iteration every strategy sum is reach times uniform, so the average is
    /// uniform: the first `OpenSpiel` checkpoint equals the profile before any iteration.
    #[test]
    fn average_after_one_iteration_is_uniform() {
        let mut solver = PlainCfr::new(Kuhn::new());
        let before = nash_conv(&solver);
        solver.advance_to(1);
        assert_eq!(solver.iterations(), 1);
        for node in [0u32, 1, 2, 4] {
            let mut out = [0.0f32; 6];
            solver.average().strategy_into(node, &mut out);
            assert_eq!(out, [0.5; 6], "node {node}");
        }
        assert!((nash_conv(&solver) - before).abs() < f32::EPSILON);
    }
}
