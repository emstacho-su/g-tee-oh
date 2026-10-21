//! The chunk file container (R2.7, O-129). Every `.bin.zst` file of the library is:
//!
//! 1. one zstd skippable frame (magic `0x184D2A50`, then a little-endian `u32` length) whose
//!    payload is the file directory: magic `GTOL`, `format_version u32`, the frame table
//!    (`n_frames u32`, then `offset u64`, `compressed_len u32`, `decompressed_len u32` per
//!    data frame) and the record table (`n_records u32`, then `key_hash u64`, `frame u32`,
//!    `offset u32` per record, sorted by hash);
//! 2. data frames, each an ordinary zstd frame of about `ChunkOptions::target_bytes` of
//!    encoded records. A record is never split across frames, and the frames follow the
//!    directory frame back to back.
//!
//! Standard zstd tools skip the directory frame and still decompress the records. The reader
//! parses the directory when it first opens a file, together with the sha256 check, and
//! decodes data frames lazily, each capped at `MAX_FRAME_BYTES`.
//!
//! Lane W (writer) owns this file and `le_reader`, the bounds-checked little-endian cursor
//! the directory parser and the record decoder share.

mod le_reader;

use crate::error::LibraryError;
use crate::record::NodeRecord;
use crate::{CHUNK_TARGET_BYTES, MAX_FRAME_BYTES, SUPPORTED_FORMAT_VERSIONS, ZSTD_LEVEL};

pub(crate) use le_reader::LeReader;

/// The magic at the start of the directory payload.
pub const DIRECTORY_MAGIC: [u8; 4] = *b"GTOL";

/// The zstd skippable-frame magic the directory frame uses (the first of the sixteen).
pub const SKIPPABLE_FRAME_MAGIC: u32 = 0x184D_2A50;

/// A skippable frame's header: the magic and the payload length, four bytes each.
const SKIPPABLE_HEADER_BYTES: usize = 8;
/// The directory's fixed fields: magic, format version, frame count and record count.
const DIRECTORY_FIXED_BYTES: usize = 16;
/// One frame table entry: offset `u64`, compressed and decompressed lengths `u32`.
const FRAME_ENTRY_BYTES: usize = 16;
/// One record table entry: key hash `u64`, frame `u32`, offset `u32`.
const RECORD_ENTRY_BYTES: usize = 16;

/// How a file is cut into frames and compressed.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ChunkOptions {
    /// Uncompressed record bytes per data frame; a frame closes before it would exceed this,
    /// unless it holds a single record larger than the target. Targets above
    /// `MAX_FRAME_BYTES` are treated as `MAX_FRAME_BYTES`.
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
        let at = self.records.binary_search_by_key(&key_hash, |entry| entry.key_hash).ok()?;
        self.records.get(at).copied()
    }
}

/// The uncompressed bytes of one data frame and the records in it.
#[derive(Default)]
struct RawFrame {
    bytes: Vec<u8>,
    /// (key hash, offset in `bytes`) per record, in frame order.
    records: Vec<(u64, u32)>,
}

/// Encodes records into one file: the directory frame, then the data frames in input order.
///
/// # Errors
///
/// `LibraryError::Quantize` when a record does not encode; `LibraryError::Decode` when a
/// table would overflow its `u32` fields, a frame would exceed `MAX_FRAME_BYTES`, or two
/// records share a key hash; `LibraryError::Io` when zstd fails.
pub fn encode_file(records: &[NodeRecord], opts: &ChunkOptions) -> Result<Vec<u8>, LibraryError> {
    let raw = cut_frames(records, opts)?;
    let compressed =
        raw.iter()
            .map(|frame| {
                zstd::bulk::compress(&frame.bytes, opts.zstd_level).map_err(|source| {
                    LibraryError::Io { path: "(zstd compression of a data frame)".into(), source }
                })
            })
            .collect::<Result<Vec<Vec<u8>>, LibraryError>>()?;
    let entries = record_entries(&raw)?;
    let payload_len =
        DIRECTORY_FIXED_BYTES + FRAME_ENTRY_BYTES * raw.len() + RECORD_ENTRY_BYTES * entries.len();
    let frames = frame_entries(&raw, &compressed, SKIPPABLE_HEADER_BYTES + payload_len)?;
    let data_len: usize = compressed.iter().map(Vec::len).sum();
    let mut file = Vec::with_capacity(SKIPPABLE_HEADER_BYTES + payload_len + data_len);
    file.extend_from_slice(&SKIPPABLE_FRAME_MAGIC.to_le_bytes());
    file.extend_from_slice(&to_u32(payload_len, "the directory length")?.to_le_bytes());
    file.extend_from_slice(&DIRECTORY_MAGIC);
    file.extend_from_slice(&crate::FORMAT_VERSION.to_le_bytes());
    file.extend_from_slice(&to_u32(frames.len(), "the frame count")?.to_le_bytes());
    for frame in &frames {
        file.extend_from_slice(&frame.offset.to_le_bytes());
        file.extend_from_slice(&frame.compressed_len.to_le_bytes());
        file.extend_from_slice(&frame.decompressed_len.to_le_bytes());
    }
    file.extend_from_slice(&to_u32(entries.len(), "the record count")?.to_le_bytes());
    for entry in &entries {
        file.extend_from_slice(&entry.key_hash.to_le_bytes());
        file.extend_from_slice(&entry.frame.to_le_bytes());
        file.extend_from_slice(&entry.offset.to_le_bytes());
    }
    for frame in &compressed {
        file.extend_from_slice(frame);
    }
    Ok(file)
}

