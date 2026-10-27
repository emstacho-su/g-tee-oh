//! One build job end to end (A5 section 4, plan section C step 4).
//!
//! The work is split so the database-free `--once --job-spec` path (O-205) runs the same
//! code as the loop:
//!
//! 1. [`resolve`] (database jobs only) turns a claimed row into [`BuildInputs`]: the
//!    configuration from `v1_configs` (O-182), the sizing convention from the database,
//!    the job's lines from the preflop tree, the tree hash checked against the row, ranges
//!    from the range source (O-181), a build id from `uuidv7()` (O-177), and the seed
//!    from the job id.
//! 2. [`stage_build`] (synchronous, the solve's thread) canonicalizes the flop, draws the
//!    runouts once, and per line solves, checks both gains against the target (nothing is
//!    written for a line above it), extracts to the raw flop and writes the line's files
//!    into the staging directory, dropping the solved game before the next line; then it
//!    writes the manifest.
//! 3. [`run_job`] uploads the staged build (manifest last), verifies every object's sha256
//!    by reading it back (O-184), and publishes in one transaction; on any failure it
//!    deletes what it uploaded, records the failure (three park the job, O-176) and
//!    returns the outcome.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use gto_library::Manifest;
use gto_model::{Flop, GameConfig, PositionPair};
use gto_solve::postflop::Range;
use gto_tree::{PreflopLine, TreeConfig};
use serde::Serialize;

use crate::error::BuilderError;
use crate::notify::BuildProgress;
use crate::ops::Status;
use crate::queue::{ClaimedJob, FailureOutcome, JobQueue, Publication};
use crate::ranges::RangeSource;
use crate::settings::BuilderSettings;
use crate::solve::LineSolver;
use crate::store::LibraryTarget;

/// The engine version a build records: this crate's version and the vendored engine's
/// pinned commit (crates/vendor/UPSTREAM-postflop-engine.md).
pub const ENGINE_VERSION: &str = concat!("g-tee-oh-builder/", env!("CARGO_PKG_VERSION"));

/// What the loop and `--once` share.
pub struct Env<Q: JobQueue> {
    /// The queue.
    pub queue: Arc<Q>,
    /// The solver.
    pub solver: Arc<dyn LineSolver>,
    /// The library target, when configured.
    pub target: Option<LibraryTarget>,
    /// Where ranges come from.
    pub ranges: Arc<dyn RangeSource>,
    /// Where the planner reads equilibrium reach from (ADR 0013, O-181).
    pub reach: Arc<dyn gto_planner::ReachSource + Send + Sync>,
    /// The staging directory.
    pub scratch_dir: PathBuf,
    /// This worker's name.
    pub worker_id: String,
    /// `BUILDER_THREADS`.
    pub builder_threads: usize,
    /// The shared status `/healthz` and `/metrics` read.
    pub status: Arc<Status>,
}

/// Everything a build needs once its row is resolved.
#[derive(Clone, Debug)]
pub struct BuildInputs {
    /// The job id (`spec` for a job-spec run).
    pub job_id: String,
    /// The build id.
    pub build_id: String,
    /// The configuration.
    pub config: GameConfig,
    /// The pair.
    pub pair: PositionPair,
    /// The raw flop the job names.
    pub raw_flop: Flop,
    /// Each line with its `[oop, ip]` ranges.
    pub lines: Vec<(PreflopLine, [Range; 2])>,
    /// The postflop tree.
    pub tree: TreeConfig,
    /// Runouts to keep.
    pub k_runouts: usize,
    /// The runout seed.
    pub seed: u64,
    /// The attempt number, 1 for the first.
    pub attempt: u16,
    /// Solve threads.
    pub threads: usize,
    /// The settings in force.
    pub settings: BuilderSettings,
    /// True for a synthetic or bench build.
    pub synthetic: bool,
}

/// One line's measurements.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct LineSummary {
    /// The line.
    pub line: String,
    /// Wall seconds of the solve.
    pub seconds: f64,
    /// Iterations run.
    pub iterations: u32,
    /// Both seats' gains, percent of the pot.
    pub gains_pct_pot: [f64; 2],
    /// Why the solve stopped.
    pub stop_reason: String,
    /// The memory estimate.
    pub estimate_bytes: u64,
    /// The flop file's bytes.
    pub flop_bytes: u64,
    /// Each runout file's bytes.
    pub runout_bytes: Vec<u64>,
}

