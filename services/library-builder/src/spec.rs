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
use std::time::Instant;

use gto_model::{Board, Flop, PositionPair, canonical_flops, v1_configs};
use gto_solve::postflop::{PostflopProblem, Range, StorageBits, estimate_memory};
use gto_tree::{PreflopLine, PreflopTree, SizingConventionSpec, TreeConfig};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::BuilderError;
use crate::job::{self, BuildInputs, RunSummary, StagedBuild};
use crate::notify::BuildProgress;
use crate::ranges::{FixtureRanges, RangeSource};
use crate::settings::BuilderSettings;
use crate::solve::LineSolver;
use crate::store::LibraryTarget;

/// The one spec format version.
pub const SCHEMA_VERSION: u32 = 1;

/// The job id a spec run reports, since no `build_job` row exists (O-205).
pub const SPEC_JOB_ID: &str = "spec";

/// The outcome of a spec run that staged, uploaded and verified its build.
pub const OUTCOME_STAGED: &str = "staged";

/// FNV-1a 64-bit offset basis and prime.
const FNV_OFFSET_BASIS: u64 = 0xcbf2_9ce4_8422_2325;
const FNV_PRIME: u64 = 0x0000_0100_0000_01b3;

/// The UUID version nibble (bits 76 to 79 of the 128) and version 8.
const UUID_VERSION_MASK: u128 = 0xf << 76;
const UUID_VERSION_8: u128 = 0x8 << 76;

/// The UUID variant bits (62 and 63) and the RFC 9562 variant `10`.
const UUID_VARIANT_MASK: u128 = 0x3 << 62;
const UUID_VARIANT_RFC: u128 = 0x2 << 62;

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
    let text = std::fs::read_to_string(path).map_err(|source| BuilderError::io(path, source))?;
    let spec: JobSpecFile =
        serde_json::from_str(&text).map_err(|error| malformed(path, error.to_string()))?;
    if spec.schema_version != SCHEMA_VERSION {
        let found = spec.schema_version;
        return Err(malformed(path, format!("schema_version {found} is not {SCHEMA_VERSION}")));
    }
    if spec.lines.is_empty() {
        return Err(malformed(path, "lines is empty".to_owned()));
    }
    if spec.k_runouts == 0 {
        return Err(malformed(path, "k_runouts is 0".to_owned()));
    }
    let dir = path.parent().map(Path::to_path_buf).unwrap_or_default();
    Ok(LoadedSpec { spec, dir })
}

/// The build inputs of a loaded spec, with `threads` solve threads.
///
/// The checks run cheapest first: the settings overrides (any error is
/// `BuilderError::Malformed`, since a spec is written by hand and should be right), the
/// configuration in `v1_configs` (O-182), the sizing convention and its postflop tree, the
/// pair and the raw flop, each line in the pair's preflop tree, and last the ranges
/// fixture and each line's ranges in it (O-181).
///
/// The build id is fixed per spec: a version 8 (custom) UUID made of two 64-bit FNV-1a
/// hashes of the spec id (see [`build_id_of`]). A rerun of the same spec writes the same
/// prefix, so the benchmark's library volume holds one build per spec, not one per run.
///
/// # Errors
///
/// The named error of whichever check fails (configuration, tree, lines, ranges).
pub fn inputs(loaded: &LoadedSpec, threads: usize) -> Result<BuildInputs, BuilderError> {
    let spec = &loaded.spec;
    let settings = spec_settings(loaded)?;
    let config = v1_configs()
        .into_iter()
        .find(|config| config.config_id().as_str() == spec.config_id)
        .ok_or_else(|| BuilderError::UnknownConfig(spec.config_id.clone()))?;
    let convention = SizingConventionSpec::from_json(&spec.convention.to_string())?;
    let tree = TreeConfig::from_spec(&convention)?;
    let pair: PositionPair = spec.position_pair.parse()?;
    let raw_flop: Flop = spec.flop.parse()?;
    let preflop = PreflopTree::build(&convention, &config, pair)?;
    let lines = spec
        .lines
        .iter()
        .map(|text| {
            preflop.flop_lines().iter().find(|line| line.text() == *text).cloned().ok_or_else(
                || BuilderError::UnknownLine {
                    config_id: spec.config_id.clone(),
                    pair: spec.position_pair.clone(),
                    line: text.clone(),
                },
            )
        })
        .collect::<Result<Vec<PreflopLine>, BuilderError>>()?;
    let ranges = FixtureRanges::load(&loaded.dir.join(&spec.ranges_fixture))?;
    let lines = lines
        .into_iter()
        .map(|line| {
            let pair_ranges = ranges.ranges(&spec.config_id, &spec.position_pair, &line.text())?;
            Ok((line, pair_ranges))
        })
        .collect::<Result<Vec<_>, BuilderError>>()?;
    Ok(BuildInputs {
        job_id: SPEC_JOB_ID.to_owned(),
        build_id: build_id_of(&spec.id),
        config,
        pair,
        raw_flop,
        lines,
        tree,
        k_runouts: usize::from(spec.k_runouts),
        seed: spec.seed,
        attempt: 1,
        threads: threads.max(1),
        settings,
        synthetic: spec.synthetic,
    })
}

