//! An in-memory [`JobQueue`] with the same rules as [`super::pg::PgQueue`], for the loop
//! and operations tests that run in continuous integration (CI) without Postgres. A mutex
//! around one state value stands in for the row locks: each trait method takes it once,
//! so each runs as one transaction. The accessors at the bottom let a test seed jobs and
//! settings and read back what the loop wrote.

use std::collections::BTreeSet;
use std::future::{Future, ready};
use std::sync::{Mutex, MutexGuard};

use gto_planner::{JobKey, Plan};
use serde_json::Value;

use super::{
    BudgetGate, Claim, Failure, FailureOutcome, JobQueue, PlanWrite, Publication, PublishedBuild,
};
use crate::error::BuilderError;
use crate::notify::{BuildProgress, StatePayload};

/// One job row.
#[derive(Clone, Debug, PartialEq)]
pub struct MemJob {
    /// The id.
    pub id: String,
    /// The configuration.
    pub game_config_id: String,
    /// The pair.
    pub position_pair: String,
    /// The flop.
    pub flop: String,
    /// The preflop lines.
    pub preflop_lines: Vec<String>,
    /// The tree hash.
    pub tree_config_hash: Vec<u8>,
    /// Runouts to keep.
    pub k_runouts: i16,
    /// The priority.
    pub priority: f32,
    /// `queued`, `running`, `done`, `failed` or `blocked_budget`.
    pub status: String,
    /// Failures so far.
    pub attempts: i16,
    /// The last gains.
    pub last_exploitability_pct_pot: Option<[f32; 2]>,
    /// The worker holding it.
    pub locked_by: Option<String>,
    /// The last progress.
    pub progress: Option<Value>,
    /// The last error.
    pub error: Option<String>,
}

impl MemJob {
    /// A queued job with no attempts.
    #[allow(clippy::too_many_arguments, reason = "one argument per column a test seeds")]
    #[must_use]
    pub fn queued(
        id: &str,
        game_config_id: &str,
        position_pair: &str,
        flop: &str,
        preflop_lines: &[&str],
        tree_config_hash: [u8; 32],
        k_runouts: i16,
        priority: f32,
    ) -> MemJob {
        MemJob {
            id: id.to_owned(),
            game_config_id: game_config_id.to_owned(),
            position_pair: position_pair.to_owned(),
            flop: flop.to_owned(),
            preflop_lines: preflop_lines.iter().map(|line| (*line).to_owned()).collect(),
            tree_config_hash: tree_config_hash.to_vec(),
            k_runouts,
            priority,
            status: "queued".to_owned(),
            attempts: 0,
            last_exploitability_pct_pot: None,
            locked_by: None,
            progress: None,
            error: None,
        }
    }
}

/// One solution row.
#[derive(Clone, Debug, PartialEq)]
pub struct MemSolution {
    /// The publication that wrote it.
    pub publication: Publication,
    /// `published`, `unavailable` or `superseded`.
    pub status: String,
}

/// Everything the queue holds.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct MemState {
    /// `build_job`.
    pub jobs: Vec<MemJob>,
    /// `builder_setting`.
    pub settings: Vec<(String, Value)>,
    /// Sizing convention specs by configuration.
    pub conventions: Vec<(String, Value)>,
    /// `solution` rows of own flop builds.
    pub solutions: Vec<MemSolution>,
    /// `storage_ledger.library_bytes`, latest.
    pub ledger_bytes: u64,
    /// Every notification sent, as (channel, payload).
    pub notifications: Vec<(String, Value)>,
    /// The next build id's counter.
    pub next_build: u64,
}

/// The in-memory queue.
#[derive(Debug, Default)]
pub struct MemQueue {
    state: Mutex<MemState>,
}

impl MemQueue {
    /// An empty queue.
    #[must_use]
    pub fn new() -> MemQueue {
        MemQueue::default()
    }

    /// The state, locked; a poisoned lock is recovered because the state is plain data.
    fn lock(&self) -> MutexGuard<'_, MemState> {
        self.state.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    /// Adds a job row.
    pub fn insert_job(&self, job: MemJob) {
        self.lock().jobs.push(job);
    }

    /// Sets one setting, replacing a previous value.
    pub fn set_setting(&self, key: &str, value: Value) {
        let mut state = self.lock();
        state.settings.retain(|(existing, _)| existing != key);
        state.settings.push((key.to_owned(), value));
    }