/// Encodes the records into frames of at most the target size (one record minimum).
fn cut_frames(records: &[NodeRecord], opts: &ChunkOptions) -> Result<Vec<RawFrame>, LibraryError> {
    let cap = usize::try_from(MAX_FRAME_BYTES).unwrap_or(usize::MAX);
    let target = opts.target_bytes.min(cap);
    let mut frames = Vec::new();
    let mut current = RawFrame::default();
    for record in records {
        if !current.bytes.is_empty() && current.bytes.len() + record.encoded_len() > target {
            frames.push(std::mem::take(&mut current));
        }
        let offset = to_u32(current.bytes.len(), "a record offset")?;
        record.encode(&mut current.bytes)?;
        current.records.push((record.key_hash, offset));
    }
    if !current.bytes.is_empty() {
        frames.push(current);
    }
    match frames.iter().find(|frame| frame.bytes.len() > cap) {
        Some(frame) => Err(LibraryError::Decode(format!(
            "a {}-byte frame exceeds the {MAX_FRAME_BYTES}-byte cap readers apply",
            frame.bytes.len()
        ))),
        None => Ok(frames),
    }
}

/// The record table, sorted by key hash, rejecting a hash that appears twice.
fn record_entries(raw: &[RawFrame]) -> Result<Vec<RecordEntry>, LibraryError> {
    let mut entries = Vec::new();
    for (index, frame) in raw.iter().enumerate() {
        let frame_index = to_u32(index, "a frame index")?;
        entries.extend(frame.records.iter().map(|&(key_hash, offset)| RecordEntry {
            key_hash,
            frame: frame_index,
            offset,
        }));
    }
    entries.sort_by_key(|entry| entry.key_hash);
    match entries.windows(2).find(|pair| pair[0].key_hash == pair[1].key_hash) {
        Some(pair) => Err(LibraryError::Decode(format!(
            "two records share key hash {:016x}",
            pair[0].key_hash
        ))),
        None => Ok(entries),
    }
}

/// The frame table: frames laid back to back from `data_start`.
fn frame_entries(
    raw: &[RawFrame],
    compressed: &[Vec<u8>],
    data_start: usize,
) -> Result<Vec<FrameEntry>, LibraryError> {
    let mut offset = u64::try_from(data_start).map_err(|_| overflow("the data offset"))?;
    let mut frames = Vec::with_capacity(raw.len());
    for (frame, bytes) in raw.iter().zip(compressed) {
        let compressed_len = to_u32(bytes.len(), "a compressed frame length")?;
        let decompressed_len = to_u32(frame.bytes.len(), "a frame length")?;
        frames.push(FrameEntry { offset, compressed_len, decompressed_len });
        offset += u64::from(compressed_len);
    }
    Ok(frames)
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
    let mut outer = LeReader::new(file);
    let magic = outer.u32("the directory frame magic")?;
    if magic != SKIPPABLE_FRAME_MAGIC {
        return Err(LibraryError::Decode(format!(
            "the file starts with {magic:#010x}, not the directory frame magic"
        )));
    }
    let payload_len = outer.u32("the directory length")?;
    let payload_len = usize::try_from(payload_len).map_err(|_| overflow("the directory"))?;
    let mut reader = LeReader::new(outer.take(payload_len, "the directory")?);
    if reader.take(DIRECTORY_MAGIC.len(), "the directory magic")? != DIRECTORY_MAGIC {
        return Err(LibraryError::Decode("the directory magic is not GTOL".into()));
    }
    let format_version = reader.u32("the format version")?;
    if !SUPPORTED_FORMAT_VERSIONS.contains(&format_version) {
        return Err(LibraryError::UnsupportedFormat(format_version));
    }
    let frames = read_frames(&mut reader)?;
    let records = read_records(&mut reader)?;
    if reader.remaining() != 0 {
        return Err(LibraryError::Decode("the directory has trailing bytes".into()));
    }
    check_frames(&frames, outer.position(), file.len())?;
    check_records(&records, &frames)?;
    Ok(FileDirectory { format_version, frames, records })
}

