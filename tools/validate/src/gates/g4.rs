//! Gate G4, the own engine against the oracle (04 section 6; R2.11; O-125, O-160 to
//! O-171): a generic compare of two node dumps in the node-dump schema, the engine side
//! written by `g4_engine` and the oracle side by the private program, judged per gated
//! spot of the spot list.
//!
//! Mechanism, in order. [`load_dump`] reads a dump under library-pack's size cap, parses
//! it and runs the criterion 2 invariants; a violation is [`GateError::Dump`]. [`run_with`]
//! checks both dumps name the list's configuration and pair, then per spot finds the root
//! node by its key in both dumps and every deeper root-street node both carry (a key that
//! starts with the root key). At each node pair the `diff` child module requires the same
//! actor, pot, stacks, action tokens with sizes and hand label set, else
//! [`GateError::Mismatch`] names the spot and the node, and computes the reach-weighted
//! mean absolute frequency difference (O-160) and both sides' reach-weighted expected
//! value (EV). A gated spot is judged on four measurements through [`judge`]: the engine
//! root's `accuracy_pct_pot` and the oracle root's (the larger of that spot's two seat
//! gains, since the schema's dump-level `exploitability_pct_pot` holds one pair for every
//! spot of a dump) at most 0.3 percent of the pot, the root frequency-mad strictly under
//! 2.0 points, and the root EV error at most 0.3 percent of the pot. Everything else is
//! informational: the unweighted and the largest frequency difference, the hands
//! compared, both root EVs, every deeper node's frequency-mad, the nodes compared, the
//! dump-level exploitability pairs, and the engine run's iterations, seconds, bytes and
//! the root EV against the best-response walk when the engine side was solved in this run.
//!
//! Report: id `g4-oracle`, `r_ids` `["R2.11"]`, written through the shared envelope
//! (`Report::from_gate`); `notes` carries the mode line, the oracle target, the spot list,
//! the tree hash, the input provenance lines the command adds (paths and sha256) and the
//! per-spot stop reasons and gains.

use std::collections::BTreeMap;
use std::path::Path;

use gto_model::Cbb;
use gto_tree::tree_hash_hex;
use library_pack::{DumpNode, MAX_DUMP_BYTES, NodeDump, check_invariants, parse_dump};

use crate::fixtures::FixtureError;
use crate::fixtures::g4_spots::{G4Spots, PCT_POT, PERCENTAGE_POINTS, Rule, Spot};
use crate::report::{Measurement, Threshold};

use super::{GateError, GateReport};

mod diff;

use diff::{NodeDiff, actor_index, check_pair, node_diff};

/// The report id (O-170), also the file stem of the two report files.
pub const REPORT_ID: &str = "g4-oracle";
/// The requirement the gate closes.
pub const R_ID: &str = "R2.11";

/// The first segment of every measurement id.
const ID_PREFIX: &str = "g4";
/// The node name of the root in a measurement id; deeper nodes use their line.
const ROOT: &str = "root";
/// The node name in a `Mismatch` about the dump header.
const HEADER: &str = "header";
/// The spot segment of the dump-level rows.
const DUMP: &str = "dump";
/// Units of the informational rows.
const BB: &str = "bb";
const FREQUENCY: &str = "frequency";
const COUNT: &str = "count";
const ITERATIONS: &str = "iterations";
const SECONDS: &str = "seconds";
const BYTES: &str = "bytes";
/// Percent per whole.
const PERCENT: f64 = 100.0;
/// How the engine side was solved (O-138).
const ENGINE_MODE_LINE: &str = "engine: exact DCFR 1.5/0/2, no regret floor, 16-bit storage, \
                                exact chance, measured every 10 iterations (O-138)";

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

/// What the command adds to a compare: the engine run's facts and provenance lines.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct RunExtras {
    /// One entry per spot the engine solved in this run.
    pub facts: Vec<SpotFacts>,
    /// Lines for the notes: input paths and digests.
    pub inputs: Vec<String>,
}

