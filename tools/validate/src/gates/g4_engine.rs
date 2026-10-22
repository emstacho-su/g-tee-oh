//! The engine side of gate G4 (R2.11; O-135, O-138, O-161, O-163, O-164, O-168): one spot
//! of the list to a `PostflopProblem`, its solve under the list's stop rule, and the
//! engine-side node dump in the node-dump schema that `g4` compares against the oracle's.
//!
//! Mechanism. [`problem_for`] builds the game configuration from the catalog row the
//! list's `config_id` names, with the stake's rake zeroed for a rake-free spot (O-161),
//! the tree from the list's `tree` block, the board and the preflop line from the spot's
//! root key (the line is descriptive, O-164), both ranges through `Range::parse`, and the
//! spot's pot and equal stacks. [`solve_spot`] takes the memory estimate first, runs
//! `solve_postflop_with_estimate` with the default options (16-bit storage, the 5 GiB cap,
//! a measurement every 10 iterations, O-138), measures the exact best response and walks
//! `root_street_nodes`. [`engine_dump`] turns the walked nodes of every solved spot into
//! one dump: `source` `own` (O-163), the catalog configuration as the config block, the
//! root key of each spot with the node's line appended to its last street section as the
//! node key, `to_act` the actor's seat in the pair, hands labelled by `ComboId`'s canonical
//! spelling, `reach` and `ev_bb` as the walk defines them, `size_cbb` the street total
//! (zero for fold and check, the opponent's street total for a call, the label's total for
//! a bet or raise, the root stack for an all-in), `accuracy_pct_pot` on every node of a
//! spot as the larger of its two seat gains, and the dump-level `exploitability_pct_pot`
//! as the per-seat maximum over the spots. [`write_dump`] writes it pretty-printed with a
//! trailing newline; [`sha256_hex_of`] digests a file for the report notes (O-169).

use std::fmt::Write as _;
use std::path::Path;

use gto_model::{Cbb, GameConfig, NodeKey, RakeModel, Stake, Street, format_cards};
use gto_solve::postflop::{
    BestResponseReport, NodeStrategy, PostflopProblem, ProgressSink, Range, SolveOptions,
    SolveReport, StopReason, best_response, estimate_memory, root_street_nodes,
    solve_postflop_with_estimate,
};
use gto_tree::{LineKind, PreflopLine};
use library_pack::{DumpAction, DumpConfig, DumpHand, DumpNode, NodeDump};
use sha2::{Digest, Sha256};

use crate::fixtures::g4_spots::{G4Spots, RAKE_NONE, Spot};
use crate::report::ReportError;

use super::GateError;
use super::g4::SpotFacts;

/// The dump's `source` for the engine side (O-163) and its hand space.
pub const SOURCE_OWN: &str = "own";
pub const HAND_SPACE: &str = "postflop_1326";

/// The seed the solve records; exact DCFR never reads it, so every run is bit for bit
/// the same (R2.10).
const SEED: u64 = 0;
/// Half the pot, the credit of the pot-inclusive EV.
const HALF: f64 = 0.5;
/// The rake of a rake-free spot: no percent and no cap (O-161).
const NO_RAKE: RakeModel = RakeModel { percent_bp: 0, cap_cents: 0, no_flop_no_drop: false };

/// One solved spot: its dump nodes, the solve report, the best response and the facts
/// the compare reports.
#[derive(Debug, Clone, PartialEq)]
pub struct SpotSolve {
    /// The spot id.
    pub id: String,
    /// The root-street nodes in dump form.
    pub nodes: Vec<DumpNode>,
    /// What the solve did.
    pub report: SolveReport,
    /// The exact best response of the final profile.
    pub best_response: BestResponseReport,
    /// The facts for the report's informational rows.
    pub facts: SpotFacts,
}

/// A sink that prints every measured iteration of one spot to standard error.
#[derive(Debug, Clone)]
pub struct SpotProgress {
    /// The spot id printed on every line.
    pub spot: String,
}

impl ProgressSink for SpotProgress {
    fn report(&self, iteration: u32, exploitability_pct_pot: Option<[f32; 2]>) {
        if let Some([oop, ip]) = exploitability_pct_pot {
            eprintln!(
                "validate: g4 {}: iteration {iteration}, gains oop {oop} ip {ip} percent of the pot",
                self.spot
            );
        }
    }
}

