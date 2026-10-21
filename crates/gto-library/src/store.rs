//! Storage behind traits (architecture decision record (ADR) 0019): the reader fetches
//! through `ObjectStore` and the writer puts through `ObjectSink`, so the S3 (Simple Storage
//! Service) adapter of S16 and S18 slots in without touching either. Paths are relative,
//! use forward slashes, never hold a `..` segment and never name a Windows device such as
//! `CON` or `nul.json`; both stores here reject anything else with
//! `LibraryError::InvalidPath`.
//!
//! - `FsStore`: files under a root directory. A put writes a sibling temporary file and
//!   renames it over the target, so a reader never sees a half-written object.
//! - `MemStore`: an in-memory map for tests and benches; it is `Clone`, so a test can hand a
//!   copy to a fresh reader to simulate a restart.
//!
//! Lane R (reader) owns this file.

use std::collections::BTreeMap;
use std::fs::File;
use std::io::{self, ErrorKind, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use crate::error::LibraryError;

/// The suffix of the temporary file a put writes before renaming it into place.
const TEMP_SUFFIX: &str = ".partial";

/// Characters no path segment may hold: a backslash, a drive colon or a NUL.
const FORBIDDEN_CHARS: [char; 3] = ['\\', ':', '\0'];

/// The device names Windows resolves before the file system, whatever the case and whatever
/// extension follows: `CON`, `con.txt` and `nul.json` all name a device, not a file.
const RESERVED_DEVICE_NAMES: [&str; 22] = [
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

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

/// Checks a store path: every segment between forward slashes is a plain name (not empty,
/// `.` or `..`, none of `FORBIDDEN_CHARS`, not a reserved device name). That rules out an
/// empty path, an absolute path, a drive prefix, traversal and a Windows device, so no path
/// can leave the store root or reach a device.
fn check_path(path: &str) -> Result<(), LibraryError> {
    let plain = |segment: &str| {
        !segment.is_empty()
            && segment != "."
            && segment != ".."
            && !segment.contains(FORBIDDEN_CHARS)
            && !is_reserved_device_name(segment)
    };
    if path.split('/').all(plain) {
        Ok(())
    } else {
        Err(LibraryError::InvalidPath(path.to_owned()))
    }
}

/// True when the segment, or its stem before the first dot, is one of
/// `RESERVED_DEVICE_NAMES` in any case.
fn is_reserved_device_name(segment: &str) -> bool {
    let stem = segment.split_once('.').map_or(segment, |(stem, _)| stem);
    RESERVED_DEVICE_NAMES.iter().any(|name| name.eq_ignore_ascii_case(stem))
}

/// `LibraryError::Io` for `path`.
fn io_error(path: &str, source: io::Error) -> LibraryError {
    LibraryError::Io { path: path.to_owned(), source }
}

/// The error for a range that runs past the end of an object of `size` bytes.
fn past_end(path: &str, offset: u64, len: u32, size: u64) -> LibraryError {
    let message = format!("range {offset}+{len} runs past the end of a {size}-byte object");
    io_error(path, io::Error::new(ErrorKind::UnexpectedEof, message))
}

/// The byte range `offset..offset + len` as indexes, when it lies inside `size` bytes.
fn checked_range(offset: u64, len: u32, size: u64) -> Option<(usize, usize)> {
    let end = offset.checked_add(u64::from(len)).filter(|&end| end <= size)?;
    Some((usize::try_from(offset).ok()?, usize::try_from(end).ok()?))
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
        let root = root.into();
        let shown = root.display().to_string();
        let metadata = std::fs::metadata(&root).map_err(|source| io_error(&shown, source))?;
        if !metadata.is_dir() {
            let source =
                io::Error::new(ErrorKind::InvalidInput, "the store root is not a directory");
            return Err(io_error(&shown, source));
        }
        Ok(FsStore { root })
    }

    /// The root directory.
    #[must_use]
    pub fn root(&self) -> &Path {
        &self.root
    }

    /// The file behind a checked store path.
    fn file_path(&self, path: &str) -> Result<PathBuf, LibraryError> {
        check_path(path)?;
        Ok(self.root.join(path))
    }
}

impl ObjectStore for FsStore {
    fn get(&self, path: &str) -> Result<Vec<u8>, LibraryError> {
        let file = self.file_path(path)?;
        std::fs::read(file).map_err(|source| io_error(path, source))
    }

    fn get_range(&self, path: &str, offset: u64, len: u32) -> Result<Vec<u8>, LibraryError> {
        let mut file =
            File::open(self.file_path(path)?).map_err(|source| io_error(path, source))?;
        let size = file.metadata().map_err(|source| io_error(path, source))?.len();
        let (start, end) =
            checked_range(offset, len, size).ok_or_else(|| past_end(path, offset, len, size))?;
        let mut bytes = vec![0_u8; end - start];
        file.seek(SeekFrom::Start(offset)).map_err(|source| io_error(path, source))?;
        file.read_exact(&mut bytes).map_err(|source| io_error(path, source))?;
        Ok(bytes)
    }
}

impl ObjectSink for FsStore {
    fn put(&mut self, path: &str, bytes: &[u8]) -> Result<(), LibraryError> {
        let target = self.file_path(path)?;
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(|source| io_error(path, source))?;
        }
        let mut temp = target.clone().into_os_string();
        temp.push(TEMP_SUFFIX);
        std::fs::write(&temp, bytes).map_err(|source| io_error(path, source))?;
        std::fs::rename(&temp, &target).map_err(|source| io_error(path, source))
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
        self.files.keys().cloned().collect()
    }

    /// The bytes at `path`, if stored.
    #[must_use]
    pub fn bytes(&self, path: &str) -> Option<&[u8]> {
        self.files.get(path).map(Vec::as_slice)
    }

    /// The bytes at a checked path, or `LibraryError::Io` with `NotFound`.
    fn object(&self, path: &str) -> Result<&[u8], LibraryError> {
        check_path(path)?;
        self.bytes(path).ok_or_else(|| {
            io_error(path, io::Error::new(ErrorKind::NotFound, "no object at this path"))
        })
    }
}