/// Read a dump file: the size cap, the parse and the criterion 2 invariants.
///
/// # Errors
///
/// `GateError::Fixture` when the file cannot be read or is above the cap,
/// `GateError::Dump` with every violation when it breaks the invariants.
pub fn load_dump(path: &Path) -> Result<NodeDump, GateError> {
    let read_error = |source| FixtureError::Read { path: path.to_path_buf(), source };
    let bytes = std::fs::metadata(path).map_err(read_error)?.len();
    if bytes > MAX_DUMP_BYTES {
        let reason = format!("{bytes} bytes is above the {MAX_DUMP_BYTES} byte dump cap");
        return Err(FixtureError::Invalid { path: path.to_path_buf(), reason }.into());
    }
    let text = std::fs::read(path).map_err(read_error)?;
    let dump_error = |violations| GateError::Dump { path: path.to_path_buf(), violations };
    let dump = parse_dump(&text).map_err(dump_error)?;
    let violations = check_invariants(&dump);
    if violations.is_empty() { Ok(dump) } else { Err(dump_error(violations)) }
}

/// A measurement judged by `rule`: at most the bound, inclusive or strict as the rule
/// says; the report records the inclusive bound beside the verdict the gate made.
#[must_use]
pub fn judge(rule: &Rule, id: &str, value: f64) -> Measurement {
    let pass = if rule.inclusive { value <= rule.value } else { value < rule.value };
    let threshold = Threshold::at_most(rule.value, &rule.unit);
    Measurement::judged_as(id, value, &rule.unit, threshold, pass)
}

/// Compare `engine` against `oracle` over the spots of `spots`, with nothing from a run.
///
/// # Errors
///
/// The errors of [`run_with`].
pub fn run(spots: &G4Spots, engine: &NodeDump, oracle: &NodeDump) -> Result<GateReport, GateError> {
    run_with(spots, engine, oracle, &RunExtras::default())
}

/// Compare `engine` against `oracle` over the spots of `spots`, with the engine run's
/// facts and the provenance lines of `extras`.
///
/// # Errors
///
/// `GateError::Mismatch` when a dump names another configuration or pair, lacks a spot's
/// root, lacks a root's `accuracy_pct_pot` or a hand's reach, or differs from the other
/// dump in a node's actor, pot, stacks, actions or hand set.
pub fn run_with(
    spots: &G4Spots,
    engine: &NodeDump,
    oracle: &NodeDump,
    extras: &RunExtras,
) -> Result<GateReport, GateError> {
    check_header(spots, engine, "engine")?;
    check_header(spots, oracle, "oracle")?;
    let mut measurements = Vec::new();
    for spot in &spots.spots {
        let (rows, root) = spot_measurements(spots, spot, engine, oracle)?;
        measurements.extend(rows);
        if let Some(facts) = extras.facts.iter().find(|facts| facts.id == spot.id) {
            measurements.extend(facts_rows(spot, facts, &root));
        }
    }
    measurements.extend(dump_rows(engine, "engine"));
    measurements.extend(dump_rows(oracle, "oracle"));
    Ok(assemble(spots, measurements, extras))
}

/// The dump names the list's configuration and pair.
fn check_header(spots: &G4Spots, dump: &NodeDump, side: &str) -> Result<(), GateError> {
    let mismatch = |reason: String| GateError::Mismatch {
        spot: spots.id.clone(),
        node: HEADER.to_owned(),
        reason: format!("the {side} dump {reason}"),
    };
    if dump.position_pair != spots.position_pair {
        let reason = format!(
            "names the pair {}, not the list's {}",
            dump.position_pair, spots.position_pair
        );
        return Err(mismatch(reason));
    }
    match dump.config_id.as_deref() {
        Some(id) if id != spots.config_id => {
            Err(mismatch(format!("names config {id}, not the list's {}", spots.config_id)))
        }
        _ => Ok(()),
    }
}

