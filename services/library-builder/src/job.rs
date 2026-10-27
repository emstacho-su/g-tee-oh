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
//!
//! A job's progress crosses from the blocking solve thread to the queue through an
//! unbounded channel drained while the solve runs; the solve thread never waits on the
//! database.

mod stage;
mod sys;

use std::fmt::Write as _;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Instant;

use gto_library::{MANIFEST_FILE, Manifest, narrow_f32, sha256_hex};
use gto_model::{Flop, GameConfig, PositionPair, flop_weight, v1_configs};
use gto_solve::postflop::Range;
use gto_tree::{PreflopLine, PreflopTree, SizingConventionSpec, TreeConfig, tree_hash};
use serde::{Deserialize, Serialize};

pub use self::stage::{PROGRESS_INTERVAL, manifest_config, stage_build};
pub use self::sys::{
    PEAK_SOURCE_CGROUP, PEAK_SOURCE_NONE, PEAK_SOURCE_VM_HWM, PeakMemory, ProcSnapshot,
    RuntimeMachine, minute_of_day_utc, now_epoch_seconds, peak_memory, peak_rss_bytes,
    runtime_machine, utc_now_rfc3339,
};
use crate::error::BuilderError;
use crate::notify::BuildProgress;
use crate::ops::Status;
use crate::queue::{ClaimedJob, Failure, FailureOutcome, JobQueue, Publication, ScenarioRow};
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
    /// The environment ceilings every setting read is clamped to (`settings::Limits`).
    pub limits: crate::settings::Limits,
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
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
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

/// What a job run reports, also the `--once` summary line and the bench's input (read back
/// by `bench::read_summary`).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
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
    /// The memory figures at the end of the job and which one O-50 judges (O-190).
    pub memory: PeakMemory,
    /// The machine the job ran on, captured in this process.
    pub machine: RuntimeMachine,
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

/// The catalog configuration `config_id` names (O-182).
///
/// # Errors
///
/// `BuilderError::UnknownConfig` outside `v1_configs`.
pub fn catalog_config(config_id: &str) -> Result<GameConfig, BuilderError> {
    v1_configs()
        .into_iter()
        .find(|config| config.config_id().as_str() == config_id)
        .ok_or_else(|| BuilderError::UnknownConfig(config_id.to_owned()))
}

/// Bytes as lowercase hexadecimal.
fn hex(bytes: &[u8]) -> String {
    bytes.iter().fold(String::with_capacity(bytes.len() * 2), |mut text, byte| {
        // Writing to a String cannot fail.
        let _ = write!(text, "{byte:02x}");
        text
    })
}

/// Requires the row's tree hash to equal the one the convention gives now.
fn check_tree_hash(job: &ClaimedJob, tree: &TreeConfig) -> Result<(), BuilderError> {
    let current = tree_hash(tree);
    if job.tree_config_hash.as_slice() == current.as_slice() {
        Ok(())
    } else {
        Err(BuilderError::TreeHashMismatch {
            job: job.id.clone(),
            queued: hex(&job.tree_config_hash),
            current: hex(&current),
        })
    }
}

/// The job's lines from the preflop tree, each with its ranges.
fn job_lines(
    ranges: &dyn RangeSource,
    job: &ClaimedJob,
    tree: &PreflopTree,
) -> Result<Vec<(PreflopLine, [Range; 2])>, BuilderError> {
    job.preflop_lines
        .iter()
        .map(|text| {
            let line =
                tree.flop_lines().iter().find(|line| &line.text() == text).ok_or_else(|| {
                    BuilderError::UnknownLine {
                        config_id: job.game_config_id.clone(),
                        pair: job.position_pair.clone(),
                        line: text.clone(),
                    }
                })?;
            let pair_ranges = ranges.ranges(&job.game_config_id, &job.position_pair, text)?;
            Ok((line.clone(), pair_ranges))
        })
        .collect()
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
    let config = catalog_config(&job.game_config_id)?;
    let convention = env.queue.sizing_convention(&job.game_config_id).await?;
    let spec = SizingConventionSpec::from_json(&convention.to_string())?;
    let pair: PositionPair = job.position_pair.parse()?;
    let raw_flop: Flop = job.flop.parse()?;
    let tree = TreeConfig::from_spec(&spec)?;
    check_tree_hash(job, &tree)?;
    let preflop = PreflopTree::build(&spec, &config, pair)?;
    let lines = job_lines(env.ranges.as_ref(), job, &preflop)?;
    let build_id = env.queue.new_build_id().await?;
    Ok(BuildInputs {
        job_id: job.id.clone(),
        build_id,
        config,
        pair,
        raw_flop,
        lines,
        tree,
        k_runouts: usize::from(job.k_runouts.max(0).unsigned_abs()),
        seed: seed_of(&job.id),
        attempt: job.attempts.max(0).unsigned_abs().saturating_add(1),
        threads: settings.threads(env.builder_threads, minute_of_day_utc(now_epoch_seconds())),
        settings: settings.clone(),
        synthetic: false,
    })
}

