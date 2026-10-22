//! What the `g4` command adds to a compare beyond the two dumps (R2.11): the report id,
//! the engine run's facts per solved spot and the provenance lines, with the rows and the
//! notes they turn into. Child module of `g4`.
//!
//! Mechanism. [`RunExtras`] is empty by default (the report id `g4-oracle`, no engine
//! mode, no facts, no inputs), which is what a compare of two committed dumps uses; the
//! command fills the engine mode line and the facts from each engine solve and the inputs
//! from the dump paths and digests. [`facts_rows`] turns one spot's facts into
//! informational rows (iterations, seconds, bytes, and the dump's root EV against the
//! best-response walk, a consistency check of the reach and EV conventions);
//! [`dump_rows`] reads the dump-level exploitability pair; [`notes`] writes the engine
//! mode line when there is one, the oracle target, the list, the tree hash, the inputs,
//! the per-spot stop reasons and gains and the skipped nodes as one paragraph.

use gto_tree::tree_hash_hex;
use library_pack::NodeDump;

use crate::fixtures::g4_spots::{G4Spots, PCT_POT, Spot};
use crate::report::Measurement;

use super::{BB, ID_PREFIX, REPORT_ID, ROOT, informational};

/// The spot segment of the dump-level rows.
const DUMP: &str = "dump";
/// Units of the engine run's rows.
const ITERATIONS: &str = "iterations";
const SECONDS: &str = "seconds";
const BYTES: &str = "bytes";

/// What the engine run knows about one spot beyond its dump, for the informational rows.
#[derive(Debug, Clone, PartialEq)]
pub struct SpotFacts {
    /// The spot id.
    pub id: String,
    /// Iterations run.
    pub iterations: u32,
    /// Wall-clock seconds of the solve.
    pub seconds: f32,
    /// The memory estimate checked against the cap.
    pub estimate_bytes: u64,
    /// The accounted peak.
    pub peak_bytes: u64,
    /// Why the solve stopped.
    pub stop_reason: String,
    /// Each seat's gain as a percent of the pot, `[oop, ip]`.
    pub gains_pct_pot: [f64; 2],
    /// The best-response walk's expected value of the actor plus half the pot, in bb.
    pub best_response_root_ev_bb: f64,
}

/// What the command adds to a compare: the report id, how the engine side was solved,
/// the engine run's facts and the provenance lines.
#[derive(Debug, Clone, PartialEq)]
pub struct RunExtras {
    /// The report id, also the file stem: [`REPORT_ID`] for the gated list.
    pub report_id: String,
    /// The engine mode line, derived from the options and report of the solve, when the
    /// engine side was solved in this run; none when a committed engine dump was read.
    pub engine_mode: Option<String>,
    /// One entry per spot the engine solved in this run.
    pub facts: Vec<SpotFacts>,
    /// Lines for the notes: input paths and digests.
    pub inputs: Vec<String>,
}

impl Default for RunExtras {
    /// The gated list's report id with nothing from a run.
    fn default() -> Self {
        RunExtras {
            report_id: REPORT_ID.to_owned(),
            engine_mode: None,
            facts: Vec::new(),
            inputs: Vec::new(),
        }
    }
}

/// The engine run's rows for one spot, with the dump's root EV against the best-response
/// walk's figure: a consistency check of the reach and EV conventions.
pub(super) fn facts_rows(
    spot: &Spot,
    facts: &SpotFacts,
    root: &super::NodeDiff,
) -> Vec<Measurement> {
    let against = root.ev_engine_bb - facts.best_response_root_ev_bb;
    let engine = super::ENGINE;
    vec![
        informational(spot, engine, "iterations", f64::from(facts.iterations), ITERATIONS),
        informational(spot, engine, "seconds", f64::from(facts.seconds), SECONDS),
        informational(spot, engine, "estimate-bytes", bytes_as_f64(facts.estimate_bytes), BYTES),
        informational(spot, engine, "peak-bytes", bytes_as_f64(facts.peak_bytes), BYTES),
        informational(spot, ROOT, "ev-engine-vs-best-response-bb", against, BB),
    ]
}

/// The dump-level exploitability pair as informational rows, when the dump carries it.
pub(super) fn dump_rows(dump: &NodeDump, side: &str) -> Vec<Measurement> {
    let Some(pair) = dump.exploitability_pct_pot.as_deref() else {
        return Vec::new();
    };
    ["oop", "ip"]
        .iter()
        .zip(pair)
        .map(|(seat, value)| {
            let row_id = format!("{ID_PREFIX}/{DUMP}/{side}/exploitability/{seat}");
            Measurement::informational(&row_id, *value, PCT_POT)
        })
        .collect()
}

/// The notes: the engine mode when the engine side was solved in this run, the oracle
/// target, the list, the tree hash, the inputs, the per-spot facts and the skipped nodes,
/// one sentence each.
pub(super) fn notes(spots: &G4Spots, extras: &RunExtras, skipped: &[String]) -> String {
    let gated = spots.spots.iter().filter(|spot| spot.gated).count();
    let tree = spots.tree.tree_config().map_or_else(|err| err.to_string(), |t| tree_hash_hex(&t));
    let mode = extras.engine_mode.as_deref().map_or_else(String::new, |mode| format!("{mode}; "));
    let head = format!(
        "G4 oracle compare (R2.11). {mode}oracle solved to a mean gain of {} percent of the \
         pot (O-162). Spot list {}: {} spots, {gated} gated; tree hash {tree}.",
        spots.stop.oracle_target_pct_pot,
        spots.id,
        spots.spots.len()
    );
    let facts = extras.facts.iter().map(|facts| {
        format!(
            "Spot {}: stopped on {} after {} iterations in {:.1} s; gains oop {} ip {} percent \
             of the pot.",
            facts.id,
            facts.stop_reason,
            facts.iterations,
            facts.seconds,
            facts.gains_pct_pot[0],
            facts.gains_pct_pot[1]
        )
    });
    let lines: Vec<String> = std::iter::once(head)
        .chain(extras.inputs.iter().cloned())
        .chain(facts)
        .chain(skipped.iter().cloned())
        .collect();
    lines.join(" ")
}

/// A byte count as a report value.
#[allow(clippy::cast_precision_loss, reason = "byte counts stay far below 2^53")]
fn bytes_as_f64(bytes: u64) -> f64 {
    bytes as f64
}
