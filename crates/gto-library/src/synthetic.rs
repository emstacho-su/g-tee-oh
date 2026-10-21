//! Seeded synthetic trees (R2.7, feature `synthetic`): solved nodes with valid keys and
//! plausible numbers, for tests, benches and the size estimate (R-19). Nothing here is a
//! real solve; data written from it carries `synthetic: true` (O-57).
//!
//! Mechanism: a `ChaCha8Rng` generator seeded with `SyntheticParams::seed` drives every choice,
//! so one seed always gives the same tree. Keys are built through the `gto-model` builders
//! (`NodeKey::preflop`, `with_flop` and so on), so every key parses and displays back.
//!
//! What a tree looks like:
//!
//! - One configuration of the v1 catalog (`gto_model::v1_configs`) and one pair of seated
//!   positions, both drawn from the seed, shared by every node.
//! - `TreeLayout` picks the file kind of A3 section 2 the nodes belong to: preflop nodes,
//!   flop nodes of one flop tree, or the turn and river nodes of one runout. Node `i` ends its
//!   line with a raise or bet sized `LINE_BASE_CBB + i`, which makes every key distinct; the
//!   lines are not a game tree.
//! - Every node faces that last wager, so its actions are fold, call, then raises of growing
//!   size, `SyntheticParams::actions` of them.
//! - Each hand of the range is pure (frequency 1 on one action) with probability
//!   `pure_share`, else mixed. The most frequent action is the best one with loss 0, the
//!   other played actions sit within `INDIFFERENCE_POT_SHARE` of the pot below it, and an
//!   unplayed action loses between `MIN_LOSS_POT_SHARE` and `MAX_LOSS_POT_SHARE` of the pot.
//! - On a board, combos holding a dealt card are left out of the range.
//!
//! Lane M (manifest, schema, bench) owns this file.

use gto_model::{
    ActionToken, Board, Card, Cbb, ComboId, Flop, ModelError, NodeKey, Position, PositionPair,
    v1_configs,
};
use rand::seq::index::sample;
use rand::{Rng, SeedableRng};
use rand_chacha::ChaCha8Rng;

use crate::record::{HandSpace, SolvedHand, SolvedNode};

/// The size of node `i`'s last raise or bet is `LINE_BASE_CBB + i`.
const LINE_BASE_CBB: u32 = 200;
/// The most nodes one call generates, so every line size fits a `u32`.
const MAX_NODES: u32 = 1_000_000;
/// The most actions a record holds.
const MAX_ACTIONS: u8 = u8::MAX;
/// The preflop line every postflop node follows: a raise to 2.5 bb and a call.
const POSTFLOP_PREFLOP_LINE: [ActionToken; 2] = [ActionToken::Raise(Cbb(250)), ActionToken::Call];
/// Pot ranges in cbb: preflop after a raise, postflop after a called raise.
const PREFLOP_POT_CBB: (u32, u32) = (250, 2_000);
const POSTFLOP_POT_CBB: (u32, u32) = (500, 10_000);
/// The call costs a third of the pot; raise `j` costs `j + 2` calls.
const CALL_POT_DIVISOR: u32 = 3;
const FIRST_RAISE_MULTIPLE: u32 = 2;
/// cbb per big blind, for expected values (EVs) in bb.
const CBB_PER_BB: f64 = 100.0;
/// The best action's EV as a share of the pot.
const EV_BEST_POT_SHARE: (f64, f64) = (-0.5, 1.0);
/// How far below the best EV a played action of a mixed hand sits, as a share of the pot.
const INDIFFERENCE_POT_SHARE: f64 = 0.002;
/// How much an unplayed action loses, as a share of the pot.
const MIN_LOSS_POT_SHARE: f64 = 0.01;
const MAX_LOSS_POT_SHARE: f64 = 0.6;
/// A mixed hand's weight per action is this floor plus a uniform draw in `[0, 1)`.
const MIXED_WEIGHT_FLOOR: f64 = 0.05;
/// The node's accuracy in percent of the pot (O-22).
const ACCURACY_PCT_POT: (f32, f32) = (0.05, 0.5);
/// Cards a runout deals: three on the flop, the turn and the river.
const RUNOUT_CARDS: usize = 5;

/// Which file kind of A3 section 2 the nodes belong to.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum TreeLayout {
    /// Preflop nodes, as in a preflop solution's chunks.
    Preflop,
    /// Flop nodes of one flop, as in a build's `flop/<line>` file.
    FlopTree,
    /// Turn and river nodes of one turn and river, alternating, as in a build's
    /// `runouts/<turn><river>/<line>` file.
    Runout,
}