/// The rows of one spot (the judged four when gated, the root's informational rows, one
/// frequency-mad row per deeper node both dumps carry, the nodes compared) and the root
/// diff for the engine run's rows.
fn spot_measurements(
    spots: &G4Spots,
    spot: &Spot,
    engine: &NodeDump,
    oracle: &NodeDump,
) -> Result<(Vec<Measurement>, NodeDiff), GateError> {
    let root_key = spot.node_key.as_str();
    let engine_root = root_of(engine, spot, "engine")?;
    let oracle_root = root_of(oracle, spot, "oracle")?;
    check_pair(spot, engine_root, oracle_root)?;
    let root = node_diff(spot, engine_root, oracle_root, actor_index(spots, spot, engine_root)?)?;
    let mut rows = root_rows(spots, spot, &root, engine_root, oracle_root)?;
    let mut compared = 1.0;
    let deeper = engine.nodes.iter().filter(|node| is_deeper(&node.node_key, root_key));
    for engine_node in deeper {
        let Some(oracle_node) = oracle.nodes.iter().find(|n| n.node_key == engine_node.node_key)
        else {
            continue;
        };
        check_pair(spot, engine_node, oracle_node)?;
        let actor = actor_index(spots, spot, engine_node)?;
        let diff = node_diff(spot, engine_node, oracle_node, actor)?;
        let line = &engine_node.node_key[root_key.len()..];
        rows.push(informational(spot, line, "frequency-mad", diff.mad_points, PERCENTAGE_POINTS));
        compared += 1.0;
    }
    rows.push(informational(spot, "nodes", "compared", compared, COUNT));
    Ok((rows, root))
}

/// The four rule rows of a spot, judged when gated and informational for a raked twin,
/// then the root's informational rows.
fn root_rows(
    spots: &G4Spots,
    spot: &Spot,
    root: &NodeDiff,
    engine_root: &DumpNode,
    oracle_root: &DumpNode,
) -> Result<Vec<Measurement>, GateError> {
    let rules = &spots.rules;
    let pot_bb = f64::from(engine_root.pot_cbb) / f64::from(Cbb::PER_BB);
    let ev_error = PERCENT * (root.ev_engine_bb - root.ev_oracle_bb).abs() / pot_bb;
    let engine_accuracy = accuracy_of(spot, engine_root, "engine")?;
    let oracle_accuracy = accuracy_of(spot, oracle_root, "oracle")?;
    let quartet = [
        (id(spot, "engine", "exploitability"), engine_accuracy, &rules.exploitability_max),
        (id(spot, "oracle", "exploitability"), oracle_accuracy, &rules.exploitability_max),
        (id(spot, ROOT, "frequency-mad"), root.mad_points, &rules.frequency_mad_max),
        (id(spot, ROOT, "ev-abs-error"), ev_error, &rules.root_ev_max),
    ];
    let mut rows: Vec<Measurement> = quartet
        .into_iter()
        .map(|(row_id, value, rule)| {
            if spot.gated {
                judge(rule, &row_id, value)
            } else {
                Measurement::informational(&row_id, value, &rule.unit)
            }
        })
        .collect();
    let unweighted = root.mad_unweighted_points;
    rows.extend([
        informational(spot, ROOT, "frequency-mad-unweighted", unweighted, PERCENTAGE_POINTS),
        informational(spot, ROOT, "frequency-max-abs-diff", root.max_abs_diff, FREQUENCY),
        informational(spot, ROOT, "hands-compared", root.hands, COUNT),
        informational(spot, ROOT, "ev-engine-bb", root.ev_engine_bb, BB),
        informational(spot, ROOT, "ev-oracle-bb", root.ev_oracle_bb, BB),
    ]);
    Ok(rows)
}

