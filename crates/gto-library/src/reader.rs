//! The reader (R2.7, A3 section 5). Mechanism, in the order a request meets it:
//!
//! 1. `open(prefix)` reads `<prefix>/manifest.json` through `Manifest::from_json`, which
//!    rejects a format version outside `SUPPORTED_FORMAT_VERSIONS`. For a preflop solution
//!    it then fetches every chunk file, checks its sha256 against the manifest and parses its
//!    directory, because the key index spans all chunks. No data frame is decoded.
//! 2. A flop build's `open` reads only the manifest. A node key routes to its file: the flop
//!    street to the line's `flop_file`, the turn and river to the runout of the key's turn
//!    and river cards for the line (a turn key takes the first runout listed with its turn).
//!    Each file is checksummed and its directory parsed on its first use.
//! 3. `node(handle, key)` hashes the key, finds its record entry, takes the decoded frame
//!    from the cache or fetches and decodes it (outside the state lock), and decodes the
//!    record into a `NodeView`.
//! 4. A checksum mismatch, or a file that does not decode, marks the whole solution
//!    unavailable: `open` or `node` returns `LibraryError::Unavailable` naming the expected
//!    and actual digests, every later read of that solution is refused, and `unavailable()`
//!    lists it for S16 and S18 to re-queue. Nothing is remembered across a restart, so a
//!    fresh reader checks again. An input/output error marks nothing, since it may pass.
//!
//! Lane R (reader) owns this file.

mod routes;

use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use gto_model::NodeKey;

use crate::cache::ByteLru;
use crate::checksum::verify_sha256;
use crate::chunk::{FileDirectory, FrameEntry, decode_frame, read_directory};
use crate::error::LibraryError;
use crate::key_hash::key_hash;
use crate::manifest::{MANIFEST_FILE, Manifest};
use crate::record::NodeRecord;
use crate::store::ObjectStore;
use crate::view::NodeView;
use crate::{DEFAULT_QUERY_CACHE_BYTES, SUPPORTED_FORMAT_VERSIONS};
use routes::{FileSlot, Planned, Routes, at_path, corrupt, index_u32, plan_files, route};

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

/// A cached frame: (solution handle, file index in the solution, frame index in the file).
type FrameKey = (u32, u32, u32);

/// Where a key's record lives: the solution prefix, the file index and the file.
type Located = Result<Option<(String, u32, FileSlot)>, LibraryError>;

/// One opened solution.
#[derive(Debug)]
struct Solution {
    prefix: String,
    files: Vec<FileSlot>,
    routes: Routes,
}

/// A solution marked unavailable: its prefix, the file that failed and why.
#[derive(Clone, Debug)]
struct Marked {
    prefix: String,
    path: String,
    reason: String,
}

/// The reader's mutable state: opened solutions, the unavailable list and the frame cache.
struct ReaderState {
    solutions: Vec<Solution>,
    unavailable: Vec<Marked>,
    cache: ByteLru<FrameKey>,
}

impl ReaderState {
    /// The mark on `prefix`, if any.
    fn marked(&self, prefix: &str) -> Option<&Marked> {
        self.unavailable.iter().find(|marked| marked.prefix == prefix)
    }

    /// `Unavailable` for a marked prefix.
    fn refuse(&self, prefix: &str) -> Result<(), LibraryError> {
        self.marked(prefix).map_or(Ok(()), |marked| {
            let (prefix, reason) = (marked.prefix.clone(), marked.reason.clone());
            Err(LibraryError::Unavailable { prefix, reason })
        })
    }
}

/// Serves node reads from stored solutions. Shared across threads: the state sits behind a
/// mutex, and fetching, checksumming and frame decoding happen outside it.
pub struct Reader<S: ObjectStore> {
    store: S,
    state: Mutex<ReaderState>,
}

impl<S: ObjectStore> Reader<S> {
    /// A reader over `store` with nothing opened and an empty cache.
    #[must_use]
    pub fn new(store: S, o: ReaderOptions) -> Self {
        let cache = ByteLru::new(o.cache_bytes);
        let state = ReaderState { solutions: Vec::new(), unavailable: Vec::new(), cache };
        Reader { store, state: Mutex::new(state) }
    }

