//! Solutions library: stores solved spots and serves them by key, so every request path
//! reads a prebuilt solution instead of starting a solve (ADR 0018, library-first).
//!
//! The crate depends on `gto-model` only within the workspace. Solutions enter and leave it
//! as `gto-model` types, so the writers (`library-builder`, `validate`, `library-pack`)
//! combine it with `gto-solve` while `solver-query` links it without any path to a solver.
//! Because the edge to `gto-solve` does not exist here, no Cargo feature unification can add
//! it (O-101); `just rust-boundary` checks the workspace graph to keep it that way.
//!
//! The format (R2.7, A3 sections 2 to 5; S14 decisions O-129 and O-130), from the bytes up:
//!
//! - `quantize`: 8-bit frequencies at 1/255, 16-bit reach at 1/65535 and 16-bit loss units
//!   of 0.01% of the pot, saturating at 655.35%.
//! - `record`: the little-endian node record and the solved node it is quantized from;
//!   `view` reads a decoded record back as numbers.
//! - `key_hash`: the 64-bit xxhash (xxh64, seed 0) of the node-key text.
//! - `chunk`: one `.bin.zst` file is a zstd skippable frame holding a directory (frame table
//!   and key hash to frame and offset) followed by data frames of about
//!   `CHUNK_TARGET_BYTES` of records each.
//! - `checksum`: the sha256 of every file, checked the first time it is opened.
//! - `manifest`: the serde mirror of `schemas/manifest.schema.json`.
//! - `store`: storage behind the `ObjectStore` and `ObjectSink` traits (ADR 0019).
//! - `writer`: solved nodes to chunk files plus a manifest.
//! - `cache` and `reader`: lazy frame decoding through a least recently used (LRU) cache
//!   bounded by `QUERY_CACHE_BYTES`, with a build marked unavailable on a checksum mismatch.
//! - `synthetic` (feature `synthetic`): seeded synthetic trees for tests, benches and the
//!   size estimate.

#![forbid(unsafe_code)]

pub mod cache;
pub mod checksum;
pub mod chunk;
pub mod error;
pub mod key_hash;
pub mod manifest;
pub mod quantize;
pub mod reader;
pub mod record;
pub mod store;
#[cfg(feature = "synthetic")]
pub mod synthetic;
pub mod view;
pub mod writer;

pub use cache::ByteLru;
pub use checksum::{sha256_hex, verify_sha256};
pub use chunk::{
    ChunkOptions, FileDirectory, FrameEntry, RecordEntry, decode_frame, encode_file, read_directory,
};
pub use error::LibraryError;
pub use key_hash::key_hash;
pub use manifest::{
    ChunkRef, FileRef, LineEntry, MANIFEST_FILE, MANIFEST_SCHEMA, MAX_CHUNKS, Manifest,
    ManifestConfig, ManifestKind, Runout, Source, TurnRoot,
};
pub use quantize::{
    dequantize_frequencies, dequantize_reach, loss_bb, loss_units, quantize_frequencies,
    quantize_reach,
};
pub use reader::{Availability, Reader, ReaderOptions, SolutionHandle};
pub use record::{HandSpace, NodeRecord, RecordAction, SolvedHand, SolvedNode};
pub use store::{FsStore, MemStore, ObjectSink, ObjectStore};
#[cfg(feature = "synthetic")]
pub use synthetic::{SyntheticParams, synthetic_tree};
pub use view::NodeView;
pub use writer::{SolutionMeta, preflop_prefix, write_preflop, write_tree_file};

/// The crate's package name, used by the workspace link tests (R0.1).
pub const CRATE_NAME: &str = "gto-library";

/// The library format this crate writes, carried by every manifest and file directory.
pub const FORMAT_VERSION: u32 = 1;

/// The format versions a reader accepts: N and N-1 (A3 section 5). Version 0 never existed,
/// so in v1 the N-1 rule adds nothing; `library-migrate` arrives in v1.5.
pub const SUPPORTED_FORMAT_VERSIONS: [u32; 1] = [FORMAT_VERSION];

/// The default bound on decoded frames held in memory: 2 GiB, the Mac's `QUERY_CACHE_BYTES`
/// (A3 section 5). Deploy 1 runs at 1 GiB through `ReaderOptions` (R-9, 09 section 8).
pub const DEFAULT_QUERY_CACHE_BYTES: u64 = 2 * 1024 * 1024 * 1024;

/// Uncompressed record bytes per data frame, about 64 KiB; a record is never split (O-129).
pub const CHUNK_TARGET_BYTES: usize = 64 * 1024;

/// The largest frame a reader decodes, 16 MiB, so an oversized or hostile frame header
/// cannot make it allocate without bound.
pub const MAX_FRAME_BYTES: u32 = 16 * 1024 * 1024;

/// The zstd level the writer uses (O-129); decoding speed does not depend on it.
pub const ZSTD_LEVEL: i32 = 19;

#[cfg(test)]
mod tests {
    use super::CRATE_NAME;

    #[test]
    fn r0_1_gto_library_links() {
        assert_eq!(CRATE_NAME, env!("CARGO_PKG_NAME"));
        // The edge to gto-model is real: this symbol resolves only through that crate.
        assert_eq!(gto_model::CRATE_NAME, "gto-model");
    }
}
