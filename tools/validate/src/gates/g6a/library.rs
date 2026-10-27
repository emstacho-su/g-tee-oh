//! The committed G6a library (R2.19, O-131, O-133): the node dump of a solution, its pack
//! into library format, and the check of a committed solution against a recomputation.
//!
//! Mechanism. A solution becomes a `preflop_169` node dump with source `own`, seed 0, the
//! CFR+ iteration count and each seat's best-response gain as a percent of the starting
//! pot; the export time is a fixed constant, so the dump, and with it the solution id
//! (the dump's sha256, O-131) and every packed byte, is the same on every run. The pack
//! goes through library-pack's `to_solution` (both checkers, criterion 2) and
//! gto-library's `prepare_preflop`, the two steps `library_pack::pack` runs on a dump
//! file, without the file. The check reads the one committed solution of the depth's
//! configuration back through gto-library's `Reader`, re-exports it under its manifest
//! and compares it with the recomputed dump with library-pack's `compare_dumps`, the O-133
//! tolerances (frequencies within 1/255, the best action's expected value (EV) equal as
//! an f32, losses within half a unit); the largest frequency difference is reported too.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use gto_library::{
    ChunkOptions, FsStore, MANIFEST_FILE, Manifest, ObjectStore, Reader, ReaderOptions,
    SolutionMeta, SolvedNode, is_uuid, preflop_prefix, prepare_preflop,
};
use gto_model::{ActionToken, Cbb, NodeKey};
use gto_solve::preflop::{SolvedPreflop, SolvedPreflopNode};
use library_pack::{DumpAction, DumpConfig, DumpHand, DumpNode, NodeDump, PackOptions};

use super::G6aError;

/// The export time every G6a dump carries, so packing is deterministic.
pub const EXPORTED_AT: &str = "2026-10-27T00:00:00Z";

/// The seed recorded in the manifest: the solve is deterministic and draws nothing.
pub const SEED: u64 = 0;

/// The node-dump schema version.
const SCHEMA_VERSION: u32 = 1;

/// Percent in one whole.
const PERCENT: f64 = 100.0;

/// Centi-big-blinds (cbb) in one big blind.
const CBB_PER_BB: f64 = 100.0;

/// What the check of one committed solution found.
#[derive(Debug, Clone, PartialEq)]
pub struct LibraryCheck {
    /// The prefix of the committed solution, `preflop/<config_id>/<id>`.
    pub prefix: String,
    /// The largest absolute frequency difference over every node, hand and action.
    pub max_frequency_diff: f64,
    /// Every difference beyond the O-133 tolerances, one sentence each.
    pub differences: Vec<String>,
}

/// The `preflop_169` node dump of `solution` (see the module docs).
///
/// # Errors
///
/// `G6aError` when the solution has no root node.
pub fn dump(solution: &SolvedPreflop) -> Result<NodeDump, G6aError> {
    let root = solution.nodes.first().ok_or_else(|| G6aError::new("a solution with no node"))?;
    let depth_cbb = depth_cbb(root);
    let pot_bb = f64::from(solution.starting_pot.get()) / CBB_PER_BB;
    let exploitability = solution.gains_bb.map(|gain| gain.max(0.0) / pot_bb * PERCENT);
    Ok(NodeDump {
        schema_version: SCHEMA_VERSION,
        source: "own".to_owned(),
        exported_at: EXPORTED_AT.to_owned(),
        config: DumpConfig {
            format: "online".to_owned(),
            table_size: 2,
            stake_label: gto_solve::preflop::NO_RAKE_STAKE_LABEL.to_owned(),
            depth_cbb,
            straddle: false,
            ante_cbb: 0,
        },
        config_id: Some(solution.config_id.to_string()),
        position_pair: root.key.pair.to_string(),
        hand_space: "preflop_169".to_owned(),
        exploitability_pct_pot: Some(exploitability.to_vec()),
        nodes: solution.nodes.iter().map(|node| dump_node(node, depth_cbb)).collect(),
    })
}

/// The effective stack in cbb at a node of a game with no dead money (heads-up, no
/// ante): each seat's chips put in are the depth minus its stack behind and the pot is
/// their sum, so the depth is the pot plus both stacks behind, halved.
pub fn depth_cbb(node: &SolvedPreflopNode) -> u32 {
    (node.pot.get() + node.stacks[0].get() + node.stacks[1].get()) / 2
}