impl ObjectStore for MemStore {
    fn get(&self, path: &str) -> Result<Vec<u8>, LibraryError> {
        self.object(path).map(<[u8]>::to_vec)
    }

    fn get_range(&self, path: &str, offset: u64, len: u32) -> Result<Vec<u8>, LibraryError> {
        let bytes = self.object(path)?;
        let size = u64::try_from(bytes.len()).unwrap_or(u64::MAX);
        let (start, end) =
            checked_range(offset, len, size).ok_or_else(|| past_end(path, offset, len, size))?;
        Ok(bytes[start..end].to_vec())
    }
}

impl ObjectSink for MemStore {
    fn put(&mut self, path: &str, bytes: &[u8]) -> Result<(), LibraryError> {
        check_path(path)?;
        self.files.insert(path.to_owned(), bytes.to_vec());
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::{MemStore, ObjectSink, ObjectStore, check_path};
    use crate::error::LibraryError;

    #[test]
    fn r2_7_check_path_rejects_windows_reserved_device_names() {
        for bad in ["CON", "nul.json", "chunks/COM1.bin.zst", "prn/x.bin", "Lpt9.bin.zst"] {
            assert!(matches!(check_path(bad), Err(LibraryError::InvalidPath(_))), "{bad:?}");
        }
        for good in ["console", "nullable.json", "chunks/0001.bin.zst", "com10.bin", "aux1"] {
            check_path(good).unwrap_or_else(|err| panic!("{good:?} is a plain path: {err}"));
        }
    }

    #[test]
    fn r2_7_mem_store_rejects_windows_reserved_device_names() {
        let mut store = MemStore::new();
        for bad in ["CON", "nul.json", "chunks/COM1.bin.zst"] {
            assert!(matches!(store.put(bad, b"x"), Err(LibraryError::InvalidPath(_))), "{bad:?}");
            assert!(matches!(store.get(bad), Err(LibraryError::InvalidPath(_))), "{bad:?}");
        }
        store.put("chunks/0001.bin.zst", b"x").expect("a plain path stores");
        assert_eq!(store.paths(), vec!["chunks/0001.bin.zst".to_owned()]);
    }
}
