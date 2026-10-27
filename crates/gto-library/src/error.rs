//! The one error type of the library crate. Every module reports through it, so the four
//! S14 lanes (writer, reader, pack, manifest) share it without owning it; a lane that needs
//! a new variant asks the integrator.
//!
//! Mechanism before meaning: a function that decodes bytes without knowing their file
//! (`NodeRecord::decode`, `read_directory`, `decode_frame`) reports `Decode`, and the reader,
//! which knows the path, reports the same failure as `Corrupt` with that path attached.

use thiserror::Error;

/// Every failure the library reports. Messages are plain sentences and never contain
/// solution data beyond paths, hashes and node keys.
#[derive(Debug, Error)]
pub enum LibraryError {
    /// Reading or writing a stored object failed.
    #[error("input/output error on {path}: {source}")]
    Io {
        /// The object path, relative to the store root.
        path: String,
        /// The underlying error.
        source: std::io::Error,
    },
    /// Bytes that do not decode as library data, without a known file (see the module docs).
    #[error("malformed library bytes: {0}")]
    Decode(String),
    /// A stored file that does not decode, with its path.
    #[error("corrupt library file {path}: {reason}")]
    Corrupt {
        /// The object path.
        path: String,
        /// What failed to decode.
        reason: String,
    },
    /// A file whose sha256 differs from the manifest's.
    #[error("checksum mismatch on {path}: expected {expected}, found {actual}")]
    ChecksumMismatch {
        /// The object path.
        path: String,
        /// The sha256 the manifest lists.
        expected: String,
        /// The sha256 of the bytes read.
        actual: String,
    },
    /// A solution or build the reader has marked unavailable; S16 and S18 re-queue it.
    #[error("solution {prefix} is unavailable: {reason}")]
    Unavailable {
        /// The solution's path prefix.
        prefix: String,
        /// Why, for example the checksum mismatch that marked it.
        reason: String,
    },
    /// A manifest or file directory with a format version outside
    /// `SUPPORTED_FORMAT_VERSIONS`.
    #[error("format version {0} is not supported by this reader")]
    UnsupportedFormat(u32),
    /// Two different node keys of one solution with the same 64-bit key hash.
    #[error("node keys {first} and {second} share one key hash")]
    KeyHashCollision {
        /// The key written first.
        first: String,
        /// The key that collided with it.
        second: String,
    },
    /// The same node key given twice to one writer call.
    #[error("node key {0} is listed more than once")]
    DuplicateKey(String),
    /// A node key the opened solution does not hold.
    #[error("node {0} is not in this solution")]
    NodeNotFound(String),
    /// A handle this reader did not hand out.
    #[error("solution handle {0} was not opened by this reader")]
    UnknownHandle(u32),
    /// A number that cannot be quantized: not finite, negative, above one where a
    /// probability is expected, or a row that does not fit the record.
    #[error("cannot quantize: {0}")]
    Quantize(String),
    /// A manifest that does not parse or breaks a rule of the schema.
    #[error("invalid manifest: {0}")]
    Manifest(String),
    /// A store path that is empty, absolute, holds a backslash or a `..` segment, or names a
    /// Windows device such as `CON` or `nul.json`.
    #[error("invalid store path {0:?}: expected a relative path with forward slashes")]
    InvalidPath(String),
    /// A request the build writer cannot satisfy, such as more runouts than a flop has or
    /// a node with a hand space a suit permutation does not apply to (S18).
    #[error("invalid build request: {0}")]
    InvalidRequest(String),
    /// A `gto-model` value that failed its own checks.
    #[error(transparent)]
    Model(#[from] gto_model::ModelError),
}
