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
//! reported by `parse_dump`, which then runs `check_facts` over what the dump does hold, so
//! `check_invariants` adds only rule 5's known hand space to a complete dump. Both paths
//! feed the same `NodeFacts`, in which an absent field is `None` and its checks are skipped
//! exactly where node-dump.ts skips them.
//!
//! Structural (Rust only, in the `structure` submodule): `check_dump_structure` for any
//! dump (every key parses and is listed once, its config id and pair match the dump's, its
//! street and board match the node's, `to_act` is in the pair, two stacks, a pot above
//! zero, at most 255 actions, a sized token equal to its `size_cbb`, reach within `[0, 1]`
//! with one entry per seat), `check_pack_hand_space` for the pack's `preflop_169` rule
//! (O-132), and `check_structure` for both, what `pack` runs.
//!
//! Lane P (pack) owns this file.

use std::borrow::Cow;
use std::collections::BTreeSet;
use std::fmt;

use gto_model::{ComboId, HandClass};

use crate::dump::{DumpHand, DumpNode, NodeDump};

mod structure;

pub(crate) use structure::is_timestamp;
pub use structure::{check_dump_structure, check_pack_hand_space, check_structure};

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

/// What rules 1 to 4 read of one hand. A field is `None` when the dump lacks it: its
/// absence is `parse_dump`'s rule 5 or rule 1 sentence, and the checks that need it are
/// skipped, as `checkNodeDumpInvariants` skips them.
pub(crate) struct HandFacts<'a> {
    /// The hand label.
    pub label: Option<&'a str>,
    /// One frequency per action.
    pub frequencies: Option<Cow<'a, [f64]>>,
    /// One expected value per action.
    pub ev_bb: Option<Cow<'a, [f64]>>,
}

/// What rules 1 to 4 read of one node; `None` marks an absent field as in `HandFacts`.
pub(crate) struct NodeFacts<'a> {
    /// `Node <key>`, or `The node at index <i>` for a node without a key.
    pub name: String,
    /// How many actions the node lists.
    pub action_count: Option<usize>,
    /// The tokens the node's actions carry.
    pub tokens: Vec<&'a str>,
    /// The node's hands.
    pub hands: Option<Vec<HandFacts<'a>>>,
}

/// Rules 1 to 4 over a parsed dump, plus rule 5's known hand space (the missing fields of
/// rule 5 are `parse_dump`'s); empty when the dump holds.
#[must_use]
pub fn check_invariants(d: &NodeDump) -> Vec<Violation> {
    check_facts(Some(&d.hand_space), d.nodes.iter().map(node_facts))
}

/// Every fact of a typed node, which has every field.
fn node_facts(node: &DumpNode) -> NodeFacts<'_> {
    let hands = node.hands.iter().map(hand_facts).collect();
    NodeFacts {
        name: format!("Node {}", node.node_key),
        action_count: Some(node.actions.len()),
        tokens: node.actions.iter().map(|action| action.token.as_str()).collect(),
        hands: Some(hands),
    }
}

fn hand_facts(hand: &DumpHand) -> HandFacts<'_> {
    HandFacts {
        label: Some(&hand.hand),
        frequencies: Some(Cow::Borrowed(&hand.frequencies)),
        ev_bb: Some(Cow::Borrowed(&hand.ev_bb)),
    }
}

/// Rules 1 to 4 over the facts present, plus rule 5's known hand space. A `None` hand
/// space is absent from the dump: `parse_dump` reports it and rule 3 is skipped.
pub(crate) fn check_facts<'a>(
    hand_space: Option<&str>,
    nodes: impl Iterator<Item = NodeFacts<'a>>,
) -> Vec<Violation> {
    let known = hand_space.filter(|space| [PREFLOP_169, POSTFLOP_1326].contains(space));
    let unknown = hand_space.filter(|_| known.is_none()).map(|shown| {
        let message =
            format!("The dump's hand_space {shown:?} is not {PREFLOP_169} or {POSTFLOP_1326}.");
        Violation::new(Rule::Metadata, message)
    });
    let nodes = nodes.flat_map(|node| check_node(&node, known));
    unknown.into_iter().chain(nodes).collect()
}

/// Rules 1 to 4 for one node.
fn check_node(node: &NodeFacts<'_>, hand_space: Option<&str>) -> Vec<Violation> {
    let name = node.name.as_str();
    let hands = node.hands.as_deref().unwrap_or_default();
    let tokens = duplicates(node.tokens.iter().copied())
        .into_iter()
        .map(|token| format!("{name} lists the action token {token} more than once."));
    let labels = duplicates(hands.iter().filter_map(|hand| hand.label))
        .into_iter()
        .map(|label| format!("{name} lists the hand {label} more than once."));
    let repeated: Vec<Violation> =
        tokens.chain(labels).map(|message| Violation::new(Rule::Duplicates, message)).collect();
    let checked = hands
        .iter()
        .enumerate()
        .flat_map(|(index, hand)| check_hand(name, index, hand, node.action_count, hand_space));
    checked.chain(repeated).collect()
}

/// Rules 1 to 3 for one hand; a check whose field is absent is skipped.
fn check_hand(
    name: &str,
    index: usize,
    hand: &HandFacts<'_>,
    actions: Option<usize>,
    hand_space: Option<&str>,
) -> Vec<Violation> {
    let who = match hand.label {
        Some(label) => format!("{name} hand {label}"),
        None => format!("{name} hand at index {index}"),
    };
    let label = hand_space
        .zip(hand.label)
        .filter(|(space, label)| canonical_hand_index(space, label).is_none())
        .map(|(space, _)| {
            let message =
                format!("{who} is not a {space} label in gto-model's canonical spelling.");
            Violation::new(Rule::HandLabel, message)
        });
    let frequencies = hand.frequencies.as_deref();
    let frequency_count = count_mismatch(&who, "frequencies", frequencies, actions);
    let frequency_sum = frequencies.and_then(|row| sum_mismatch(&who, row));
    let ev_count = count_mismatch(&who, "expected values", hand.ev_bb.as_deref(), actions);
    [label, frequency_count, frequency_sum, ev_count].into_iter().flatten().collect()
}

/// Rule 1: one entry of `row` per action, when the dump has both.
fn count_mismatch(
    who: &str,
    what: &str,
    row: Option<&[f64]>,
    actions: Option<usize>,
) -> Option<Violation> {
    let (row, actions) = row.zip(actions)?;
    let count = row.len();
    (count != actions).then(|| {
        Violation::new(Rule::Counts, format!("{who} has {count} {what} for {actions} actions."))
    })
}

/// Rule 2: the frequencies sum to 1 within the tolerance.
fn sum_mismatch(who: &str, row: &[f64]) -> Option<Violation> {
    let sum = row.iter().fold(0.0, |total, frequency| total + frequency);
    ((sum - 1.0).abs() > FREQUENCY_SUM_TOLERANCE).then(|| {
        let shown = format_sum(sum);
        let message = format!(
            "{who} has frequencies summing to {shown}, not 1 within {FREQUENCY_SUM_TOLERANCE}."
        );
        Violation::new(Rule::FrequencySum, message)
    })
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
