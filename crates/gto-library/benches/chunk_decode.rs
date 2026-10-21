//! Chunk-decode benchmark (R0.10, R2.7): one data frame of a library file decompressed and
//! every record in it decoded. Ids `chunk_decode/preflop_169`, a frame of dense 169-hand
//! preflop records, and `chunk_decode/postflop_1326_sparse`, a frame of flop records that
//! hold half of the live combos.
//!
//! Mechanism: a synthetic tree (`gto_library::synthetic_tree`, seed 0) is quantized and
//! encoded with `encode_file` at the writer's settings once, before the measurement, and
//! the file's directory locates its first data frame, about `CHUNK_TARGET_BYTES` of
//! records. The routine decompresses that frame with `decode_frame`, the step the reader
//! runs on a cache miss, and then decodes every record in it with `NodeRecord::decode`, so
//! the number is one frame's full cost; a reader decodes one record per read and so pays
//! less than this per node. The frame passes through `black_box` and the routine returns
//! the record count, so the compiler can neither hoist nor drop the work. The throughput is
//! the frame's decompressed bytes.

#![forbid(unsafe_code)]

use std::hint::black_box;

use criterion::{Criterion, Throughput, criterion_group, criterion_main};
use gto_library::synthetic::{SyntheticParams, TreeLayout, synthetic_tree};
use gto_library::{ChunkOptions, HandSpace, NodeRecord, decode_frame, encode_file, read_directory};

/// Nodes per synthetic tree: enough for several frames, of which the first is measured.
const NODES: usize = 64;
/// The share of the live combos a sparse flop record holds.
const SPARSE_RANGE_FRACTION: f64 = 0.5;

/// One compressed data frame and the length it decompresses to.
struct Frame {
    compressed: Vec<u8>,
    decompressed_len: u32,
}

/// The first data frame of the file the writer would produce for `params`.
fn first_frame(params: &SyntheticParams) -> Frame {
    let tree = synthetic_tree(params);
    let pair = tree.first().expect("a synthetic tree holds nodes").key.pair;
    let records: Vec<NodeRecord> = tree
        .iter()
        .map(|node| NodeRecord::from_solved(node, pair).expect("a synthetic node quantizes"))
        .collect();
    let file = encode_file(&records, &ChunkOptions::default()).expect("the records encode");
    let directory = read_directory(&file).expect("the file starts with its directory");
    let entry = directory.frames.first().expect("the file holds a data frame");
    let start = usize::try_from(entry.offset).expect("a frame offset fits in memory");
    let len = usize::try_from(entry.compressed_len).expect("a frame length fits in memory");
    Frame {
        compressed: file[start..start + len].to_vec(),
        decompressed_len: entry.decompressed_len,
    }
}

/// Decompresses the frame and decodes every record in it, returning the record count.
fn decode_chunk(frame: &Frame) -> usize {
    let bytes = decode_frame(&frame.compressed, frame.decompressed_len)
        .expect("a frame the writer encoded decompresses");
    let mut offset = 0;
    let mut count = 0;
    while offset < bytes.len() {
        let (_, used) =
            NodeRecord::decode(&bytes[offset..]).expect("a record the writer encoded decodes");
        assert!(used > 0, "a decoded record uses at least its header");
        offset += used;
        count += 1;
    }
    count
}

fn bench_chunk_decode(c: &mut Criterion) {
    let preflop = first_frame(&SyntheticParams { nodes: NODES, ..SyntheticParams::default() });
    let postflop = first_frame(&SyntheticParams {
        nodes: NODES,
        hand_space: HandSpace::Postflop1326,
        range_fraction: SPARSE_RANGE_FRACTION,
        layout: TreeLayout::FlopTree,
        ..SyntheticParams::default()
    });
    let mut group = c.benchmark_group("chunk_decode");
    for (name, frame) in [("preflop_169", &preflop), ("postflop_1326_sparse", &postflop)] {
        group.throughput(Throughput::Bytes(u64::from(frame.decompressed_len)));
        group.bench_function(name, |b| b.iter(|| decode_chunk(black_box(frame))));
    }
    group.finish();
}

criterion_group!(benches, bench_chunk_decode);
criterion_main!(benches);