/// A build that published.
struct Published {
    inputs: BuildInputs,
    staged: StagedBuild,
    uploaded: u64,
}

/// A job that failed, with the build id when one was made.
struct Failed {
    error: BuilderError,
    build_id: Option<String>,
}

/// Runs one claimed job to a publish or a recorded failure (step 3).
///
/// # Errors
///
/// Only when the failure itself cannot be recorded (the database is gone, or a stale
/// reclaim took the job, `BuilderError::LostLock`); every other job failure is returned
/// as `JobOutcome::Failed`.
pub async fn run_job<Q: JobQueue>(
    env: &Env<Q>,
    job: ClaimedJob,
    settings: &BuilderSettings,
) -> Result<JobOutcome, BuilderError> {
    let started = Instant::now();
    env.status.update(|view| view.current_job = Some(job.id.clone()));
    let attempt = attempt_job(env, &job, settings).await;
    env.status.update(|view| view.current_job = None);
    match attempt {
        Ok(published) => Ok(JobOutcome::Published(record_publish(env, published, started))),
        Err(failed) => record_failure(env, &job, settings, failed, started).await,
    }
}

/// Resolve, stage, upload, verify and publish; the staging directory is cleared after.
async fn attempt_job<Q: JobQueue>(
    env: &Env<Q>,
    job: &ClaimedJob,
    settings: &BuilderSettings,
) -> Result<Published, Failed> {
    let inputs =
        resolve(env, job, settings).await.map_err(|error| Failed { error, build_id: None })?;
    let failed = |error| Failed { error, build_id: Some(inputs.build_id.clone()) };
    let target = env.target.as_ref().ok_or(BuilderError::StoreUnconfigured).map_err(failed)?;
    let staging = env.scratch_dir.join(&inputs.build_id);
    let result = match stage_off_thread(env, &inputs, &staging).await {
        Ok(staged) => upload_and_publish(env, target, &inputs, staged, &staging).await,
        Err(error) => Err(error),
    };
    clear_staging(&staging);
    let build_id = inputs.build_id.clone();
    result
        .map(|(staged, uploaded)| Published { inputs, staged, uploaded })
        .map_err(|error| Failed { error, build_id: Some(build_id) })
}

/// Runs [`stage_build`] on a blocking thread and forwards its progress to the queue while
/// it runs.
async fn stage_off_thread<Q: JobQueue>(
    env: &Env<Q>,
    inputs: &BuildInputs,
    staging: &Path,
) -> Result<StagedBuild, BuilderError> {
    let (sender, mut receiver) = tokio::sync::mpsc::unbounded_channel::<BuildProgress>();
    let solver = Arc::clone(&env.solver);
    let owned_inputs = inputs.clone();
    let staging_root = staging.to_path_buf();
    let handle = tokio::task::spawn_blocking(move || {
        let forward = move |progress: BuildProgress| {
            if sender.send(progress).is_err() {
                tracing::debug!("the progress receiver is gone; the report is dropped");
            }
        };
        stage_build(&owned_inputs, solver.as_ref(), &staging_root, &forward)
    });
    while let Some(progress) = receiver.recv().await {
        if let Err(err) = env.queue.progress(&progress).await {
            tracing::warn!(job_id = %progress.job_id, error = %err, "progress was not recorded");
        }
    }
    handle.await.map_err(|err| BuilderError::io(staging, std::io::Error::other(err.to_string())))?
}

/// Refreshes the job's `locked_at` between the long steps after staging (PR #22 re-review
/// LOW 3). A failed refresh is logged: the publish's lock check is what decides.
async fn touch<Q: JobQueue>(env: &Env<Q>, job_id: &str) {
    if let Err(err) = env.queue.touch(job_id, &env.worker_id).await {
        tracing::warn!(job_id = %job_id, error = %err, "locked_at was not refreshed");
    }
}

/// Uploads, verifies and publishes a staged build, refreshing the lock after the upload and
/// after the read-back; on any failure the uploaded objects are deleted best effort
/// (O-184).
async fn upload_and_publish<Q: JobQueue>(
    env: &Env<Q>,
    target: &LibraryTarget,
    inputs: &BuildInputs,
    staged: StagedBuild,
    staging: &Path,
) -> Result<(StagedBuild, u64), BuilderError> {
    let attempt = async {
        let uploaded = target.upload_build(staging, &staged.prefix).await?;
        touch(env, &inputs.job_id).await;
        target.verify_build(&staged.prefix).await?;
        touch(env, &inputs.job_id).await;
        env.queue.publish(&env.worker_id, &publication(inputs, &staged)).await?;
        Ok::<u64, BuilderError>(uploaded)
    }
    .await;
    match attempt {
        Ok(uploaded) => Ok((staged, uploaded)),
        Err(error) => {
            match target.delete_build(&staged.prefix).await {
                Ok(deleted) => tracing::warn!(prefix = %staged.prefix, deleted, "build removed"),
                Err(err) => tracing::warn!(prefix = %staged.prefix, error = %err,
                    "the build's objects could not be removed"),
            }
            Err(error)
        }
    }
}

