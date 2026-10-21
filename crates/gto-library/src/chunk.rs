//! The chunk file container (R2.7, O-129). Every `.bin.zst` file of the library is:
//!
//! 1. one zstd skippable frame (magic `0x184D2A50`, then a little-endian `u32` length) whose
//!    payload is the file directory: magic `GTOL`, `format_version u32`, the frame table
//!    (`offset u64`, `compressed_len u32`, `decompressed_len u32` per data frame) and the
//!    record table (`key_hash u64`, `frame u32`, `offset u32` per record, sorted by hash);
//! 2. data frames, each an ordinary zstd frame of about `ChunkOptions::target_bytes` of
//!    encoded records. A record is never split across frames.
//!
//! Standard zstd tools skip the directory frame and still decompress the records. The reader
//! parses the directory when it first opens a file, together with the sha256 check, and
//! decodes data frames lazily, each capped at `MAX_FRAME_BYTES`.
//!
//! Lane W (writer) owns this file.

#![allow(unused_variables, reason = "S14 red skeleton: lane W replaces the todo!() bodies")]

use crate::error::LibraryError;
use crate::record::NodeRecord;
use crate::{CHUNK_TARGET_BYTES, ZSTD_LEVEL};

/// The magic at the start of the directory payload.
pub const DIRECTORY_MAGIC: [u8; 4] = *b"GTOL";

/// The zstd skippable-frame magic the directory frame uses (the first of the sixteen).
pub const SKIPPABLE_FRAME_MAGIC: u32 = 0x184D_2A50;

/// How a file is cut into frames and compressed.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ChunkOptions {
    /// Uncompressed record bytes per data frame; a frame closes before it would exceed this,
    /// unless it holds a single record larger than the target.
    pub target_bytes: usize,
    /// The zstd compression level.
    pub zstd_level: i32,
}

impl Default for ChunkOptions {
    /// `CHUNK_TARGET_BYTES` at `ZSTD_LEVEL`, the writer's settings (O-129).
    fn default() -> Self {
        ChunkOptions { target_bytes: CHUNK_TARGET_BYTES, zstd_level: ZSTD_LEVEL }
    }
}

/// One data frame in the file.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct FrameEntry {
    /// Byte offset of the frame from the start of the file.
    pub offset: u64,
    /// The frame's compressed length in bytes.
    pub compressed_len: u32,
    /// The frame's decompressed length in bytes.
    pub decompressed_len: u32,
}

/// Where one record lives.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RecordEntry {
    /// `key_hash` of the record's node key.
    pub key_hash: u64,
    /// Index into `FileDirectory::frames`.
    pub frame: u32,
    /// Byte offset of the record inside the decompressed frame.
    pub offset: u32,
}

/// The parsed directory frame of one file.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FileDirectory {
    /// The format version the file was written with.
    pub format_version: u32,
    /// The data frames in file order.
    pub frames: Vec<FrameEntry>,
    /// The records, sorted by `key_hash`.
    pub records: Vec<RecordEntry>,
}

impl FileDirectory {
    /// The record entry for a key hash, by binary search; `None` when absent.
    #[must_use]
    pub fn find(&self, key_hash: u64) -> Option<RecordEntry> {
        todo!("lane W: binary search on key_hash")
    }
}

/// Encodes records into one file: the directory frame, then the data frames in input order.
///
/// # Errors
///
/// `LibraryError::Quantize` when a record does not encode, `LibraryError::Decode` when a
/// table would overflow its `u32` fields, `LibraryError::Io` when zstd fails.
pub fn encode_file(records: &[NodeRecord], opts: &ChunkOptions) -> Result<Vec<u8>, LibraryError> {
    todo!("lane W: directory frame plus data frames")
}

/// Parses the directory frame at the start of a file. Every count and offset is checked
/// against the file length, so a malformed file is an error and never a panic.
///
/// # Errors
///
/// `LibraryError::Decode` for a missing or malformed directory frame or a frame that lies
/// outside the file; `LibraryError::UnsupportedFormat` for a version outside
/// `SUPPORTED_FORMAT_VERSIONS`.
pub fn read_directory(file: &[u8]) -> Result<FileDirectory, LibraryError> {
    todo!("lane W: bounds-checked directory parse")
}

/// Decompresses one data frame, which must decode to exactly `expected_len` bytes.
///
/// # Errors
///
/// `LibraryError::Decode` when `expected_len` exceeds `MAX_FRAME_BYTES`, when zstd fails, or
/// when the output length differs from `expected_len`.
pub fn decode_frame(compressed: &[u8], expected_len: u32) -> Result<Vec<u8>, LibraryError> {
    todo!("lane W: capped zstd decode")
}
