//! Leduc hold'em in the engine's vector form, as `OpenSpiel`'s `leduc_poker` defines it
//! by default (R2.6, O-30). Owner: the G3 agent.
//!
//! Rules (S13 plan section B, read off the `OpenSpiel` game object recorded in
//! `validation/fixtures/openspiel/PROVENANCE.md`). Six cards, J, Q, K in two suits; one
//! private card each; both ante 1. Round 1: player 0 acts first, a raise adds 2, at most
//! two raises; fold is legal only facing a raise; check-check or raise-call ends the
//! round. One public card, uniform over the 4 unseen cards. Round 2: player 0 acts first
//! again, a raise adds 4, the same limits. Showdown: a pair with the public card beats
//! everything, otherwise the higher rank wins and equal ranks split. Utilities are net
//! chips: the winner nets the loser's contribution, a folder loses its own.
//!
//! Vector form. 6 combos per player at the round-1 nodes; 5 chance nodes (after cc, crc,
//! crrc, rc and rrc) with 6 outcomes each at weight 0.25, whose `parent_of_child` drops
//! the public card for both players, so 5 combos per player below them; same-card
//! matchups are skipped at the terminals; the normalizer is 30 (6 times 5 compatible
//! root pairs); the root pot is 2. Round-2 nodes are one node per public card, so the
//! information states count 6 round-1 nodes times 6 combos plus 30 round-2 subtrees of
//! 6 nodes times 5 combos, 936 in all, the number `OpenSpiel` reports. The uniform
//! profile's mean gain is 2.373611111 chips, the curve's first row, and both pins hold
//! before any solver runs (the tests at the bottom of this file).
//!
//! Layout. One flat table of 465 nodes. A card is `rank * 2 + suit` (J 0 and 1, Q 2 and
//! 3, K 4 and 5), so the root combo slots are the cards in that order and a chance edge
//! keeps the five survivors ascending, as the engine's chance invariant requires. Nodes
//! 0 to 14 are the betting-round template below for round 1, whose five round-end slots
//! are chance nodes; outcome `k` of the chance node after round-1 history `h` leads to a
//! round-2 copy of the template at `15 + (h * 6 + k) * 15`, whose round-end slots are
//! showdowns with public card `k`.
//!
//! ```text
//! slot  node                         actions            children
//!  0    player 0 to act              check, raise       1, 6
//!  1    player 1 after a check       check, raise       2 (cc end), 3
//!  3    player 0 facing a raise      fold, call, raise  4 (fold), 5 (crc end), 7
//!  6    player 1 facing a raise      fold, call, raise  10 (fold), 11 (rc end), 12
//!  7    player 1 facing a re-raise   fold, call         8 (fold), 9 (crrc end)
//! 12    player 0 facing a re-raise   fold, call         13 (fold), 14 (rrc end)
//! ```
//!
//! The fixture states no strategy facts for Leduc (gate G3 asserts the curve only), so
//! the vocabulary is empty.

use std::cmp::Ordering;

use postflop_engine::game::{ChanceEdge, Game, NodeInfo};

use super::Names;

const PLAYER_0: u8 = 0;
const PLAYER_1: u8 = 1;
/// Cards in the deck, `rank * 2 + suit`.
const CARDS: usize = 6;
const SUITS: u8 = 2;
/// Cards a player can hold once the public card is out.
const SURVIVORS: usize = CARDS - 1;
const ANTE: f32 = 1.0;
/// What a raise adds in round 1 and in round 2.
const RAISE: [f32; 2] = [2.0, 4.0];
/// Probability of each public card given two private cards: one of the four unseen.
const PUBLIC_CARD_WEIGHT: f32 = 0.25;
/// Compatible root pairs, 6 times 5, times the chance mass of 1.
const NORMALIZER: f32 = 30.0;
const ROOT_POT: f32 = 2.0 * ANTE;
/// Nodes in one betting-round template.
const ROUND_NODES: usize = 15;
/// Raises on the way to each round end, in the order cc, crc, crrc, rc, rrc.
const ROUND_END_RAISES: [f32; 5] = [0.0, 1.0, 2.0, 1.0, 2.0];
/// Showdown strength of a pair with the public card: above every rank (0 to 2).
const PAIR: u8 = 3;
const NO_CHILD: u32 = u32::MAX;
static ROOT_WEIGHTS: [f32; CARDS] = [1.0; CARDS];