    /// Opens the solution at `prefix` (see the module docs for what is checked). Opening a
    /// prefix again returns the handle it already has.
    ///
    /// # Errors
    ///
    /// `LibraryError::Unavailable` for a checksum mismatch, now or recorded earlier;
    /// `LibraryError::UnsupportedFormat`, `LibraryError::Manifest`, `LibraryError::Corrupt`
    /// or `LibraryError::Io` when the manifest or a file cannot be read.
    pub fn open(&self, prefix: &str) -> Result<SolutionHandle, LibraryError> {
        if let Some(found) = self.known(prefix)? {
            return Ok(found);
        }
        let manifest_path = format!("{prefix}/{MANIFEST_FILE}");
        let bytes = self.store.get(&manifest_path)?;
        let manifest = Manifest::from_json(&bytes).map_err(|err| at_path(&manifest_path, err))?;
        if !SUPPORTED_FORMAT_VERSIONS.contains(&manifest.format_version) {
            return Err(LibraryError::UnsupportedFormat(manifest.format_version));
        }
        let (files, routes) = match plan_files(prefix, &manifest)? {
            (files, Routes::Preflop(_)) => self.check_chunks(prefix, &files)?,
            (files, flop_build @ Routes::FlopBuild { .. }) => (files, flop_build),
        };
        if let Some(found) = self.known(prefix)? {
            return Ok(found);
        }
        let mut state = self.lock();
        let index = index_u32(prefix, state.solutions.len())?;
        state.solutions.push(Solution { prefix: prefix.to_owned(), files, routes });
        Ok(SolutionHandle(index))
    }

    /// Reads one node, decoding its frame through the cache.
    ///
    /// # Errors
    ///
    /// `LibraryError::UnknownHandle`, `LibraryError::Unavailable` for an unavailable
    /// solution, `LibraryError::NodeNotFound` for a key the solution does not hold,
    /// `LibraryError::Corrupt` or `LibraryError::Io` for a frame that cannot be read.
    pub fn node(&self, h: SolutionHandle, key: &NodeKey) -> Result<NodeView, LibraryError> {
        let hash = key_hash(key);
        let not_found = || LibraryError::NodeNotFound(key.to_string());
        let (prefix, file, slot) = self.locate(h, key, hash)?.ok_or_else(not_found)?;
        let directory = self.directory(h, &prefix, file, &slot)?;
        let entry = directory.find(hash).ok_or_else(not_found)?;
        let path = slot.path.as_str();
        let record = self.guarded(&prefix, path, || {
            let frame_entry = directory.frames.get(entry.frame as usize);
            let frame_entry =
                frame_entry.ok_or_else(|| corrupt(path, "a record names no frame"))?;
            let frame = self.frame((h.0, file, entry.frame), path, frame_entry)?;
            let start = usize::try_from(entry.offset).unwrap_or(usize::MAX);
            let bytes =
                frame.get(start..).ok_or_else(|| corrupt(path, "a record is past its frame"))?;
            let (record, _) = NodeRecord::decode(bytes).map_err(|err| at_path(path, err))?;
            if record.key_hash == hash {
                Ok(record)
            } else {
                Err(corrupt(path, "a record holds another key hash"))
            }
        })?;
        Ok(NodeView::from(record))
    }

    /// Whether the solution can serve reads; `Unavailable` for an unknown handle too.
    #[must_use]
    pub fn availability(&self, h: SolutionHandle) -> Availability {
        let state = self.lock();
        let Some(solution) = state.solutions.get(h.0 as usize) else {
            let reason = LibraryError::UnknownHandle(h.0).to_string();
            return Availability::Unavailable { path: String::new(), reason };
        };
        state.marked(&solution.prefix).map_or(Availability::Available, |marked| {
            Availability::Unavailable { path: marked.path.clone(), reason: marked.reason.clone() }
        })
    }

    /// Every solution marked unavailable, as (prefix, reason), in the order marked.
    #[must_use]
    pub fn unavailable(&self) -> Vec<(String, String)> {
        let state = self.lock();
        state.unavailable.iter().map(|m| (m.prefix.clone(), m.reason.clone())).collect()
    }

    /// The bytes of decoded frames the cache holds now.
    #[must_use]
    pub fn cache_used_bytes(&self) -> u64 {
        self.lock().cache.used_bytes()
    }

    /// The state. A panic while the lock was held cannot leave it half-updated, because
    /// every change is a single push, insert or assignment, so a poisoned lock is reused.
    fn lock(&self) -> MutexGuard<'_, ReaderState> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// The handle of an opened prefix, or `Unavailable` for a prefix marked earlier.
    fn known(&self, prefix: &str) -> Result<Option<SolutionHandle>, LibraryError> {
        let state = self.lock();
        state.refuse(prefix)?;
        let found = state.solutions.iter().position(|solution| solution.prefix == prefix);
        found.map(|index| index_u32(prefix, index).map(SolutionHandle)).transpose()
    }

