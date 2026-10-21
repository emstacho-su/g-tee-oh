//! Library to dump (R2.8, O-133): the read-back side of the round trip.
//!
//! O-133 defines "reads back identically" for an 8-bit format: node keys, actions, sizes,
//! hands, `to_act`, pot and stacks are equal; frequencies are within 1/255, losses within
//! half a unit (0.005% of the pot), reach within 1/131070 and the best action's expected
//! value (EV) exactly equal as an f32. `compare_dumps` checks exactly that.
//!
//! Lane P (pack) owns this file.

#![allow(unused_variables, reason = "S14 red skeleton: lane P replaces the todo!() bodies")]

use gto_library::{SolutionMeta, SolvedNode};

use crate::dump::NodeDump;

/// A dump of `nodes` under `meta`: the inverse of `to_solution`.
#[must_use]
pub fn export_dump(meta: &SolutionMeta, nodes: &[SolvedNode]) -> NodeDump {
    todo!("lane P: SolutionMeta and SolvedNode to a dump")
}

/// Every difference between a dump and its read-back beyond the O-133 tolerances, one
/// sentence each; empty when they agree.
#[must_use]
pub fn compare_dumps(original: &NodeDump, read_back: &NodeDump) -> Vec<String> {
    todo!("lane P: O-133 comparison")
}
