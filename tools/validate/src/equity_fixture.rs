//! The 169 by 169 preflop equity fixture, `validation/fixtures/equity/preflop-169.json`
//! (R2.20, O-32, O-126), written from `gto_solve::equity::table()` by the `equity-table`
//! subcommand. Owner: the S13 integrator (plan task 6). The writer and the builder are
//! stubs until then; the file format and the loader are settled here so the tests under
//! `tests/equity_table.rs` read the committed file.
//!
//! Format (S13 plan section B): `schema_version` 1; `classes`, the 169 labels in
//! `gto_model::HandClass` index order; `equity[i][j]`, the hero class `i` against the
//! villain class `j` as `(wins + ties / 2) / total` over every disjoint combo pair and
//! every C(48, 5) = 1,712,304 board; `pairs[i][j]`, the number of disjoint ordered combo
//! pairs behind the entry, so range weighting stays exact; `method`, `evaluator` (the
//! vendored `eval7`), `boards_per_pair`, `generated_at` and `commit`. The provenance note
//! beside the file records the machine and the elapsed time.

use std::fmt;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// The schema version the fixture carries today.
pub const SCHEMA_VERSION: u32 = 1;

/// Path of the fixture relative to the repository root.
pub const DEFAULT_PATH: &str = "validation/fixtures/equity/preflop-169.json";

/// Boards scored per disjoint combo pair: C(48, 5).
pub const BOARDS_PER_PAIR: u64 = 1_712_304;

/// Hand classes in the table.
pub const CLASS_COUNT: usize = 169;

/// The fixture file.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EquityFixture {
    /// Always [`SCHEMA_VERSION`].
    pub schema_version: u32,
    /// The 169 class labels in index order.
    pub classes: Vec<String>,
    /// `equity[hero][villain]`.
    pub equity: Vec<Vec<f64>>,
    /// `pairs[hero][villain]`.
    pub pairs: Vec<Vec<u32>>,
    /// How the numbers were produced, in plain words.
    pub method: String,
    /// The evaluator that scored the boards.
    pub evaluator: String,
    /// Boards scored per disjoint combo pair.
    pub boards_per_pair: u64,
    /// When the file was written, ISO 8601 in Coordinated Universal Time (UTC).
    pub generated_at: String,
    /// `git rev-parse HEAD` when the file was written.
    pub commit: String,
}

/// Why the fixture could not be read or written.
#[derive(Debug)]
pub enum EquityFixtureError {
    /// The file could not be read.
    Read {
        /// The fixture path.
        path: PathBuf,
        /// The input/output error.
        source: std::io::Error,
    },
    /// The file is not valid JSON for the fixture type.
    Parse {
        /// The fixture path.
        path: PathBuf,
        /// The serde error.
        source: serde_json::Error,
    },
    /// The file parsed but its shape is wrong.
    Invalid {
        /// The fixture path.
        path: PathBuf,
        /// What failed, in plain words.
        reason: String,
    },
    /// The fixture could not be serialised.
    Serialize {
        /// The target path.
        path: PathBuf,
        /// The serde error.
        source: serde_json::Error,
    },
    /// The file could not be written.
    Write {
        /// The target path.
        path: PathBuf,
        /// The input/output error.
        source: std::io::Error,
    },
}

impl fmt::Display for EquityFixtureError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Read { path, source } => {
                write!(f, "cannot read equity fixture {}: {source}", path.display())
            }
            Self::Parse { path, source } => {
                write!(f, "cannot parse equity fixture {}: {source}", path.display())
            }
            Self::Invalid { path, reason } => {
                write!(f, "equity fixture {} is invalid: {reason}", path.display())
            }
            Self::Serialize { path, source } => {
                write!(f, "cannot serialise equity fixture {}: {source}", path.display())
            }
            Self::Write { path, source } => {
                write!(f, "cannot write equity fixture {}: {source}", path.display())
            }
        }
    }
}

impl std::error::Error for EquityFixtureError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Read { source, .. } | Self::Write { source, .. } => Some(source),
            Self::Parse { source, .. } | Self::Serialize { source, .. } => Some(source),
            Self::Invalid { .. } => None,
        }
    }
}

/// Read and validate the fixture: schema version 1, 169 classes, 169 by 169 `equity`
/// and `pairs`, `boards_per_pair` equal to [`BOARDS_PER_PAIR`].
///
/// # Errors
///
/// `EquityFixtureError::Read`, `Parse` or `Invalid`.
pub fn load(path: &Path) -> Result<EquityFixture, EquityFixtureError> {
    let text = std::fs::read_to_string(path)
        .map_err(|source| EquityFixtureError::Read { path: path.to_path_buf(), source })?;
    let fixture: EquityFixture = serde_json::from_str(&text)
        .map_err(|source| EquityFixtureError::Parse { path: path.to_path_buf(), source })?;
    check_shape(&fixture)
        .map_err(|reason| EquityFixtureError::Invalid { path: path.to_path_buf(), reason })?;
    Ok(fixture)
}

fn check_shape(fixture: &EquityFixture) -> Result<(), String> {
    if fixture.schema_version != SCHEMA_VERSION {
        return Err(format!("schema_version {} is not {SCHEMA_VERSION}", fixture.schema_version));
    }
    if fixture.classes.len() != CLASS_COUNT {
        return Err(format!("{} classes, not {CLASS_COUNT}", fixture.classes.len()));
    }
    let square = |rows: usize, name: &str| {
        if rows == CLASS_COUNT { Ok(()) } else { Err(format!("{name} has {rows} rows")) }
    };
    square(fixture.equity.len(), "equity")?;
    square(fixture.pairs.len(), "pairs")?;
    for (i, row) in fixture.equity.iter().enumerate() {
        if row.len() != CLASS_COUNT {
            return Err(format!("equity row {i} has {} entries", row.len()));
        }
    }
    for (i, row) in fixture.pairs.iter().enumerate() {
        if row.len() != CLASS_COUNT {
            return Err(format!("pairs row {i} has {} entries", row.len()));
        }
    }
    if fixture.boards_per_pair != BOARDS_PER_PAIR {
        return Err(format!(
            "boards_per_pair {} is not {BOARDS_PER_PAIR}",
            fixture.boards_per_pair
        ));
    }
    Ok(())
}

/// Build the fixture from `gto_solve::equity::table()`, dated `generated_at` at `commit`.
#[must_use]
pub fn build(generated_at: &str, commit: &str) -> EquityFixture {
    todo!("integrator: the table at {commit} on {generated_at}")
}

/// Write the fixture as pretty-printed JSON with a trailing newline, creating the parent
/// directory when it is missing.
///
/// # Errors
///
/// `EquityFixtureError::Serialize` or `Write`.
pub fn write(fixture: &EquityFixture, path: &Path) -> Result<(), EquityFixtureError> {
    todo!("integrator: write {} classes to {}", fixture.classes.len(), path.display())
}