/// The spec's `settings` overrides over the defaults; any setting error is a
/// `BuilderError::Malformed` listing every `key: reason`.
fn spec_settings(loaded: &LoadedSpec) -> Result<BuilderSettings, BuilderError> {
    let rows: Vec<(String, Value)> =
        loaded.spec.settings.iter().map(|(key, value)| (key.clone(), value.clone())).collect();
    let (settings, errors) = BuilderSettings::from_rows(&rows);
    if errors.is_empty() {
        return Ok(settings);
    }
    let reasons: Vec<String> =
        errors.iter().map(|error| format!("{}: {}", error.key, error.reason)).collect();
    Err(malformed(&spec_path(loaded), format!("settings: {}", reasons.join("; "))))
}

/// Runs a spec: stage, upload, verify; no rows.
///
/// The build is staged under `scratch_dir/spec-<build id>` by `job::stage_build`, the same
/// code the loop runs, on a blocking section of the runtime (see [`on_blocking_thread`]);
/// then the target uploads it (manifest last) and reads every object back against its
/// sha256 (O-184). The staging directory is removed whether or not the run succeeds.
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
    let started = Instant::now();
    let inputs = inputs(loaded, threads)?;
    let staging = scratch_dir.join(format!("spec-{}", inputs.build_id));
    std::fs::create_dir_all(&staging).map_err(|source| BuilderError::io(&staging, source))?;
    let result = stage_upload_verify(&inputs, target, solver, &staging).await;
    if let Err(error) = std::fs::remove_dir_all(&staging) {
        tracing::warn!(path = %staging.display(), %error, "the staging directory was not removed");
    }
    let (staged, bytes_written) = result?;
    Ok(RunSummary {
        job_id: inputs.job_id.clone(),
        build_id: Some(inputs.build_id.clone()),
        outcome: OUTCOME_STAGED.to_owned(),
        error: None,
        lines: staged.lines,
        bytes_written,
        memory: job::peak_memory(),
        machine: job::runtime_machine(),
        seconds: started.elapsed().as_secs_f64(),
    })
}

/// Stages the build into `staging`, uploads it and verifies it; the staged build and the
/// bytes uploaded.
async fn stage_upload_verify(
    inputs: &BuildInputs,
    target: &LibraryTarget,
    solver: &dyn LineSolver,
    staging: &Path,
) -> Result<(StagedBuild, u64), BuilderError> {
    let progress = |progress: BuildProgress| {
        tracing::info!(
            line = %progress.line,
            iteration = progress.iteration,
            exploitability = ?progress.exploitability,
            "job spec progress"
        );
    };
    let staged = on_blocking_thread(|| job::stage_build(inputs, solver, staging, &progress))?;
    let bytes = target.upload_build(staging, &staged.prefix).await?;
    target.verify_build(&staged.prefix).await?;
    Ok((staged, bytes))
}

/// Runs `work`, a synchronous solve, where it may block: inside
/// `tokio::task::block_in_place` on a multi-thread runtime, so the runtime moves its other
/// tasks off this worker, and inline elsewhere (a current-thread test runtime, or no
/// runtime), where nothing else is waiting on the thread. `spawn_blocking` is not used
/// because the solver and inputs are borrowed, not owned.
fn on_blocking_thread<T>(work: impl FnOnce() -> T) -> T {
    match tokio::runtime::Handle::try_current() {
        Ok(handle) if handle.runtime_flavor() == tokio::runtime::RuntimeFlavor::MultiThread => {
            tokio::task::block_in_place(work)
        }
        _ => work(),
    }
}

