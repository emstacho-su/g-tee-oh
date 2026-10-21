//! The node dump as serde reads it (R2.8): a mirror of
//! `packages/contracts/schemas/node-dump.schema.json` with unknown fields denied.
//!
//! Fields a rule checks (keys, positions, tokens, labels, enumerations) stay text here, so a
//! bad value becomes a violation sentence from `invariants` rather than a serde error.
//! `parse_dump` reads the bytes as a JSON (JavaScript Object Notation) value first and
//! reports every missing required field the way `checkNodeDumpInvariants` does, before the
//! typed parse: rule 5 for metadata, node fields and labels, rule 1 for a hand without its
//! frequencies or expected values. A dump with a missing field is rejected without the typed
//! parse, but rules 1 to 4 still run over what it does hold (`invariants::check_facts`),
//! skipping each check whose field is absent as the TypeScript checker does, so the two
//! checkers report the same rules for the same dump. Anything else serde rejects (a wrong
//! type, an unknown field, a number out of range) is one `Rule::Structural` sentence. It never
//! panics; `serde_json`'s default recursion limit of 128 bounds nesting.
//!
//! Lane P (pack) owns this file and may reshape these types, which only lane P uses.

use std::borrow::Cow;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::invariants::{HandFacts, NodeFacts, Rule, Violation, check_facts};

/// The game configuration a dump was exported for.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DumpConfig {
    /// `online` or `live`.
    pub format: String,
    /// Seats at the table, 2 to 9.
    pub table_size: u8,
    /// The stake label, copied verbatim into the manifest's `config.stake` (plan G7).
    pub stake_label: String,
    /// Effective stack depth in cbb (centi-big-blinds).
    pub depth_cbb: u32,
    /// True when a straddle is posted.
    pub straddle: bool,
    /// Ante per player in cbb.
    pub ante_cbb: u32,
}

/// One action of a node: its token and total wager in cbb.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DumpAction {
    /// The token text, for example `r300`.
    pub token: String,
    /// The total wager in cbb.
    pub size_cbb: u32,
}

/// One hand's strategy at a node.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DumpHand {
    /// The hand label in `gto-model`'s canonical spelling.
    pub hand: String,
    /// Reach per seat in pair order, when exported.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reach: Option<Vec<f64>>,
    /// One frequency per action.
    pub frequencies: Vec<f64>,
    /// One expected value (EV) in big blinds per action.
    pub ev_bb: Vec<f64>,
}

/// One decision point.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DumpNode {
    /// The node key text.
    pub node_key: String,
    /// `preflop`, `flop`, `turn` or `river`.
    pub street: String,
    /// The board cards, empty preflop.
    pub board: String,
    /// The seat to act.
    pub to_act: String,
    /// The total pot in cbb.
    pub pot_cbb: u32,
    /// Remaining stacks in cbb in pair order.
    pub stacks_cbb: Vec<u32>,
    /// The available actions.
    pub actions: Vec<DumpAction>,
    /// The hands in range.
    pub hands: Vec<DumpHand>,
    /// The solve's accuracy at this node in percent of the pot.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub accuracy_pct_pot: Option<f64>,
}

/// A node dump.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NodeDump {
    /// Always 1.
    pub schema_version: u32,
    /// `own` or `reference`.
    pub source: String,
    /// When the dump was exported.
    pub exported_at: String,
    /// The game configuration.
    pub config: DumpConfig,
    /// The configuration identifier, when given.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub config_id: Option<String>,
    /// The two seats, out of position first.
    pub position_pair: String,
    /// `preflop_169` or `postflop_1326`.
    pub hand_space: String,
    /// The exploitability per seat in percent of the pot.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exploitability_pct_pot: Option<Vec<f64>>,
    /// The nodes.
    pub nodes: Vec<DumpNode>,
}

/// The fields every dump carries (schema `required`); a missing one is a rule 5 sentence.
const REQUIRED_DUMP_FIELDS: [&str; 7] =
    ["schema_version", "source", "exported_at", "config", "position_pair", "hand_space", "nodes"];
