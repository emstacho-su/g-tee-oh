//! The claim loop (plan section C), `--once`, the planner pass and the verify pass.
//!
//! [`tick`] is one iteration: read the settings (every claim, R2.18); publish the state on
//! change (`paused`, `throttled`, `running`, `idle`); when paused, claim nothing; run the
//! stale reclaim when due (O-185); claim under the budget gate (T1); run the job; when the
//! queue is empty, run the planner when due. [`run_loop`] repeats it, sleeping
//! `poll_seconds` when paused or idle, until shutdown. Tests drive [`tick`] directly with
//! an injected minute of the day so the boost window is deterministic.

use std::future::Future;

use serde::Serialize;

use crate::error::BuilderError;
use crate::job::{Env, JobOutcome, RunSummary};
use crate::queue::{JobQueue, PlanWrite};
use crate::settings::BuilderSettings;

/// What one [`tick`] did.
#[derive(Clone, Debug, PartialEq)]
pub enum TickOutcome {
    /// The `paused` setting is on; nothing was claimed.
    Paused,
    /// The queue head went to `blocked_budget`.
    Blocked {
        /// The job.
        job_id: String,
        /// The reason.
        reason: String,
    },
    /// A job ran.
    Ran(JobOutcome),
    /// The queue was empty and the planner ran.
    Planned(PlanWrite),
    /// The queue was empty and the planner was not due.
    Idle,
}

/// Loop timing the ticks share.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct LoopClock {
    /// Seconds since the epoch of the last stale reclaim, 0 for never.
    pub last_reclaim: u64,
    /// Seconds since the epoch of the last plan, 0 for never.
    pub last_plan: u64,
    /// Seconds since the epoch of the last verify pass, 0 for never.
    pub last_verify: u64,
}

/// One loop iteration at `now_epoch_seconds`.
///
/// # Errors
///
/// A database or store error the iteration cannot record as a job failure.
pub async fn tick<Q: JobQueue>(
    env: &Env<Q>,
    clock: &mut LoopClock,
    now_epoch_seconds: u64,
) -> Result<TickOutcome, BuilderError> {
    let _ = (env, clock, now_epoch_seconds);
    Err(BuilderError::NotImplemented("run::tick"))
}

/// Ticks until `shutdown` resolves.
///
/// # Errors
///
/// The first error a tick returns after the loop has logged it and retried
/// `poll_seconds` later three times in a row.
pub async fn run_loop<Q: JobQueue>(
    env: &Env<Q>,
    shutdown: impl Future<Output = ()> + Send,
) -> Result<(), BuilderError> {
    let _ = (env, shutdown);
    Err(BuilderError::NotImplemented("run::run_loop"))
}

/// `--once`: claims the next job, or `job_id`, runs it in the foreground and returns its
/// summary.
///
/// # Errors
///
/// `BuilderError::JobNotQueued` when there is nothing to claim, and as [`tick`].
pub async fn run_once<Q: JobQueue>(
    env: &Env<Q>,
    job_id: Option<&str>,
) -> Result<RunSummary, BuilderError> {
    let _ = (env, job_id);
    Err(BuilderError::NotImplemented("run::run_once"))
}

/// One planner pass under `settings` (`library-builder plan` and the automatic plan).
///
/// # Errors
///
/// `BuilderError::Plan`, and the database errors.
pub async fn plan_once<Q: JobQueue>(
    env: &Env<Q>,
    settings: &BuilderSettings,
) -> Result<PlanWrite, BuilderError> {
    let _ = (env, settings);
    Err(BuilderError::NotImplemented("run::plan_once"))
}

/// What a verify pass found (O-186).
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
pub struct VerifyReport {
    /// Builds checked.
    pub checked: u64,
    /// Solution ids marked unavailable and re-queued.
    pub unavailable: Vec<String>,
}

/// Reads every published own build back and checks it; a failing one is marked
/// unavailable and its job re-queued (O-186).
///
/// # Errors
///
/// The database errors, and `BuilderError::StoreUnconfigured`.
pub async fn verify_once<Q: JobQueue>(env: &Env<Q>) -> Result<VerifyReport, BuilderError> {
    let _ = env;
    Err(BuilderError::NotImplemented("run::verify_once"))
}
