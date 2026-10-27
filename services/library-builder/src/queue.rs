//! The job queue (A5 section 4, ADR 0005, R2.17): the [`JobQueue`] trait the loop is
//! written against, with [`pg::PgQueue`] over Postgres as the `builder` role and
//! [`mem::MemQueue`] for tests that need no database.
//!
//! Transaction boundaries (plan section C):
//!
//! - T1, [`JobQueue::claim`]: a transaction-scoped advisory lock first, so two workers
//!   never both pass the budget gate on the same ledger figure (review L4); then
//!   `for update skip locked` on the queue head; over budget the row becomes
//!   `blocked_budget` with the numbers in `error`, else `running` under this worker with
//!   `locked_at` stamped. One transaction, committed before any work starts.
//! - [`JobQueue::progress`] refreshes `locked_at` while the row runs, so a live long job
//!   is never taken by the stale reclaim (review L6).
//! - Work runs with no transaction open.
//! - T2, [`JobQueue::publish`]: the lock check, the supersede of a previous own build, the
//!   `solution` row, the `scenario` rows, the `storage_ledger` upsert, the job marked
//!   `done` and `pg_notify('coverage_added', ...)`, in one transaction.
//! - T3, [`JobQueue::fail`]: attempts plus one, back to `queued` below `max_attempts`,
//!   `failed` (parked, O-176) at it.
//! - [`JobQueue::reclaim_stale`] (O-185, review M1, L6): a running row held by a dead
//!   previous process of this worker (the same [`stable_worker_id`], another nonce), or
//!   locked longer than `stale_hours`, goes back to `queued` with attempts plus one, or to
//!   `failed` at `max_attempts`, so a job that kills its container parks instead of
//!   looping. A row held by exactly this process's id is never taken.
//! - [`JobQueue::mark_unavailable`] (O-186, review HIGH 2, H1, L5): the solution marked
//!   `unavailable`, only its own `done` job (same configuration, pair, flop and tree hash)
//!   re-queued with attempts reset, and its bytes taken off the latest ledger figure
//!   (never below 0), in one transaction.
//!
//! Worker ids: two processes running at the same time must not share `BUILDER_WORKER_ID`.
//! The nonce tells a dead previous process from this one only across restarts; two live
//! processes with one stable id would each see the other's rows as a dead process's and
//! reclaim them mid-solve.

pub mod mem;
pub mod pg;

use std::collections::BTreeSet;
use std::future::Future;

use gto_planner::{JobKey, JobSpec, Plan, PlannerSettings};
use serde::Serialize;
use serde_json::Value;

use crate::error::BuilderError;
use crate::notify::{BuildProgress, StatePayload};

/// A claimed `build_job` row.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ClaimedJob {
    /// The job id, a UUID as text.
    pub id: String,
    /// The configuration.
    pub game_config_id: String,
    /// The pair, for example `BB-BTN`.
    pub position_pair: String,
    /// The flop as the planner wrote it.
    pub flop: String,
    /// The preflop lines.
    pub preflop_lines: Vec<String>,
    /// The tree hash.
    pub tree_config_hash: Vec<u8>,
    /// Runouts to keep.
    pub k_runouts: i16,
    /// The priority.
    pub priority: f32,
    /// Failures so far.
    pub attempts: i16,
}

/// What the budget gate of a claim needs (A5 section 4).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct BudgetGate {
    /// The library budget.
    pub budget_bytes: u64,
    /// Estimated bytes per runout per line.
    pub bytes_per_runout: u64,
    /// Estimated bytes per flop tree per line.
    pub bytes_per_flop_tree: u64,
}

impl BudgetGate {
    /// The gate the planner settings in force give.
    #[must_use]
    pub fn from_planner(settings: &PlannerSettings) -> BudgetGate {
        BudgetGate {
            budget_bytes: settings.budget_bytes,
            bytes_per_runout: settings.bytes_per_runout,
            bytes_per_flop_tree: settings.bytes_per_flop_tree,
        }
    }

    /// The estimated bytes of a job with `lines` preflop lines and K = `k_runouts`, the
    /// planner's formula (plan section B) under this gate's sizes.
    #[must_use]
    pub fn estimate(&self, lines: usize, k_runouts: i16) -> u64 {
        let settings = PlannerSettings {
            budget_bytes: self.budget_bytes,
            bytes_per_runout: self.bytes_per_runout,
            bytes_per_flop_tree: self.bytes_per_flop_tree,
            ..PlannerSettings::default()
        };
        gto_planner::estimated_bytes(lines, k_runouts.max(0).unsigned_abs(), &settings)
    }

    /// The reason a job of `estimate` bytes does not fit when `used` bytes are already
    /// stored or committed to running jobs, or `None` when it fits (A5 section 4).
    #[must_use]
    pub fn refusal(&self, estimate: u64, used: u64) -> Option<String> {
        let total = used.saturating_add(estimate);
        (total > self.budget_bytes).then(|| {
            format!(
                "over the storage budget: estimate {estimate} bytes plus {used} bytes stored or \
                 running comes to {total} bytes, above the budget of {} bytes",
                self.budget_bytes
            )
        })
    }
}