/// One node of the flat table.
#[derive(Debug, Clone, Copy, PartialEq)]
enum Node {
    /// `player` to act; `children[..num_actions]` in action order.
    Decision { player: u8, num_actions: usize, children: [u32; 3] },
    /// The public card is dealt; outcome `k` leads to `first_child + k * ROUND_NODES`.
    Chance { first_child: u32 },
    /// `folder` gave up `lost` chips to the other player.
    Fold { folder: u8, lost: f32 },
    /// Both showed down for `stake` chips each with `public` on the board.
    Showdown { stake: f32, public: u8 },
}

/// Leduc hold'em with the default `OpenSpiel` parameters.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Leduc {
    nodes: Vec<Node>,
    /// `survivors[k]`: the root slots of the five cards other than `k`, ascending.
    survivors: [[u32; SURVIVORS]; CARDS],
    /// `strengths[k][slot]`: the showdown strength of `survivors[k][slot]` against `k`.
    strengths: [[u8; SURVIVORS]; CARDS],
}

/// Leduc hold'em with the default `OpenSpiel` parameters.
pub(crate) fn build() -> Leduc {
    let deal = |history, _| Node::Chance { first_child: subtree_base(history, 0) };
    let round_1 = (0..ROUND_NODES).map(|slot| template_node(slot, 0, ANTE, RAISE[0], deal));
    let round_2 = ROUND_END_RAISES.iter().enumerate().flat_map(|(history, &raises)| {
        let put_in = ANTE + raises * RAISE[0];
        (0..CARDS).flat_map(move |public| {
            let public = u8::try_from(public).expect("six cards fit a u8");
            let base = subtree_base(history, usize::from(public));
            let show = move |_, stake| Node::Showdown { stake, public };
            (0..ROUND_NODES).map(move |slot| template_node(slot, base, put_in, RAISE[1], show))
        })
    });
    let survivors =
        std::array::from_fn(|public| std::array::from_fn(|slot| survivor(public, slot)));
    let strengths = std::array::from_fn(|public| {
        let public_card = u8::try_from(public).expect("six cards fit a u8");
        std::array::from_fn(|slot| strength(survivor(public, slot), public_card))
    });
    Leduc { nodes: round_1.chain(round_2).collect(), survivors, strengths }
}

/// The fixture vocabulary: empty, see the module docs.
pub(crate) fn names() -> Names {
    Names::default()
}

/// Node `slot` of the betting round at `base`, each player having put in `put_in` when
/// it starts; `end(history, stake)` makes the round-end node after history `0` to `4`
/// (cc, crc, crrc, rc, rrc) with `stake` put in by each player.
fn template_node(
    slot: usize,
    base: u32,
    put_in: f32,
    raise: f32,
    end: impl Fn(usize, f32) -> Node,
) -> Node {
    let at = |offset: u32| base + offset;
    let decision = |player: u8, children: [u32; 3]| {
        let num_actions = children.iter().filter(|&&child| child != NO_CHILD).count();
        Node::Decision { player, num_actions, children }
    };
    match slot {
        0 => decision(PLAYER_0, [at(1), at(6), NO_CHILD]),
        1 => decision(PLAYER_1, [at(2), at(3), NO_CHILD]),
        2 => end(0, put_in),
        3 => decision(PLAYER_0, [at(4), at(5), at(7)]),
        4 => Node::Fold { folder: PLAYER_0, lost: put_in },
        5 => end(1, put_in + raise),
        6 => decision(PLAYER_1, [at(10), at(11), at(12)]),
        7 => decision(PLAYER_1, [at(8), at(9), NO_CHILD]),
        8 => Node::Fold { folder: PLAYER_1, lost: put_in + raise },
        9 => end(2, put_in + 2.0 * raise),
        10 => Node::Fold { folder: PLAYER_1, lost: put_in },
        11 => end(3, put_in + raise),
        12 => decision(PLAYER_0, [at(13), at(14), NO_CHILD]),
        13 => Node::Fold { folder: PLAYER_0, lost: put_in + raise },
        14 => end(4, put_in + 2.0 * raise),
        _ => panic!("slot {slot} is outside the {ROUND_NODES}-node round template"),
    }
}

/// Index of the round-2 template after round-1 history `history` with public card
/// `public`.
fn subtree_base(history: usize, public: usize) -> u32 {
    node_index(ROUND_NODES * (1 + history * CARDS + public))
}

fn node_index(index: usize) -> u32 {
    u32::try_from(index).expect("the Leduc tree has 465 nodes")
}

/// The root slot of the card at `slot` once `public` is out: the cards other than
/// `public`, in ascending order.
fn survivor(public: usize, slot: usize) -> u32 {
    let card = if slot < public { slot } else { slot + 1 };
    u32::try_from(card).expect("six cards fit a u32")
}

