//! An in-memory [`JobQueue`] with the same rules as [`super::pg::PgQueue`], for the loop
//! and operations tests that run in continuous integration (CI) without Postgres. A mutex
//! around one state value stands in for the row locks: each trait method takes it once,
//! so each runs as one transaction. The accessors at the bottom let a test seed jobs and
//! settings and read back what the loop wrote.

use std::collections::BTreeSet;
use std::future::{Future, ready};
use std::sync::{Mutex, MutexGuard};

use gto_planner::{JobKey, JobSpec, Plan};
use serde_json::Value;

use super::{
    BudgetGate, Claim, ClaimedJob, Failure, FailureOutcome, JobQueue, PlanWrite, Publication,
    PublishedBuild, SECONDS_PER_HOUR, Unavailable, job_key, reclaim_error, row_k_and_priority,
    stable_worker_id,
};
use crate::error::BuilderError;
use crate::notify::{
    BUILD_PROGRESS, BUILDER_STATE, BuildProgress, COVERAGE_ADDED, CoverageAdded, StatePayload,
};

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
    /// When the lock was taken or last refreshed by progress, in seconds of the queue's
    /// clock ([`MemQueue::set_now`]).
    pub locked_at: Option<u64>,
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
            locked_at: None,
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
    /// `build_job_id`: the job whose publish wrote it; `None` stands for a row published
    /// before migration `20261027000200`.
    pub build_job_id: Option<String>,
    /// `tree_config_hash`, that job's tree hash.
    pub tree_config_hash: Option<Vec<u8>>,
    /// `bytes`, what the publish added to the ledger.
    pub bytes: Option<u64>,
}

impl MemSolution {
    /// Whether `job` is the job this solution's unavailable mark re-queues: the recorded
    /// job, or for an old row the job of the same key, `fallback_hash` standing in for the
    /// unrecorded tree hash (PR #22 re-review HIGH 1).
    fn owns(&self, job: &MemJob, fallback_hash: Option<&[u8]>) -> bool {
        if let Some(id) = &self.build_job_id {
            return &job.id == id;
        }
        let hash = self.tree_config_hash.as_deref().or(fallback_hash);
        let p = &self.publication;
        hash.is_some_and(|hash| {
            job.game_config_id == p.config_id
                && job.position_pair == p.pair
                && job.flop == p.flop
                && job.tree_config_hash == hash
        })
    }
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
    /// The clock that stands in for `now()`, in seconds; tests move it with
    /// [`MemQueue::set_now`].
    pub now: u64,
    /// The full worker ids whose liveness signal is held, standing in for the advisory
    /// locks `PgQueue` takes; tests end one with [`MemQueue::mark_dead`].
    pub live: BTreeSet<String>,
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

    /// Sets the queue's clock, in seconds: claims and progress stamp `locked_at` with it
    /// and the stale reclaim compares against it, as Postgres does with `now()`.
    pub fn set_now(&self, seconds: u64) {
        self.lock().now = seconds;
    }