/// What to generate. Out-of-range values are clamped, never rejected: `nodes` to
/// `MAX_NODES`, `range_fraction` to `(0, 1]` (at least one hand), `pure_share` to `[0, 1]`,
/// and `actions` to `1..=255` with the upper end at least the lower.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SyntheticParams {
    /// The generator seed.
    pub seed: u64,
    /// How many nodes, each with a distinct key.
    pub nodes: usize,
    /// The hand space of every node.
    pub hand_space: HandSpace,
    /// The share of the hand space each node holds, in `(0, 1]`; 1 gives dense records.
    pub range_fraction: f64,
    /// The share of hands that play one action at frequency 1, in `[0, 1]`.
    pub pure_share: f64,
    /// The inclusive range of actions per node, for example `(2, 4)`.
    pub actions: (u8, u8),
    /// The file kind the nodes belong to.
    pub layout: TreeLayout,
}

impl Default for SyntheticParams {
    /// Seed 0, 64 dense preflop nodes, half the hands pure, 2 to 4 actions.
    fn default() -> Self {
        SyntheticParams {
            seed: 0,
            nodes: 64,
            hand_space: HandSpace::Preflop169,
            range_fraction: 1.0,
            pure_share: 0.5,
            actions: (2, 4),
            layout: TreeLayout::Preflop,
        }
    }
}

/// A synthetic tree for `p`: `p.nodes` nodes with distinct keys of one configuration and
/// pair, frequencies that sum to one per hand, and one expected value per action.
#[must_use]
pub fn synthetic_tree(p: &SyntheticParams) -> Vec<SolvedNode> {
    match build_tree(p) {
        Ok(nodes) => nodes,
        // Every card, flop and key is built from distinct draws in dealing order, which is
        // exactly what the gto-model builders check, so they cannot fail here.
        Err(err) => unreachable!("a synthetic tree built from distinct cards: {err}"),
    }
}

/// The shared parts of every node: configuration, pair, board cards and the generator.
struct Context {
    rng: ChaCha8Rng,
    config_id: gto_model::ConfigId,
    pair: PositionPair,
    depth: Cbb,
    cards: Vec<Card>,
}

fn build_tree(p: &SyntheticParams) -> Result<Vec<SolvedNode>, ModelError> {
    let mut ctx = context(p.seed);
    let count = u32::try_from(p.nodes).map_or(MAX_NODES, |n| n.min(MAX_NODES));
    (0..count)
        .map(|i| {
            let key = node_key(&ctx, p.layout, i)?;
            Ok(solved_node(&mut ctx, p, key))
        })
        .collect()
}

fn context(seed: u64) -> Context {
    let mut rng = ChaCha8Rng::seed_from_u64(seed);
    let configs = v1_configs();
    let config = &configs[rng.random_range(0..configs.len())];
    let seated = Position::seated(config.table_size);
    let seats = sample(&mut rng, seated.len(), 2).into_vec();
    let pair = match PositionPair::new(seated[seats[0]], seated[seats[1]]) {
        Ok(pair) => pair,
        Err(err) => unreachable!("two distinct sampled seats: {err}"),
    };
    let deck: Vec<Card> = Card::all().collect();
    let cards = sample(&mut rng, deck.len(), RUNOUT_CARDS).into_iter().map(|i| deck[i]).collect();
    Context { rng, config_id: config.config_id(), pair, depth: config.depth_cbb, cards }
}

/// Node `i`'s key in `layout`, ending in a wager sized `LINE_BASE_CBB + i`.
fn node_key(ctx: &Context, layout: TreeLayout, i: u32) -> Result<NodeKey, ModelError> {
    let size = Cbb(LINE_BASE_CBB + i);
    let preflop = |line| NodeKey::preflop(ctx.config_id.clone(), ctx.pair, line);
    let flop = Flop::new([ctx.cards[0], ctx.cards[1], ctx.cards[2]])?;
    let (turn, river) = (ctx.cards[3], ctx.cards[4]);
    let checked = || vec![ActionToken::Check, ActionToken::Check];
    match layout {
        TreeLayout::Preflop => Ok(preflop(vec![ActionToken::Raise(size)])),
        TreeLayout::FlopTree => {
            preflop(POSTFLOP_PREFLOP_LINE.to_vec()).with_flop(flop, vec![ActionToken::Bet(size)])
        }
        TreeLayout::Runout => {
            let dealt = preflop(POSTFLOP_PREFLOP_LINE.to_vec()).with_flop(flop, checked())?;
            if i % 2 == 0 {
                dealt.with_turn(turn, vec![ActionToken::Bet(size)])
            } else {
                dealt.with_turn(turn, checked())?.with_river(river, vec![ActionToken::Bet(size)])
            }
        }
    }
}

