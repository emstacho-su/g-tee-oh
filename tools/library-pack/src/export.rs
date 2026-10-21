//! Library to dump (R2.8, O-133): the read-back side of the round trip.
//!
//! O-133 defines "reads back identically" for an 8-bit format: node keys, actions, sizes,
//! hands, `to_act`, pot and stacks are equal; frequencies are within 1/255, losses within
//! half a unit (0.005% of the pot), reach within 1/131070 and the best action's expected
//! value (EV) exactly equal as an f32. `compare_dumps` checks exactly that, plus the header
//! (source, configuration, pair, hand space, and the config id and exploitability when the
//! original has them), and names each difference once. Nodes are matched by key and hands by
//! label, so order does not matter. Each tolerance carries `F32_SLACK` because the library
//! hands numbers back as f32. The loss tolerances derive from `gto_library::quantize`, so a
//! change to the loss unit cannot leave `verify` checking against stale values.
//!
//! Lane P (pack) owns this file.

use std::collections::{BTreeMap, BTreeSet};

use gto_library::quantize::{LOSS_SATURATED, LOSS_UNITS_PER_POT};
use gto_library::{HandSpace, SolutionMeta, SolvedHand, SolvedNode, Source, narrow_f32};
use gto_model::{Cbb, ComboId, HandClass, format_cards};

use crate::dump::{DumpAction, DumpConfig, DumpHand, DumpNode, NodeDump};
use crate::invariants::{POSTFLOP_1326, PREFLOP_169};

/// A frequency reads back within 1/255 of its share of the row (R2.7, O-133).
pub const FREQUENCY_TOLERANCE: f64 = 1.0 / 255.0;
/// A reach reads back within half a step of 1/65535 (R2.7, O-133).
pub const REACH_TOLERANCE: f64 = 1.0 / 131_070.0;
/// A loss reads back within half a unit, one unit being 1/`LOSS_UNITS_PER_POT` of the pot
/// (0.01%), as a share of the pot. The casts are exact; `f64::from` is not `const`.
pub const LOSS_TOLERANCE_PER_POT: f64 = 0.5 / LOSS_UNITS_PER_POT as f64;
/// A loss saturates at `LOSS_SATURATED` units (655.35% of the pot, A3 section 4), as a
/// share of the pot.
pub const LOSS_SATURATION_PER_POT: f64 = LOSS_SATURATED as f64 / LOSS_UNITS_PER_POT as f64;
/// The relative rounding an f32 adds to a value read back from the library.
pub const F32_SLACK: f64 = 1e-6;
/// The dump schema version `export_dump` writes.
const SCHEMA_VERSION: u32 = 1;

/// A dump of `nodes` under `meta`: the inverse of `to_solution`. A hand index outside the
/// hand space gets a label no checker accepts, so such a dump never packs again.
#[must_use]
pub fn export_dump(meta: &SolutionMeta, nodes: &[SolvedNode]) -> NodeDump {
    let config = &meta.config;
    let hand_space = nodes.first().map_or(HandSpace::Preflop169, |node| node.hand_space);
    NodeDump {
        schema_version: SCHEMA_VERSION,
        source: source_name(meta.source).to_owned(),
        exported_at: meta.created_at.clone(),
        config: DumpConfig {
            format: config.format.to_string(),
            table_size: config.table_size.get(),
            stake_label: config.stake.clone(),
            depth_cbb: config.depth_cbb.get(),
            straddle: config.straddle,
            ante_cbb: config.ante_cbb.get(),
        },
        config_id: Some(meta.config_id.to_string()),
        position_pair: meta.pair.to_string(),
        hand_space: hand_space_name(hand_space).to_owned(),
        exploitability_pct_pot: meta.exploitability_pct_pot.map(Vec::from),
        nodes: nodes.iter().map(export_node).collect(),
    }
}

