//! Node-read benchmark (R0.10, R2.7): one node read from an opened preflop solution through
//! `Reader::node`. Ids `node_read/warm_cache`, where the node's frame sits in the least
//! recently used (LRU) cache, and `node_read/cold_cache`, where a reader with a 0-byte cache
//! fetches and decompresses the frame on every read: the cost of a cache miss.
//!
//! Mechanism: a synthetic preflop tree (`gto_library::synthetic_tree`, seed 0, 256 dense
//! 169-hand nodes) is written with `write_preflop` into a `MemStore`, so no disk is timed,
//! and opened once per reader before the measurement, which checks the chunk's sha256 and
//! parses its directory. The routine reads the middle node's key: with the default cache the
//! first read decodes the frame and every later one decodes the record out of the cached
//! frame; with a 0-byte cache `ByteLru` serves the frame without keeping it, so every read
//! decompresses it again. The key passes through `black_box` so its hash is not hoisted.

#![forbid(unsafe_code)]

use std::hint::black_box;

use criterion::{Criterion, criterion_group, criterion_main};
use gto_library::synthetic::{SyntheticParams, synthetic_tree};
use gto_library::{
    ChunkOptions, DEFAULT_QUERY_CACHE_BYTES, ManifestConfig, MemStore, Reader, ReaderOptions,
    SolutionMeta, Source, preflop_prefix, write_preflop,
};
use gto_model::{NodeKey, v1_configs};

/// Nodes in the synthetic preflop solution.
const NODES: usize = 256;
/// A cache that keeps nothing, so every read is a miss.
const COLD_CACHE_BYTES: u64 = 0;
/// The synthetic solution's identifier and timestamp.
const SOLUTION_ID: &str = "00000000-0000-4000-8000-000000000001";
const CREATED_AT: &str = "2026-10-20T00:00:00Z";
/// A tree hash for synthetic data: 64 zero digits.
const SYNTHETIC_TREE_HASH_DIGITS: usize = 64;

/// Writes the synthetic solution into `store`; returns its prefix and the middle node's key.
fn write_solution(store: &mut MemStore) -> (String, NodeKey) {
    let tree = synthetic_tree(&SyntheticParams { nodes: NODES, ..SyntheticParams::default() });
    let key = tree[NODES / 2].key.clone();
    let config = v1_configs()
        .into_iter()
        .find(|config| config.config_id() == key.config_id)
        .expect("a synthetic tree uses a v1 configuration");
    let meta = SolutionMeta {
        id: SOLUTION_ID.to_owned(),
        source: Source::Reference,
        engine_version: "synthetic".to_owned(),
        config: ManifestConfig {
            format: config.format,
            table_size: config.table_size,
            stake: config.stake.label.clone(),
            depth_cbb: config.depth_cbb,
            straddle: config.straddle,
            ante_cbb: config.ante_cbb,
        },
        config_id: key.config_id.clone(),
        pair: key.pair,
        tree_hash: "0".repeat(SYNTHETIC_TREE_HASH_DIGITS),
        seed: None,
        iterations: None,
        exploitability_pct_pot: None,
        synthetic: true,
        created_at: CREATED_AT.to_owned(),
    };
    write_preflop(store, &meta, &tree, &ChunkOptions::default())
        .expect("the synthetic solution writes");
    (preflop_prefix(&key.config_id, SOLUTION_ID), key)
}

fn bench_node_read(c: &mut Criterion) {
    let mut store = MemStore::new();
    let (prefix, key) = write_solution(&mut store);
    let mut group = c.benchmark_group("node_read");
    let readers = [("warm_cache", DEFAULT_QUERY_CACHE_BYTES), ("cold_cache", COLD_CACHE_BYTES)];
    for (name, cache_bytes) in readers {
        let reader = Reader::new(store.clone(), ReaderOptions { cache_bytes });
        let handle = reader.open(&prefix).expect("the synthetic solution opens");
        reader.node(handle, &key).expect("the middle node reads");
        group.bench_function(name, |b| {
            b.iter(|| reader.node(handle, black_box(&key)).expect("the middle node reads"));
        });
    }
    group.finish();
}

criterion_group!(benches, bench_node_read);
criterion_main!(benches);