/// The engine run's rows for one spot, with the dump's root EV against the best-response
/// walk's figure: a consistency check of the reach and EV conventions.
fn facts_rows(spot: &Spot, facts: &SpotFacts, root: &NodeDiff) -> Vec<Measurement> {
    let against = root.ev_engine_bb - facts.best_response_root_ev_bb;
    vec![
        informational(spot, "engine", "iterations", f64::from(facts.iterations), ITERATIONS),
        informational(spot, "engine", "seconds", f64::from(facts.seconds), SECONDS),
        informational(spot, "engine", "estimate-bytes", bytes_as_f64(facts.estimate_bytes), BYTES),
        informational(spot, "engine", "peak-bytes", bytes_as_f64(facts.peak_bytes), BYTES),
        informational(spot, ROOT, "ev-engine-vs-best-response-bb", against, BB),
    ]
}

/// The dump-level exploitability pair as informational rows, when the dump carries it.
fn dump_rows(dump: &NodeDump, side: &str) -> Vec<Measurement> {
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

/// The report: thresholds and verdict from the judged rows, the notes from the list, the
/// extras and the spot facts.
fn assemble(spots: &G4Spots, measurements: Vec<Measurement>, extras: &RunExtras) -> GateReport {
    let thresholds: BTreeMap<String, Threshold> = measurements
        .iter()
        .filter_map(|m| m.threshold.clone().map(|threshold| (m.id.clone(), threshold)))
        .collect();
    let pass = measurements.iter().filter(|m| m.threshold.is_some()).all(|m| m.pass == Some(true));
    GateReport {
        report: REPORT_ID.to_owned(),
        r_ids: vec![R_ID.to_owned()],
        pass,
        thresholds,
        measurements,
        notes: notes(spots, extras),
    }
}

/// The notes: the mode, the oracle target, the list, the tree hash, the inputs and the
/// per-spot facts, one sentence each.
fn notes(spots: &G4Spots, extras: &RunExtras) -> String {
    let gated = spots.spots.iter().filter(|spot| spot.gated).count();
    let tree = spots.tree.tree_config().map_or_else(|err| err.to_string(), |t| tree_hash_hex(&t));
    let mut lines = vec![format!(
        "G4 oracle compare (R2.11). {ENGINE_MODE_LINE}; oracle solved to a mean gain of {} \
         percent of the pot (O-162). Spot list {}: {} spots, {gated} gated; tree hash {tree}.",
        spots.stop.oracle_target_pct_pot,
        spots.id,
        spots.spots.len()
    )];
    lines.extend(extras.inputs.iter().cloned());
    lines.extend(extras.facts.iter().map(|facts| {
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
    }));
    lines.join(" ")
}

/// A measurement id: `g4/<spot>/<node>/<name>`.
fn id(spot: &Spot, node: &str, name: &str) -> String {
    format!("{ID_PREFIX}/{}/{node}/{name}", spot.id)
}

/// An informational row of a spot.
fn informational(spot: &Spot, node: &str, name: &str, value: f64, unit: &str) -> Measurement {
    Measurement::informational(&id(spot, node, name), value, unit)
}

/// The spot's root node in `dump`.
fn root_of<'a>(dump: &'a NodeDump, spot: &Spot, side: &str) -> Result<&'a DumpNode, GateError> {
    dump.nodes.iter().find(|node| node.node_key == spot.node_key).ok_or_else(|| {
        GateError::Mismatch {
            spot: spot.id.clone(),
            node: spot.node_key.clone(),
            reason: format!("the {side} dump carries no node with the spot's root key"),
        }
    })
}

/// The root's `accuracy_pct_pot`, the spot's exploitability figure for that side.
fn accuracy_of(spot: &Spot, root: &DumpNode, side: &str) -> Result<f64, GateError> {
    root.accuracy_pct_pot.ok_or_else(|| GateError::Mismatch {
        spot: spot.id.clone(),
        node: spot.node_key.clone(),
        reason: format!("the {side} dump's root carries no accuracy_pct_pot"),
    })
}

/// A key below the root on the root street: the root key followed by actions.
fn is_deeper(key: &str, root_key: &str) -> bool {
    key.len() > root_key.len() && key.starts_with(root_key)
}

/// A byte count as a report value.
#[allow(clippy::cast_precision_loss, reason = "byte counts stay far below 2^53")]
fn bytes_as_f64(bytes: u64) -> f64 {
    bytes as f64
}