fn solved_node(ctx: &mut Context, p: &SyntheticParams, key: NodeKey) -> SolvedNode {
    let range = if key.flop.is_some() { POSTFLOP_POT_CBB } else { PREFLOP_POT_CBB };
    let pot = Cbb(ctx.rng.random_range(range.0..=range.1));
    let behind = Cbb(ctx.depth.get().saturating_sub(pot.get() / 2));
    let to_act = if ctx.rng.random_bool(0.5) { ctx.pair.oop() } else { ctx.pair.ip() };
    let actions = node_actions(&mut ctx.rng, p.actions, pot);
    let dead = key.board().map(Board::cards).unwrap_or_default();
    let hands = range_of(&mut ctx.rng, p, &dead)
        .into_iter()
        .map(|hand| solved_hand(&mut ctx.rng, hand, actions.len(), p.pure_share, pot))
        .collect();
    let accuracy = ctx.rng.random_range(ACCURACY_PCT_POT.0..ACCURACY_PCT_POT.1);
    SolvedNode {
        key,
        to_act,
        pot,
        stacks: [behind, behind],
        actions,
        hand_space: p.hand_space,
        hands,
        accuracy_pct_pot: Some(accuracy),
    }
}

/// Fold, call, then raises of `j + 2` calls each, as many as the drawn action count.
fn node_actions(rng: &mut ChaCha8Rng, bounds: (u8, u8), pot: Cbb) -> Vec<(ActionToken, Cbb)> {
    let low = bounds.0.clamp(1, MAX_ACTIONS);
    let high = bounds.1.clamp(low, MAX_ACTIONS);
    let count = rng.random_range(low..=high);
    let call = Cbb((pot.get() / CALL_POT_DIVISOR).max(1));
    let raises = (0..u32::from(count)).map(|j| {
        let size = Cbb(call.get() * (j + FIRST_RAISE_MULTIPLE));
        (ActionToken::Raise(size), size)
    });
    [(ActionToken::Fold, Cbb::ZERO), (ActionToken::Call, call)]
        .into_iter()
        .chain(raises)
        .take(usize::from(count))
        .collect()
}

/// The node's hands in ascending index order: a `range_fraction` share of the live hands.
fn range_of(rng: &mut ChaCha8Rng, p: &SyntheticParams, dead: &[Card]) -> Vec<u16> {
    let live: Vec<u16> = match p.hand_space {
        HandSpace::Preflop169 => (0..HandSpace::Preflop169.size()).collect(),
        HandSpace::Postflop1326 => {
            ComboId::all().filter(|combo| !combo.conflicts_with(dead)).map(u16::from).collect()
        }
    };
    let amount = share_of(live.len(), p.range_fraction);
    let mut picked: Vec<u16> =
        sample(rng, live.len(), amount).into_iter().map(|i| live[i]).collect();
    picked.sort_unstable();
    picked
}

/// `fraction` of `len` rounded to the nearest whole, at least 1 and at most `len`.
#[expect(
    clippy::cast_possible_truncation,
    clippy::cast_precision_loss,
    clippy::cast_sign_loss,
    reason = "len is at most 1,326 and the product is clamped to [1, len] before the cast"
)]
fn share_of(len: usize, fraction: f64) -> usize {
    let fraction = if fraction.is_nan() { 1.0 } else { fraction.clamp(0.0, 1.0) };
    ((fraction * len as f64).round() as usize).clamp(1, len.max(1))
}

fn solved_hand(rng: &mut ChaCha8Rng, hand: u16, n: usize, pure: f64, pot: Cbb) -> SolvedHand {
    let pure = if pure.is_nan() { 0.0 } else { pure.clamp(0.0, 1.0) };
    let frequencies: Vec<f64> = if rng.random_bool(pure) {
        let chosen = rng.random_range(0..n);
        (0..n).map(|a| if a == chosen { 1.0 } else { 0.0 }).collect()
    } else {
        let weights: Vec<f64> = (0..n).map(|_| MIXED_WEIGHT_FLOOR + rng.random::<f64>()).collect();
        let total: f64 = weights.iter().sum();
        weights.iter().map(|w| w / total).collect()
    };
    let ev_bb = expected_values(rng, &frequencies, f64::from(pot.get()) / CBB_PER_BB);
    let reach = Some([rng.random::<f64>(), rng.random::<f64>()]);
    SolvedHand { hand, reach, frequencies, ev_bb }
}

