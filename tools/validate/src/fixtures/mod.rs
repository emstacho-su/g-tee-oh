//! Fixture files under `validation/fixtures/` and how they are read (R0.11).
//!
//! Every fixture is a JSON document with a `schema_version` field. Loading has two steps:
//! serde parses the document into a typed struct whose field set is closed
//! (`deny_unknown_fields`), so a stray or misspelled field fails the parse; then a
//! structural check runs on the parsed value, so a version mismatch or a dangling source
//! reference fails before any gate reads a number. The result is a fresh value; nothing
//! is mutated after parsing.

use std::fmt;
use std::path::{Path, PathBuf};

use serde::de::DeserializeOwned;

pub mod openspiel;
pub mod toy_game;

/// The schema version every fixture file in this directory carries today.
pub const SCHEMA_VERSION: u32 = 1;

/// Path of the fixture root relative to the repository root (A1 section 1).
pub const FIXTURES_RELATIVE_TO_REPO_ROOT: &str = "validation/fixtures";

/// Why a fixture could not be loaded. Every variant names the file.
#[derive(Debug)]
pub enum FixtureError {
    /// The file could not be read.
    Read {
        /// The fixture path.
        path: PathBuf,
        /// The underlying input/output error.
        source: std::io::Error,
    },
    /// The file is not valid JSON for the expected type.
    Parse {
        /// The fixture path.
        path: PathBuf,
        /// The serde error, with line and column.
        source: serde_json::Error,
    },
    /// The file parsed, but its `schema_version` is not the one this crate reads.
    SchemaVersion {
        /// The fixture path.
        path: PathBuf,
        /// The version this crate reads.
        expected: u32,
        /// The version the file carries.
        found: u32,
    },
    /// The file parsed, but a structural rule failed.
    Invalid {
        /// The fixture path.
        path: PathBuf,
        /// What failed, in plain words.
        reason: String,
    },
}

impl fmt::Display for FixtureError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Read { path, source } => {
                write!(f, "cannot read fixture {}: {source}", path.display())
            }
            Self::Parse { path, source } => {
                write!(f, "cannot parse fixture {}: {source}", path.display())
            }
            Self::SchemaVersion { path, expected, found } => write!(
                f,
                "fixture {} has schema_version {found}, this crate reads {expected}",
                path.display()
            ),
            Self::Invalid { path, reason } => {
                write!(f, "fixture {} is invalid: {reason}", path.display())
            }
        }
    }
}

impl std::error::Error for FixtureError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Read { source, .. } => Some(source),
            Self::Parse { source, .. } => Some(source),
            Self::SchemaVersion { .. } | Self::Invalid { .. } => None,
        }
    }
}

/// Read a JSON fixture into `T`.
///
/// # Errors
///
/// `FixtureError::Read` when the file cannot be read, `FixtureError::Parse` when it is
/// not valid JSON for `T` or carries a field `T` does not declare.
pub(crate) fn read_json<T: DeserializeOwned>(path: &Path) -> Result<T, FixtureError> {
    let text = std::fs::read_to_string(path)
        .map_err(|source| FixtureError::Read { path: path.to_path_buf(), source })?;
    serde_json::from_str(&text)
        .map_err(|source| FixtureError::Parse { path: path.to_path_buf(), source })
}

/// Fail unless `found` is the schema version this crate reads.
pub(crate) fn check_schema_version(path: &Path, found: u32) -> Result<(), FixtureError> {
    if found == SCHEMA_VERSION {
        Ok(())
    } else {
        Err(FixtureError::SchemaVersion {
            path: path.to_path_buf(),
            expected: SCHEMA_VERSION,
            found,
        })
    }
}

/// Turn a structural failure reason into the error that names the file.
pub(crate) fn invalid(path: &Path, reason: String) -> FixtureError {
    FixtureError::Invalid { path: path.to_path_buf(), reason }
}
