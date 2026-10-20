//! Node-read benchmark stub (R0.10, R2.7): a placeholder for reading one node from the
//! library. Bench id `node_read/stub`.
//!
//! S14 replaces this file with the real library format (A3): a node key resolved through the
//! manifest index and its record decoded from the chunk that holds it. Until that lands there
//! is no index and no record, so the routine looks one key up in a `HashMap` of synthetic
//! node records, the same shape of work (key in, record out) at a trivially small cost. The
//! stub exists so `just bench` and `scripts/bench-report.mjs` exercise the full three-target
//! path from day one; the report marks every id that ends in `/stub` with `stub: true`, so
//! nobody reads the number as a node read time.
//!
//! Mechanism: the map is built once before the measurement, and the routine looks up a key
//! passed through `black_box` so the compiler cannot hoist the hash out of the loop.

#![forbid(unsafe_code)]

use std::collections::HashMap;
use std::hint::black_box;

use criterion::{Criterion, criterion_group, criterion_main};

/// Synthetic node records in the placeholder index.
const NODE_COUNT: u64 = 4096;
/// The key the routine reads, somewhere in the middle of the index.
const PROBE_KEY: u64 = NODE_COUNT / 2;
/// A placeholder record: a uniform strategy over four actions.
const UNIFORM: [f32; 4] = [0.25; 4];

/// The placeholder index: one record per node key.
fn index() -> HashMap<u64, [f32; 4]> {
    (0..NODE_COUNT).map(|key| (key, UNIFORM)).collect()
}

fn bench_node_read(c: &mut Criterion) {
    let index = index();
    let mut group = c.benchmark_group("node_read");
    group.bench_function("stub", |b| {
        b.iter(|| index.get(&black_box(PROBE_KEY)).copied());
    });
    group.finish();
}

criterion_group!(benches, bench_node_read);
criterion_main!(benches);
