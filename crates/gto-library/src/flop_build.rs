//! The flop-build writer (S18, A3 sections 2 and 3, ADR 0023, O-17).
//!
//! Layout under `builds/<config_id>/<pair>/<flop>/<build_id>/`: one flop tree file per
//! preflop line at `flop/<line>.bin.zst`, one file per runout and line at
//! `runouts/<turn><river>/<line>.bin.zst`, and `manifest.json`. The builder writes one
//! line at a time ([`write_line_files`]) so a solved game can be dropped before the next
//! line is solved, then writes the manifest last ([`write_flop_build_manifest`]): a build
//! whose upload stops early has no manifest, so no reader or scan ever sees it. The
//! manifest id is the build id and the directory name, which the `solver-query` scan
//! requires (O-177). [`write_flop_build`] does both in one call.

use gto_model::{ConfigId, Flop, PositionPair};

use crate::chunk::ChunkOptions;
use crate::error::LibraryError;
use crate::manifest::{FileRef, LineEntry, Manifest, ManifestConfig};
use crate::record::SolvedNode;
use crate::runout::RunoutSpec;
use crate::store::ObjectSink;

/// `builds/<config_id>/<pair>/<flop>/<build_id>`, the build's prefix in the library.
#[must_use]
pub fn builds_prefix(
    config_id: &ConfigId,
    pair: PositionPair,
    flop: Flop,
    build_id: &str,
) -> String {
    format!("builds/{config_id}/{pair}/{flop}/{build_id}")
}

/// `flop/<line>.bin.zst`.
#[must_use]
pub fn flop_file_path(line: &str) -> String {
    format!("flop/{line}.bin.zst")
}

/// `runouts/<turn><river>/<line>.bin.zst`.
#[must_use]
pub fn runout_file_path(runout: &RunoutSpec, line: &str) -> String {
    format!("runouts/{runout}/{line}.bin.zst")
}

/// Everything a flop-build manifest carries besides its lines and runouts.
#[derive(Clone, Debug, PartialEq)]
pub struct FlopBuildMeta {
    /// The build id: a lowercase UUID, the directory name and the solution row id.
    pub id: String,
    /// The engine version.
    pub engine_version: String,
    /// The game configuration.
    pub config: ManifestConfig,
    /// The configuration identifier every node key carries.
    pub config_id: ConfigId,
    /// The two seats every node key carries.
    pub pair: PositionPair,
    /// The raw flop the job names, as the keys carry it.
    pub flop: Flop,
    /// The sha256 of the tree definition (O-131).
    pub tree_hash: String,
    /// The runout draw's seed.
    pub seed: u64,
    /// True for a synthetic build.
    pub synthetic: bool,
    /// The creation time, RFC 3339 in UTC.
    pub created_at: String,
}

/// One solved preflop line, extracted and relabelled to the raw flop.
#[derive(Clone, Debug, PartialEq)]
pub struct LineBuild {
    /// The preflop line, for example `r250.c`.
    pub line: String,
    /// The sha256 of the line's tree definition.
    pub tree_hash: String,
    /// The solve's seed.
    pub seed: u64,
    /// The solve's iterations.
    pub iterations: u64,
    /// Both seats' gains in percent of the pot.
    pub exploitability_pct_pot: [f64; 2],
    /// The flop-street nodes.
    pub flop_nodes: Vec<SolvedNode>,
    /// Per runout, its turn and river nodes, in the order of the drawn runouts.
    pub runouts: Vec<(RunoutSpec, Vec<SolvedNode>)>,
}

/// What [`write_line_files`] wrote for one line.
#[derive(Clone, Debug, PartialEq)]
pub struct LineWritten {
    /// The manifest entry of the line.
    pub entry: LineEntry,
    /// The runout files of the line, in runout order.
    pub runout_files: Vec<(RunoutSpec, FileRef)>,
    /// The bytes of the flop file.
    pub flop_bytes: u64,
    /// The bytes of each runout file, in runout order.
    pub runout_bytes: Vec<u64>,
}

/// Writes the flop file and the runout files of one line under `prefix`.
///
/// # Errors
///
/// As `write_tree_file`.
pub fn write_line_files(
    sink: &mut dyn ObjectSink,
    prefix: &str,
    pair: PositionPair,
    line: &LineBuild,
    o: &ChunkOptions,
) -> Result<LineWritten, LibraryError> {
    let _ = (sink, prefix, pair, o);
    Err(LibraryError::InvalidRequest(format!(
        "write_line_files({}) is not implemented yet (S18 lane X)",
        line.line
    )))
}

/// Builds, validates and writes `manifest.json` under `prefix` from the written lines;
/// every line must list the same runouts.
///
/// # Errors
///
/// `LibraryError::Manifest` when the manifest fails `Manifest::validate` or the lines
/// disagree on the runouts; `LibraryError::Io` from the sink.
pub fn write_flop_build_manifest(
    sink: &mut dyn ObjectSink,
    prefix: &str,
    meta: &FlopBuildMeta,
    lines: &[LineWritten],
) -> Result<Manifest, LibraryError> {
    let _ = (sink, prefix, lines);
    Err(LibraryError::InvalidRequest(format!(
        "write_flop_build_manifest({}) is not implemented yet (S18 lane X)",
        meta.id
    )))
}

/// Writes every line and then the manifest of a flop build under its prefix.
///
/// # Errors
///
/// As [`write_line_files`] and [`write_flop_build_manifest`].
pub fn write_flop_build(
    sink: &mut dyn ObjectSink,
    meta: &FlopBuildMeta,
    lines: &[LineBuild],
    o: &ChunkOptions,
) -> Result<Manifest, LibraryError> {
    let prefix = builds_prefix(&meta.config_id, meta.pair, meta.flop, &meta.id);
    let written = lines
        .iter()
        .map(|line| write_line_files(sink, &prefix, meta.pair, line, o))
        .collect::<Result<Vec<_>, _>>()?;
    write_flop_build_manifest(sink, &prefix, meta, &written)
}