/// The problem the spot describes.
///
/// # Errors
///
/// `GateError::Solve` when the configuration is not in the catalog, the key or a range
/// does not parse, the tree does not build or the problem fails its validation.
pub fn problem_for(spots: &G4Spots, spot: &Spot) -> Result<PostflopProblem, GateError> {
    let solve_error = |message: String| GateError::Solve { spot: spot.id.clone(), message };
    let config = game_config(spots, spot).map_err(solve_error)?;
    let key = spot.key().map_err(|err| solve_error(err.to_string()))?;
    let board = key.board().ok_or_else(|| solve_error("the key has no board".to_owned()))?;
    let aggressor = spot.preflop.aggressor.parse().map_err(|err| solve_error(format!("{err}")))?;
    let line = PreflopLine {
        pair: key.pair,
        actions: key.preflop.clone(),
        kind: line_kind(&spot.preflop.kind).map_err(solve_error)?,
        flop_pot: Cbb(spot.pot_cbb),
        flop_stack: Cbb(spot.stack_cbb),
        aggressor: Some(aggressor),
    };
    let ranges = [
        Range::parse(&spot.ranges.oop_notation()).map_err(|err| solve_error(err.to_string()))?,
        Range::parse(&spot.ranges.ip_notation()).map_err(|err| solve_error(err.to_string()))?,
    ];
    let tree = spots.tree.tree_config().map_err(|err| solve_error(err.to_string()))?;
    let problem = PostflopProblem {
        config,
        line,
        board,
        ranges,
        pot: Cbb(spot.pot_cbb),
        stacks: [Cbb(spot.stack_cbb); 2],
        tree,
    };
    problem.validate().map_err(|err| solve_error(err.to_string()))?;
    Ok(problem)
}

/// The catalog configuration, with the stake's rake zeroed for a rake-free spot.
fn game_config(spots: &G4Spots, spot: &Spot) -> Result<GameConfig, String> {
    let base = spots
        .game_config()
        .ok_or_else(|| format!("config_id {} names no v1 configuration", spots.config_id))?;
    if spot.rake != RAKE_NONE {
        return Ok(base);
    }
    let stake =
        Stake::new(base.stake.label.clone(), base.stake.sb_cents, base.stake.bb_cents, NO_RAKE)
            .map_err(|err| err.to_string())?;
    Ok(GameConfig { stake, ..base })
}

/// The `LineKind` a spot's preflop block names.
fn line_kind(name: &str) -> Result<LineKind, String> {
    [LineKind::Limped, LineKind::SingleRaised, LineKind::ThreeBet, LineKind::FourBet]
        .into_iter()
        .find(|kind| kind.as_str() == name)
        .ok_or_else(|| format!("preflop.kind {name:?} is not a line kind"))
}

/// Solve one spot under the list's stop rule and walk its root-street nodes.
///
/// # Errors
///
/// The errors of [`problem_for`], and `GateError::Solve` for the adapter's errors.
pub fn solve_spot(
    spots: &G4Spots,
    spot: &Spot,
    sink: &dyn ProgressSink,
) -> Result<SpotSolve, GateError> {
    let solve_error = |message: String| GateError::Solve { spot: spot.id.clone(), message };
    let problem = problem_for(spots, spot)?;
    let options = SolveOptions::default();
    let estimate =
        estimate_memory(&problem, options.storage).map_err(|err| solve_error(err.to_string()))?;
    let stop = spots.stop.engine_stop_rule();
    let (solved, report) =
        solve_postflop_with_estimate(&problem, &estimate, stop, SEED, sink, &options)
            .map_err(|err| solve_error(err.to_string()))?;
    let response = best_response(&solved);
    let walked = root_street_nodes(&solved).map_err(|err| solve_error(err.to_string()))?;
    let key = spot.key().map_err(|err| solve_error(err.to_string()))?;
    let accuracy = response.gain_pct_pot[0].max(response.gain_pct_pot[1]);
    let nodes = walked.iter().map(|node| dump_node(&key, spot, node, accuracy)).collect();
    let pot_bb = f64::from(spot.pot_cbb) / f64::from(Cbb::PER_BB);
    let facts = SpotFacts {
        id: spot.id.clone(),
        iterations: report.iterations,
        seconds: report.seconds,
        estimate_bytes: report.estimate_bytes,
        peak_bytes: report.peak_bytes,
        stop_reason: stop_reason_name(report.stop_reason).to_owned(),
        gains_pct_pot: response.gain_pct_pot,
        best_response_root_ev_bb: response.expected_value_bb[0] + HALF * pot_bb,
    };
    Ok(SpotSolve { id: spot.id.clone(), nodes, report, best_response: response, facts })
}

/// The stop reason in the words the report notes use.
fn stop_reason_name(reason: StopReason) -> &'static str {
    match reason {
        StopReason::Target => "target",
        StopReason::MaxIterations => "max-iterations",
        StopReason::MaxSeconds => "max-seconds",
    }
}