    /// Ends the process `worker_id`: its liveness signal is released, as Postgres releases
    /// the advisory lock when a process's connection closes.
    pub fn mark_dead(&self, worker_id: &str) {
        self.lock().live.remove(worker_id);
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

impl MemJob {
    /// The claimed form of the row.
    fn claimed(&self) -> ClaimedJob {
        ClaimedJob {
            id: self.id.clone(),
            game_config_id: self.game_config_id.clone(),
            position_pair: self.position_pair.clone(),
            flop: self.flop.clone(),
            preflop_lines: self.preflop_lines.clone(),
            tree_config_hash: self.tree_config_hash.clone(),
            k_runouts: self.k_runouts,
            priority: self.priority,
            attempts: self.attempts,
        }
    }

    /// The row's unique key.
    fn key(&self) -> Result<JobKey, BuilderError> {
        job_key(&self.game_config_id, &self.position_pair, &self.flop, &self.tree_config_hash)
    }

    /// The row's estimated bytes under `gate`.
    fn estimate(&self, gate: &BudgetGate) -> u64 {
        gate.estimate(self.preflop_lines.len(), self.k_runouts)
    }
}

/// A notification's payload as JSON.
fn payload<T: serde::Serialize>(channel: &str, value: &T) -> Result<Value, BuilderError> {
    serde_json::to_value(value).map_err(|err| BuilderError::Malformed {
        path: channel.to_owned(),
        reason: err.to_string(),
    })
}

impl MemState {
    /// The index of the job `id`.
    fn index_of(&self, id: &str) -> Option<usize> {
        self.jobs.iter().position(|job| job.id == id)
    }

    /// The index of the job `id` when `worker_id` holds it running, else `LostLock`.
    fn locked_index(&self, worker_id: &str, id: &str) -> Result<usize, BuilderError> {
        self.index_of(id)
            .filter(|&index| {
                let job = &self.jobs[index];
                job.status == "running" && job.locked_by.as_deref() == Some(worker_id)
            })
            .ok_or_else(|| BuilderError::LostLock(id.to_owned()))
    }

    /// The queue head: the highest priority among queued rows (the named one only, when
    /// given), ties to the row inserted first, as `order by priority desc, created_at`.
    fn head(&self, job_id: Option<&str>) -> Option<usize> {
        self.jobs
            .iter()
            .enumerate()
            .filter(|(_, job)| job.status == "queued" && job_id.is_none_or(|id| job.id == id))
            .max_by(|(a_index, a), (b_index, b)| {
                a.priority.total_cmp(&b.priority).then_with(|| b_index.cmp(a_index))
            })
            .map(|(index, _)| index)
    }

    /// The latest ledger bytes plus the estimates of running rows other than `except`.
    fn used_bytes(&self, gate: &BudgetGate, except: usize) -> u64 {
        self.jobs
            .iter()
            .enumerate()
            .filter(|(index, job)| *index != except && job.status == "running")
            .fold(self.ledger_bytes, |sum, (_, job)| sum.saturating_add(job.estimate(gate)))
    }

    /// T1 under the lock. The mutex is held for the whole call, so two claims never both
    /// pass the budget gate on the same figure: it stands in for the advisory lock
    /// `PgQueue` takes (review L4).
    fn claim(&mut self, worker_id: &str, job_id: Option<&str>, gate: &BudgetGate) -> Claim {
        let Some(index) = self.head(job_id) else { return Claim::Empty };
        let estimate = self.jobs[index].estimate(gate);
        let used = self.used_bytes(gate, index);
        let now = self.now;
        let job = &mut self.jobs[index];
        if let Some(reason) = gate.refusal(estimate, used) {
            "blocked_budget".clone_into(&mut job.status);
            job.error = Some(reason.clone());
            return Claim::Blocked { job_id: job.id.clone(), reason };
        }
        "running".clone_into(&mut job.status);
        job.locked_by = Some(worker_id.to_owned());
        job.locked_at = Some(now);
        Claim::Job(job.claimed())
    }

    /// Whether the stale reclaim takes `job` for the process `worker_id`: running, not
    /// held by exactly this process, and held by a dead previous process of this worker
    /// (the same stable id, another nonce, not in `live`) or locked at or before `cutoff`
    /// (O-185, review M1, L6, PR #22 re-review MEDIUM).
    fn reclaimable(
        job: &MemJob,
        worker_id: &str,
        cutoff: Option<u64>,
        live: &BTreeSet<String>,
    ) -> bool {
        let holder = job.locked_by.as_deref();
        let dead_previous = holder.is_some_and(|by| {
            by != worker_id
                && stable_worker_id(by) == stable_worker_id(worker_id)
                && !live.contains(by)
        });
        let stale = job.locked_at.zip(cutoff).is_some_and(|(at, cutoff)| at < cutoff);
        job.status == "running" && holder != Some(worker_id) && (dead_previous || stale)
    }

    /// The stale reclaim under the lock, as `PgQueue::reclaim_stale` does it.
    fn reclaim_stale(&mut self, worker_id: &str, stale_hours: u32, max_attempts: i16) -> u64 {
        let cutoff = self.now.checked_sub(u64::from(stale_hours) * SECONDS_PER_HOUR);
        let mut reclaimed = 0;
        for job in &mut self.jobs {
            if !Self::reclaimable(job, worker_id, cutoff, &self.live) {
                continue;
            }
            let holder = job.locked_by.take().unwrap_or_default();
            let attempts = job.attempts.saturating_add(1);
            let parked = attempts >= max_attempts;
            job.attempts = attempts;
            job.locked_at = None;
            job.error = Some(reclaim_error(&holder, attempts, parked));
            let status = if parked { "failed" } else { "queued" };
            status.clone_into(&mut job.status);
            reclaimed += 1;
        }
        reclaimed
    }

    /// T2 under the lock.
    fn publish(&mut self, worker_id: &str, publication: &Publication) -> Result<(), BuilderError> {
        let index = self.locked_index(worker_id, &publication.job_id)?;
        let scenario_count = u32::try_from(publication.scenarios.len()).unwrap_or(u32::MAX);
        let notice = payload(
            COVERAGE_ADDED,
            &CoverageAdded {
                config_id: publication.config_id.clone(),
                pair: publication.pair.clone(),
                flop: publication.flop.clone(),
                build_id: publication.build_id.clone(),
                scenario_count,
            },
        )?;
        for solution in &mut self.solutions {
            let same = &solution.publication;
            if solution.status == "published"
                && same.config_id == publication.config_id
                && same.pair == publication.pair
                && same.flop == publication.flop
            {
                "superseded".clone_into(&mut solution.status);
            }
        }
        self.solutions.push(MemSolution {
            publication: publication.clone(),
            status: "published".to_owned(),
            build_job_id: Some(publication.job_id.clone()),
            tree_config_hash: Some(self.jobs[index].tree_config_hash.clone()),
            bytes: Some(publication.bytes),
        });
        self.ledger_bytes = self.ledger_bytes.saturating_add(publication.bytes);
        let job = &mut self.jobs[index];
        "done".clone_into(&mut job.status);
        job.locked_by = None;
        job.locked_at = None;
        job.error = None;
        job.last_exploitability_pct_pot = Some(publication.exploitability_pct_pot);
        self.notifications.push((COVERAGE_ADDED.to_owned(), notice));
        Ok(())
    }

    /// T3 under the lock.
    fn fail(
        &mut self,
        worker_id: &str,
        failure: &Failure,
        max_attempts: i16,
    ) -> Result<FailureOutcome, BuilderError> {
        let index = self
            .index_of(&failure.job_id)
            .filter(|&index| self.jobs[index].locked_by.as_deref() == Some(worker_id))
            .ok_or_else(|| BuilderError::LostLock(failure.job_id.clone()))?;
        let job = &mut self.jobs[index];
        let attempts = job.attempts.saturating_add(1);
        job.attempts = attempts;
        job.error = Some(failure.error.clone());
        job.last_exploitability_pct_pot =
            failure.exploitability_pct_pot.or(job.last_exploitability_pct_pot);
        job.locked_by = None;
        job.locked_at = None;
        if attempts >= max_attempts {
            "failed".clone_into(&mut job.status);
            Ok(FailureOutcome::Parked { attempts })
        } else {
            "queued".clone_into(&mut job.status);
            Ok(FailureOutcome::Requeued { attempts })
        }
    }

    /// The keys of rows not `blocked_budget`, and the ledger plus the estimates of the
    /// queued and running rows.
    fn plan_inputs(&self, gate: &BudgetGate) -> Result<(BTreeSet<JobKey>, u64), BuilderError> {
        let keys = self
            .jobs
            .iter()
            .filter(|job| job.status != "blocked_budget")
            .map(MemJob::key)
            .collect::<Result<BTreeSet<_>, _>>()?;
        let committed = self
            .jobs
            .iter()
            .filter(|job| job.status == "queued" || job.status == "running")
            .fold(self.ledger_bytes, |sum, job| sum.saturating_add(job.estimate(gate)));
        Ok((keys, committed))
    }

    /// A fresh UUIDv7-shaped id from the counter.
    fn next_id(&mut self) -> String {
        let id = format!("0192f000-0000-7000-8000-{:012}", self.next_build);
        self.next_build += 1;
        id
    }

    /// Inserts `spec` as a new row with `status` unless its key exists; true when inserted.
    fn insert_spec(&mut self, spec: &JobSpec, status: &str) -> Result<bool, BuilderError> {
        let key = spec.key();
        if self.find_key(&key)?.is_some() {
            return Ok(false);
        }
        let (k_runouts, priority) = row_k_and_priority(spec)?;
        let id = self.next_id();
        let lines: Vec<&str> = spec.preflop_lines.iter().map(String::as_str).collect();
        let job = MemJob::queued(
            &id,
            &key.game_config_id,
            &key.position_pair,
            &key.flop,
            &lines,
            key.tree_config_hash,
            k_runouts,
            priority,
        );
        self.jobs.push(MemJob { status: status.to_owned(), ..job });
        Ok(true)
    }

    /// The index of the row with `key`.
    fn find_key(&self, key: &JobKey) -> Result<Option<usize>, BuilderError> {
        for (index, job) in self.jobs.iter().enumerate() {
            if &job.key()? == key {
                return Ok(Some(index));
            }
        }
        Ok(None)
    }

    /// Writes a plan as `PgQueue::write_plan` does.
    fn write_plan(&mut self, plan: &Plan) -> Result<PlanWrite, BuilderError> {
        let mut write = PlanWrite::default();
        for spec in &plan.queued {
            if self.insert_spec(spec, "queued")? {
                write.queued += 1;
            } else if let Some(index) = self.find_key(&spec.key())? {
                let job = &mut self.jobs[index];
                if job.status == "blocked_budget" {
                    "queued".clone_into(&mut job.status);
                    job.error = None;
                    write.promoted += 1;
                }
            }
        }
        for spec in &plan.blocked {
            if self.insert_spec(spec, "blocked_budget")? {
                write.blocked += 1;
            }
        }
        Ok(write)
    }

    /// Marks a `published` solution unavailable, re-queues the `done` job its publish
    /// recorded and gives the recorded bytes back to the ledger, as
    /// `PgQueue::mark_unavailable` does (O-186, PR #22 re-review HIGH 1, LOW 1). A solution
    /// no longer published is left alone, so a repeat never subtracts twice and a build
    /// superseded mid-pass never re-queues the job that superseded it.
    fn mark_unavailable(&mut self, build: &Unavailable) {
        let Some(solution) = self
            .solutions
            .iter_mut()
            .find(|s| s.publication.build_id == build.solution_id && s.status == "published")
        else {
            tracing::warn!(solution_id = %build.solution_id,
                "mark_unavailable: no such solution, or no longer published");
            return;
        };
        "unavailable".clone_into(&mut solution.status);
        let solution = solution.clone();
        let fallback_hash = build.tree_config_hash.as_deref();
        let own = self
            .jobs
            .iter_mut()
            .filter(|job| job.status == "done" && solution.owns(job, fallback_hash));
        for job in own {
            "queued".clone_into(&mut job.status);
            job.attempts = 0;
            job.error = Some(build.reason.clone());
            job.locked_by = None;
            job.locked_at = None;
        }
        let bytes = solution.bytes.unwrap_or(build.bytes);
        self.ledger_bytes = self.ledger_bytes.saturating_sub(bytes);
    }

    /// Refreshes `locked_at` of `job_id` while `worker_id` holds it running.
    fn touch(&mut self, job_id: &str, worker_id: &str) {
        let now = self.now;
        if let Ok(index) = self.locked_index(worker_id, job_id) {
            self.jobs[index].locked_at = Some(now);
        }
    }

    /// Rows per status, sorted by status.
    fn queue_depth(&self) -> Vec<(String, i64)> {
        let mut counts = std::collections::BTreeMap::<String, i64>::new();
        for job in &self.jobs {
            *counts.entry(job.status.clone()).or_default() += 1;
        }
        counts.into_iter().collect()
    }
}

// Every method takes the lock once and answers at once: one transaction per call.
impl JobQueue for MemQueue {
    fn settings(&self) -> impl Future<Output = Result<Vec<(String, Value)>, BuilderError>> + Send {
        ready(Ok(self.lock().settings.clone()))
    }

    /// Adds `worker_id` to the live set, standing in for the advisory lock.
    fn hold_liveness(
        &self,
        worker_id: &str,
    ) -> impl Future<Output = Result<(), BuilderError>> + Send {
        self.lock().live.insert(worker_id.to_owned());
        ready(Ok(()))
    }

    /// Staleness is measured against the queue's clock ([`MemQueue::set_now`]).
    fn reclaim_stale(
        &self,
        worker_id: &str,
        stale_hours: u32,
        max_attempts: i16,
    ) -> impl Future<Output = Result<u64, BuilderError>> + Send {
        ready(Ok(self.lock().reclaim_stale(worker_id, stale_hours, max_attempts)))
    }

    fn claim(
        &self,
        worker_id: &str,
        job_id: Option<&str>,
        gate: &BudgetGate,
    ) -> impl Future<Output = Result<Claim, BuilderError>> + Send {
        ready(Ok(self.lock().claim(worker_id, job_id, gate)))
    }

    fn new_build_id(&self) -> impl Future<Output = Result<String, BuilderError>> + Send {
        ready(Ok(self.lock().next_id()))
    }

    fn sizing_convention(
        &self,
        config_id: &str,
    ) -> impl Future<Output = Result<Value, BuilderError>> + Send {
        let state = self.lock();
        let found = state.conventions.iter().find(|(id, _)| id == config_id);
        ready(
            found
                .map(|(_, spec)| spec.clone())
                .ok_or_else(|| BuilderError::UnknownConfig(config_id.to_owned())),
        )
    }

    fn progress(
        &self,
        progress: &BuildProgress,
    ) -> impl Future<Output = Result<(), BuilderError>> + Send {
        let result = payload(BUILD_PROGRESS, progress).map(|value| {
            let mut state = self.lock();
            let now = state.now;
            if let Some(index) = state.index_of(&progress.job_id) {
                let job = &mut state.jobs[index];
                job.progress = Some(value.clone());
                if job.status == "running" {
                    job.locked_at = Some(now);
                }
            }
            state.notifications.push((BUILD_PROGRESS.to_owned(), value));
        });
        ready(result)
    }

    fn touch(
        &self,
        job_id: &str,
        worker_id: &str,
    ) -> impl Future<Output = Result<(), BuilderError>> + Send {
        self.lock().touch(job_id, worker_id);
        ready(Ok(()))
    }

    fn publish(
        &self,
        worker_id: &str,
        publication: &Publication,
    ) -> impl Future<Output = Result<(), BuilderError>> + Send {
        ready(self.lock().publish(worker_id, publication))
    }

    fn fail(
        &self,
        worker_id: &str,
        failure: &Failure,
        max_attempts: i16,
    ) -> impl Future<Output = Result<FailureOutcome, BuilderError>> + Send {
        ready(self.lock().fail(worker_id, failure, max_attempts))
    }

    fn notify_state(
        &self,
        state: &StatePayload,
    ) -> impl Future<Output = Result<(), BuilderError>> + Send {
        let result = payload(BUILDER_STATE, state)
            .map(|value| self.lock().notifications.push((BUILDER_STATE.to_owned(), value)));
        ready(result)
    }

    fn plan_inputs(
        &self,
        gate: &BudgetGate,
    ) -> impl Future<Output = Result<(BTreeSet<JobKey>, u64), BuilderError>> + Send {
        ready(self.lock().plan_inputs(gate))
    }

    fn write_plan(
        &self,
        plan: &Plan,
    ) -> impl Future<Output = Result<PlanWrite, BuilderError>> + Send {
        ready(self.lock().write_plan(plan))
    }

    fn published_builds(
        &self,
    ) -> impl Future<Output = Result<Vec<PublishedBuild>, BuilderError>> + Send {
        let builds = self
            .lock()
            .solutions
            .iter()
            .filter(|solution| solution.status == "published")
            .map(|solution| PublishedBuild {
                solution_id: solution.publication.build_id.clone(),
                manifest_uri: solution.publication.manifest_uri.clone(),
            })
            .collect();
        ready(Ok(builds))
    }

    fn mark_unavailable(
        &self,
        build: &Unavailable,
    ) -> impl Future<Output = Result<(), BuilderError>> + Send {
        self.lock().mark_unavailable(build);
        ready(Ok(()))
    }

    fn queue_depth(&self) -> impl Future<Output = Result<Vec<(String, i64)>, BuilderError>> + Send {
        ready(Ok(self.lock().queue_depth()))
    }

    fn ledger_bytes(&self) -> impl Future<Output = Result<u64, BuilderError>> + Send {
        ready(Ok(self.lock().ledger_bytes))
    }
}

#[cfg(test)]
mod tests;