/// A build staged on disk, not yet uploaded.
#[derive(Clone, Debug)]
pub struct StagedBuild {
    /// The build's prefix.
    pub prefix: String,
    /// The manifest written.
    pub manifest: Manifest,
    /// Per line.
    pub lines: Vec<LineSummary>,
    /// Bytes staged.
    pub bytes: u64,
    /// Per seat, the largest gain over the lines.
    pub max_gains_pct_pot: [f64; 2],
}

/// What a job run reports, also the `--once` summary line and the bench's input.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct RunSummary {
    /// The job.
    pub job_id: String,
    /// The build id, once one was made.
    pub build_id: Option<String>,
    /// `published`, `requeued`, `parked` or `staged` (job-spec runs).
    pub outcome: String,
    /// The error text of a failure.
    pub error: Option<String>,
    /// Per line.
    pub lines: Vec<LineSummary>,
    /// Bytes written.
    pub bytes_written: u64,
    /// The process's peak resident set size at the end of the job.
    pub peak_rss_bytes: u64,
    /// Wall seconds of the job.
    pub seconds: f64,
}

/// The outcome of [`run_job`].
#[derive(Clone, Debug, PartialEq)]
pub enum JobOutcome {
    /// Published.
    Published(RunSummary),
    /// Failed and recorded.
    Failed {
        /// Requeued or parked.
        outcome: FailureOutcome,
        /// The summary, with the error.
        summary: RunSummary,
    },
}

/// Resolves a claimed row to build inputs (step 1 of the module docs).
///
/// # Errors
///
/// The named `BuilderError` of whichever check fails.
pub async fn resolve<Q: JobQueue>(
    env: &Env<Q>,
    job: &ClaimedJob,
    settings: &BuilderSettings,
) -> Result<BuildInputs, BuilderError> {
    let _ = (env, job, settings);
    Err(BuilderError::NotImplemented("job::resolve"))
}

/// Solves, extracts and stages every line, then the manifest (step 2).
///
/// # Errors
///
/// `BuilderError::OverMemoryCap`, `BuilderError::AboveTarget`, and the solve, extract and
/// library errors.
pub fn stage_build(
    inputs: &BuildInputs,
    solver: &dyn LineSolver,
    staging_root: &Path,
    progress: &(dyn Fn(BuildProgress) + Sync),
) -> Result<StagedBuild, BuilderError> {
    let _ = (inputs, solver, staging_root, progress);
    Err(BuilderError::NotImplemented("job::stage_build"))
}

/// Runs one claimed job to a publish or a recorded failure (step 3).
///
/// # Errors
///
/// Only when the failure itself cannot be recorded (the database is gone); every job
/// failure is returned as `JobOutcome::Failed`.
pub async fn run_job<Q: JobQueue>(
    env: &Env<Q>,
    job: ClaimedJob,
    settings: &BuilderSettings,
) -> Result<JobOutcome, BuilderError> {
    let _ = (env, job, settings);
    Err(BuilderError::NotImplemented("job::run_job"))
}

/// The publication of a verified build.
#[must_use]
pub fn publication(inputs: &BuildInputs, staged: &StagedBuild) -> Publication {
    let _ = (inputs, staged);
    Publication {
        job_id: String::new(),
        build_id: String::new(),
        config_id: String::new(),
        pair: String::new(),
        flop: String::new(),
        flop_weight: 0,
        engine_version: String::new(),
        manifest_uri: String::new(),
        exploitability_pct_pot: [0.0; 2],
        scenarios: Vec::new(),
        bytes: 0,
    }
}

/// The runout seed of a job: the first 8 bytes of the sha256 of its id, big-endian.
#[must_use]
pub fn seed_of(job_id: &str) -> u64 {
    let _ = job_id;
    0
}

/// The current time in UTC as RFC 3339 with a `Z` suffix, for `created_at`.
#[must_use]
pub fn utc_now_rfc3339() -> String {
    String::new()
}

/// The process's peak resident set size in bytes: `VmHWM` from `/proc/self/status` on
/// Linux, sysinfo's current figure elsewhere.
#[must_use]
pub fn peak_rss_bytes() -> u64 {
    0
}