/// One walked node in dump form under the spot's root key.
fn dump_node(root: &NodeKey, spot: &Spot, node: &NodeStrategy, accuracy: f64) -> DumpNode {
    let key = key_below(root, &node.line);
    let board = key.board().map(|board| format_cards(&board.cards())).unwrap_or_default();
    let opponent = node.player.other().index();
    let actions = node
        .actions
        .iter()
        .map(|token| {
            let size_cbb = match token.size() {
                Some(size) => size.get(),
                None if matches!(token, gto_model::ActionToken::Call) => {
                    spot.stack_cbb - node.stacks[opponent].get()
                }
                None if matches!(token, gto_model::ActionToken::AllIn) => spot.stack_cbb,
                None => 0,
            };
            DumpAction { token: token.to_string(), size_cbb }
        })
        .collect();
    let hands = node
        .hands
        .iter()
        .map(|hand| DumpHand {
            hand: hand.combo.to_string(),
            reach: Some(hand.reach.to_vec()),
            frequencies: hand.frequencies.iter().map(|f| f64::from(*f)).collect(),
            ev_bb: hand.ev_bb.clone(),
        })
        .collect();
    DumpNode {
        node_key: key.to_string(),
        street: key.street().as_str().to_owned(),
        board,
        to_act: node.player.position(root.pair).to_string(),
        pot_cbb: node.pot.get(),
        stacks_cbb: vec![node.stacks[0].get(), node.stacks[1].get()],
        actions,
        hands,
        accuracy_pct_pot: Some(accuracy),
    }
}

/// The root key with `line` as the actions of its last dealt street: the river section
/// for a river root, the turn section for a turn root (the loader admits no other root;
/// a flop root would take its flop section, a preflop key its preflop line).
fn key_below(root: &NodeKey, line: &[gto_model::ActionToken]) -> NodeKey {
    let mut key = root.clone();
    let actions = line.to_vec();
    match root.street() {
        Street::River => {
            if let Some(section) = key.river.as_mut() {
                section.actions = actions;
            }
        }
        Street::Turn => {
            if let Some(section) = key.turn.as_mut() {
                section.actions = actions;
            }
        }
        Street::Flop => {
            if let Some(section) = key.flop.as_mut() {
                section.actions = actions;
            }
        }
        Street::Preflop => key.preflop = actions,
    }
    key
}

/// The engine-side dump of every solved spot.
///
/// # Errors
///
/// `GateError::Solve` when the list's configuration is not in the catalog.
pub fn engine_dump(
    spots: &G4Spots,
    solves: &[SpotSolve],
    exported_at: &str,
) -> Result<NodeDump, GateError> {
    let config = spots.game_config().ok_or_else(|| GateError::Solve {
        spot: spots.id.clone(),
        message: format!("config_id {} names no v1 configuration", spots.config_id),
    })?;
    let worst = |seat: usize| {
        solves.iter().map(|solve| solve.best_response.gain_pct_pot[seat]).fold(f64::MIN, f64::max)
    };
    let exploitability = (!solves.is_empty()).then(|| vec![worst(0), worst(1)]);
    Ok(NodeDump {
        schema_version: crate::fixtures::SCHEMA_VERSION,
        source: SOURCE_OWN.to_owned(),
        exported_at: exported_at.to_owned(),
        config: DumpConfig {
            format: config.format.to_string(),
            table_size: config.table_size.get(),
            stake_label: config.stake.label.clone(),
            depth_cbb: config.depth_cbb.get(),
            straddle: config.straddle,
            ante_cbb: config.ante_cbb.get(),
        },
        config_id: Some(spots.config_id.clone()),
        position_pair: spots.position_pair.clone(),
        hand_space: HAND_SPACE.to_owned(),
        exploitability_pct_pot: exploitability,
        nodes: solves.iter().flat_map(|solve| solve.nodes.iter().cloned()).collect(),
    })
}

/// Write `dump` as pretty-printed JSON with a trailing newline, creating the parent
/// directory when it is missing.
///
/// # Errors
///
/// `GateError::Report` wrapping the serialise or write failure.
pub fn write_dump(dump: &NodeDump, path: &Path) -> Result<(), GateError> {
    let mut text = serde_json::to_string_pretty(dump)
        .map_err(|source| ReportError::Serialize { path: path.to_path_buf(), source })?;
    text.push('\n');
    let write_error =
        |source| GateError::Report(ReportError::Write { path: path.to_path_buf(), source });
    if let Some(parent) = path.parent().filter(|parent| !parent.as_os_str().is_empty()) {
        std::fs::create_dir_all(parent).map_err(write_error)?;
    }
    std::fs::write(path, text).map_err(write_error)
}

/// The SHA-256 digest of a file as 64 lowercase hex digits, for the report notes.
///
/// # Errors
///
/// `GateError::Fixture` when the file cannot be read.
pub fn sha256_hex_of(path: &Path) -> Result<String, GateError> {
    let bytes = std::fs::read(path).map_err(|source| crate::fixtures::FixtureError::Read {
        path: path.to_path_buf(),
        source,
    })?;
    let digest = Sha256::digest(bytes);
    let mut hex = String::with_capacity(digest.len() * 2);
    for byte in digest {
        write!(hex, "{byte:02x}").expect("writing to a String cannot fail");
    }
    Ok(hex)
}
