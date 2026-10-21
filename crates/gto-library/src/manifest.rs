//! The manifest (R2.7, R0.7, A3 section 3): a serde mirror of `schemas/manifest.schema.json`,
//! itself a byte-for-byte copy of `packages/contracts/schemas/manifest.schema.json` (O-119).
//!
//! The manifest is JSON (JavaScript Object Notation); amounts are integer centi-big-blinds
//! (cbb). Every struct denies unknown fields and every optional field is skipped when absent, so a
//! manifest serializes to exactly the shape the schema allows. `validate` checks the rules
//! serde cannot: the format version, the fields each kind requires, and the string patterns
//! (identifier, timestamp, sha256, chunk path). The identifier and timestamp matchers,
//! `is_uuid` and `is_timestamp`, are public so a tool that builds those fields checks them
//! with the same code.
//!
//! The struct fields are fixed by the S14 red commit because the writer (lane W) and the
//! reader (lane R) build and read them; lane M owns this file's function bodies and the
//! schema, and asks the integrator before changing a field.

mod validate;

use std::collections::BTreeMap;

use gto_model::{Cbb, ConfigId, GameFormat, PositionPair, TableSize};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::SUPPORTED_FORMAT_VERSIONS;
use crate::error::LibraryError;

pub use validate::{is_timestamp, is_uuid};

/// The manifest schema, compiled into the crate so tests and tools validate against it.
pub const MANIFEST_SCHEMA: &str = include_str!("../schemas/manifest.schema.json");

/// The manifest's file name inside a solution directory.
pub const MANIFEST_FILE: &str = "manifest.json";

/// The most chunk files a preflop solution may list: the schema's four-digit chunk path.
pub const MAX_CHUNKS: usize = 10_000;

/// A preflop tree in chunks, or a flop build with lines and runouts.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ManifestKind {
    /// `preflop`
    Preflop,
    /// `flop_build`
    FlopBuild,
}

/// Solved by this project's engine, or imported as a reference.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Source {
    /// `own`
    Own,
    /// `reference`
    Reference,
}

/// The game configuration a solution was solved for (the schema's `game_config`).
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ManifestConfig {
    /// Online or live.
    pub format: GameFormat,
    /// Seats at the table.
    pub table_size: TableSize,
    /// The stake label as players name it, for example `1/3`.
    pub stake: String,
    /// Effective stack depth in cbb.
    pub depth_cbb: Cbb,
    /// True when a straddle is posted.
    pub straddle: bool,
    /// Ante per player in cbb.
    pub ante_cbb: Cbb,
}

/// One file of a solution with its checksum.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FileRef {
    /// The path relative to the solution directory, with forward slashes.
    pub path: String,
    /// The file's sha256, 64 lowercase hexadecimal digits.
    pub sha256: String,
}

/// One chunk file of a preflop solution.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ChunkRef {
    /// `chunks/NNNN.bin.zst`.
    pub path: String,
    /// The file's sha256.
    pub sha256: String,
    /// How many node records the file holds.
    pub node_count: u32,
}

/// One preflop line of a flop build with its flop tree file.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LineEntry {
    /// The preflop line, for example `r250.c`.
    pub line: String,
    /// The sha256 of the line's tree definition.
    pub tree_hash: String,
    /// The solve's random seed.
    pub seed: u64,
    /// The solve's iteration count.
    pub iterations: u64,
    /// The exploitability reached per seat in percent of the pot.
    pub exploitability_pct_pot: [f64; 2],
    /// The flop tree file relative to the solution directory.
    pub flop_file: String,
    /// The sha256 of `flop_file`.
    pub sha256: String,
}

/// One turn and river runout of a flop build.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Runout {
    /// The turn card, for example `Kh`.
    pub turn: String,
    /// The river card.
    pub river: String,
    /// The runout's tree file per preflop line, keyed by the line.
    pub files: BTreeMap<String, FileRef>,
}

/// A turn-rooted tree, reserved for later versions (O-15).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TurnRoot {
    /// The preflop line.
    pub line: String,
    /// The file relative to the solution directory.
    pub path: String,
    /// The file's sha256.
    pub sha256: String,
}