    /// Sets the sizing convention spec of a configuration.
    pub fn set_convention(&self, config_id: &str, spec: Value) {
        let mut state = self.lock();
        state.conventions.retain(|(existing, _)| existing != config_id);
        state.conventions.push((config_id.to_owned(), spec));
    }

    /// Sets the ledger's latest library bytes.
    pub fn set_ledger_bytes(&self, bytes: u64) {
        self.lock().ledger_bytes = bytes;
    }

    /// A copy of the state.
    #[must_use]
    pub fn snapshot(&self) -> MemState {
        self.lock().clone()
    }

    /// A copy of one job, if present.
    #[must_use]
    pub fn job(&self, id: &str) -> Option<MemJob> {
        self.lock().jobs.iter().find(|job| job.id == id).cloned()
    }
}

// Skeleton: every method answers at once with NotImplemented until its lane lands.
impl JobQueue for MemQueue {
    fn settings(&self) -> impl Future<Output = Result<Vec<(String, Value)>, BuilderError>> + Send {
        ready(Err(BuilderError::NotImplemented("MemQueue::settings")))
    }

    fn reclaim_stale(
        &self,
        _worker_id: &str,
        _stale_hours: u32,
    ) -> impl Future<Output = Result<u64, BuilderError>> + Send {
        ready(Err(BuilderError::NotImplemented("MemQueue::reclaim_stale")))
    }

    fn claim(
        &self,
        _worker_id: &str,
        _job_id: Option<&str>,
        _gate: &BudgetGate,
    ) -> impl Future<Output = Result<Claim, BuilderError>> + Send {
        ready(Err(BuilderError::NotImplemented("MemQueue::claim")))
    }

    fn new_build_id(&self) -> impl Future<Output = Result<String, BuilderError>> + Send {
        ready(Err(BuilderError::NotImplemented("MemQueue::new_build_id")))
    }

    fn sizing_convention(
        &self,
        _config_id: &str,
    ) -> impl Future<Output = Result<Value, BuilderError>> + Send {
        ready(Err(BuilderError::NotImplemented("MemQueue::sizing_convention")))
    }

    fn progress(
        &self,
        _progress: &BuildProgress,
    ) -> impl Future<Output = Result<(), BuilderError>> + Send {
        ready(Err(BuilderError::NotImplemented("MemQueue::progress")))
    }

    fn publish(
        &self,
        _worker_id: &str,
        _publication: &Publication,
    ) -> impl Future<Output = Result<(), BuilderError>> + Send {
        ready(Err(BuilderError::NotImplemented("MemQueue::publish")))
    }

    fn fail(
        &self,
        _worker_id: &str,
        _failure: &Failure,
        _max_attempts: i16,
    ) -> impl Future<Output = Result<FailureOutcome, BuilderError>> + Send {
        ready(Err(BuilderError::NotImplemented("MemQueue::fail")))
    }

    fn notify_state(
        &self,
        _state: &StatePayload,
    ) -> impl Future<Output = Result<(), BuilderError>> + Send {
        ready(Err(BuilderError::NotImplemented("MemQueue::notify_state")))
    }

    fn plan_inputs(
        &self,
        _gate: &BudgetGate,
    ) -> impl Future<Output = Result<(BTreeSet<JobKey>, u64), BuilderError>> + Send {
        ready(Err(BuilderError::NotImplemented("MemQueue::plan_inputs")))
    }

    fn write_plan(
        &self,
        _plan: &Plan,
    ) -> impl Future<Output = Result<PlanWrite, BuilderError>> + Send {
        ready(Err(BuilderError::NotImplemented("MemQueue::write_plan")))
    }

    fn published_builds(
        &self,
    ) -> impl Future<Output = Result<Vec<PublishedBuild>, BuilderError>> + Send {
        ready(Err(BuilderError::NotImplemented("MemQueue::published_builds")))
    }

    fn mark_unavailable(
        &self,
        _solution_id: &str,
        _reason: &str,
    ) -> impl Future<Output = Result<(), BuilderError>> + Send {
        ready(Err(BuilderError::NotImplemented("MemQueue::mark_unavailable")))
    }

    fn queue_depth(&self) -> impl Future<Output = Result<Vec<(String, i64)>, BuilderError>> + Send {
        ready(Err(BuilderError::NotImplemented("MemQueue::queue_depth")))
    }

    fn ledger_bytes(&self) -> impl Future<Output = Result<u64, BuilderError>> + Send {
        ready(Err(BuilderError::NotImplemented("MemQueue::ledger_bytes")))
    }
}
