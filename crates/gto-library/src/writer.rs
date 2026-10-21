//! The writer (R2.7, A3 sections 2 and 3): solved nodes to chunk files plus a manifest.
//!
//! Mechanism: every node's key is hashed and checked against the others first, so a
//! duplicate key or a 64-bit hash collision rejects the whole call before anything is put.
//! The nodes are then quantized into records and packed into chunk files (see `chunk`) in
//! input order, so the same nodes always give the same bytes. Every file and the manifest
//! are built and checked in memory before the first put, so a rejected call writes nothing.
//!
//! Paths:
//! - preflop: `preflop/<config_id>/<solution_id>/manifest.json` and
//!   `.../chunks/NNNN.bin.zst`, at most `MAX_CHUNKS` files of about
//!   `CHUNK_FILE_TARGET_BYTES` of uncompressed records each;
//! - flop builds (S18): `builds/<config_id>/<pair>/<flop>/<build_id>/` holding
//!   `flop/<line>.bin.zst` and `runouts/<turn><river>/<line>.bin.zst`, one
//!   `write_tree_file` call per file.
//!
//! Lane W (writer) owns this file.

use std::collections::HashMap;

use gto_model::{ConfigId, NodeKey, PositionPair};

use crate::FORMAT_VERSION;
use crate::checksum::sha256_hex;
use crate::chunk::{ChunkOptions, encode_file};
use crate::error::LibraryError;
use crate::key_hash::key_hash;
use crate::manifest::{
    ChunkRef, FileRef, MANIFEST_FILE, MAX_CHUNKS, Manifest, ManifestConfig, ManifestKind, Source,
};
use crate::record::{NodeRecord, SolvedNode};
use crate::store::ObjectSink;

/// Uncompressed record bytes per preflop chunk file, about 16 MiB: a file closes before it
/// would exceed this, unless it holds a single record. A few thousand preflop nodes fit in
/// one or two files, and the sha256 check at open reads each file once.
pub const CHUNK_FILE_TARGET_BYTES: usize = 16 * 1024 * 1024;

/// The suffix every tree file path carries.
const TREE_FILE_SUFFIX: &str = ".bin.zst";

/// Everything a preflop manifest carries besides its chunks.
#[derive(Clone, Debug, PartialEq)]
pub struct SolutionMeta {
    /// The solution's lowercase universally unique identifier (UUID).
    pub id: String,
    /// Own or reference.
    pub source: Source,
    /// The engine version, or an opaque label for a reference solution.
    pub engine_version: String,
    /// The game configuration.
    pub config: ManifestConfig,
    /// The configuration identifier every node key carries.
    pub config_id: ConfigId,
    /// The two seats every node key carries.
    pub pair: PositionPair,
    /// The sha256 of the tree definition (lead decision 2).
    pub tree_hash: String,
    /// The solve's random seed, when known.
    pub seed: Option<u64>,
    /// The solve's iteration count, when known.
    pub iterations: Option<u64>,
    /// The exploitability per seat in percent of the pot, when known.
    pub exploitability_pct_pot: Option<[f64; 2]>,
    /// True for synthetic test data.
    pub synthetic: bool,
    /// The manifest timestamp, `YYYY-MM-DDTHH:MM:SSZ`.
    pub created_at: String,
}

/// `preflop/<config_id>/<solution_id>`, the directory of a preflop solution.
#[must_use]
pub fn preflop_prefix(config_id: &ConfigId, solution_id: &str) -> String {
    format!("preflop/{config_id}/{solution_id}")
}

/// Writes a preflop solution under `preflop_prefix(meta.config_id, meta.id)` and returns
/// the manifest it stored. The manifest passes `Manifest::validate` before anything is put.
///
/// # Errors
///
/// `LibraryError::DuplicateKey`, `LibraryError::KeyHashCollision`, a node whose key names
/// another configuration or pair (`LibraryError::Manifest`), no nodes, more than
/// `MAX_CHUNKS` files, any quantization or validation error, or the sink's error. Nothing is
/// put when the nodes or the manifest are rejected.
pub fn write_preflop(
    sink: &mut dyn ObjectSink,
    meta: &SolutionMeta,
    nodes: &[SolvedNode],
    o: &ChunkOptions,
) -> Result<Manifest, LibraryError> {
    check_membership(nodes, &meta.config_id, meta.pair)?;
    let records = quantize_nodes(nodes, meta.pair)?;
    let groups = file_groups(&records);
    if groups.len() > MAX_CHUNKS {
        return Err(LibraryError::Manifest(format!(
            "the solution needs {} chunk files; a manifest lists at most {MAX_CHUNKS}",
            groups.len()
        )));
    }
    let files = groups
        .iter()
        .enumerate()
        .map(|(index, group)| chunk_file(index, group, o))
        .collect::<Result<Vec<(ChunkRef, Vec<u8>)>, LibraryError>>()?;
    let manifest = preflop_manifest(meta, files.iter().map(|(chunk, _)| chunk.clone()).collect());
    manifest.validate()?;
    let json = manifest.to_json_pretty()?;
    let prefix = preflop_prefix(&meta.config_id, &meta.id);
    for (chunk, bytes) in &files {
        sink.put(&format!("{prefix}/{}", chunk.path), bytes)?;
    }
    sink.put(&format!("{prefix}/{MANIFEST_FILE}"), json.as_bytes())?;
    Ok(manifest)
}

