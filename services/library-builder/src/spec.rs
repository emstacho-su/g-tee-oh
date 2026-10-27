//! One job without a database (O-205): `library-builder --once --job-spec FILE` for the
//! Zenbook benchmark (O-50, O-201) and a database-free S20 rehearsal, and
//! `library-builder estimate --job-spec FILE`, the O-194 recheck of the largest flop trees
//! against the memory cap.
//!
//! A job spec is self-contained: the configuration, pair, raw flop, lines, K and seed, the
//! sizing convention spec inline (for the bench, the S02 placeholder of
//! `cfg_6_online_100`, pinned to the seed migration by a test), a ranges fixture path
//! relative to the spec's directory (the `ranges` module's format) and `builder_setting`
//! overrides in the table's own key and value form. It runs through the same
//! `job::stage_build` and `LibraryTarget::upload_build` and `verify_build` as the loop and
//! publishes no rows.
//!
//! Format, `schema_version` 1:
//!
//! ```json
//! { "schema_version": 1, "id": "bench-bb-btn-srp", "config_id": "cfg_6_online_100",
//!   "position_pair": "BB-BTN", "flop": "Ah7d2c", "lines": ["r250.c"], "k_runouts": 20,
//!   "seed": 1, "convention": { ...SizingConventionSpec... },
//!   "ranges_fixture": "bench-bb-btn-srp.ranges.json",
//!   "settings": { "target_pct_pot": 0.3, "storage_bits": 32 }, "synthetic": true }
//! ```

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::BuilderError;
use crate::job::{BuildInputs, RunSummary};
use crate::solve::LineSolver;
use crate::store::LibraryTarget;

/// A job spec file.
#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct JobSpecFile {
    /// Always 1.
    pub schema_version: u32,
    /// The file stem.
    pub id: String,
    /// The configuration, in `v1_configs`.
    pub config_id: String,
    /// The pair, for example `BB-BTN`.
    pub position_pair: String,
    /// The raw flop.
    pub flop: String,
    /// The preflop lines to solve.
    pub lines: Vec<String>,
    /// Runouts to keep.
    pub k_runouts: u16,
    /// The runout seed.
    pub seed: u64,
    /// The sizing convention spec.
    pub convention: Value,
    /// The ranges fixture, relative to the spec's directory.
    pub ranges_fixture: String,
    /// `builder_setting` overrides.
    #[serde(default)]
    pub settings: BTreeMap<String, Value>,
    /// True for a synthetic or hand-made input.
    #[serde(default)]
    pub synthetic: bool,
}

/// A loaded spec with its directory.
#[derive(Clone, Debug, PartialEq)]
pub struct LoadedSpec {
    /// The file.
    pub spec: JobSpecFile,
    /// The directory the ranges fixture is relative to.
    pub dir: PathBuf,
}

/// Loads and checks a job spec.
///
/// # Errors
///
/// `BuilderError::Io` or `BuilderError::Malformed` naming the file.
pub fn load(path: &Path) -> Result<LoadedSpec, BuilderError> {
    let _ = path;
    Err(BuilderError::NotImplemented("spec::load"))
}

/// The build inputs of a loaded spec, with `threads` solve threads.
///
/// # Errors
///
/// The named error of whichever check fails (configuration, tree, lines, ranges).
pub fn inputs(loaded: &LoadedSpec, threads: usize) -> Result<BuildInputs, BuilderError> {
    let _ = (loaded, threads);
    Err(BuilderError::NotImplemented("spec::inputs"))
}

/// Runs a spec: stage, upload, verify; no rows.
///
/// # Errors
///
/// As `job::stage_build` and the target's upload and verify.
pub async fn run_spec(
    loaded: &LoadedSpec,
    target: &LibraryTarget,
    solver: &dyn LineSolver,
    scratch_dir: &Path,
    threads: usize,
) -> Result<RunSummary, BuilderError> {
    let _ = (loaded, target, solver, scratch_dir, threads);
    Err(BuilderError::NotImplemented("spec::run_spec"))
}

/// One line's largest estimate over every canonical flop.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SweepLine {
    /// The line.
    pub line: String,
    /// The canonical flop with the largest estimate.
    pub flop: String,
    /// That estimate in bytes.
    pub estimate_bytes: u64,
    /// The smallest estimate over the flops.
    pub min_bytes: u64,
}

/// The O-194 recheck: per line of the spec, the largest memory estimate over all 1,755
/// canonical flops under the spec's storage, against the cap.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Sweep {
    /// Flops estimated per line.
    pub flops: u32,
    /// `16` or `32`.
    pub storage_bits: u8,
    /// The cap.
    pub cap_bytes: u64,
    /// Per line.
    pub lines: Vec<SweepLine>,
}

/// Estimates every canonical flop for every line of the spec (skeleton only, no solve).
///
/// # Errors
///
/// As [`inputs`] and `gto_solve`'s estimate.
pub fn estimate_sweep(loaded: &LoadedSpec) -> Result<Sweep, BuilderError> {
    let _ = loaded;
    Err(BuilderError::NotImplemented("spec::estimate_sweep"))
}
