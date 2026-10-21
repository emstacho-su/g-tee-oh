//! The polar river toy game, the `polar-river-pot-bet` case of
//! `validation/fixtures/toy-games/akq.json`, which the engine does not model. Owner: the
//! G2 agent (R2.5).
//!
//! Rules (S13 plan section B). Player 1 holds air (combo 0) or the nuts (combo 1), root
//! weight 1 each; player 0 holds one bluff catcher (combo 0); there is no card removal.
//! The tree and the payoffs are the AKQ (ace, king, queen) ones: node 0 is player 1 at
//! the root (check 0, bet 1), node 1 the showdown after a check, node 2 player 0 facing
//! the bet (fold 0, call 1), node 3 the fold and node 4 the showdown after a call. A
//! showdown pays the winner `P / 2` after a check and `P / 2 + B` after a call, the nuts
//! always winning; a fold gives player 1 `P / 2`. Every terminal is zero-sum in net
//! chips. The normalizer is 2 (two joint combo pairs) and the root pot is `P`.
//!
//! Equilibrium. With `b` the air bet frequency and `c` the call frequency, the bluff
//! catcher is indifferent when `b (P / 2 + B) - (P / 2 + B) = -(1 + b) P / 2`, so
//! `b = B / (P + B)`; air is indifferent when `-P / 2 = -c (P / 2 + B) + (1 - c) P / 2`,
//! so `c = P / (P + B)`; the nuts bet whenever `c > 0`. At `P = B = 1` that is bet the
//! nuts always, bet air half the time, call half the time, so bluffs are one third of
//! the bets, and the equilibrium is unique.
//!
//! The fixture names the holdings `nuts`, `air` and `bluff_catcher`, the nodes `open` and
//! `facing_bet`, and states three strategy facts, so `names` lists 3 facts and 3
//! holdings. The `Game` methods are only ever called with the node indices and players
//! the trait documents; an index outside the arena is a caller bug, and the methods
//! panic naming the index, as the engine's own toy games do.

use postflop_engine::game::{ChanceEdge, Game, NodeInfo};

use super::{FactName, HoldingName, Names, Slot};

/// Player 1's combo slots.
const AIR: usize = 0;
const NUTS: usize = 1;
/// Player 0's one combo slot.
const BLUFF_CATCHER: usize = 0;

/// Node 0: player 1 at the root, the fixture's `open`.
const OPEN: u32 = 0;
/// Node 1: the showdown after a check.
const CHECK_SHOWDOWN: u32 = 1;
/// Node 2: player 0 facing the bet, the fixture's `facing_bet`.
const FACING_BET: u32 = 2;
/// Node 3: player 0 folded.
const FOLDED: u32 = 3;
/// Node 4: the showdown after a call.
const CALL_SHOWDOWN: u32 = 4;
const NUM_NODES: usize = 5;

/// Actions at `open`.
const CHECK: usize = 0;
const BET: usize = 1;
/// Actions at `facing_bet`.
const FOLD: usize = 0;
const CALL: usize = 1;

/// Joint root reach mass: one bluff catcher against air and against the nuts.
const NORMALIZER: f32 = 2.0;

/// The polar river game with a dead pot of `pot` chips and one bet of `bet` chips.
#[derive(Debug, Clone)]
pub(crate) struct PolarRiver {
    pot: f32,
    bet: f32,
    /// Player 0's root weights: the bluff catcher.
    catcher_weights: [f32; 1],
    /// Player 1's root weights: air, then the nuts.
    polar_weights: [f32; 2],
}

/// The polar river game with a dead pot of `pot` chips and one bet of `bet` chips, both
/// positive, as the engine's AKQ constructor requires of its own pot and bet. The public
/// callers are the gates, which read both numbers from a validated fixture.
///
/// # Panics
///
/// When `pot` or `bet` is not positive: a zero pot has no percent-of-pot figure.
#[allow(
    clippy::cast_possible_truncation,
    reason = "the engine takes f32 chips; fixture pots and bets are small exact values"
)]
pub(crate) fn build(pot: f64, bet: f64) -> PolarRiver {
    assert!(pot > 0.0 && bet > 0.0, "polar river needs a positive pot and bet, got {pot}, {bet}");
    PolarRiver { pot: pot as f32, bet: bet as f32, catcher_weights: [1.0], polar_weights: [1.0; 2] }
}

