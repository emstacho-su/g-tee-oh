//! Gate G4, the own engine against the oracle (04 section 6; R2.11; O-125, O-160 to
//! O-171): a generic compare of two node dumps in the node-dump schema, the engine side
//! written by `g4_engine` and the oracle side by the private program, judged per gated
//! spot of the spot list.
//!
//! Mechanism, in order. [`load_dump`] reads a dump once under library-pack's size cap,
//! digests and parses it; [`check_dump`] then runs the criterion 2 invariants and
//! library-pack's node checks on it, as it does on the engine dump the command solves in
//! memory, and a violation is [`GateError::Dump`] naming the dump and the node (the
//! `dumps` child module). [`run_with`] checks both dumps name the list's
//! configuration and pair, then per spot finds the root node by its key in both dumps and
//! every deeper root-street node both carry: a key that adds actions to the root key with
//! no further street section, so a turn spot never absorbs the nodes of the river spot
//! that extends it. At each node pair the `diff` child module requires the same actor,
//! pot, stacks, action tokens with sizes and hand label set, else [`GateError::Mismatch`]
//! names the spot and the node, and computes the reach-weighted mean absolute frequency
//! difference (O-160) and both sides' reach-weighted expected value (EV). A root nobody
//! reaches is a mismatch too (the root is always reached); a deeper node whose actor has
//! zero reach on either side is a node the engine's 16-bit walk writes for a never-taken
//! action, so its rows are skipped and a note names it. A gated spot is judged on four
//! measurements through [`judge`]: the engine root's `accuracy_pct_pot` and the oracle
//! root's (the larger of that spot's two seat gains, since the schema's dump-level
//! `exploitability_pct_pot` holds one pair for every spot of a dump) at most 0.3 percent
//! of the pot, the root frequency-mad strictly under 2.0 points, and the root EV error at
//! most 0.3 percent of the pot. Everything else is informational: the unweighted and the
//! largest frequency difference, the hands compared, both root EVs, every deeper node's
//! frequency-mad, the nodes compared, the dump-level exploitability pairs, and the engine
//! run's iterations, seconds, bytes and the root EV against the best-response walk when
//! the engine side was solved in this run (the `extras` child module).
//!
//! Report: id `g4-oracle` for the gated list, or the id the command passes for another
//! list (`g4-oracle-raked` for the raked twins, O-161), `r_ids` `["R2.11"]`, written
//! through the shared envelope (`Report::from_gate`); `notes` carries the mode line, the
//! oracle target, the spot list, the tree hash, the input provenance lines the command
//! adds (paths and sha256), the per-spot stop reasons and gains, and the skipped nodes.

use std::collections::BTreeMap;

use gto_model::Cbb;
use gto_model::keys::SECTION_SEPARATOR;
use library_pack::{DumpNode, NodeDump};

use crate::fixtures::g4_spots::{G4Spots, PERCENTAGE_POINTS, Rule, Spot};
use crate::report::{Measurement, Threshold};

use super::{GateError, GateReport};

mod diff;
mod dumps;
mod extras;

use diff::{NodeCompare, NodeDiff, actor_index, check_pair, node_diff};
pub use dumps::{LoadedDump, check_dump, load_dump, sha256_hex};
pub use extras::{RunExtras, SpotFacts};
use extras::{dump_rows, facts_rows, notes};

/// The report id of the gated list (O-170), also the file stem of the two report files.
pub const REPORT_ID: &str = "g4-oracle";
/// The requirement the gate closes.
pub const R_ID: &str = "R2.11";

/// The two sides of a compare, as the rows, the errors and the notes name them.
pub(super) const ENGINE: &str = "engine";
pub(super) const ORACLE: &str = "oracle";