/// Showdown strength of `card` with `public` on the board: a pair above every rank,
/// otherwise the rank.
fn strength(card: u32, public: u8) -> u8 {
    let rank = u8::try_from(card).expect("six cards fit a u8") / SUITS;
    if rank == public / SUITS { PAIR } else { rank }
}

/// `out[i] = sum over j != i of opp_reach[j] * amount`: a fold pays `amount` to the
/// hero whatever the cards, with the same-card matchup removed.
fn fold(amount: f32, opp_reach: &[f32], out: &mut [f32]) {
    for (hero_slot, slot_out) in out.iter_mut().enumerate() {
        *slot_out = opp_reach
            .iter()
            .enumerate()
            .filter(|&(opp_slot, _)| opp_slot != hero_slot)
            .map(|(_, &reach)| reach * amount)
            .sum();
    }
}

impl Leduc {
    fn at(&self, node: u32) -> Node {
        self.nodes[node as usize]
    }

    /// `out[i] = sum over j != i of opp_reach[j] * (stake, -stake or 0)` by whether the
    /// hero's card beats, loses to or ties the opponent's with `public` on the board.
    fn showdown(&self, stake: f32, public: u8, opp_reach: &[f32], out: &mut [f32]) {
        let strengths = &self.strengths[usize::from(public)];
        for (hero_slot, slot_out) in out.iter_mut().enumerate() {
            *slot_out = opp_reach
                .iter()
                .enumerate()
                .filter(|&(opp_slot, _)| opp_slot != hero_slot)
                .map(|(opp_slot, &reach)| {
                    reach
                        * match strengths[hero_slot].cmp(&strengths[opp_slot]) {
                            Ordering::Greater => stake,
                            Ordering::Less => -stake,
                            Ordering::Equal => 0.0,
                        }
                })
                .sum();
        }
    }
}

impl Game for Leduc {
    fn root(&self) -> u32 {
        0
    }

    fn num_nodes(&self) -> usize {
        self.nodes.len()
    }

    fn node(&self, node: u32) -> NodeInfo {
        match self.at(node) {
            Node::Decision { player, num_actions, .. } => {
                NodeInfo::Decision { player, num_actions }
            }
            Node::Chance { .. } => NodeInfo::Chance { num_outcomes: CARDS },
            Node::Fold { .. } | Node::Showdown { .. } => NodeInfo::Terminal,
        }
    }

    fn child(&self, node: u32, action: usize) -> u32 {
        let Node::Decision { num_actions, children, .. } = self.at(node) else {
            panic!("leduc node {node} is not a decision node");
        };
        assert!(action < num_actions, "leduc node {node} has no action {action}");
        children[action]
    }

    fn combo_count(&self, node: u32, _player: u8) -> usize {
        if (node as usize) < ROUND_NODES { CARDS } else { SURVIVORS }
    }

    fn root_weights(&self, _player: u8) -> &[f32] {
        &ROOT_WEIGHTS
    }

    fn chance_outcome(&self, node: u32, outcome: usize) -> ChanceEdge<'_> {
        let Node::Chance { first_child } = self.at(node) else {
            panic!("leduc node {node} is not a chance node");
        };
        let survivors: &[u32] = &self.survivors[outcome];
        ChanceEdge {
            child: first_child + node_index(outcome * ROUND_NODES),
            weight: PUBLIC_CARD_WEIGHT,
            parent_of_child: [survivors, survivors],
        }
    }

    fn terminal_utility(&self, node: u32, hero: u8, opp_reach: &[f32], out: &mut [f32]) {
        match self.at(node) {
            Node::Fold { folder, lost } => {
                fold(if folder == hero { -lost } else { lost }, opp_reach, out);
            }
            Node::Showdown { stake, public } => self.showdown(stake, public, opp_reach, out),
            Node::Decision { .. } | Node::Chance { .. } => {
                panic!("leduc node {node} is not terminal");
            }
        }
    }

    fn normalizer(&self) -> f32 {
        NORMALIZER
    }

    fn root_pot(&self) -> f32 {
        ROOT_POT
    }
}

#[cfg(test)]
mod tests {
    use postflop_engine::br::{self, UniformProfile};

    use super::*;

    /// The first row of `validation/fixtures/openspiel/leduc_exploitability.json`.
    const OPENSPIEL_UNIFORM_MEAN_GAIN: f64 = 2.373_611_111_111_111;
    const UNIFORM_TOLERANCE: f64 = 1e-6;
    const INFORMATION_STATES: usize = 936;
    const NODES: usize = 465;
    /// `OpenSpiel`'s `max_utility` for `leduc_poker`.
    const MAX_WIN: f32 = 13.0;