/// Every difference between a dump and its read-back beyond the O-133 tolerances, one
/// sentence each and each difference once: a node missing from or only in the read-back is
/// named, so the node counts are not compared on top; empty when they agree.
#[must_use]
pub fn compare_dumps(original: &NodeDump, read_back: &NodeDump) -> Vec<String> {
    let mut found = compare_header(original, read_back);
    let back: BTreeMap<&str, &DumpNode> =
        read_back.nodes.iter().map(|node| (node.node_key.as_str(), node)).collect();
    if back.len() != read_back.nodes.len() {
        found.push("The read-back lists a node key more than once.".to_owned());
    }
    for node in &original.nodes {
        match back.get(node.node_key.as_str()) {
            Some(other) => found.extend(compare_node(node, other)),
            None => found.push(format!("Node {} is missing from the read-back.", node.node_key)),
        }
    }
    let known: BTreeSet<&str> = original.nodes.iter().map(|node| node.node_key.as_str()).collect();
    let extra = read_back.nodes.iter().filter(|node| !known.contains(node.node_key.as_str()));
    found.extend(extra.map(|node| format!("Node {} is only in the read-back.", node.node_key)));
    found
}

/// The manifest and dump name of a source.
#[must_use]
pub fn source_name(source: Source) -> &'static str {
    match source {
        Source::Own => "own",
        Source::Reference => "reference",
    }
}

fn hand_space_name(space: HandSpace) -> &'static str {
    match space {
        HandSpace::Preflop169 => PREFLOP_169,
        HandSpace::Postflop1326 => POSTFLOP_1326,
    }
}

fn export_node(node: &SolvedNode) -> DumpNode {
    let board = node.key.board().map(|board| format_cards(&board.cards())).unwrap_or_default();
    DumpNode {
        node_key: node.key.to_string(),
        street: node.key.street().as_str().to_owned(),
        board,
        to_act: node.to_act.to_string(),
        pot_cbb: node.pot.get(),
        stacks_cbb: node.stacks.iter().map(|stack| stack.get()).collect(),
        actions: node
            .actions
            .iter()
            .map(|(token, size)| DumpAction { token: token.to_string(), size_cbb: size.get() })
            .collect(),
        hands: node.hands.iter().map(|hand| export_hand(node.hand_space, hand)).collect(),
        accuracy_pct_pot: node.accuracy_pct_pot.map(f64::from),
    }
}

fn export_hand(space: HandSpace, hand: &SolvedHand) -> DumpHand {
    DumpHand {
        hand: hand_label(space, hand.hand),
        reach: hand.reach.map(Vec::from),
        frequencies: hand.frequencies.clone(),
        ev_bb: hand.ev_bb.clone(),
    }
}

/// The canonical label of a hand index, or `#<index>` when the index is outside the space.
fn hand_label(space: HandSpace, index: u16) -> String {
    let label = match space {
        HandSpace::Preflop169 => u8::try_from(index)
            .ok()
            .and_then(|index| HandClass::from_index(index).ok())
            .map(|class| class.to_string()),
        HandSpace::Postflop1326 => ComboId::from_index(index).ok().map(|combo| combo.to_string()),
    };
    label.unwrap_or_else(|| format!("#{index}"))
}

fn compare_header(original: &NodeDump, back: &NodeDump) -> Vec<String> {
    let differs = |field: &str, a: &dyn std::fmt::Debug, b: &dyn std::fmt::Debug| {
        format!("The read-back's {field} is {b:?}, not {a:?}.")
    };
    let config_id = original.config_id.as_ref().filter(|id| back.config_id.as_ref() != Some(*id));
    let exploitability = original
        .exploitability_pct_pot
        .as_ref()
        .filter(|values| back.exploitability_pct_pot.as_ref() != Some(*values));
    let checks = [
        (original.source != back.source).then(|| differs("source", &original.source, &back.source)),
        (original.config != back.config).then(|| differs("config", &original.config, &back.config)),
        (original.position_pair != back.position_pair)
            .then(|| differs("position_pair", &original.position_pair, &back.position_pair)),
        (original.hand_space != back.hand_space)
            .then(|| differs("hand_space", &original.hand_space, &back.hand_space)),
        config_id.map(|id| differs("config_id", id, &back.config_id)),
        exploitability
            .map(|values| differs("exploitability", values, &back.exploitability_pct_pot)),
    ];
    checks.into_iter().flatten().collect()
}

