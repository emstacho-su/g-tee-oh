//! Chunk-decode benchmark stub (R0.10, R2.7): a placeholder for decoding one library chunk.
//! Bench id `chunk_decode/stub`.
//!
//! S14 replaces this file with the real library format (A3): one zstd-compressed chunk
//! decoded into node records. Until that lands there is no chunk and no decoder, so the
//! routine copies a 64 KiB zero buffer through `std::io::Read`, the same shape of work
//! (bytes in, bytes out) at a trivially small cost. The stub exists so `just bench` and
//! `scripts/bench-report.mjs` exercise the full three-target path from day one; the report
//! marks every id that ends in `/stub` with `stub: true`, so nobody reads the number as a
//! decode time.
//!
//! Mechanism: `iter_batched` hands the routine a fresh source and destination buffer per
//! batch, so neither allocation is timed; the routine reads the whole source into the
//! destination through the `Read` trait and returns the destination so its drop is not timed.

#![forbid(unsafe_code)]

use std::io::Read;

use criterion::{BatchSize, Criterion, criterion_group, criterion_main};

/// Size of the placeholder chunk: 64 KiB, the chunk size A3 sketches.
const CHUNK_BYTES: usize = 64 * 1024;

/// Two zeroed buffers of one chunk each: the source to read and the destination to fill.
fn buffers() -> (Vec<u8>, Vec<u8>) {
    (vec![0u8; CHUNK_BYTES], vec![0u8; CHUNK_BYTES])
}

/// Copies the source into the destination through `std::io::Read`.
fn copy_chunk((source, mut destination): (Vec<u8>, Vec<u8>)) -> Vec<u8> {
    let mut reader: &[u8] = &source;
    reader
        .read_exact(&mut destination)
        .expect("a chunk-sized source fills a chunk-sized destination");
    destination
}

fn bench_chunk_decode(c: &mut Criterion) {
    let mut group = c.benchmark_group("chunk_decode");
    group.bench_function("stub", |b| {
        b.iter_batched(buffers, copy_chunk, BatchSize::SmallInput);
    });
    group.finish();
}

criterion_group!(benches, bench_chunk_decode);
criterion_main!(benches);