/// Removes a staging directory, logging a failure.
fn clear_staging(staging: &Path) {
    if !staging.exists() {
        return;
    }
    if let Err(err) = std::fs::remove_dir_all(staging) {
        tracing::warn!(path = %staging.display(), error = %err, "staging was not cleared");
    }
}

/// Counts and logs a publish and returns its summary.
fn record_publish<Q: JobQueue>(env: &Env<Q>, done: Published, started: Instant) -> RunSummary {
    let Published { inputs, staged, uploaded } = done;
    for line in &staged.lines {
        env.status.record_line(line.seconds, line.iterations);
    }
    env.status.count_job("done");
    env.status.update(|view| view.last_exploitability_pct_pot = Some(staged.max_gains_pct_pot));
    tracing::info!(job_id = %inputs.job_id, build_id = %inputs.build_id,
        prefix = %staged.prefix, bytes = uploaded, "build published");
    RunSummary {
        job_id: inputs.job_id,
        build_id: Some(inputs.build_id),
        outcome: "published".to_owned(),
        error: None,
        lines: staged.lines,
        bytes_written: uploaded,
        memory: peak_memory(),
        machine: runtime_machine(),
        seconds: started.elapsed().as_secs_f64(),
    }
}

/// Records a failure (T3), counts it and returns its outcome.
async fn record_failure<Q: JobQueue>(
    env: &Env<Q>,
    job: &ClaimedJob,
    settings: &BuilderSettings,
    failed: Failed,
    started: Instant,
) -> Result<JobOutcome, BuilderError> {
    let error = failed.error.to_string();
    tracing::warn!(job_id = %job.id, error = %error, "job failed");
    let gains = match &failed.error {
        BuilderError::AboveTarget { gains_pct_pot, .. } => Some(gains_pct_pot.map(narrow_f32)),
        _ => None,
    };
    let failure =
        Failure { job_id: job.id.clone(), error: error.clone(), exploitability_pct_pot: gains };
    let outcome = env.queue.fail(&env.worker_id, &failure, settings.max_attempts).await?;
    if matches!(failed.error, BuilderError::OverMemoryCap { .. }) {
        env.status.count_job("refused");
    }
    let label = match outcome {
        FailureOutcome::Requeued { .. } => "requeued",
        FailureOutcome::Parked { .. } => "parked",
    };
    env.status.count_job(label);
    let summary = RunSummary {
        job_id: job.id.clone(),
        build_id: failed.build_id,
        outcome: label.to_owned(),
        error: Some(error),
        lines: Vec::new(),
        bytes_written: 0,
        memory: peak_memory(),
        machine: runtime_machine(),
        seconds: started.elapsed().as_secs_f64(),
    };
    Ok(JobOutcome::Failed { outcome, summary })
}

/// The publication of a verified build.
#[must_use]
pub fn publication(inputs: &BuildInputs, staged: &StagedBuild) -> Publication {
    let scenarios = staged
        .manifest
        .runouts
        .iter()
        .flatten()
        .map(|runout| ScenarioRow { turn: runout.turn.clone(), river: runout.river.clone() })
        .collect();
    Publication {
        job_id: inputs.job_id.clone(),
        build_id: inputs.build_id.clone(),
        config_id: inputs.config.config_id().to_string(),
        pair: inputs.pair.to_string(),
        flop: inputs.raw_flop.to_string(),
        flop_weight: i16::try_from(flop_weight(inputs.raw_flop)).unwrap_or(i16::MAX),
        engine_version: staged.manifest.engine_version.clone(),
        manifest_uri: format!("{}/{MANIFEST_FILE}", staged.prefix),
        exploitability_pct_pot: staged.max_gains_pct_pot.map(narrow_f32),
        scenarios,
        bytes: staged.bytes,
    }
}

/// The runout seed of a job: the first 8 bytes of the sha256 of its id, big-endian.
#[must_use]
pub fn seed_of(job_id: &str) -> u64 {
    let digest = sha256_hex(job_id.as_bytes());
    // sha256_hex always gives 64 hexadecimal digits, so the first 16 always parse.
    digest.get(..16).and_then(|first| u64::from_str_radix(first, 16).ok()).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::{catalog_config, hex, seed_of};
    use crate::error::BuilderError;

    #[test]
    fn r2_17_the_seed_is_the_first_eight_bytes_of_the_job_ids_sha256() {
        // sha256("abc") = ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
        assert_eq!(seed_of("abc"), 0xba78_16bf_8f01_cfea);
        assert_ne!(seed_of("job-1"), seed_of("job-2"));
    }

    #[test]
    fn r2_17_only_catalog_configurations_resolve() {
        assert!(catalog_config("cfg_6_online_100").is_ok());
        let unknown = catalog_config("cfg_2_home_1");
        assert!(matches!(unknown, Err(BuilderError::UnknownConfig(_))), "{unknown:?}");
        assert_eq!(hex(&[0, 171, 255]), "00abff");
    }
}