fn compare_node(original: &DumpNode, back: &DumpNode) -> Vec<String> {
    let name = format!("Node {}", original.node_key);
    let same_accuracy =
        original.accuracy_pct_pot.map(narrow_f32) == back.accuracy_pct_pot.map(narrow_f32);
    let fields = [
        ("street", original.street == back.street),
        ("board", original.board == back.board),
        ("to_act", original.to_act == back.to_act),
        ("pot_cbb", original.pot_cbb == back.pot_cbb),
        ("stacks_cbb", original.stacks_cbb == back.stacks_cbb),
        ("actions", original.actions == back.actions),
        ("accuracy_pct_pot", same_accuracy),
    ];
    let mut found: Vec<String> = fields
        .iter()
        .filter(|(_, same)| !same)
        .map(|(field, _)| format!("{name} reads back a different {field}."))
        .collect();
    let back_hands: BTreeMap<&str, &DumpHand> =
        back.hands.iter().map(|hand| (hand.hand.as_str(), hand)).collect();
    if back_hands.len() != original.hands.len() {
        let (want, got) = (original.hands.len(), back.hands.len());
        found.push(format!("{name} reads back {got} hands, not {want}."));
    }
    let pot_bb = f64::from(original.pot_cbb) / f64::from(Cbb::PER_BB);
    for hand in &original.hands {
        match back_hands.get(hand.hand.as_str()) {
            Some(other) => found.extend(compare_hand(&name, pot_bb, hand, other)),
            None => found.push(format!("{name} hand {} is missing from the read-back.", hand.hand)),
        }
    }
    found
}

fn compare_hand(name: &str, pot_bb: f64, original: &DumpHand, back: &DumpHand) -> Vec<String> {
    let who = format!("{name} hand {}", original.hand);
    let mut found = Vec::new();
    if !frequencies_agree(&original.frequencies, &back.frequencies) {
        let (want, got) = (&original.frequencies, &back.frequencies);
        found.push(format!("{who} reads back frequencies {got:?} for {want:?}."));
    }
    if !reach_agrees(original.reach.as_deref(), back.reach.as_deref()) {
        let (want, got) = (&original.reach, &back.reach);
        found.push(format!("{who} reads back reach {got:?} for {want:?}."));
    }
    if !evs_agree(pot_bb, &original.ev_bb, &back.ev_bb) {
        let (want, got) = (&original.ev_bb, &back.ev_bb);
        found.push(format!("{who} reads back expected values {got:?} for {want:?}."));
    }
    found
}

/// Each read-back frequency within 1/255 of the original's share of its row.
fn frequencies_agree(original: &[f64], back: &[f64]) -> bool {
    let sum: f64 = original.iter().sum();
    original.len() == back.len()
        && sum > 0.0
        && original
            .iter()
            .zip(back)
            .all(|(want, got)| (got - want / sum).abs() <= FREQUENCY_TOLERANCE + F32_SLACK)
}

/// Both absent, or both present with each value within 1/131070.
fn reach_agrees(original: Option<&[f64]>, back: Option<&[f64]>) -> bool {
    match (original, back) {
        (None, None) => true,
        (Some(want), Some(got)) => {
            want.len() == got.len()
                && want.iter().zip(got).all(|(a, b)| (a - b).abs() <= REACH_TOLERANCE + F32_SLACK)
        }
        _ => false,
    }
}

/// The best action's EV equal as an f32, every loss within half a unit, and a saturated loss
/// read back at or above the saturation point.
fn evs_agree(pot_bb: f64, original: &[f64], back: &[f64]) -> bool {
    let Some(best) = best_action(original) else {
        return original.is_empty() && back.is_empty();
    };
    if original.len() != back.len()
        || narrow_f32(original[best]).to_bits() != narrow_f32(back[best]).to_bits()
    {
        return false;
    }
    let best_ev = original[best];
    let slack = F32_SLACK * (1.0 + best_ev.abs() + pot_bb);
    let half_unit = LOSS_TOLERANCE_PER_POT * pot_bb + slack;
    let saturation = LOSS_SATURATION_PER_POT * pot_bb;
    original.iter().zip(back).all(|(want, got)| {
        let (loss, back_loss) = (best_ev - want, back[best] - got);
        if loss >= saturation {
            back_loss >= saturation - half_unit
        } else {
            (loss - back_loss).abs() <= half_unit
        }
    })
}

/// The action with the highest EV, the first on ties (O-130).
fn best_action(evs: &[f64]) -> Option<usize> {
    evs.iter()
        .enumerate()
        .fold(None, |best: Option<(usize, f64)>, (index, ev)| match best {
            Some((_, top)) if top >= *ev => best,
            _ => Some((index, *ev)),
        })
        .map(|(index, _)| index)
}