/// The six game configuration fields (rule 5).
const REQUIRED_CONFIG_FIELDS: [&str; 6] =
    ["format", "table_size", "stake_label", "depth_cbb", "straddle", "ante_cbb"];
/// The fields every node carries (rule 5), each with the word `checkNodeDumpInvariants`
/// uses for its shape in the sentence `<node> has no <field> <shape>.`.
const REQUIRED_NODE_FIELDS: [(&str, &str); 8] = [
    (NODE_KEY_FIELD, "string"),
    ("street", "field"),
    ("board", "field"),
    ("to_act", "field"),
    ("pot_cbb", "field"),
    ("stacks_cbb", "field"),
    (ACTIONS_FIELD, "array"),
    (HANDS_FIELD, "array"),
];
/// The per-action arrays of a hand; a missing one breaks rule 1, as in node-dump.ts.
const PER_ACTION_HAND_FIELDS: [&str; 2] = [FREQUENCIES_FIELD, EV_FIELD];
/// The hand label field; a missing one breaks rule 5.
const HAND_LABEL_FIELD: &str = "hand";
/// The field names rules 1 to 4 read from an incomplete dump.
const HAND_SPACE_FIELD: &str = "hand_space";
const NODES_FIELD: &str = "nodes";
const NODE_KEY_FIELD: &str = "node_key";
const ACTIONS_FIELD: &str = "actions";
const TOKEN_FIELD: &str = "token";
const HANDS_FIELD: &str = "hands";
const FREQUENCIES_FIELD: &str = "frequencies";
const EV_FIELD: &str = "ev_bb";

/// Parses dump bytes, reporting a malformed shape as violation sentences (rule 5 for a
/// missing required field, rule 1 for a hand without its frequencies or expected values,
/// `Rule::Structural` for anything else serde rejects). A dump with a missing field also
/// gets rules 1 to 4 over the fields it has, so no rule is hidden behind rule 5.
///
/// # Errors
///
/// Every violation found, never empty.
pub fn parse_dump(bytes: &[u8]) -> Result<NodeDump, Vec<Violation>> {
    let value: Value = serde_json::from_slice(bytes).map_err(|err| {
        vec![Violation::new(Rule::Structural, format!("The dump is not valid JSON: {err}."))]
    })?;
    let missing = missing_fields(&value);
    if missing.is_empty() {
        return serde_json::from_value(value).map_err(|err| {
            let message = format!("The dump does not match the node-dump schema: {err}.");
            vec![Violation::new(Rule::Structural, message)]
        });
    }
    let hand_space = value.get(HAND_SPACE_FIELD).and_then(Value::as_str);
    let present = check_facts(hand_space, node_facts_of(&value));
    Err([missing, present].concat())
}

/// Every required field the value lacks, in the sentences `checkNodeDumpInvariants` writes.
fn missing_fields(value: &Value) -> Vec<Violation> {
    let Some(dump) = value.as_object() else {
        return vec![Violation::new(Rule::Structural, "The dump is not a JSON object.")];
    };
    let top = absent(dump, &REQUIRED_DUMP_FIELDS)
        .map(|field| format!("The dump is missing the required field {field}."));
    let config_fields = dump.get("config").and_then(Value::as_object).map_or_else(Vec::new, |c| {
        absent(c, &REQUIRED_CONFIG_FIELDS)
            .map(|field| {
                format!("The dump's config is missing the game configuration field {field}.")
            })
            .collect()
    });
    let metadata = top.chain(config_fields).map(|message| Violation::new(Rule::Metadata, message));
    let in_nodes = nodes_of(dump).iter().enumerate().flat_map(|(i, node)| missing_in_node(i, node));
    metadata.chain(in_nodes).collect()
}

/// The `nodes` array of a dump object, empty when absent or not an array.
fn nodes_of(dump: &Map<String, Value>) -> &[Value] {
    dump.get(NODES_FIELD).and_then(Value::as_array).map_or(&[][..], Vec::as_slice)
}