/// The fixture vocabulary mapped onto the layout above: player 1's bet at `open` with
/// the nuts and with air, player 0's call at `facing_bet` with the bluff catcher.
pub(crate) fn names() -> Names {
    let bet = |holding: &'static str, combo: usize| FactName {
        player: 1,
        node: "open",
        holding,
        action: "bet",
        slot: Slot { node: OPEN, action: BET, combo },
    };
    let call = FactName {
        player: 0,
        node: "facing_bet",
        holding: "bluff_catcher",
        action: "call",
        slot: Slot { node: FACING_BET, action: CALL, combo: BLUFF_CATCHER },
    };
    Names {
        facts: vec![bet("nuts", NUTS), bet("air", AIR), call],
        holdings: vec![
            HoldingName { player: 1, holding: "nuts", combo: NUTS },
            HoldingName { player: 1, holding: "air", combo: AIR },
            HoldingName { player: 0, holding: "bluff_catcher", combo: BLUFF_CATCHER },
        ],
    }
}

impl PolarRiver {
    /// A showdown for `stake` chips: the nuts beat the bluff catcher, air loses to it.
    fn showdown(stake: f32, hero: u8, opp_reach: &[f32], out: &mut [f32]) {
        if hero == 0 {
            out[BLUFF_CATCHER] = stake * opp_reach[AIR] - stake * opp_reach[NUTS];
        } else {
            out[AIR] = -stake * opp_reach[BLUFF_CATCHER];
            out[NUTS] = stake * opp_reach[BLUFF_CATCHER];
        }
    }

    /// Player 0 folded: player 1 nets `half_pot` with either holding, player 0 loses it.
    fn fold(half_pot: f32, hero: u8, opp_reach: &[f32], out: &mut [f32]) {
        if hero == 0 {
            out[BLUFF_CATCHER] = -half_pot * (opp_reach[AIR] + opp_reach[NUTS]);
        } else {
            out[AIR] = half_pot * opp_reach[BLUFF_CATCHER];
            out[NUTS] = half_pot * opp_reach[BLUFF_CATCHER];
        }
    }
}

impl Game for PolarRiver {
    fn root(&self) -> u32 {
        OPEN
    }

    fn num_nodes(&self) -> usize {
        NUM_NODES
    }

    fn node(&self, node: u32) -> NodeInfo {
        match node {
            OPEN => NodeInfo::Decision { player: 1, num_actions: 2 },
            FACING_BET => NodeInfo::Decision { player: 0, num_actions: 2 },
            CHECK_SHOWDOWN | FOLDED | CALL_SHOWDOWN => NodeInfo::Terminal,
            _ => unreachable!("polar river has no node {node}"),
        }
    }

    fn child(&self, node: u32, action: usize) -> u32 {
        match (node, action) {
            (OPEN, CHECK) => CHECK_SHOWDOWN,
            (OPEN, BET) => FACING_BET,
            (FACING_BET, FOLD) => FOLDED,
            (FACING_BET, CALL) => CALL_SHOWDOWN,
            _ => unreachable!("polar river has no edge {node}/{action}"),
        }
    }

    fn combo_count(&self, _node: u32, player: u8) -> usize {
        if player == 0 { self.catcher_weights.len() } else { self.polar_weights.len() }
    }

    fn root_weights(&self, player: u8) -> &[f32] {
        if player == 0 { &self.catcher_weights } else { &self.polar_weights }
    }

    fn chance_outcome(&self, node: u32, _outcome: usize) -> ChanceEdge<'_> {
        unreachable!("polar river has no chance nodes (node {node})")
    }

    fn terminal_utility(&self, node: u32, hero: u8, opp_reach: &[f32], out: &mut [f32]) {
        let half_pot = self.pot / 2.0;
        match node {
            CHECK_SHOWDOWN => Self::showdown(half_pot, hero, opp_reach, out),
            FOLDED => Self::fold(half_pot, hero, opp_reach, out),
            CALL_SHOWDOWN => Self::showdown(half_pot + self.bet, hero, opp_reach, out),
            _ => unreachable!("polar river node {node} is not terminal"),
        }
    }

    fn normalizer(&self) -> f32 {
        NORMALIZER
    }

    fn root_pot(&self) -> f32 {
        self.pot
    }
}