/// One EV per action: the most frequent action (the first on ties) is the best, a played
/// action sits just below it, an unplayed one clearly below.
fn expected_values(rng: &mut ChaCha8Rng, frequencies: &[f64], pot_bb: f64) -> Vec<f64> {
    let best = frequencies
        .iter()
        .enumerate()
        .fold(0, |best, (a, f)| if *f > frequencies[best] { a } else { best });
    let ev_best = pot_bb * rng.random_range(EV_BEST_POT_SHARE.0..EV_BEST_POT_SHARE.1);
    frequencies
        .iter()
        .enumerate()
        .map(|(a, f)| {
            let share = if a == best {
                0.0
            } else if *f > 0.0 {
                rng.random_range(0.0..INDIFFERENCE_POT_SHARE)
            } else {
                rng.random_range(MIN_LOSS_POT_SHARE..MAX_LOSS_POT_SHARE)
            };
            ev_best - share * pot_bb
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use super::{SyntheticParams, TreeLayout, synthetic_tree};
    use crate::record::HandSpace;

    const TOLERANCE: f64 = 1e-9;

    fn params(layout: TreeLayout, hand_space: HandSpace) -> SyntheticParams {
        SyntheticParams { seed: 11, nodes: 30, hand_space, layout, ..SyntheticParams::default() }
    }

    #[test]
    fn r2_7_synthetic_tree_is_seeded_and_keys_are_distinct() {
        let p = params(TreeLayout::Preflop, HandSpace::Preflop169);
        let tree = synthetic_tree(&p);
        assert_eq!(tree, synthetic_tree(&p), "one seed, one tree");
        assert_ne!(tree, synthetic_tree(&SyntheticParams { seed: 12, ..p }), "seeds differ");
        let keys: HashSet<String> = tree.iter().map(|n| n.key.to_string()).collect();
        assert_eq!(keys.len(), 30, "every key is distinct");
        for node in &tree {
            assert_eq!(node.key.to_string().parse::<gto_model::NodeKey>(), Ok(node.key.clone()));
            assert!(node.key.pair.contains(node.to_act), "the seat to act is in the pair");
        }
    }

    #[test]
    fn r2_7_synthetic_hands_sum_to_one_with_the_best_action_first() {
        for layout in [TreeLayout::Preflop, TreeLayout::FlopTree, TreeLayout::Runout] {
            for node in synthetic_tree(&params(layout, HandSpace::Postflop1326)) {
                let dead = node.key.board().map(gto_model::Board::cards).unwrap_or_default();
                for hand in &node.hands {
                    let sum: f64 = hand.frequencies.iter().sum();
                    assert!((sum - 1.0).abs() < TOLERANCE, "{layout:?} frequencies sum to 1");
                    assert_eq!(hand.ev_bb.len(), node.actions.len(), "one EV per action");
                    let combo = gto_model::ComboId::from_index(hand.hand).expect("a combo");
                    assert!(!combo.conflicts_with(&dead), "no hand holds a board card");
                }
                let ascending = node.hands.windows(2).all(|pair| pair[0].hand < pair[1].hand);
                assert!(ascending, "hands are distinct and ascending");
            }
        }
    }

    #[test]
    fn r2_7_synthetic_layouts_put_nodes_on_their_streets() {
        use gto_model::Street;
        let streets = |layout| -> HashSet<Street> {
            synthetic_tree(&params(layout, HandSpace::Postflop1326))
                .iter()
                .map(|n| n.key.street())
                .collect()
        };
        assert_eq!(streets(TreeLayout::Preflop), HashSet::from([Street::Preflop]));
        assert_eq!(streets(TreeLayout::FlopTree), HashSet::from([Street::Flop]));
        assert_eq!(streets(TreeLayout::Runout), HashSet::from([Street::Turn, Street::River]));
    }

    #[test]
    fn r2_7_synthetic_params_are_clamped() {
        let p = SyntheticParams {
            nodes: 3,
            range_fraction: -1.0,
            pure_share: f64::NAN,
            actions: (0, 0),
            ..SyntheticParams::default()
        };
        for node in synthetic_tree(&p) {
            assert_eq!(node.hands.len(), 1, "at least one hand");
            assert_eq!(node.actions.len(), 1, "at least one action");
        }
        let dense = SyntheticParams { nodes: 2, range_fraction: 1.0, ..SyntheticParams::default() };
        assert!(synthetic_tree(&dense).iter().all(|n| n.hands.len() == 169), "dense is 169");
    }
}