/// The build id of the spec `id`: a version 8 UUID from two FNV-1a 64-bit hashes of the id
/// (one from the standard offset basis, one from that basis with its bits inverted), with
/// the version and variant bits set as RFC 9562 requires.
#[must_use]
pub fn build_id_of(id: &str) -> String {
    let high = fnv1a(FNV_OFFSET_BASIS, id.as_bytes());
    let low = fnv1a(!FNV_OFFSET_BASIS, id.as_bytes());
    let bits = (u128::from(high) << 64) | u128::from(low);
    let bits = (bits & !UUID_VERSION_MASK) | UUID_VERSION_8;
    let bits = (bits & !UUID_VARIANT_MASK) | UUID_VARIANT_RFC;
    let hex = format!("{bits:032x}");
    format!("{}-{}-{}-{}-{}", &hex[0..8], &hex[8..12], &hex[12..16], &hex[16..20], &hex[20..32])
}

/// FNV-1a over `bytes` from `basis`.
fn fnv1a(basis: u64, bytes: &[u8]) -> u64 {
    bytes.iter().fold(basis, |hash, byte| (hash ^ u64::from(*byte)).wrapping_mul(FNV_PRIME))
}

/// A `BuilderError::Malformed` naming `path`.
fn malformed(path: &Path, reason: String) -> BuilderError {
    BuilderError::Malformed { path: path.display().to_string(), reason }
}

/// The spec's path as messages name it: `<dir>/<id>.json` (the id is the file stem).
fn spec_path(loaded: &LoadedSpec) -> PathBuf {
    loaded.dir.join(format!("{}.json", loaded.spec.id))
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
///
/// Each line's problem is set on every entry of `gto_model::canonical_flops()` with the
/// line's fixture ranges and the spec's tree, and `gto_solve::postflop::estimate_memory`
/// builds only the betting skeleton, so the sweep allocates no solver. The storage and the
/// cap are the spec's settings (O-194).
///
/// # Errors
///
/// As [`inputs`] and `gto_solve`'s estimate.
pub fn estimate_sweep(loaded: &LoadedSpec) -> Result<Sweep, BuilderError> {
    let built = inputs(loaded, 1)?;
    let storage = built.settings.solve_options().storage;
    let lines = built
        .lines
        .iter()
        .map(|(line, ranges)| sweep_line(&built, line, ranges, storage))
        .collect::<Result<Vec<SweepLine>, BuilderError>>()?;
    let flops = u32::try_from(canonical_flops().len()).unwrap_or(u32::MAX);
    Ok(Sweep {
        flops,
        storage_bits: built.settings.storage_bits,
        cap_bytes: built.settings.memory_cap_bytes,
        lines,
    })
}

/// One line's largest and smallest estimate over the canonical flops.
fn sweep_line(
    built: &BuildInputs,
    line: &PreflopLine,
    ranges: &[Range; 2],
    storage: StorageBits,
) -> Result<SweepLine, BuilderError> {
    let mut largest: Option<(u64, String)> = None;
    let mut smallest = u64::MAX;
    for entry in canonical_flops() {
        let board = Board::new(entry.flop, None, None)?;
        let problem = PostflopProblem::from_line(
            built.config.clone(),
            line.clone(),
            board,
            ranges.clone(),
            built.tree.clone(),
        )?;
        let bytes = estimate_memory(&problem, storage)?.total_bytes;
        smallest = smallest.min(bytes);
        if largest.as_ref().is_none_or(|(most, _)| bytes > *most) {
            largest = Some((bytes, entry.flop.to_string()));
        }
    }
    let (estimate_bytes, flop) = largest.unwrap_or((0, String::new()));
    Ok(SweepLine {
        line: line.text(),
        flop,
        estimate_bytes,
        min_bytes: smallest.min(estimate_bytes),
    })
}

#[cfg(test)]
mod tests {
    use super::build_id_of;

    #[test]
    fn r2_18_the_build_id_is_a_fixed_version_8_uuid_per_spec() {
        let id = build_id_of("bench-bb-btn-srp");
        assert_eq!(id, build_id_of("bench-bb-btn-srp"));
        assert_ne!(id, build_id_of("bench-bb-btn-srp.16bit"));
        assert_eq!(id.len(), 36);
        assert_eq!(&id[14..15], "8", "version 8: {id}");
        assert!(matches!(&id[19..20], "8" | "9" | "a" | "b"), "RFC variant: {id}");
    }
}