#[cfg(test)]
mod tests {
    use postflop_engine::br::{UniformProfile, best_response_value, expected_value};
    use postflop_engine::cfr::{DcfrParams, Solver};
    use postflop_engine::game::{Game, NodeInfo};

    use super::{
        AIR, BET, BLUFF_CATCHER, CALL, CALL_SHOWDOWN, CHECK, CHECK_SHOWDOWN, FACING_BET, FOLD,
        FOLDED, NUTS, OPEN, PolarRiver, build, names,
    };

    const CLOSE: f32 = 1e-6;
    /// Enough DCFR (discounted counterfactual regret minimization) iterations of the
    /// engine's default schedule to land within 0.01 of the unique equilibrium.
    const ITERATIONS: u64 = 20_000;
    const TOLERANCE: f32 = 0.01;

    fn pot_bet_one() -> PolarRiver {
        build(1.0, 1.0)
    }

    fn utility(game: &PolarRiver, node: u32, hero: u8, opp_reach: &[f32]) -> Vec<f32> {
        let mut out = vec![0.0; game.combo_count(node, hero)];
        game.terminal_utility(node, hero, opp_reach, &mut out);
        out
    }

    fn assert_close(actual: f32, expected: f32, what: &str) {
        assert!((actual - expected).abs() < CLOSE, "{what}: {actual} is not {expected}");
    }

    fn assert_close_slice(actual: &[f32], expected: &[f32], what: &str) {
        assert_eq!(actual.len(), expected.len(), "{what}: length");
        for (index, (a, e)) in actual.iter().zip(expected).enumerate() {
            assert_close(*a, *e, &format!("{what}[{index}]"));
        }
    }

    #[test]
    fn r2_5_tree_has_the_akq_shape_with_one_catcher_and_two_polar_combos() {
        let game = build(1.0, 0.5);
        assert_eq!(game.root(), OPEN);
        assert_eq!(game.num_nodes(), 5);
        assert_eq!(game.node(OPEN), NodeInfo::Decision { player: 1, num_actions: 2 });
        assert_eq!(game.node(FACING_BET), NodeInfo::Decision { player: 0, num_actions: 2 });
        for terminal in [CHECK_SHOWDOWN, FOLDED, CALL_SHOWDOWN] {
            assert_eq!(game.node(terminal), NodeInfo::Terminal, "node {terminal}");
        }
        assert_eq!(game.child(OPEN, CHECK), CHECK_SHOWDOWN);
        assert_eq!(game.child(OPEN, BET), FACING_BET);
        assert_eq!(game.child(FACING_BET, FOLD), FOLDED);
        assert_eq!(game.child(FACING_BET, CALL), CALL_SHOWDOWN);
        for node in 0..5 {
            assert_eq!(game.combo_count(node, 0), 1, "node {node} player 0");
            assert_eq!(game.combo_count(node, 1), 2, "node {node} player 1");
        }
        assert_close_slice(game.root_weights(0), &[1.0], "catcher weights");
        assert_close_slice(game.root_weights(1), &[1.0, 1.0], "polar weights");
        assert_close(game.normalizer(), 2.0, "normalizer");
        assert_close(game.root_pot(), 1.0, "root pot");
        assert!(game.zero_sum());
    }

    /// The payoff table at `P = B = 1`, per joint pair and in net chips: a check
    /// showdown moves 1/2, a call showdown 3/2, a fold 1/2 to player 1.
    #[test]
    fn r2_5_payoffs_at_pot_one_bet_one_are_half_three_halves_and_half() {
        let game = pot_bet_one();
        let catcher = [1.0];
        for (node, stake) in [(CHECK_SHOWDOWN, 0.5), (CALL_SHOWDOWN, 1.5)] {
            let what = format!("node {node}");
            assert_close_slice(&utility(&game, node, 0, &[1.0, 0.0]), &[stake], &what);
            assert_close_slice(&utility(&game, node, 0, &[0.0, 1.0]), &[-stake], &what);
            assert_close_slice(&utility(&game, node, 1, &catcher), &[-stake, stake], &what);
        }
        assert_close_slice(&utility(&game, FOLDED, 0, &[1.0, 1.0]), &[-1.0], "catcher folds");
        assert_close_slice(&utility(&game, FOLDED, 1, &catcher), &[0.5, 0.5], "fold wins");
    }