/// `Node <key>`, or `The node at index <index>` when the node has no key string.
fn node_name(index: usize, node: &Map<String, Value>) -> String {
    match node.get(NODE_KEY_FIELD).and_then(Value::as_str) {
        Some(key) => format!("Node {key}"),
        None => format!("The node at index {index}"),
    }
}

/// The names in `required` that `object` lacks, in `required` order.
fn absent<'a>(
    object: &'a Map<String, Value>,
    required: &'a [&'a str],
) -> impl Iterator<Item = &'a str> + 'a {
    required.iter().copied().filter(|field| !object.contains_key(*field))
}

/// The required fields one node and its hands lack.
fn missing_in_node(index: usize, node: &Value) -> Vec<Violation> {
    let Some(node) = node.as_object() else {
        return Vec::new();
    };
    let name = node_name(index, node);
    let own = REQUIRED_NODE_FIELDS.iter().filter(|(field, _)| !node.contains_key(*field)).map(
        |(field, shape)| Violation::new(Rule::Metadata, format!("{name} has no {field} {shape}.")),
    );
    let hands = node.get(HANDS_FIELD).and_then(Value::as_array).map_or(&[][..], Vec::as_slice);
    let in_hands = hands.iter().enumerate().flat_map(|(at, hand)| missing_in_hand(&name, at, hand));
    own.chain(in_hands).collect()
}

/// The required fields one hand lacks: its label (rule 5) and its per-action arrays (rule 1).
fn missing_in_hand(name: &str, index: usize, hand: &Value) -> Vec<Violation> {
    let Some(hand) = hand.as_object() else {
        return Vec::new();
    };
    let who = match hand.get(HAND_LABEL_FIELD).and_then(Value::as_str) {
        Some(label) => format!("{name} hand {label}"),
        None => format!("{name} hand at index {index}"),
    };
    let label = (!hand.contains_key(HAND_LABEL_FIELD))
        .then(|| Violation::new(Rule::Metadata, format!("{who} has no hand label string.")));
    let arrays = absent(hand, &PER_ACTION_HAND_FIELDS)
        .map(|field| {
            Violation::new(Rule::Counts, format!("{who} has no {field} array of numbers."))
        })
        .collect::<Vec<_>>();
    label.into_iter().chain(arrays).collect()
}

/// The nodes of an incomplete dump as rules 1 to 4 read them, with `None` for every absent
/// field, so the rules run over what is present and skip what they cannot read. A node that
/// is not an object has no facts; the typed parse would reject it, and the dump is already
/// rejected for its missing fields.
fn node_facts_of(value: &Value) -> impl Iterator<Item = NodeFacts<'_>> {
    let nodes = value.as_object().map_or(&[][..], nodes_of);
    nodes.iter().enumerate().filter_map(|(index, node)| {
        let node = node.as_object()?;
        let actions = node.get(ACTIONS_FIELD).and_then(Value::as_array);
        let tokens = actions.map_or(&[][..], Vec::as_slice);
        let hands = node.get(HANDS_FIELD).and_then(Value::as_array);
        Some(NodeFacts {
            name: node_name(index, node),
            action_count: actions.map(Vec::len),
            tokens: tokens.iter().filter_map(|action| action.get(TOKEN_FIELD)?.as_str()).collect(),
            hands: hands.map(|hands| hands.iter().map(hand_facts_of).collect()),
        })
    })
}

/// One hand as rules 1 to 3 read it; a hand that is not an object has no facts.
fn hand_facts_of(hand: &Value) -> HandFacts<'_> {
    HandFacts {
        label: hand.get(HAND_LABEL_FIELD).and_then(Value::as_str),
        frequencies: number_list(hand.get(FREQUENCIES_FIELD)).map(Cow::Owned),
        ev_bb: number_list(hand.get(EV_FIELD)).map(Cow::Owned),
    }
}

/// The numbers of a JSON array; `None` when absent, not an array, or holding a non-number.
fn number_list(value: Option<&Value>) -> Option<Vec<f64>> {
    value?.as_array()?.iter().map(Value::as_f64).collect()
}