/// One dump node.
fn dump_node(node: &SolvedPreflopNode, depth_cbb: u32) -> DumpNode {
    DumpNode {
        node_key: node.key.to_string(),
        street: "preflop".to_owned(),
        board: String::new(),
        to_act: node.actor.to_string(),
        pot_cbb: node.pot.get(),
        stacks_cbb: node.stacks.iter().map(|stack| stack.get()).collect(),
        actions: node
            .actions
            .iter()
            .map(|token| DumpAction {
                token: token.to_string(),
                size_cbb: size_cbb(*token, depth_cbb),
            })
            .collect(),
        hands: node
            .hands
            .iter()
            .map(|hand| DumpHand {
                hand: hand.class.to_string(),
                reach: Some(hand.reach.to_vec()),
                frequencies: hand.frequencies.clone(),
                ev_bb: hand.ev_bb.clone(),
            })
            .collect(),
        accuracy_pct_pot: None,
    }
}

/// The total wager of an action: 0 for a fold or a check, the stack for an all-in or the
/// call of one, the size of a sized token.
fn size_cbb(token: ActionToken, depth_cbb: u32) -> u32 {
    match token {
        ActionToken::Fold | ActionToken::Check => 0,
        ActionToken::AllIn | ActionToken::Call | ActionToken::Limp => depth_cbb,
        sized => sized.size().map_or(0, Cbb::get),
    }
}

/// Packs `solutions` under `out_root` and returns each solution's directory. Any other
/// solution directory under a packed configuration is removed, so a regenerated library
/// holds exactly one solution per depth.
///
/// # Errors
///
/// `G6aError` naming the configuration whose dump, pack or write failed.
pub fn pack(
    solutions: &[SolvedPreflop],
    out_root: &Path,
    engine_version: &str,
) -> Result<Vec<PathBuf>, G6aError> {
    solutions.iter().map(|solution| pack_one(solution, out_root, engine_version)).collect()
}

/// Packs one solution.
fn pack_one(
    solution: &SolvedPreflop,
    out_root: &Path,
    engine_version: &str,
) -> Result<PathBuf, G6aError> {
    let named = |message: String| G6aError::new(format!("{}: {message}", solution.config_id));
    let dump = dump(solution)?;
    let options = PackOptions {
        engine_version: Some(engine_version.to_owned()),
        seed: Some(SEED),
        iterations: Some(u64::from(solution.iterations)),
        ..PackOptions::default()
    };
    let (meta, nodes) = library_pack::to_solution(&dump, &options).map_err(|found| {
        named(found.iter().map(ToString::to_string).collect::<Vec<_>>().join(" "))
    })?;
    let prepared = prepare_preflop(&meta, &nodes, &ChunkOptions::default())
        .map_err(|error| named(error.to_string()))?;
    std::fs::create_dir_all(out_root).map_err(|error| named(error.to_string()))?;
    let mut store = FsStore::new(out_root).map_err(|error| named(error.to_string()))?;
    prepared.write(&mut store).map_err(|error| named(error.to_string()))?;
    remove_stale(&out_root.join("preflop").join(meta.config_id.as_str()), &meta.id)?;
    Ok(out_root.join(preflop_prefix(&meta.config_id, &meta.id)))
}

/// Removes every solution directory under `config_dir` other than `keep`; only
/// directories named by a solution id are touched.
fn remove_stale(config_dir: &Path, keep: &str) -> Result<(), G6aError> {
    let failed =
        |error: std::io::Error| G6aError::new(format!("{}: {error}", config_dir.display()));
    for entry in std::fs::read_dir(config_dir).map_err(failed)? {
        let entry = entry.map_err(failed)?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if name != keep && is_uuid(&name) && entry.path().is_dir() {
            std::fs::remove_dir_all(entry.path()).map_err(failed)?;
        }
    }
    Ok(())
}