/// The first segment of every measurement id.
const ID_PREFIX: &str = "g4";
/// The node name of the root in a measurement id; deeper nodes use their line.
const ROOT: &str = "root";
/// The node name in a `Mismatch` about the dump header.
const HEADER: &str = "header";
/// Units of the informational rows.
const BB: &str = "bb";
const FREQUENCY: &str = "frequency";
const COUNT: &str = "count";
/// Percent per whole.
const PERCENT: f64 = 100.0;

/// The rows of one spot, the root figures the engine run's rows need, and the notes.
struct SpotRows {
    rows: Vec<Measurement>,
    root: NodeDiff,
    notes: Vec<String>,
}

/// A measurement judged by `rule`: at most the bound when the rule is inclusive, under it
/// when strict, through a threshold that reads the bound the same way the verdict does.
#[must_use]
pub fn judge(rule: &Rule, id: &str, value: f64) -> Measurement {
    let threshold = if rule.inclusive {
        Threshold::at_most(rule.value, &rule.unit)
    } else {
        Threshold::under(rule.value, &rule.unit)
    };
    Measurement::judged(id, value, &rule.unit, threshold)
}

/// Compare `engine` against `oracle` over the spots of `spots`, with nothing from a run.
///
/// # Errors
///
/// The errors of [`run_with`].
pub fn run(spots: &G4Spots, engine: &NodeDump, oracle: &NodeDump) -> Result<GateReport, GateError> {
    run_with(spots, engine, oracle, &RunExtras::default())
}

