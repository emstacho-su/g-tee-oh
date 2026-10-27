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

use std::collections::BTreeMap;

use gto_model::{ConfigId, Flop, PositionPair, flop_weight};

use crate::FORMAT_VERSION;
use crate::chunk::ChunkOptions;
use crate::error::LibraryError;
use crate::manifest::{
    FileRef, LineEntry, MANIFEST_FILE, Manifest, ManifestConfig, ManifestKind, Runout, Source,
};
use crate::record::SolvedNode;
use crate::runout::RunoutSpec;
use crate::store::ObjectSink;
use crate::writer::write_tree_file;

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
    let mut counting = Counting { inner: sink, last_bytes: 0 };
    let flop_path = flop_file_path(&line.line);
    let flop_ref = write_tree_file(&mut counting, prefix, &flop_path, pair, &line.flop_nodes, o)?;
    let flop_bytes = counting.last_bytes;
    let mut runout_files = Vec::with_capacity(line.runouts.len());
    let mut runout_bytes = Vec::with_capacity(line.runouts.len());
    for (runout, nodes) in &line.runouts {
        let path = runout_file_path(runout, &line.line);
        let file = write_tree_file(&mut counting, prefix, &path, pair, nodes, o)?;
        runout_files.push((*runout, file));
        runout_bytes.push(counting.last_bytes);
    }
    let entry = LineEntry {
        line: line.line.clone(),
        tree_hash: line.tree_hash.clone(),
        seed: line.seed,
        iterations: line.iterations,
        exploitability_pct_pot: line.exploitability_pct_pot,
        flop_file: flop_ref.path,
        sha256: flop_ref.sha256,
    };
    Ok(LineWritten { entry, runout_files, flop_bytes, runout_bytes })
}

/// A sink that passes every put through and remembers the size of the last one, so the
/// writer can report each file's bytes without a second encode.
struct Counting<'a> {
    inner: &'a mut dyn ObjectSink,
    last_bytes: u64,
}

impl ObjectSink for Counting<'_> {
    fn put(&mut self, path: &str, bytes: &[u8]) -> Result<(), LibraryError> {
        self.inner.put(path, bytes)?;
        self.last_bytes = bytes.len() as u64;
        Ok(())
    }
}

/// The manifest's runouts: those of the first line, each with its file per line. Every
/// line must list the same runouts in the same order.
fn manifest_runouts(lines: &[LineWritten]) -> Result<Vec<Runout>, LibraryError> {
    let Some(first) = lines.first() else {
        return Err(LibraryError::Manifest("a flop build needs at least one line".to_owned()));
    };
    let drawn: Vec<RunoutSpec> = first.runout_files.iter().map(|(runout, _)| *runout).collect();
    for written in lines {
        let listed: Vec<RunoutSpec> =
            written.runout_files.iter().map(|(runout, _)| *runout).collect();
        if listed != drawn {
            return Err(LibraryError::Manifest(format!(
                "line {} lists other runouts than line {}",
                written.entry.line, first.entry.line
            )));
        }
    }
    Ok(drawn
        .iter()
        .enumerate()
        .map(|(index, runout)| Runout {
            turn: runout.turn.to_string(),
            river: runout.river.to_string(),
            files: lines
                .iter()
                .map(|written| (written.entry.line.clone(), written.runout_files[index].1.clone()))
                .collect::<BTreeMap<_, _>>(),
        })
        .collect())
}

/// The flop-build manifest of `meta` with its lines and runouts.
fn flop_build_manifest(
    meta: &FlopBuildMeta,
    lines: &[LineWritten],
) -> Result<Manifest, LibraryError> {
    let weight = flop_weight(meta.flop);
    let flop_weight = u8::try_from(weight)
        .map_err(|_| LibraryError::Manifest(format!("flop_weight {weight} exceeds a byte")))?;
    Ok(Manifest {
        format_version: FORMAT_VERSION,
        kind: ManifestKind::FlopBuild,
        source: Source::Own,
        id: meta.id.clone(),
        engine_version: meta.engine_version.clone(),
        config: meta.config.clone(),
        config_id: Some(meta.config_id.clone()),
        pair: Some(meta.pair),
        flop: Some(meta.flop.to_string()),
        flop_weight: Some(flop_weight),
        lines: Some(lines.iter().map(|written| written.entry.clone()).collect()),
        runouts: Some(manifest_runouts(lines)?),
        turn_roots: None,
        chunks: None,
        tree_hash: Some(meta.tree_hash.clone()),
        seed: Some(meta.seed),
        iterations: None,
        exploitability_pct_pot: None,
        synthetic: Some(meta.synthetic),
        created_at: meta.created_at.clone(),
    })
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
    let manifest = flop_build_manifest(meta, lines)?;
    manifest.validate()?;
    let json = manifest.to_json_pretty()?;
    sink.put(&format!("{prefix}/{MANIFEST_FILE}"), json.as_bytes())?;
    Ok(manifest)
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
