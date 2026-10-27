//! From strategy rows to a packed solution (O-57, O-131, O-225).
//!
//! Mechanism. Each tree node becomes a `gto_library::SolvedNode`: its key from
//! `NodeKey::preflop`, the stacks and wagers from `line::Replay`, and the rows of
//! `strategy`. The metadata follows `library_pack::synthetic`: source `reference`, the
//! engine label `synthetic`, the catalog row of the configuration, no exploitability, and
//! the set's fixed `created_at` as `exported_at`. `library_pack::export_dump` turns the
//! nodes into a node dump, written as compact JSON (JavaScript Object Notation) into a
//! temporary directory outside the repository, and `library_pack::pack` packs it with
//! `synthetic: true`, the set seed and the same `created_at`. The pack runs the criterion 2
//! invariants and derives the solution id from the dump's sha256, so the bytes on disk
//! depend only on the set, the configuration and the pair.

use std::path::{Path, PathBuf};

use gto_library::{
    HandSpace, Manifest, ManifestConfig, SolutionMeta, SolvedHand, SolvedNode, Source,
    preflop_prefix,
};
use gto_model::{GameConfig, NodeKey, PositionPair};
use gto_tree::PreflopTree;
use library_pack::synthetic::SYNTHETIC_ENGINE;
use library_pack::{PackError, PackOptions, export_dump, pack};

use crate::line::Replay;
use crate::strategy::HandRow;
use crate::{GenError, Generated};

/// The solution id of the in-memory metadata; the dump carries no id, `pack` assigns one.
const PLACEHOLDER_ID: &str = "00000000-0000-8000-8000-000000000000";

/// The most violations a pack failure quotes.
const QUOTED_VIOLATIONS: usize = 5;

/// What one solution is: the set it belongs to, its configuration and its pair.
pub(crate) struct Target<'a> {
    /// The set name.
    pub set: &'a str,
    /// The set seed.
    pub seed: u64,
    /// The set's fixed timestamp.
    pub created_at: &'a str,
    /// The catalog row.
    pub config: &'a GameConfig,
    /// The pair.
    pub pair: PositionPair,
}

impl Target<'_> {
    /// `set config pair`, for error messages.
    pub(crate) fn name(&self) -> String {
        format!("{} {} {}", self.set, self.config.config_id(), self.pair)
    }
}

/// The solved nodes of `tree` with the rows of each node, in the tree's order.
pub(crate) fn solved_nodes(
    target: &Target<'_>,
    tree: &PreflopTree,
    rows: Vec<Vec<HandRow>>,
) -> Result<Vec<SolvedNode>, GenError> {
    let root = tree.nodes().first().ok_or_else(|| GenError::Build("an empty tree".into()))?;
    let replay = Replay::new(target.config, target.pair, root)?;
    let config_id = target.config.config_id();
    tree.nodes()
        .iter()
        .zip(rows)
        .map(|(node, hands)| {
            let chips = replay.chips(node)?;
            Ok(SolvedNode {
                key: NodeKey::preflop(config_id.clone(), target.pair, node.line.clone()),
                to_act: node.actor,
                pot: node.pot,
                stacks: chips.stacks,
                actions: chips.actions,
                hand_space: HandSpace::Preflop169,
                hands: hands.into_iter().map(solved_hand).collect(),
                accuracy_pct_pot: None,
            })
        })
        .collect()
}

fn solved_hand(row: HandRow) -> SolvedHand {
    SolvedHand {
        hand: row.class,
        reach: Some(row.reach),
        frequencies: row.frequencies,
        ev_bb: row.ev_bb,
    }
}

/// The synthetic reference metadata of `nodes` (as `library_pack::synthetic` writes it).
fn meta(target: &Target<'_>, nodes: &[SolvedNode]) -> SolutionMeta {
    let config = target.config;
    SolutionMeta {
        id: PLACEHOLDER_ID.to_owned(),
        source: Source::Reference,
        engine_version: SYNTHETIC_ENGINE.to_owned(),
        config: ManifestConfig {
            format: config.format,
            table_size: config.table_size,
            stake: config.stake.label.clone(),
            depth_cbb: config.depth_cbb,
            straddle: config.straddle,
            ante_cbb: config.ante_cbb,
        },
        config_id: config.config_id(),
        pair: target.pair,
        tree_hash: library_pack::convert::tree_hash(nodes),
        seed: Some(target.seed),
        iterations: None,
        exploitability_pct_pot: None,
        synthetic: true,
        created_at: target.created_at.to_owned(),
    }
}

/// Dumps `nodes` into `scratch`, packs the dump into `out_root` and returns the solution.
pub(crate) fn pack_nodes(
    target: &Target<'_>,
    nodes: &[SolvedNode],
    scratch: &Path,
    out_root: &Path,
) -> Result<Generated, GenError> {
    let dump = export_dump(&meta(target, nodes), nodes);
    let bytes = serde_json::to_vec(&dump).map_err(|err| {
        GenError::Build(format!("{}: the dump does not serialize: {err}", target.name()))
    })?;
    let dump_path = scratch.join("dump.json");
    std::fs::write(&dump_path, bytes)
        .map_err(|source| GenError::Io { path: dump_path.display().to_string(), source })?;
    let options = PackOptions {
        engine_version: Some(SYNTHETIC_ENGINE.to_owned()),
        seed: Some(target.seed),
        created_at: Some(target.created_at.to_owned()),
        synthetic: true,
        ..PackOptions::default()
    };
    let manifest = pack(&dump_path, out_root, &options)
        .map_err(|err| GenError::Build(format!("{}: {}", target.name(), pack_message(&err))))?;
    Ok(generated(target, &manifest, out_root))
}

/// A pack error with the first violations quoted.
fn pack_message(err: &PackError) -> String {
    let quoted: Vec<String> = match err {
        PackError::Rejected(found) => {
            found.iter().take(QUOTED_VIOLATIONS).map(ToString::to_string).collect()
        }
        PackError::Mismatch(found) => found.iter().take(QUOTED_VIOLATIONS).cloned().collect(),
        _ => Vec::new(),
    };
    if quoted.is_empty() { err.to_string() } else { format!("{err}: {}", quoted.join(" ")) }
}

/// The record of a packed solution.
fn generated(target: &Target<'_>, manifest: &Manifest, out_root: &Path) -> Generated {
    let config_id = target.config.config_id();
    let prefix: PathBuf = preflop_prefix(&config_id, &manifest.id)
        .split('/')
        .fold(out_root.to_path_buf(), |p, s| p.join(s));
    Generated {
        set: target.set.to_owned(),
        config_id: config_id.to_string(),
        pair: target.pair.to_string(),
        solution_id: manifest.id.clone(),
        prefix,
    }
}

/// The bytes of every file under `dir`, read in name order.
pub(crate) fn bytes_under(dir: &Path) -> Result<u64, GenError> {
    let io = |source| GenError::Io { path: dir.display().to_string(), source };
    let mut entries: Vec<PathBuf> = std::fs::read_dir(dir)
        .map_err(io)?
        .map(|e| e.map(|e| e.path()))
        .collect::<Result<_, _>>()
        .map_err(io)?;
    entries.sort();
    entries.iter().try_fold(0_u64, |total, path| {
        let size = if path.is_dir() {
            bytes_under(path)?
        } else {
            std::fs::metadata(path)
                .map_err(|source| GenError::Io { path: path.display().to_string(), source })?
                .len()
        };
        Ok(total + size)
    })
}
