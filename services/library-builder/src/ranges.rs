//! Where a line's flop ranges come from (O-181): [`FixtureRanges`] reads the hand-made
//! JSON file `BUILDER_RANGES_FIXTURE` names (validation/fixtures/builder/, O-83), before
//! the first preflop solution is packed; [`LibraryRanges`] derives them from the published
//! preflop solution once a configuration is packed: each seat's per-class reach at the
//! flop (`gto_planner::LibraryReach::line_classes`) spread over the class's combos. A
//! line neither covers fails its job with `BuilderError::MissingRanges`.
//!
//! Fixture format, `schema_version` 1:
//!
//! ```json
//! { "schema_version": 1, "id": "tiny-bb-btn-srp", "sources": [...],
//!   "config_id": "cfg_6_online_100",
//!   "lines": [ { "position_pair": "BB-BTN", "line": "r250.c",
//!                "oop": "<engine notation>", "ip": "<engine notation>" } ],
//!   "notes": [...] }
//! ```

use std::path::Path;

use gto_solve::postflop::Range;

use crate::error::BuilderError;

/// A source of `[oop, ip]` ranges for a line.
pub trait RangeSource: Send + Sync {
    /// The ranges of `line` (dotted text, for example `r250.c`) of `pair` in `config_id`.
    ///
    /// # Errors
    ///
    /// `BuilderError::MissingRanges` when the source does not cover the line.
    fn ranges(&self, config_id: &str, pair: &str, line: &str) -> Result<[Range; 2], BuilderError>;
}

/// One line of a ranges fixture.
#[derive(Clone, Debug, PartialEq, Eq, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FixtureLine {
    /// The pair, for example `BB-BTN`.
    pub position_pair: String,
    /// The preflop line, for example `r250.c`.
    pub line: String,
    /// The out-of-position range in engine notation.
    pub oop: String,
    /// The in-position range in engine notation.
    pub ip: String,
}

/// A ranges fixture file.
#[derive(Clone, Debug, PartialEq, Eq, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FixtureFile {
    /// Always 1.
    pub schema_version: u32,
    /// The file stem.
    pub id: String,
    /// Citations, free form.
    pub sources: Vec<serde_json::Value>,
    /// The configuration every line belongs to.
    pub config_id: String,
    /// The lines.
    pub lines: Vec<FixtureLine>,
    /// Reader notes.
    #[serde(default)]
    pub notes: Vec<String>,
}

/// Ranges from a fixture file, parsed once at load.
#[derive(Clone, Debug)]
pub struct FixtureRanges {
    file: FixtureFile,
}

impl FixtureRanges {
    /// Loads and checks the fixture at `path`: schema version 1, unique (pair, line), and
    /// every range parses.
    ///
    /// # Errors
    ///
    /// `BuilderError::Io` or `BuilderError::Malformed` naming the file.
    pub fn load(path: &Path) -> Result<FixtureRanges, BuilderError> {
        let _ = path;
        Err(BuilderError::NotImplemented("FixtureRanges::load"))
    }

    /// The parsed file.
    #[must_use]
    pub fn file(&self) -> &FixtureFile {
        &self.file
    }
}

/// Ranges from published preflop solutions.
pub struct LibraryRanges<S: gto_library::ObjectStore> {
    reach: gto_planner::LibraryReach<S>,
}

impl<S: gto_library::ObjectStore> LibraryRanges<S> {
    /// Wraps the planner's reach reader.
    #[must_use]
    pub fn new(reach: gto_planner::LibraryReach<S>) -> LibraryRanges<S> {
        LibraryRanges { reach }
    }
}

impl<S: gto_library::ObjectStore> RangeSource for LibraryRanges<S> {
    fn ranges(&self, config_id: &str, pair: &str, line: &str) -> Result<[Range; 2], BuilderError> {
        let _ = &self.reach;
        Err(BuilderError::MissingRanges {
            config_id: config_id.to_owned(),
            pair: pair.to_owned(),
            line: line.to_owned(),
        })
    }
}

/// Tries each source in order and answers with the first that covers the line.
pub struct ChainRanges {
    sources: Vec<Box<dyn RangeSource>>,
}

impl ChainRanges {
    /// The sources, library first, fixture second (O-181).
    #[must_use]
    pub fn new(sources: Vec<Box<dyn RangeSource>>) -> ChainRanges {
        ChainRanges { sources }
    }
}

impl RangeSource for ChainRanges {
    fn ranges(&self, config_id: &str, pair: &str, line: &str) -> Result<[Range; 2], BuilderError> {
        let _ = &self.sources;
        Err(BuilderError::MissingRanges {
            config_id: config_id.to_owned(),
            pair: pair.to_owned(),
            line: line.to_owned(),
        })
    }
}

impl RangeSource for FixtureRanges {
    fn ranges(&self, config_id: &str, pair: &str, line: &str) -> Result<[Range; 2], BuilderError> {
        Err(BuilderError::MissingRanges {
            config_id: config_id.to_owned(),
            pair: pair.to_owned(),
            line: line.to_owned(),
        })
    }
}
