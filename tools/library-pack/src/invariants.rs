//! Criterion 2 invariants in Rust (R2.8): `check_invariants` mirrors
//! `checkNodeDumpInvariants` in `packages/contracts/src/node-dump.ts` rule for rule, and
//! `check_structure` adds the checks only Rust can make with `gto-model`. Both return every
//! violation as one plain sentence naming the node key and the hand; both read their input
//! and never change it.
//!
//! Rules 1 to 5 (from node-dump.ts): one frequency and one expected value (EV) per action;
//! each hand's frequencies sum to 1 within `FREQUENCY_SUM_TOLERANCE`; hand labels in
//! `gto-model`'s canonical spelling (`Display == input`, since `ComboId::from_str` is lenient
//! about card order); no token or hand twice in a node; complete metadata. A missing field is
//! reported by `parse_dump`, so `check_invariants` adds only rule 5's known hand space.
//!
//! Structural (Rust only, in the `structure` submodule): every key parses, its config id and
//! pair match the dump's, its street and board match the node's, `to_act` is in the pair, two
//! stacks, a pot above zero, at most 255 actions, a sized token equal to its `size_cbb`, reach
//! within `[0, 1]`, and a `preflop_169` hand space (O-132).
//!
//! Lane P (pack) owns this file.

use std::collections::BTreeSet;
use std::fmt;

use gto_model::{ComboId, HandClass};

use crate::dump::{DumpHand, DumpNode, NodeDump};

mod structure;

pub use structure::check_structure;
pub(crate) use structure::is_timestamp;

/// How far from 1 one hand's frequencies may sum (criterion 2, node-dump.ts).
pub const FREQUENCY_SUM_TOLERANCE: f64 = 0.001;

/// The hand space of the 169 preflop classes, as a dump spells it.
pub const PREFLOP_169: &str = "preflop_169";
/// The hand space of the 1,326 combos, as a dump spells it.
pub const POSTFLOP_1326: &str = "postflop_1326";

/// Decimal places a reported frequency sum keeps, enough to show a 0.001 miss (node-dump.ts).
const SUM_DECIMALS: usize = 6;

/// The rule a violation breaks.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Rule {
    /// Rule 1: one frequency and one EV per action.
    Counts,
    /// Rule 2: frequencies sum to 1 within the tolerance.
    FrequencySum,
    /// Rule 3: canonical hand labels in the dump's hand space.
    HandLabel,
    /// Rule 4: no token or hand twice in a node.
    Duplicates,
    /// Rule 5: complete metadata.
    Metadata,
    /// A Rust-only structural check.
    Structural,
}

impl Rule {
    /// The node-dump.ts rule number, 1 to 5; `None` for a structural check.
    #[must_use]
    pub const fn number(self) -> Option<u8> {
        match self {
            Rule::Counts => Some(1),
            Rule::FrequencySum => Some(2),
            Rule::HandLabel => Some(3),
            Rule::Duplicates => Some(4),
            Rule::Metadata => Some(5),
            Rule::Structural => None,
        }
    }
}

/// One broken rule with its sentence.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Violation {
    /// The rule broken.
    pub rule: Rule,
    /// One plain sentence naming the node key and the hand where they apply.
    pub message: String,
}

impl Violation {
    /// A violation of `rule` with `message`.
    #[must_use]
    pub fn new(rule: Rule, message: impl Into<String>) -> Self {
        Violation { rule, message: message.into() }
    }
}

