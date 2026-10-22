//! The node-pair checks and the per-node figures of gate G4 (R2.11, O-160). Child module
//! of `g4`.
//!
//! Mechanism. [`check_pair`] requires that the engine node and the oracle node agree on
//! the actor, the pot, the stacks, the action tokens with their sizes in order, and the
//! set of hand labels; any difference is a `GateError::Mismatch` naming the spot and the
//! node, so a range parser disagreement or a tree shape difference never passes as a
//! partial compare. [`node_diff`] then walks the engine node's hands, finds each in the
//! oracle node by label and computes: per hand the mean over actions of the absolute
//! frequency difference; the mean over hands weighted by the engine dump's reach for the
//! actor, times 100, the frequency-mad in points (O-160); the unweighted mean in points;
//! the largest single difference; and each side's root expected value (EV), its own
//! reach-weighted sum over hands of the frequency-weighted per-action EVs, with each
//! side's reach normalised to sum 1 so a dump that writes unnormalised reach still gives
//! a per-hand expectation. When the actor's reach sums to zero on a side there is no
//! such mean, and [`node_diff`] says which side instead of dividing by zero: the caller
//! refuses an unreached root and skips an unreached deeper node with a note.

use std::collections::BTreeMap;

use gto_model::Position;
use library_pack::{DumpHand, DumpNode};

use crate::fixtures::g4_spots::{G4Spots, Spot};

use super::super::GateError;
use super::{ENGINE, ORACLE};

/// Percent per whole.
const PERCENT: f64 = 100.0;

/// What a node pair yields: its figures, or the side on which the actor is unreached.
#[derive(Debug, Clone, PartialEq)]
pub(super) enum NodeCompare {
    /// Both sides reach the actor; the figures.
    Figures(NodeDiff),
    /// The actor's reach sums to zero on this side, so there is nothing to average.
    Unreached {
        /// `engine` or `oracle`.
        side: &'static str,
    },
}

/// The figures of one node pair.
#[derive(Debug, Clone, PartialEq)]
pub(super) struct NodeDiff {
    /// The reach-weighted mean absolute frequency difference, in points.
    pub(super) mad_points: f64,
    /// The unweighted mean, in points.
    pub(super) mad_unweighted_points: f64,
    /// The largest single frequency difference.
    pub(super) max_abs_diff: f64,
    /// The hands compared.
    pub(super) hands: f64,
    /// The engine side's reach-weighted EV at the node, in bb.
    pub(super) ev_engine_bb: f64,
    /// The oracle side's, in bb.
    pub(super) ev_oracle_bb: f64,
}

/// The index of the node's actor in pair order: 0 for the out-of-position seat.
pub(super) fn actor_index(
    spots: &G4Spots,
    spot: &Spot,
    node: &DumpNode,
) -> Result<usize, GateError> {
    let mismatch = |reason: String| mismatch(spot, node, reason);
    let pair = spots.pair().map_err(|err| mismatch(format!("the list's pair: {err}")))?;
    let seat: Position =
        node.to_act.parse().map_err(|err| mismatch(format!("to_act {:?}: {err}", node.to_act)))?;
    if seat == pair.oop() {
        Ok(0)
    } else if seat == pair.ip() {
        Ok(1)
    } else {
        Err(mismatch(format!("to_act {seat} is not a seat of {pair}")))
    }
}

/// Both nodes have the same actor, pot, stacks, actions and hand label set.
pub(super) fn check_pair(
    spot: &Spot,
    engine: &DumpNode,
    oracle: &DumpNode,
) -> Result<(), GateError> {
    let mismatch = |reason: String| mismatch(spot, engine, reason);
    if engine.to_act != oracle.to_act {
        return Err(mismatch(format!("to_act {} against {}", engine.to_act, oracle.to_act)));
    }
    if engine.pot_cbb != oracle.pot_cbb {
        return Err(mismatch(format!("pot_cbb {} against {}", engine.pot_cbb, oracle.pot_cbb)));
    }
    if engine.stacks_cbb != oracle.stacks_cbb {
        let reason = format!("stacks_cbb {:?} against {:?}", engine.stacks_cbb, oracle.stacks_cbb);
        return Err(mismatch(reason));
    }
    if engine.actions != oracle.actions {
        let (ours, theirs) = (action_list(engine), action_list(oracle));
        return Err(mismatch(format!("action tokens and sizes {ours} against {theirs}")));
    }
    let engine_hands = labels(engine);
    let oracle_hands = labels(oracle);
    if engine_hands != oracle_hands {
        let only_engine: Vec<&str> = engine_hands.difference(&oracle_hands).copied().collect();
        let only_oracle: Vec<&str> = oracle_hands.difference(&engine_hands).copied().collect();
        return Err(mismatch(format!(
            "hand sets differ: only the engine has {only_engine:?}, only the oracle has \
             {only_oracle:?}"
        )));
    }
    Ok(())
}