    /// Runs `step` on the file at `path`. A checksum mismatch or a `Corrupt` file marks
    /// `prefix` unavailable and becomes `Unavailable`; other failures pass through.
    fn guarded<T>(
        &self,
        prefix: &str,
        path: &str,
        step: impl FnOnce() -> Result<T, LibraryError>,
    ) -> Result<T, LibraryError> {
        step().map_err(|err| {
            if !matches!(err, LibraryError::ChecksumMismatch { .. } | LibraryError::Corrupt { .. })
            {
                return err;
            }
            let reason = err.to_string();
            let mut state = self.lock();
            if state.marked(prefix).is_none() {
                let marked =
                    Marked { prefix: prefix.into(), path: path.into(), reason: reason.clone() };
                state.unavailable.push(marked);
            }
            LibraryError::Unavailable { prefix: prefix.to_owned(), reason }
        })
    }

    /// Fetches one file, checks its sha256, parses its directory and checks the directory's
    /// record count against the manifest's.
    fn check_file(&self, slot: &FileSlot) -> Result<Arc<FileDirectory>, LibraryError> {
        let bytes = self.store.get(&slot.path)?;
        verify_sha256(&slot.path, &bytes, &slot.sha256)?;
        let directory = read_directory(&bytes).map_err(|err| at_path(&slot.path, err))?;
        match slot.nodes {
            Some(nodes) if directory.records.len() != nodes as usize => {
                Err(corrupt(&slot.path, format!("the manifest lists {nodes} nodes")))
            }
            _ => Ok(Arc::new(directory)),
        }
    }

    /// Checks every chunk of a preflop solution and builds its key index.
    fn check_chunks(&self, prefix: &str, files: &[FileSlot]) -> Planned {
        let mut checked = Vec::with_capacity(files.len());
        let mut index = Vec::new();
        for (position, slot) in files.iter().enumerate() {
            let file = index_u32(prefix, position)?;
            let directory = self.guarded(prefix, &slot.path, || self.check_file(slot))?;
            index.extend(directory.records.iter().map(|entry| (entry.key_hash, file)));
            checked.push(FileSlot { directory: Some(directory), ..slot.clone() });
        }
        index.sort_unstable();
        if index.windows(2).any(|pair| pair[0].0 == pair[1].0) {
            let duplicate = || Err(corrupt(prefix, "two records share one key hash"));
            return self.guarded(prefix, prefix, duplicate);
        }
        Ok((checked, Routes::Preflop(index)))
    }

    /// The file a key routes to in `h`'s solution, or `None` when it cannot hold the key.
    fn locate(&self, h: SolutionHandle, key: &NodeKey, hash: u64) -> Located {
        let state = self.lock();
        let solution = state.solutions.get(h.0 as usize).ok_or(LibraryError::UnknownHandle(h.0))?;
        state.refuse(&solution.prefix)?;
        let found = route(&solution.routes, key, hash);
        Ok(found.map(|file| (solution.prefix.clone(), file, solution.files[file as usize].clone())))
    }

    /// A file's directory, checking the file on its first use and keeping the result.
    fn directory(
        &self,
        h: SolutionHandle,
        prefix: &str,
        file: u32,
        slot: &FileSlot,
    ) -> Result<Arc<FileDirectory>, LibraryError> {
        if let Some(directory) = &slot.directory {
            return Ok(Arc::clone(directory));
        }
        let directory = self.guarded(prefix, &slot.path, || self.check_file(slot))?;
        let mut state = self.lock();
        state.solutions[h.0 as usize].files[file as usize].directory = Some(Arc::clone(&directory));
        Ok(directory)
    }

    /// One decoded frame, from the cache or fetched and decoded outside the lock.
    fn frame(
        &self,
        k: FrameKey,
        path: &str,
        entry: &FrameEntry,
    ) -> Result<Arc<[u8]>, LibraryError> {
        if let Some(bytes) = self.lock().cache.get(&k) {
            return Ok(bytes);
        }
        let compressed = self.store.get_range(path, entry.offset, entry.compressed_len)?;
        let decoded = decode_frame(&compressed, entry.decompressed_len);
        let bytes: Arc<[u8]> = Arc::from(decoded.map_err(|err| at_path(path, err))?);
        self.lock().cache.insert(k, Arc::clone(&bytes));
        Ok(bytes)
    }
}