/// The stable part of a worker id: the text before the last `#`, or the whole id.
///
/// A process's `locked_by` is `<stable>#<nonce>`: the stable part never holds a `#` and
/// stays the same across restarts on a host, the nonce changes per process. A running
/// row whose holder has this worker's stable part but another nonce was left by a dead
/// previous process of this worker, so the stale reclaim takes it at once (review M1).
#[must_use]
pub fn stable_worker_id(worker_id: &str) -> &str {
    worker_id.rsplit_once('#').map_or(worker_id, |(stable, _)| stable)
}

/// Seconds in an hour, for `stale_hours`.
pub(crate) const SECONDS_PER_HOUR: u64 = 3_600;

/// The `error` a stale reclaim writes to a row taken from `holder`, now at `attempts`;
/// `PgQueue` builds the same text in SQL.
pub(crate) fn reclaim_error(holder: &str, attempts: i16, parked: bool) -> String {
    if parked {
        format!("stale reclaim from {holder}: parked after {attempts} attempts")
    } else {
        format!("stale reclaim from {holder}: re-queued at attempt {attempts}")
    }
}

/// The unique key of a row from its columns.
///
/// # Errors
///
/// `BuilderError::Malformed` when the tree hash is not 32 bytes.
pub(crate) fn job_key(
    game_config_id: &str,
    position_pair: &str,
    flop: &str,
    tree_config_hash: &[u8],
) -> Result<JobKey, BuilderError> {
    let hash: [u8; 32] = tree_config_hash.try_into().map_err(|_| BuilderError::Malformed {
        path: format!("build_job {game_config_id} {position_pair} {flop}"),
        reason: format!("tree_config_hash has {} bytes, not 32", tree_config_hash.len()),
    })?;
    Ok(JobKey {
        game_config_id: game_config_id.to_owned(),
        position_pair: position_pair.to_owned(),
        flop: flop.to_owned(),
        tree_config_hash: hash,
    })
}

/// A planned job's K and priority as the row's column types.
///
/// # Errors
///
/// `BuilderError::Malformed` when K does not fit a `smallint`.
pub(crate) fn row_k_and_priority(spec: &JobSpec) -> Result<(i16, f32), BuilderError> {
    let k = i16::try_from(spec.k_runouts).map_err(|_| BuilderError::Malformed {
        path: format!("plan {}", spec.key().flop),
        reason: format!("k_runouts {} does not fit a smallint", spec.k_runouts),
    })?;
    // The column is `real`: the priority only orders the queue, so single precision is
    // what the schema keeps.
    #[allow(clippy::cast_possible_truncation, reason = "the priority column is real (f32)")]
    let priority = spec.priority as f32;
    Ok((k, priority))
}

/// The result of one claim.
#[derive(Clone, Debug, PartialEq)]
pub enum Claim {
    /// A job, now `running` under this worker.
    Job(ClaimedJob),
    /// The head job did not fit the budget and is now `blocked_budget`.
    Blocked {
        /// The job.
        job_id: String,
        /// The reason written to `error`.
        reason: String,
    },
    /// Nothing is queued.
    Empty,
}

/// One scenario row of a publish: a stored runout (ADR 0023).
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ScenarioRow {
    /// The turn card.
    pub turn: String,
    /// The river card.
    pub river: String,
}

/// Everything the publish transaction writes.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Publication {
    /// The job.
    pub job_id: String,
    /// The build id: the manifest id, the directory name and `solution.id` (O-177).
    pub build_id: String,
    /// The configuration.
    pub config_id: String,
    /// The pair.
    pub pair: String,
    /// The raw flop.
    pub flop: String,
    /// The flop's natural weight (4, 12 or 24).
    pub flop_weight: i16,
    /// The engine version.
    pub engine_version: String,
    /// The manifest's location, `<prefix>/manifest.json`.
    pub manifest_uri: String,
    /// Per seat, the largest gain over the build's lines.
    pub exploitability_pct_pot: [f32; 2],
    /// One row per runout.
    pub scenarios: Vec<ScenarioRow>,
    /// The bytes the build added to the library.
    pub bytes: u64,
}

/// What a failure is recorded as.
#[derive(Clone, Debug, PartialEq)]
pub struct Failure {
    /// The job.
    pub job_id: String,
    /// The error text written to `build_job.error`.
    pub error: String,
    /// The gains reached, when a solve ran.
    pub exploitability_pct_pot: Option<[f32; 2]>,
}

/// Where a failed job went.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FailureOutcome {
    /// Back to `queued` with this many attempts.
    Requeued {
        /// Attempts after this failure.
        attempts: i16,
    },
    /// `failed`, parked for review after this many attempts (O-176).
    Parked {
        /// Attempts after this failure.
        attempts: i16,
    },
}

/// What a plan write did.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
pub struct PlanWrite {
    /// New rows inserted as `queued`.
    pub queued: u64,
    /// New rows inserted as `blocked_budget`.
    pub blocked: u64,
    /// `blocked_budget` rows moved to `queued`.
    pub promoted: u64,
}