/// Writes one tree file of a flop build at `<prefix>/<path>` and returns its `FileRef`,
/// whose path is `path` (relative to the solution directory, as the manifest lists it).
///
/// # Errors
///
/// As `write_preflop` for the nodes (every key must carry `pair` and the first node's
/// configuration), plus `LibraryError::InvalidPath` for a `path` that is not relative with
/// forward slashes, holds an empty, `.` or `..` segment, or does not end in `.bin.zst`.
pub fn write_tree_file(
    sink: &mut dyn ObjectSink,
    prefix: &str,
    path: &str,
    pair: PositionPair,
    nodes: &[SolvedNode],
    o: &ChunkOptions,
) -> Result<FileRef, LibraryError> {
    check_tree_path(path)?;
    let config_id = nodes.first().map(|node| node.key.config_id.clone());
    let config_id = config_id.ok_or_else(|| no_nodes(path))?;
    check_membership(nodes, &config_id, pair)?;
    let records = quantize_nodes(nodes, pair)?;
    let bytes = encode_file(&records, o)?;
    let sha256 = sha256_hex(&bytes);
    sink.put(&format!("{prefix}/{path}"), &bytes)?;
    Ok(FileRef { path: path.to_owned(), sha256 })
}

/// Hashes every node key with `hasher`, returning the hashes in node order.
///
/// # Errors
///
/// `LibraryError::DuplicateKey` when one key appears twice, `LibraryError::KeyHashCollision`
/// when two different keys share a hash.
pub(crate) fn index_nodes(
    nodes: &[SolvedNode],
    hasher: fn(&NodeKey) -> u64,
) -> Result<Vec<u64>, LibraryError> {
    let mut seen: HashMap<u64, &NodeKey> = HashMap::with_capacity(nodes.len());
    let mut node_hashes = Vec::with_capacity(nodes.len());
    for node in nodes {
        let hash = hasher(&node.key);
        match seen.get(&hash) {
            Some(first) if **first == node.key => {
                return Err(LibraryError::DuplicateKey(node.key.to_string()));
            }
            Some(first) => {
                return Err(LibraryError::KeyHashCollision {
                    first: first.to_string(),
                    second: node.key.to_string(),
                });
            }
            None => {
                seen.insert(hash, &node.key);
                node_hashes.push(hash);
            }
        }
    }
    Ok(node_hashes)
}

/// Every node must exist and carry `config_id` and `pair` in its key.
fn check_membership(
    nodes: &[SolvedNode],
    config_id: &ConfigId,
    pair: PositionPair,
) -> Result<(), LibraryError> {
    if nodes.is_empty() {
        return Err(no_nodes(config_id.as_str()));
    }
    match nodes.iter().find(|node| node.key.config_id != *config_id || node.key.pair != pair) {
        Some(node) => Err(LibraryError::Manifest(format!(
            "node {} does not belong to configuration {config_id} and pair {pair}",
            node.key
        ))),
        None => Ok(()),
    }
}

fn no_nodes(target: &str) -> LibraryError {
    LibraryError::Manifest(format!("nothing to write for {target}: no nodes were given"))
}

/// The duplicate and collision check, then one record per node in input order.
fn quantize_nodes(
    nodes: &[SolvedNode],
    pair: PositionPair,
) -> Result<Vec<NodeRecord>, LibraryError> {
    index_nodes(nodes, key_hash)?;
    nodes.iter().map(|node| NodeRecord::from_solved(node, pair)).collect()
}

/// Consecutive runs of records of about `CHUNK_FILE_TARGET_BYTES` each.
fn file_groups(records: &[NodeRecord]) -> Vec<&[NodeRecord]> {
    let mut groups = Vec::new();
    let mut start = 0;
    let mut bytes = 0;
    for (index, record) in records.iter().enumerate() {
        let len = record.encoded_len();
        if index > start && bytes + len > CHUNK_FILE_TARGET_BYTES {
            groups.push(&records[start..index]);
            start = index;
            bytes = 0;
        }
        bytes += len;
    }
    if start < records.len() {
        groups.push(&records[start..]);
    }
    groups
}

