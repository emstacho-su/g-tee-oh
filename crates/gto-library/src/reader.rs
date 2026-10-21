//! The reader (R2.7, A3 section 5). Mechanism, in the order a request meets it:
//!
//! 1. `open(prefix)` reads `<prefix>/manifest.json` through `Manifest::from_json`, which
//!    rejects a format version outside `SUPPORTED_FORMAT_VERSIONS`. For a preflop solution
//!    it then fetches every chunk file, checks its sha256 against the manifest and parses its
//!    directory, because the key index spans all chunks. No data frame is decoded.
//! 2. A flop build's `open` reads only the manifest. A node key routes to its file: the flop
//!    street to the line's `flop_file`, the turn and river to the runout of the key's turn
//!    and river cards for the line. Each file is checksummed and its directory parsed on its
//!    first use.
//! 3. `node(handle, key)` hashes the key, finds its record entry, takes the decoded frame
//!    from the cache or fetches and decodes it (outside the state lock), and decodes the
//!    record into a `NodeView`.
//! 4. A checksum mismatch marks the whole solution unavailable: `open` or `node` returns
//!    `LibraryError::Unavailable` naming the expected and actual digests, every later read
//!    of that solution is refused, and `unavailable()` lists it for S16 and S18 to re-queue.
//!    Nothing is remembered across a restart, so a fresh reader checks again.
//!
//! Lane R (reader) owns this file.

#![allow(
    unused_variables,
    dead_code,
    clippy::needless_pass_by_value,
    reason = "S14 red skeleton: lane R replaces the todo!() bodies"
)]

use std::sync::Mutex;

use gto_model::NodeKey;

use crate::DEFAULT_QUERY_CACHE_BYTES;
use crate::error::LibraryError;
use crate::store::ObjectStore;
use crate::view::NodeView;

/// Reader settings.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ReaderOptions {
    /// The bound on decoded frames held in memory, `QUERY_CACHE_BYTES`.
    pub cache_bytes: u64,
}

impl Default for ReaderOptions {
    /// `DEFAULT_QUERY_CACHE_BYTES`, the Mac's 2 GiB.
    fn default() -> Self {
        ReaderOptions { cache_bytes: DEFAULT_QUERY_CACHE_BYTES }
    }
}

/// An opened solution, valid for the reader that opened it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct SolutionHandle(u32);

/// Whether an opened solution can serve reads.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Availability {
    /// Every file checked so far matched its checksum.
    Available,
    /// A file failed its checksum or did not decode.
    Unavailable {
        /// The file that failed, as a store path.
        path: String,
        /// Why, naming the expected and actual digests for a mismatch.
        reason: String,
    },
}

/// The reader's mutable state: opened solutions, the unavailable list and the frame cache.
/// Lane R defines its fields.
struct ReaderState {}

/// Serves node reads from stored solutions. Shared across threads: the state sits behind a
/// mutex, and frame decoding happens outside it.
pub struct Reader<S: ObjectStore> {
    store: S,
    options: ReaderOptions,
    state: Mutex<ReaderState>,
}

impl<S: ObjectStore> Reader<S> {
    /// A reader over `store` with nothing opened and an empty cache.
    #[must_use]
    pub fn new(store: S, o: ReaderOptions) -> Self {
        todo!("lane R: empty state")
    }

    /// Opens the solution at `prefix` (see the module docs for what is checked).
    ///
    /// # Errors
    ///
    /// `LibraryError::Unavailable` for a checksum mismatch, now or recorded earlier;
    /// `LibraryError::UnsupportedFormat`, `LibraryError::Manifest`, `LibraryError::Corrupt`
    /// or `LibraryError::Io` when the manifest or a file cannot be read.
    pub fn open(&self, prefix: &str) -> Result<SolutionHandle, LibraryError> {
        todo!("lane R: manifest, version, sha256 and directories")
    }

    /// Reads one node, decoding its frame through the cache.
    ///
    /// # Errors
    ///
    /// `LibraryError::UnknownHandle`, `LibraryError::Unavailable` for an unavailable
    /// solution, `LibraryError::NodeNotFound` for a key the solution does not hold,
    /// `LibraryError::Corrupt` or `LibraryError::Io` for a frame that cannot be read.
    pub fn node(&self, h: SolutionHandle, key: &NodeKey) -> Result<NodeView, LibraryError> {
        todo!("lane R: lazy frame decode via the cache")
    }

    /// Whether the solution can serve reads; `Unavailable` for an unknown handle too.
    #[must_use]
    pub fn availability(&self, h: SolutionHandle) -> Availability {
        todo!("lane R: availability")
    }

    /// Every solution marked unavailable, as (prefix, reason), in the order marked.
    #[must_use]
    pub fn unavailable(&self) -> Vec<(String, String)> {
        todo!("lane R: the re-queue list for S16 and S18")
    }

    /// The bytes of decoded frames the cache holds now.
    #[must_use]
    pub fn cache_used_bytes(&self) -> u64 {
        todo!("lane R: cache total")
    }
}