/// A published own flop build, for the verify pass (O-186).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PublishedBuild {
    /// The solution id.
    pub solution_id: String,
    /// `manifest_uri`.
    pub manifest_uri: String,
}

/// A published build the verify pass found broken (O-186; PR #22 review HIGH 1, HIGH 2,
/// H1): its solution, the tree hash of its job's key (from the manifest) so only that job
/// is re-queued, and its bytes so the ledger gives them back in the same transaction.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Unavailable {
    /// The solution id.
    pub solution_id: String,
    /// The job key's tree hash; without it no job is re-queued.
    pub tree_config_hash: Option<Vec<u8>>,
    /// The bytes the build added to the library.
    pub bytes: u64,
    /// Why, written to the job's error.
    pub reason: String,
}

/// The queue the loop runs against. Futures are `Send` so the loop can run on any
/// runtime thread.
pub trait JobQueue: Send + Sync {
    /// Every `builder_setting` row.
    fn settings(&self) -> impl Future<Output = Result<Vec<(String, Value)>, BuilderError>> + Send;

    /// Re-queues `running` rows a previous process of this worker left, or locked longer
    /// than `stale_hours` (O-185); each reclaim counts as an attempt and parks the job at
    /// `max_attempts`, so a job that kills its worker cannot loop forever (review M1).
    /// Returns the rows re-queued or parked.
    fn reclaim_stale(
        &self,
        worker_id: &str,
        stale_hours: u32,
        max_attempts: i16,
    ) -> impl Future<Output = Result<u64, BuilderError>> + Send;

    /// T1: claims the queue head, or the job `job_id` when given (`--once --job`).
    fn claim(
        &self,
        worker_id: &str,
        job_id: Option<&str>,
        gate: &BudgetGate,
    ) -> impl Future<Output = Result<Claim, BuilderError>> + Send;

    /// A fresh build id from `uuidv7()` (O-177).
    fn new_build_id(&self) -> impl Future<Output = Result<String, BuilderError>> + Send;

    /// The sizing convention spec of a configuration, as stored.
    fn sizing_convention(
        &self,
        config_id: &str,
    ) -> impl Future<Output = Result<Value, BuilderError>> + Send;

    /// Writes the job's `progress` and notifies `build_progress`.
    fn progress(
        &self,
        progress: &BuildProgress,
    ) -> impl Future<Output = Result<(), BuilderError>> + Send;

    /// T2: the publish transaction.
    fn publish(
        &self,
        worker_id: &str,
        publication: &Publication,
    ) -> impl Future<Output = Result<(), BuilderError>> + Send;

    /// T3: records a failure; parks the job at `max_attempts`.
    fn fail(
        &self,
        worker_id: &str,
        failure: &Failure,
        max_attempts: i16,
    ) -> impl Future<Output = Result<FailureOutcome, BuilderError>> + Send;

    /// Notifies `builder_state`.
    fn notify_state(
        &self,
        state: &StatePayload,
    ) -> impl Future<Output = Result<(), BuilderError>> + Send;

    /// The keys of every job not `blocked_budget`, and the committed bytes: the latest
    /// ledger figure plus the estimates of queued and running jobs under `gate`.
    fn plan_inputs(
        &self,
        gate: &BudgetGate,
    ) -> impl Future<Output = Result<(BTreeSet<JobKey>, u64), BuilderError>> + Send;

    /// Writes a plan: inserts new keys (queued or `blocked_budget`), promotes
    /// `blocked_budget` rows the plan queues.
    fn write_plan(
        &self,
        plan: &Plan,
    ) -> impl Future<Output = Result<PlanWrite, BuilderError>> + Send;

    /// Published own flop builds, for the verify pass.
    fn published_builds(
        &self,
    ) -> impl Future<Output = Result<Vec<PublishedBuild>, BuilderError>> + Send;

    /// Marks a solution `unavailable`, re-queues its own job with attempts reset and gives
    /// its bytes back to the ledger (O-186, see [`Unavailable`]).
    fn mark_unavailable(
        &self,
        build: &Unavailable,
    ) -> impl Future<Output = Result<(), BuilderError>> + Send;

    /// Rows per status, for `/metrics`.
    fn queue_depth(&self) -> impl Future<Output = Result<Vec<(String, i64)>, BuilderError>> + Send;

    /// The latest `storage_ledger.library_bytes`, 0 without a row.
    fn ledger_bytes(&self) -> impl Future<Output = Result<u64, BuilderError>> + Send;
}

#[cfg(test)]
mod tests {
    use super::stable_worker_id;

    #[test]
    fn r2_17_the_stable_worker_id_is_the_text_before_the_last_hash() {
        assert_eq!(stable_worker_id("host-a#0192f0"), "host-a");
        assert_eq!(stable_worker_id("host-a"), "host-a", "no nonce: the whole id");
        assert_eq!(stable_worker_id("a#b#c"), "a#b", "the last hash splits");
        assert_eq!(stable_worker_id("#n"), "", "an empty stable part stays empty");
    }
}