    /// `u0(catcher, x) + u1(x, catcher) == 0` at every terminal for both `x`.
    #[test]
    fn r2_5_every_terminal_is_zero_sum_per_joint_pair() {
        let game = build(1.0, 0.25);
        for node in [CHECK_SHOWDOWN, FOLDED, CALL_SHOWDOWN] {
            let polar = utility(&game, node, 1, &[1.0]);
            let against_air = utility(&game, node, 0, &[1.0, 0.0])[BLUFF_CATCHER];
            let against_nuts = utility(&game, node, 0, &[0.0, 1.0])[BLUFF_CATCHER];
            assert_close(against_air + polar[AIR], 0.0, &format!("node {node} air pair"));
            assert_close(against_nuts + polar[NUTS], 0.0, &format!("node {node} nuts pair"));
        }
    }

    /// The uniform profile at `P = B = 1`, by hand: player 0 nets `(0.5 - 0.75) / 2`,
    /// its best response (always call) nets 0, player 1's best response (bet the nuts,
    /// either with air) nets `(1 - 0.5) / 2`, so both gains are 1/8.
    #[test]
    fn r2_5_uniform_profile_values_match_the_hand_computation() {
        let game = pot_bet_one();
        let uniform = UniformProfile(&game);
        assert_close(expected_value(&game, 0, &uniform), -0.125, "value to player 0");
        assert_close(expected_value(&game, 1, &uniform), 0.125, "value to player 1");
        assert_close(best_response_value(&game, 0, &uniform), 0.0, "best response 0");
        assert_close(best_response_value(&game, 1, &uniform), 0.25, "best response 1");
    }

    #[test]
    fn r2_5_names_list_three_facts_and_three_holdings_on_their_slots() {
        let names = names();
        assert_eq!(names.facts.len(), 3);
        assert_eq!(names.holdings.len(), 3);
        let air = names.facts.iter().find(|f| f.holding == "air").expect("air bet");
        assert_eq!((air.player, air.node, air.action), (1, "open", "bet"));
        assert_eq!((air.slot.node, air.slot.action, air.slot.combo), (OPEN, BET, AIR));
        let call = names.facts.iter().find(|f| f.action == "call").expect("catcher call");
        assert_eq!((call.player, call.node, call.holding), (0, "facing_bet", "bluff_catcher"));
        assert_eq!((call.slot.node, call.slot.action, call.slot.combo), (FACING_BET, CALL, 0));
        let nuts = names.holdings.iter().find(|h| h.holding == "nuts").expect("nuts holding");
        assert_eq!((nuts.player, nuts.combo), (1, NUTS));
    }

    /// The engine's own solver on the game lands on the unique equilibrium: bet the nuts
    /// always, bet air half the time, call half the time.
    #[test]
    fn r2_5_engine_dcfr_reaches_the_half_half_equilibrium_at_pot_one_bet_one() {
        let mut solver = Solver::new(pot_bet_one());
        solver.run(ITERATIONS, &DcfrParams::default(), 0, |_, _, _| {});
        let open = solver.average_strategy(OPEN);
        let facing = solver.average_strategy(FACING_BET);
        let bet_nuts = open[BET * 2 + NUTS];
        let bet_air = open[BET * 2 + AIR];
        let call = facing[CALL + BLUFF_CATCHER];
        assert!(bet_nuts > 1.0 - TOLERANCE, "bet nuts {bet_nuts}");
        assert!((bet_air - 0.5).abs() < TOLERANCE, "bet air {bet_air}");
        assert!((call - 0.5).abs() < TOLERANCE, "call {call}");
    }
}