    fn decision_nodes(game: &Leduc) -> impl Iterator<Item = (u32, u8, usize)> + '_ {
        (0..game.num_nodes()).filter_map(move |index| {
            let node = node_index(index);
            match game.node(node) {
                NodeInfo::Decision { player, num_actions } => Some((node, player, num_actions)),
                NodeInfo::Chance { .. } | NodeInfo::Terminal => None,
            }
        })
    }

    /// The model pin, through the engine's own walks: the uniform profile's mean gain is
    /// the first row of the committed curve.
    #[test]
    fn uniform_profile_mean_gain_is_the_first_openspiel_row() {
        let game = build();
        let profile = UniformProfile(&game);
        let gain = |player: u8| {
            f64::from(br::best_response_value(&game, player, &profile))
                - f64::from(br::expected_value(&game, player, &profile))
        };
        let (gain_0, gain_1) = (gain(0), gain(1));
        let mean = f64::midpoint(gain_0, gain_1);
        let error = (mean - OPENSPIEL_UNIFORM_MEAN_GAIN).abs();
        println!("leduc uniform profile: gains {gain_0} {gain_1}, mean {mean}, error {error}");
        assert!(error <= UNIFORM_TOLERANCE, "mean gain {mean} is {error} off, over 1e-6");
        let values = [0, 1].map(|player| f64::from(br::expected_value(&game, player, &profile)));
        assert!((values[0] + values[1]).abs() <= 1e-6, "not zero-sum: {values:?}");
    }

    #[test]
    fn information_states_are_936() {
        let game = build();
        let states: usize =
            decision_nodes(&game).map(|(node, player, _)| game.combo_count(node, player)).sum();
        assert_eq!(states, INFORMATION_STATES);
    }

    #[test]
    fn tree_has_465_nodes_five_chance_nodes_and_consistent_edges() {
        let game = build();
        assert_eq!(game.num_nodes(), NODES);
        let chance: Vec<u32> = (0..NODES)
            .map(node_index)
            .filter(|&node| matches!(game.node(node), NodeInfo::Chance { .. }))
            .collect();
        assert_eq!(chance, vec![2, 5, 9, 11, 14]);
        for (node, player, num_actions) in decision_nodes(&game) {
            for action in 0..num_actions {
                let child = game.child(node, action);
                assert!((child as usize) < NODES, "node {node} action {action} -> {child}");
                assert_eq!(game.combo_count(child, player), game.combo_count(node, player));
            }
        }
        for &node in &chance {
            for outcome in 0..CARDS {
                let edge = game.chance_outcome(node, outcome);
                assert_eq!(edge.parent_of_child[0], edge.parent_of_child[1]);
                assert!(edge.parent_of_child[0].windows(2).all(|pair| pair[0] < pair[1]));
                assert!(!edge.parent_of_child[0].contains(&node_index(outcome)));
                assert_eq!(game.combo_count(edge.child, 0), SURVIVORS);
                assert!((edge.weight - PUBLIC_CARD_WEIGHT).abs() < f32::EPSILON);
            }
        }
        let stakes = game.nodes.iter().filter_map(|node| match *node {
            Node::Showdown { stake, .. } => Some(stake),
            Node::Fold { lost, .. } => Some(lost),
            Node::Decision { .. } | Node::Chance { .. } => None,
        });
        assert!((stakes.fold(0.0, f32::max) - MAX_WIN).abs() < f32::EPSILON);
    }

    /// `u0(i, j) + u1(j, i) == 0` at every terminal, read off one-hot reach vectors.
    #[test]
    fn every_terminal_is_zero_sum_per_combo_pair() {
        let game = build();
        let utility = |node: u32, hero: u8, opp: usize, combos: usize| {
            let mut reach = vec![0.0f32; combos];
            reach[opp] = 1.0;
            let mut out = vec![0.0f32; combos];
            game.terminal_utility(node, hero, &reach, &mut out);
            out
        };
        for node in (0..NODES).map(node_index).filter(|&n| game.node(n) == NodeInfo::Terminal) {
            let combos = game.combo_count(node, 0);
            for (opp, hero) in (0..combos).flat_map(|opp| (0..combos).map(move |hero| (opp, hero)))
            {
                let hero_0 = utility(node, 0, opp, combos)[hero];
                let total = hero_0 + utility(node, 1, hero, combos)[opp];
                assert!(total.abs() < f32::EPSILON, "node {node}: {hero} vs {opp} sum {total}");
                assert!(hero != opp || hero_0.abs() < f32::EPSILON, "same card {hero} pays");
            }
        }
    }
}
