//! The node dump as serde reads it (R2.8): a mirror of
//! `packages/contracts/schemas/node-dump.schema.json` with unknown fields denied.
//!
//! Fields a rule checks (keys, positions, tokens, labels, enumerations) stay text here, so a
//! bad value becomes a violation sentence from `invariants` rather than a serde error.
//! `parse_dump` reads the bytes as a JSON (JavaScript Object Notation) value first and
//! reports every missing required field as a rule 5 sentence, the way
//! `checkNodeDumpInvariants` does, before the typed parse; it never panics.
//!
//! Lane P (pack) owns this file and may reshape these types, which only lane P uses.

#![allow(unused_variables, reason = "S14 red skeleton: lane P replaces the todo!() body")]

use serde::{Deserialize, Serialize};

use crate::invariants::Violation;

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

/// Parses dump bytes, reporting a malformed shape as violation sentences (rule 5 for a
/// missing required field, `Rule::Structural` for anything else serde rejects).
///
/// # Errors
///
/// Every violation found, never empty.
pub fn parse_dump(bytes: &[u8]) -> Result<NodeDump, Vec<Violation>> {
    todo!("lane P: value-level rule 5 checks, then the typed parse")
}