/// The frame table, after its count.
fn read_frames(reader: &mut LeReader<'_>) -> Result<Vec<FrameEntry>, LibraryError> {
    let count = reader.count(FRAME_ENTRY_BYTES, "the frame table")?;
    let mut table = LeReader::new(reader.take(count * FRAME_ENTRY_BYTES, "the frame table")?);
    (0..count)
        .map(|_| {
            Ok(FrameEntry {
                offset: table.u64("a frame offset")?,
                compressed_len: table.u32("a compressed frame length")?,
                decompressed_len: table.u32("a frame length")?,
            })
        })
        .collect()
}

/// The record table, after its count.
fn read_records(reader: &mut LeReader<'_>) -> Result<Vec<RecordEntry>, LibraryError> {
    let count = reader.count(RECORD_ENTRY_BYTES, "the record table")?;
    let mut table = LeReader::new(reader.take(count * RECORD_ENTRY_BYTES, "the record table")?);
    (0..count)
        .map(|_| {
            Ok(RecordEntry {
                key_hash: table.u64("a key hash")?,
                frame: table.u32("a record frame")?,
                offset: table.u32("a record offset")?,
            })
        })
        .collect()
}

/// Frames must follow the directory back to back, inside the file, under the frame cap.
fn check_frames(
    frames: &[FrameEntry],
    data_start: usize,
    file_len: usize,
) -> Result<(), LibraryError> {
    let file_len = u64::try_from(file_len).map_err(|_| overflow("the file length"))?;
    let mut expected = u64::try_from(data_start).map_err(|_| overflow("the data offset"))?;
    for frame in frames {
        let end = frame.offset.checked_add(u64::from(frame.compressed_len));
        let Some(end) = end.filter(|end| frame.offset == expected && *end <= file_len) else {
            return Err(LibraryError::Decode(format!(
                "a frame at {} of {} bytes does not follow on at {expected} inside the file",
                frame.offset, frame.compressed_len
            )));
        };
        if frame.decompressed_len > MAX_FRAME_BYTES {
            return Err(LibraryError::Decode(format!(
                "a frame of {} bytes exceeds the {MAX_FRAME_BYTES}-byte cap",
                frame.decompressed_len
            )));
        }
        expected = end;
    }
    Ok(())
}

/// Records must be strictly sorted by hash and point inside their frame.
fn check_records(records: &[RecordEntry], frames: &[FrameEntry]) -> Result<(), LibraryError> {
    if records.windows(2).any(|pair| pair[0].key_hash >= pair[1].key_hash) {
        return Err(LibraryError::Decode("the record table is not strictly sorted".into()));
    }
    let outside = records.iter().find(|entry| {
        usize::try_from(entry.frame)
            .ok()
            .and_then(|index| frames.get(index))
            .is_none_or(|frame| entry.offset >= frame.decompressed_len)
    });
    match outside {
        Some(entry) => Err(LibraryError::Decode(format!(
            "record {:016x} points outside its frame",
            entry.key_hash
        ))),
        None => Ok(()),
    }
}

/// Decompresses one data frame, which must decode to exactly `expected_len` bytes.
///
/// # Errors
///
/// `LibraryError::Decode` when `expected_len` exceeds `MAX_FRAME_BYTES`, when zstd fails, or
/// when the output length differs from `expected_len`.
pub fn decode_frame(compressed: &[u8], expected_len: u32) -> Result<Vec<u8>, LibraryError> {
    if expected_len > MAX_FRAME_BYTES {
        return Err(LibraryError::Decode(format!(
            "a frame of {expected_len} bytes exceeds the {MAX_FRAME_BYTES}-byte cap"
        )));
    }
    let capacity = usize::try_from(expected_len).map_err(|_| overflow("a frame length"))?;
    let bytes = zstd::bulk::decompress(compressed, capacity).map_err(|error| {
        LibraryError::Decode(format!("a data frame does not decompress: {error}"))
    })?;
    if bytes.len() == capacity {
        Ok(bytes)
    } else {
        Err(LibraryError::Decode(format!(
            "a data frame decoded to {} bytes, not the {expected_len} its directory lists",
            bytes.len()
        )))
    }
}

/// `value` as a `u32` table field.
fn to_u32(value: usize, what: &str) -> Result<u32, LibraryError> {
    u32::try_from(value).map_err(|_| overflow(what))
}

fn overflow(what: &str) -> LibraryError {
    LibraryError::Decode(format!("{what} does not fit its field"))
}