/// One solution's `manifest.json`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Manifest {
    /// The manifest format version (O-118); `FORMAT_VERSION` when written.
    pub format_version: u32,
    /// Preflop or flop build.
    pub kind: ManifestKind,
    /// Own or reference.
    pub source: Source,
    /// The solution's lowercase universally unique identifier (UUID).
    pub id: String,
    /// The engine version, or an opaque label for a reference solution.
    pub engine_version: String,
    /// The game configuration.
    pub config: ManifestConfig,
    /// The seeded configuration identifier, when there is one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub config_id: Option<ConfigId>,
    /// The two seats, out of position first.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pair: Option<PositionPair>,
    /// A flop build's three board cards, for example `Ah7d2c`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub flop: Option<String>,
    /// How many suit-isomorphic flops the flop stands for, 1 to 24.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub flop_weight: Option<u8>,
    /// A flop build's preflop lines.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lines: Option<Vec<LineEntry>>,
    /// A flop build's runouts.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub runouts: Option<Vec<Runout>>,
    /// Reserved; absent in version 1.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub turn_roots: Option<Vec<TurnRoot>>,
    /// A preflop solution's chunk files in file order.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub chunks: Option<Vec<ChunkRef>>,
    /// The sha256 of the tree definition (lead decision 2, O-131).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tree_hash: Option<String>,
    /// The solve's random seed; required for an own preflop solution (O-131).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seed: Option<u64>,
    /// The solve's iteration count; required for an own preflop solution (O-131).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub iterations: Option<u64>,
    /// The exploitability per seat in percent of the pot; required for an own preflop
    /// solution (O-131).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exploitability_pct_pot: Option<[f64; 2]>,
    /// True for synthetic test data (O-57).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub synthetic: Option<bool>,
    /// When the manifest was written, `YYYY-MM-DDTHH:MM:SS[.fff]Z`.
    pub created_at: String,
}

impl Manifest {
    /// Parses and validates a manifest.
    ///
    /// # Errors
    ///
    /// `LibraryError::Manifest` when the bytes are not a manifest or break a rule of
    /// `validate`; `LibraryError::UnsupportedFormat` for a version outside
    /// `SUPPORTED_FORMAT_VERSIONS`.
    pub fn from_json(b: &[u8]) -> Result<Self, LibraryError> {
        let value: Value = serde_json::from_slice(b)
            .map_err(|err| LibraryError::Manifest(format!("the bytes are not JSON: {err}")))?;
        check_version_field(&value)?;
        let manifest: Manifest = serde_json::from_value(value)
            .map_err(|err| LibraryError::Manifest(format!("the JSON is not a manifest: {err}")))?;
        manifest.validate()?;
        Ok(manifest)
    }

    /// The manifest as pretty-printed JSON with a trailing newline, the bytes the writer
    /// stores.
    ///
    /// # Errors
    ///
    /// `LibraryError::Manifest` when serialization fails.
    pub fn to_json_pretty(&self) -> Result<String, LibraryError> {
        serde_json::to_string_pretty(self).map(|text| format!("{text}\n")).map_err(|err| {
            LibraryError::Manifest(format!("the manifest does not serialize: {err}"))
        })
    }

    /// Checks the rules serde cannot express: the version, the fields each kind requires
    /// (O-131 for `seed`, `iterations` and `exploitability_pct_pot`) and the patterns.
    ///
    /// # Errors
    ///
    /// `LibraryError::UnsupportedFormat` or `LibraryError::Manifest` naming the first rule
    /// broken.
    pub fn validate(&self) -> Result<(), LibraryError> {
        validate::manifest(self)
    }
}

/// Reads `format_version` before the rest of the document, so a manifest of another version
/// is reported as `UnsupportedFormat` even when its other fields no longer match this
/// version's shape.
fn check_version_field(value: &Value) -> Result<(), LibraryError> {
    let raw = value.get("format_version").and_then(Value::as_u64).ok_or_else(|| {
        LibraryError::Manifest("format_version is missing or not a whole number".to_owned())
    })?;
    let version = u32::try_from(raw)
        .map_err(|_| LibraryError::Manifest(format!("format_version {raw} is out of range")))?;
    if SUPPORTED_FORMAT_VERSIONS.contains(&version) {
        Ok(())
    } else {
        Err(LibraryError::UnsupportedFormat(version))
    }
}