/// The figures of one node pair whose shape `check_pair` accepted, or the side whose
/// actor reach sums to zero.
pub(super) fn node_diff(
    spot: &Spot,
    engine: &DumpNode,
    oracle: &DumpNode,
    actor: usize,
) -> Result<NodeCompare, GateError> {
    let by_label: BTreeMap<&str, &DumpHand> =
        oracle.hands.iter().map(|hand| (hand.hand.as_str(), hand)).collect();
    let mut sums = Sums::default();
    for hand in &engine.hands {
        let other = by_label.get(hand.hand.as_str()).copied().ok_or_else(|| {
            mismatch(spot, engine, format!("the oracle has no hand {}", hand.hand))
        })?;
        let weight = reach_of(spot, engine, hand, actor, ENGINE)?;
        let other_weight = reach_of(spot, engine, other, actor, ORACLE)?;
        sums.add(hand, other, weight, other_weight);
    }
    if sums.weight <= 0.0 {
        return Ok(NodeCompare::Unreached { side: ENGINE });
    }
    if sums.other_weight <= 0.0 {
        return Ok(NodeCompare::Unreached { side: ORACLE });
    }
    Ok(NodeCompare::Figures(sums.finish()))
}

/// The running sums over the hands of a node pair.
#[derive(Debug, Default)]
struct Sums {
    weighted: f64,
    weight: f64,
    unweighted: f64,
    max_abs: f64,
    hands: f64,
    ev_engine: f64,
    ev_oracle: f64,
    other_weight: f64,
}

impl Sums {
    fn add(&mut self, hand: &DumpHand, other: &DumpHand, weight: f64, other_weight: f64) {
        let diffs: Vec<f64> =
            hand.frequencies.iter().zip(&other.frequencies).map(|(a, b)| (a - b).abs()).collect();
        let mean = diffs.iter().sum::<f64>() / count_as_f64(diffs.len()).max(1.0);
        self.max_abs = diffs.iter().copied().fold(self.max_abs, f64::max);
        self.weighted += weight * mean;
        self.weight += weight;
        self.unweighted += mean;
        self.hands += 1.0;
        self.ev_engine += weight * hand_ev(hand);
        self.ev_oracle += other_weight * hand_ev(other);
        self.other_weight += other_weight;
    }

    fn finish(self) -> NodeDiff {
        NodeDiff {
            mad_points: PERCENT * self.weighted / self.weight,
            mad_unweighted_points: PERCENT * self.unweighted / self.hands.max(1.0),
            max_abs_diff: self.max_abs,
            hands: self.hands,
            ev_engine_bb: self.ev_engine / self.weight,
            ev_oracle_bb: self.ev_oracle / self.other_weight,
        }
    }
}

/// An action count as a divisor; a node holds at most 255 actions (library-pack).
#[allow(clippy::cast_precision_loss, reason = "a node holds at most 255 actions")]
fn count_as_f64(count: usize) -> f64 {
    count as f64
}

/// The hand's expectation: its frequency-weighted per-action EV.
fn hand_ev(hand: &DumpHand) -> f64 {
    hand.frequencies.iter().zip(&hand.ev_bb).map(|(f, ev)| f * ev).sum()
}

/// The hand's reach for the actor, which every hand of a compared node must carry.
fn reach_of(
    spot: &Spot,
    node: &DumpNode,
    hand: &DumpHand,
    actor: usize,
    side: &str,
) -> Result<f64, GateError> {
    hand.reach.as_ref().and_then(|reach| reach.get(actor).copied()).ok_or_else(|| {
        mismatch(spot, node, format!("the {side} dump's hand {} carries no reach", hand.hand))
    })
}

/// The hand labels of a node as a set.
fn labels(node: &DumpNode) -> std::collections::BTreeSet<&str> {
    node.hands.iter().map(|hand| hand.hand.as_str()).collect()
}

/// A node's actions as `token:size` words, for a mismatch reason.
fn action_list(node: &DumpNode) -> String {
    let words: Vec<String> =
        node.actions.iter().map(|action| format!("{}:{}", action.token, action.size_cbb)).collect();
    format!("[{}]", words.join(", "))
}

/// A `Mismatch` at `node` of `spot`.
fn mismatch(spot: &Spot, node: &DumpNode, reason: String) -> GateError {
    GateError::Mismatch { spot: spot.id.clone(), node: node.node_key.clone(), reason }
}