impl fmt::Display for Violation {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

/// The index of a hand label in `hand_space` when the label is in `gto-model`'s canonical
/// spelling (rule 3), else `None`. An unknown hand space has no labels.
#[must_use]
pub fn canonical_hand_index(hand_space: &str, label: &str) -> Option<u16> {
    match hand_space {
        PREFLOP_169 => label
            .parse::<HandClass>()
            .ok()
            .filter(|class| class.to_string() == label)
            .map(|class| u16::from(class.index())),
        POSTFLOP_1326 => label
            .parse::<ComboId>()
            .ok()
            .filter(|combo| combo.to_string() == label)
            .map(ComboId::index),
        _ => None,
    }
}

/// Rules 1 to 4 over a parsed dump, plus rule 5's known hand space (the missing fields of
/// rule 5 are `parse_dump`'s); empty when the dump holds.
#[must_use]
pub fn check_invariants(d: &NodeDump) -> Vec<Violation> {
    let known_space = [PREFLOP_169, POSTFLOP_1326].contains(&d.hand_space.as_str());
    let space = (!known_space).then(|| {
        let shown = &d.hand_space;
        let message =
            format!("The dump's hand_space {shown:?} is not {PREFLOP_169} or {POSTFLOP_1326}.");
        Violation::new(Rule::Metadata, message)
    });
    let hand_space = known_space.then_some(d.hand_space.as_str());
    let nodes = d.nodes.iter().flat_map(|node| check_node(node, hand_space));
    space.into_iter().chain(nodes).collect()
}

/// Rules 1 to 4 for one node.
fn check_node(node: &DumpNode, hand_space: Option<&str>) -> Vec<Violation> {
    let name = format!("Node {}", node.node_key);
    let tokens = duplicates(node.actions.iter().map(|action| action.token.as_str()))
        .into_iter()
        .map(|token| format!("{name} lists the action token {token} more than once."));
    let labels = duplicates(node.hands.iter().map(|hand| hand.hand.as_str()))
        .into_iter()
        .map(|label| format!("{name} lists the hand {label} more than once."));
    let repeated: Vec<Violation> =
        tokens.chain(labels).map(|message| Violation::new(Rule::Duplicates, message)).collect();
    let actions = node.actions.len();
    let hands = node.hands.iter().flat_map(|hand| check_hand(&name, hand, actions, hand_space));
    hands.chain(repeated).collect()
}

/// Rules 1 to 3 for one hand.
fn check_hand(
    name: &str,
    hand: &DumpHand,
    actions: usize,
    hand_space: Option<&str>,
) -> Vec<Violation> {
    let who = format!("{name} hand {}", hand.hand);
    let label =
        hand_space.filter(|space| canonical_hand_index(space, &hand.hand).is_none()).map(|space| {
            let message =
                format!("{who} is not a {space} label in gto-model's canonical spelling.");
            Violation::new(Rule::HandLabel, message)
        });
    let frequency_count = (hand.frequencies.len() != actions).then(|| {
        let count = hand.frequencies.len();
        Violation::new(
            Rule::Counts,
            format!("{who} has {count} frequencies for {actions} actions."),
        )
    });
    let sum = hand.frequencies.iter().fold(0.0, |total, frequency| total + frequency);
    let frequency_sum = ((sum - 1.0).abs() > FREQUENCY_SUM_TOLERANCE).then(|| {
        let shown = format_sum(sum);
        let message = format!(
            "{who} has frequencies summing to {shown}, not 1 within {FREQUENCY_SUM_TOLERANCE}."
        );
        Violation::new(Rule::FrequencySum, message)
    });
    let ev_count = (hand.ev_bb.len() != actions).then(|| {
        let count = hand.ev_bb.len();
        let message = format!("{who} has {count} expected values for {actions} actions.");
        Violation::new(Rule::Counts, message)
    });
    [label, frequency_count, frequency_sum, ev_count].into_iter().flatten().collect()
}

/// The values that occur more than once, each listed once, in first-repeat order.
fn duplicates<'a>(values: impl Iterator<Item = &'a str>) -> Vec<&'a str> {
    let mut seen = BTreeSet::new();
    let mut repeated = Vec::new();
    for value in values {
        if !seen.insert(value) && !repeated.contains(&value) {
            repeated.push(value);
        }
    }
    repeated
}

/// A sum rounded to `SUM_DECIMALS` places with trailing zeros dropped, as node-dump.ts
/// prints it.
fn format_sum(sum: f64) -> String {
    let fixed = format!("{sum:.SUM_DECIMALS$}");
    let trimmed = fixed.trim_end_matches('0').trim_end_matches('.');
    if trimmed == "-0" { "0".to_owned() } else { trimmed.to_owned() }
}