/// Compare `engine` against `oracle` over the spots of `spots`, with the report id, the
/// engine run's facts and the provenance lines of `extras`.
///
/// # Errors
///
/// `GateError::Mismatch` when a dump names another configuration or pair, lacks a spot's
/// root, lacks a root's `accuracy_pct_pot` or a hand's reach, reaches no hand at a root,
/// or differs from the other dump in a node's actor, pot, stacks, actions or hand set.
pub fn run_with(
    spots: &G4Spots,
    engine: &NodeDump,
    oracle: &NodeDump,
    extras: &RunExtras,
) -> Result<GateReport, GateError> {
    check_header(spots, engine, ENGINE)?;
    check_header(spots, oracle, ORACLE)?;
    let mut measurements = Vec::new();
    let mut skipped = Vec::new();
    for spot in &spots.spots {
        let SpotRows { rows, root, notes } = spot_measurements(spots, spot, engine, oracle)?;
        measurements.extend(rows);
        skipped.extend(notes);
        if let Some(facts) = extras.facts.iter().find(|facts| facts.id == spot.id) {
            measurements.extend(facts_rows(spot, facts, &root));
        }
    }
    measurements.extend(dump_rows(engine, ENGINE));
    measurements.extend(dump_rows(oracle, ORACLE));
    Ok(assemble(spots, measurements, extras, &skipped))
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
/// frequency-mad row per deeper node both dumps carry and reach, the nodes compared),
/// the root diff for the engine run's rows, and a note per skipped node.
fn spot_measurements(
    spots: &G4Spots,
    spot: &Spot,
    engine: &NodeDump,
    oracle: &NodeDump,
) -> Result<SpotRows, GateError> {
    let engine_root = root_of(engine, spot, ENGINE)?;
    let oracle_root = root_of(oracle, spot, ORACLE)?;
    check_pair(spot, engine_root, oracle_root)?;
    let actor = actor_index(spots, spot, engine_root)?;
    let root = match node_diff(spot, engine_root, oracle_root, actor)? {
        NodeCompare::Figures(diff) => diff,
        NodeCompare::Unreached { side } => {
            return Err(GateError::Mismatch {
                spot: spot.id.clone(),
                node: spot.node_key.clone(),
                reason: format!("the {side} dump's actor reach sums to zero at the root"),
            });
        }
    };
    let (deeper, notes) = deeper_rows(spots, spot, engine, oracle)?;
    let compared = 1.0 + count_as_f64(deeper.len());
    let rows = [
        root_rows(spots, spot, &root, engine_root, oracle_root)?,
        deeper,
        vec![informational(spot, "nodes", "compared", compared, COUNT)],
    ]
    .concat();
    Ok(SpotRows { rows, root, notes })
}

/// One frequency-mad row per deeper root-street node both dumps carry and reach, and a
/// note for each deeper node one side does not reach.
fn deeper_rows(
    spots: &G4Spots,
    spot: &Spot,
    engine: &NodeDump,
    oracle: &NodeDump,
) -> Result<(Vec<Measurement>, Vec<String>), GateError> {
    let root_key = spot.node_key.as_str();
    let mut rows = Vec::new();
    let mut notes = Vec::new();
    let deeper = engine.nodes.iter().filter(|node| is_deeper(&node.node_key, root_key));
    for engine_node in deeper {
        let Some(oracle_node) = oracle.nodes.iter().find(|n| n.node_key == engine_node.node_key)
        else {
            continue;
        };
        check_pair(spot, engine_node, oracle_node)?;
        let actor = actor_index(spots, spot, engine_node)?;
        let line = &engine_node.node_key[root_key.len()..];
        match node_diff(spot, engine_node, oracle_node, actor)? {
            NodeCompare::Figures(diff) => {
                let mad = diff.mad_points;
                rows.push(informational(spot, line, "frequency-mad", mad, PERCENTAGE_POINTS));
            }
            NodeCompare::Unreached { side } => notes.push(format!(
                "Spot {}: node {} is unreached on the {side} side (the actor's reach sums \
                 to zero), so its rows are skipped.",
                spot.id, engine_node.node_key
            )),
        }
    }
    Ok((rows, notes))
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
    let engine_accuracy = accuracy_of(spot, engine_root, ENGINE)?;
    let oracle_accuracy = accuracy_of(spot, oracle_root, ORACLE)?;
    let quartet = [
        (id(spot, ENGINE, "exploitability"), engine_accuracy, &rules.exploitability_max),
        (id(spot, ORACLE, "exploitability"), oracle_accuracy, &rules.exploitability_max),
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

/// The report: the id and verdict from the extras and the judged rows, the notes from the
/// list, the extras, the spot facts and the skipped nodes.
fn assemble(
    spots: &G4Spots,
    measurements: Vec<Measurement>,
    extras: &RunExtras,
    skipped: &[String],
) -> GateReport {
    let thresholds: BTreeMap<String, Threshold> = measurements
        .iter()
        .filter_map(|m| m.threshold.clone().map(|threshold| (m.id.clone(), threshold)))
        .collect();
    let pass = measurements.iter().filter(|m| m.threshold.is_some()).all(|m| m.pass == Some(true));
    GateReport {
        report: extras.report_id.clone(),
        r_ids: vec![R_ID.to_owned()],
        pass,
        thresholds,
        measurements,
        notes: notes(spots, extras, skipped),
    }
}

/// A measurement id: `g4/<spot>/<node>/<name>`.
pub(super) fn id(spot: &Spot, node: &str, name: &str) -> String {
    format!("{ID_PREFIX}/{}/{node}/{name}", spot.id)
}

/// An informational row of a spot.
pub(super) fn informational(
    spot: &Spot,
    node: &str,
    name: &str,
    value: f64,
    unit: &str,
) -> Measurement {
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

/// A key below the root on the root street: the root key followed by actions and by no
/// further street section. The river root that extends a turn root carries a section
/// separator after it, so it is the river spot's root, not a deeper node of the turn spot.
fn is_deeper(key: &str, root_key: &str) -> bool {
    key.strip_prefix(root_key)
        .is_some_and(|rest| !rest.is_empty() && !rest.contains(SECTION_SEPARATOR))
}

/// A node count as a report value.
#[allow(clippy::cast_precision_loss, reason = "a spot's root street holds a few dozen nodes")]
fn count_as_f64(count: usize) -> f64 {
    count as f64
}