/// Checks the committed solution of `solution`'s configuration under `library_root`.
///
/// # Errors
///
/// `G6aError` when the configuration has no committed solution or more than one, or the
/// manifest or a node cannot be read.
pub fn check(library_root: &Path, solution: &SolvedPreflop) -> Result<LibraryCheck, G6aError> {
    let ours = dump(solution)?;
    let prefix = committed_prefix(library_root, solution)?;
    let named = |message: String| G6aError::new(format!("{prefix}: {message}"));
    let store = FsStore::new(library_root).map_err(|error| named(error.to_string()))?;
    let bytes = store
        .get(&format!("{prefix}/{MANIFEST_FILE}"))
        .map_err(|error| named(error.to_string()))?;
    let manifest = Manifest::from_json(&bytes).map_err(|error| named(error.to_string()))?;
    let meta = meta_of(&manifest).map_err(named)?;
    let back = read_back(library_root, &prefix, &ours).map_err(named)?;
    let exported = library_pack::export_dump(&meta, &back);
    let differences = library_pack::compare_dumps(&ours, &exported);
    let max_frequency_diff = max_frequency_diff(&ours, &exported);
    Ok(LibraryCheck { prefix, max_frequency_diff, differences })
}

/// `preflop/<config_id>/<id>` of the one committed solution of the configuration.
fn committed_prefix(library_root: &Path, solution: &SolvedPreflop) -> Result<String, G6aError> {
    let config_dir = library_root.join("preflop").join(solution.config_id.as_str());
    let missing = |error: std::io::Error| {
        G6aError::new(format!("no committed G6a solution at {}: {error}", config_dir.display()))
    };
    let mut ids = Vec::new();
    for entry in std::fs::read_dir(&config_dir).map_err(missing)? {
        let entry = entry.map_err(missing)?;
        if entry.path().is_dir() {
            ids.push(entry.file_name().to_string_lossy().into_owned());
        }
    }
    match ids.as_slice() {
        [id] => Ok(format!("preflop/{}/{id}", solution.config_id)),
        _ => Err(G6aError::new(format!(
            "{} holds {} solutions, not one",
            config_dir.display(),
            ids.len()
        ))),
    }
}

/// The solution metadata a preflop manifest records.
fn meta_of(manifest: &Manifest) -> Result<SolutionMeta, String> {
    let missing = |field: &str| format!("the manifest has no {field}");
    Ok(SolutionMeta {
        id: manifest.id.clone(),
        source: manifest.source,
        engine_version: manifest.engine_version.clone(),
        config: manifest.config.clone(),
        config_id: manifest.config_id.clone().ok_or_else(|| missing("config_id"))?,
        pair: manifest.pair.ok_or_else(|| missing("pair"))?,
        tree_hash: manifest.tree_hash.clone().ok_or_else(|| missing("tree_hash"))?,
        seed: manifest.seed,
        iterations: manifest.iterations,
        exploitability_pct_pot: manifest.exploitability_pct_pot,
        synthetic: manifest.synthetic.unwrap_or(false),
        created_at: manifest.created_at.clone(),
    })
}

/// Every node of `ours` read back from the committed solution.
fn read_back(
    library_root: &Path,
    prefix: &str,
    ours: &NodeDump,
) -> Result<Vec<SolvedNode>, String> {
    let store = FsStore::new(library_root).map_err(|error| error.to_string())?;
    let reader = Reader::new(store, ReaderOptions::default());
    let handle = reader.open(prefix).map_err(|error| error.to_string())?;
    ours.nodes
        .iter()
        .map(|node| {
            let key: NodeKey = node.node_key.parse().map_err(|error| format!("{error}"))?;
            let view = reader.node(handle, &key).map_err(|error| error.to_string())?;
            view.to_solved(&key).map_err(|error| error.to_string())
        })
        .collect()
}

/// The largest absolute frequency difference between matching hands of two dumps.
fn max_frequency_diff(ours: &NodeDump, back: &NodeDump) -> f64 {
    let back_hands: BTreeMap<(&str, &str), &DumpHand> = back
        .nodes
        .iter()
        .flat_map(|node| {
            node.hands.iter().map(move |hand| ((node.node_key.as_str(), hand.hand.as_str()), hand))
        })
        .collect();
    ours.nodes
        .iter()
        .flat_map(|node| node.hands.iter().map(move |hand| (node.node_key.as_str(), hand)))
        .filter_map(|(key, hand)| {
            back_hands.get(&(key, hand.hand.as_str())).map(|other| (hand, *other))
        })
        .flat_map(|(hand, other)| {
            hand.frequencies.iter().zip(&other.frequencies).map(|(a, b)| (a - b).abs())
        })
        .fold(0.0, f64::max)
}