/// Chunk file `index` of `records`, with its manifest entry.
fn chunk_file(
    index: usize,
    records: &[NodeRecord],
    o: &ChunkOptions,
) -> Result<(ChunkRef, Vec<u8>), LibraryError> {
    let bytes = encode_file(records, o)?;
    let node_count = u32::try_from(records.len())
        .map_err(|_| LibraryError::Manifest("a chunk file holds too many nodes".into()))?;
    let chunk = ChunkRef {
        path: format!("chunks/{index:04}.bin.zst"),
        sha256: sha256_hex(&bytes),
        node_count,
    };
    Ok((chunk, bytes))
}

/// The preflop manifest for `meta` and its chunk files.
fn preflop_manifest(meta: &SolutionMeta, chunks: Vec<ChunkRef>) -> Manifest {
    Manifest {
        format_version: FORMAT_VERSION,
        kind: ManifestKind::Preflop,
        source: meta.source,
        id: meta.id.clone(),
        engine_version: meta.engine_version.clone(),
        config: meta.config.clone(),
        config_id: Some(meta.config_id.clone()),
        pair: Some(meta.pair),
        flop: None,
        flop_weight: None,
        lines: None,
        runouts: None,
        turn_roots: None,
        chunks: Some(chunks),
        tree_hash: Some(meta.tree_hash.clone()),
        seed: meta.seed,
        iterations: meta.iterations,
        exploitability_pct_pot: meta.exploitability_pct_pot,
        synthetic: Some(meta.synthetic),
        created_at: meta.created_at.clone(),
    }
}

/// A tree file path: relative, forward slashes, no empty, `.` or `..` segment, no drive
/// colon, ending in `.bin.zst`.
fn check_tree_path(path: &str) -> Result<(), LibraryError> {
    let segments_ok = path.split('/').all(|segment| !matches!(segment, "" | "." | ".."));
    if segments_ok && !path.contains(['\\', ':']) && path.ends_with(TREE_FILE_SUFFIX) {
        Ok(())
    } else {
        Err(LibraryError::InvalidPath(path.to_owned()))
    }
}

#[cfg(test)]
mod tests {
    use gto_model::{ActionToken, Cbb, ConfigId, NodeKey, Position, PositionPair};

    use super::{check_tree_path, index_nodes};
    use crate::error::LibraryError;
    use crate::record::{HandSpace, SolvedHand, SolvedNode};

    /// Every key hashes to this, so any two different keys collide.
    fn constant_hasher(_: &NodeKey) -> u64 {
        7
    }

    fn node(line: Vec<ActionToken>) -> SolvedNode {
        let config_id = ConfigId::new("cfg_6_online_100").expect("a valid config id");
        let pair = PositionPair::new(Position::Bb, Position::Btn).expect("two seats");
        SolvedNode {
            key: NodeKey::preflop(config_id, pair, line),
            to_act: Position::Btn,
            pot: Cbb(150),
            stacks: [Cbb(9_900), Cbb(10_000)],
            actions: vec![(ActionToken::Fold, Cbb(0)), (ActionToken::Call, Cbb(100))],
            hand_space: HandSpace::Preflop169,
            hands: vec![SolvedHand {
                hand: 0,
                reach: None,
                frequencies: vec![0.5, 0.5],
                ev_bb: vec![0.0, 0.1],
            }],
            accuracy_pct_pot: None,
        }
    }

    #[test]
    fn r2_7_key_hash_collision_is_rejected() {
        let first = node(vec![]);
        let second = node(vec![ActionToken::Raise(Cbb(250))]);
        let result = index_nodes(&[first.clone(), second.clone()], constant_hasher);
        match result {
            Err(LibraryError::KeyHashCollision { first: a, second: b }) => {
                assert_eq!(a, first.key.to_string());
                assert_eq!(b, second.key.to_string());
            }
            other => panic!("expected a key hash collision, got {other:?}"),
        }
    }

    #[test]
    fn r2_7_tree_file_paths_stay_inside_the_build() {
        for good in ["flop/r250.c.bin.zst", "runouts/Kh9s/r250.c.bin.zst"] {
            check_tree_path(good).expect("a relative tree path");
        }
        for bad in ["", "/flop/x.bin.zst", "../x.bin.zst", "flop//x.bin.zst", "a\\b.bin.zst"] {
            assert!(check_tree_path(bad).is_err(), "{bad:?} must be rejected");
        }
        assert!(check_tree_path("C:/x.bin.zst").is_err() && check_tree_path("flop/x").is_err());
    }
}
