//! The writer (R2.7, A3 sections 2 and 3): solved nodes to chunk files plus a manifest.
//!
//! Mechanism: every node's key is hashed and checked against the others first, so a
//! duplicate key or a 64-bit hash collision rejects the whole call before anything is put.
//! The nodes are then quantized into records, packed into chunk files (see `chunk`), and
//! each file's sha256 goes into the manifest.
//!
//! Paths:
//! - preflop: `preflop/<config_id>/<solution_id>/manifest.json` and
//!   `.../chunks/NNNN.bin.zst`, at most `MAX_CHUNKS` files;
//! - flop builds (S18): `builds/<config_id>/<pair>/<flop>/<build_id>/` holding
//!   `flop/<line>.bin.zst` and `runouts/<turn><river>/<line>.bin.zst`, one
//!   `write_tree_file` call per file.
//!
//! Lane W (writer) owns this file.

#![allow(
    unused_variables,
    dead_code,
    reason = "S14 red skeleton: lane W replaces the todo!() bodies"
)]

use gto_model::{ConfigId, NodeKey, PositionPair};

use crate::chunk::ChunkOptions;
use crate::error::LibraryError;
use crate::manifest::{FileRef, Manifest, ManifestConfig, Source};
use crate::record::SolvedNode;
use crate::store::ObjectSink;

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
    todo!("lane W: preflop path prefix")
}

/// Writes a preflop solution under `preflop_prefix(meta.config_id, meta.id)` and returns
/// the manifest it stored.
///
/// # Errors
///
/// `LibraryError::DuplicateKey`, `LibraryError::KeyHashCollision`, a node whose key names
/// another configuration or pair (`LibraryError::Manifest`), no nodes, more than
/// `MAX_CHUNKS` files, any quantization error, or the sink's error. Nothing is put when the
/// nodes are rejected.
pub fn write_preflop(
    sink: &mut dyn ObjectSink,
    meta: &SolutionMeta,
    nodes: &[SolvedNode],
    o: &ChunkOptions,
) -> Result<Manifest, LibraryError> {
    todo!("lane W: records, chunk files, sha256, manifest")
}

/// Writes one tree file of a flop build at `<prefix>/<path>` and returns its `FileRef`,
/// whose path is `path` (relative to the solution directory, as the manifest lists it).
///
/// # Errors
///
/// As `write_preflop` for the nodes, plus `LibraryError::InvalidPath` for a bad `path`.
pub fn write_tree_file(
    sink: &mut dyn ObjectSink,
    prefix: &str,
    path: &str,
    pair: PositionPair,
    nodes: &[SolvedNode],
    o: &ChunkOptions,
) -> Result<FileRef, LibraryError> {
    todo!("lane W: one tree file")
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
    todo!("lane W: duplicate and collision check")
}

#[cfg(test)]
mod tests {
    use gto_model::{ActionToken, Cbb, ConfigId, NodeKey, Position, PositionPair};

    use super::index_nodes;
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
}
