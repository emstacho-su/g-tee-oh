//! Criterion 2 invariants in Rust (R2.8): `check_invariants` mirrors
//! `checkNodeDumpInvariants` in `packages/contracts/src/node-dump.ts` rule for rule, and
//! `check_structure` adds the checks only Rust can make with `gto-model`. Both return every
//! violation as one plain sentence naming the node key and the hand; both read their input
//! and never change it.
//!
//! Rules 1 to 5 (from node-dump.ts): one frequency and one expected value (EV) per action;
//! each hand's frequencies sum to 1 within `FREQUENCY_SUM_TOLERANCE`; hand labels in
//! `gto-model`'s canonical spelling (`Display == input`, since `ComboId::from_str` is lenient
//! about card order); no token or hand twice in a node; complete metadata.
//!
//! Structural (Rust only): every key parses, its config id and pair match the dump's, its
//! street and board match the node's, `to_act` is in the pair, two stacks, a pot above zero,
//! at most 255 actions, a sized token equal to its `size_cbb`, reach within `[0, 1]`, and a
//! `preflop_169` hand space (O-132).
//!
//! Lane P (pack) owns this file.

#![allow(unused_variables, reason = "S14 red skeleton: lane P replaces the todo!() bodies")]

use std::fmt;

use crate::dump::NodeDump;

/// How far from 1 one hand's frequencies may sum (criterion 2, node-dump.ts).
pub const FREQUENCY_SUM_TOLERANCE: f64 = 0.001;

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

impl fmt::Display for Violation {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

/// Rules 1 to 4 over a parsed dump (rule 5 runs in `parse_dump`, plus the hand space check
/// here); empty when the dump holds.
#[must_use]
pub fn check_invariants(d: &NodeDump) -> Vec<Violation> {
    todo!("lane P: rules 1 to 5 of node-dump.ts")
}

/// The structural checks of the module docs; empty when the dump holds.
#[must_use]
pub fn check_structure(d: &NodeDump) -> Vec<Violation> {
    todo!("lane P: gto-model structural checks")
}
