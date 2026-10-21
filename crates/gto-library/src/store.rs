//! Storage behind traits (architecture decision record (ADR) 0019): the reader fetches
//! through `ObjectStore` and the writer puts through `ObjectSink`, so the S3 (Simple Storage
//! Service) adapter of S16 and S18 slots in without touching either. Paths are relative,
//! use forward slashes and never hold a `..` segment; both stores here reject anything else
//! with `LibraryError::InvalidPath`.
//!
//! - `FsStore`: files under a root directory.
//! - `MemStore`: an in-memory map for tests and benches; it is `Clone`, so a test can hand a
//!   copy to a fresh reader to simulate a restart.
//!
//! Lane R (reader) owns this file.

#![allow(
    unused_variables,
    dead_code,
    clippy::needless_pass_by_value,
    reason = "S14 red skeleton: lane R replaces the todo!() bodies"
)]

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use crate::error::LibraryError;

/// Read access to stored objects.
pub trait ObjectStore: Send + Sync {
    /// The whole object.
    ///
    /// # Errors
    ///
    /// `LibraryError::InvalidPath` for a bad path, `LibraryError::Io` when the object is
    /// missing or unreadable.
    fn get(&self, path: &str) -> Result<Vec<u8>, LibraryError>;

    /// `len` bytes of the object from `offset`.
    ///
    /// # Errors
    ///
    /// As `get`, plus `LibraryError::Io` when the range runs past the end of the object.
    fn get_range(&self, path: &str, offset: u64, len: u32) -> Result<Vec<u8>, LibraryError>;
}

/// Write access to stored objects. A put replaces any object at the path.
pub trait ObjectSink {
    /// Stores `bytes` at `path`.
    ///
    /// # Errors
    ///
    /// `LibraryError::InvalidPath` for a bad path, `LibraryError::Io` when the write fails.
    fn put(&mut self, path: &str, bytes: &[u8]) -> Result<(), LibraryError>;
}

/// Objects as files under a root directory.
#[derive(Clone, Debug)]
pub struct FsStore {
    root: PathBuf,
}

impl FsStore {
    /// A store rooted at an existing directory.
    ///
    /// # Errors
    ///
    /// `LibraryError::Io` when `root` is not a directory.
    pub fn new(root: impl Into<PathBuf>) -> Result<Self, LibraryError> {
        todo!("lane R: check the root directory")
    }

    /// The root directory.
    #[must_use]
    pub fn root(&self) -> &Path {
        &self.root
    }
}

impl ObjectStore for FsStore {
    fn get(&self, path: &str) -> Result<Vec<u8>, LibraryError> {
        todo!("lane R: read a file under the root")
    }

    fn get_range(&self, path: &str, offset: u64, len: u32) -> Result<Vec<u8>, LibraryError> {
        todo!("lane R: read a byte range")
    }
}

impl ObjectSink for FsStore {
    fn put(&mut self, path: &str, bytes: &[u8]) -> Result<(), LibraryError> {
        todo!("lane R: create parent directories and write")
    }
}

/// Objects in memory, keyed by path.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct MemStore {
    files: BTreeMap<String, Vec<u8>>,
}

impl MemStore {
    /// An empty store.
    #[must_use]
    pub fn new() -> Self {
        MemStore::default()
    }

    /// Every stored path, sorted.
    #[must_use]
    pub fn paths(&self) -> Vec<String> {
        todo!("lane R: list paths")
    }

    /// The bytes at `path`, if stored.
    #[must_use]
    pub fn bytes(&self, path: &str) -> Option<&[u8]> {
        todo!("lane R: borrow an object")
    }
}

impl ObjectStore for MemStore {
    fn get(&self, path: &str) -> Result<Vec<u8>, LibraryError> {
        todo!("lane R: copy an object out")
    }

    fn get_range(&self, path: &str, offset: u64, len: u32) -> Result<Vec<u8>, LibraryError> {
        todo!("lane R: copy a range out")
    }
}

impl ObjectSink for MemStore {
    fn put(&mut self, path: &str, bytes: &[u8]) -> Result<(), LibraryError> {
        todo!("lane R: validate the path and insert")
    }
}
