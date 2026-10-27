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
    PublishedBuild, Unavailable, job_key, row_k_and_priority,
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

    /// T1 under the lock.
    fn claim(&mut self, worker_id: &str, job_id: Option<&str>, gate: &BudgetGate) -> Claim {
        let Some(index) = self.head(job_id) else { return Claim::Empty };
        let estimate = self.jobs[index].estimate(gate);
        let used = self.used_bytes(gate, index);
        let job = &mut self.jobs[index];
        if let Some(reason) = gate.refusal(estimate, used) {
            "blocked_budget".clone_into(&mut job.status);
            job.error = Some(reason.clone());
            return Claim::Blocked { job_id: job.id.clone(), reason };
        }
        "running".clone_into(&mut job.status);
        job.locked_by = Some(worker_id.to_owned());
        Claim::Job(job.claimed())
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
        self.solutions
            .push(MemSolution { publication: publication.clone(), status: "published".to_owned() });
        self.ledger_bytes = self.ledger_bytes.saturating_add(publication.bytes);
        let job = &mut self.jobs[index];
        "done".clone_into(&mut job.status);
        job.locked_by = None;
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

    /// Marks a solution unavailable and re-queues its job with attempts reset (O-186).
    fn mark_unavailable(&mut self, solution_id: &str, reason: &str) {
        let Some(solution) =
            self.solutions.iter_mut().find(|s| s.publication.build_id == solution_id)
        else {
            tracing::warn!(solution_id, "mark_unavailable: no such solution");
            return;
        };
        "unavailable".clone_into(&mut solution.status);
        let published = solution.publication.clone();
        for job in &mut self.jobs {
            if job.game_config_id == published.config_id
                && job.position_pair == published.pair
                && job.flop == published.flop
            {
                "queued".clone_into(&mut job.status);
                job.attempts = 0;
                job.error = Some(reason.to_owned());
                job.locked_by = None;
            }
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

    /// No clock is kept in memory, so the rows re-queued are the running rows this worker
    /// holds (the restart case of O-185); `stale_hours` has nothing to compare with.
    fn reclaim_stale(
        &self,
        worker_id: &str,
        _stale_hours: u32,
        _max_attempts: i16,
    ) -> impl Future<Output = Result<u64, BuilderError>> + Send {
        let mut state = self.lock();
        let mut requeued = 0;
        for job in &mut state.jobs {
            if job.status == "running" && job.locked_by.as_deref() == Some(worker_id) {
                "queued".clone_into(&mut job.status);
                job.locked_by = None;
                requeued += 1;
            }
        }
        ready(Ok(requeued))
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
            if let Some(index) = state.index_of(&progress.job_id) {
                state.jobs[index].progress = Some(value.clone());
            }
            state.notifications.push((BUILD_PROGRESS.to_owned(), value));
        });
        ready(result)
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
        self.lock().mark_unavailable(&build.solution_id, &build.reason);
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
mod tests {
    use gto_model::{ConfigId, Flop, PositionPair};
    use gto_planner::{JobSpec, Plan};

    use super::{MemJob, MemQueue};
    use crate::queue::{BudgetGate, Claim, Failure, JobQueue, PlanWrite, Publication};

    fn gate(budget_bytes: u64) -> BudgetGate {
        BudgetGate { budget_bytes, bytes_per_runout: 10, bytes_per_flop_tree: 5 }
    }

    fn job(id: &str, flop: &str, priority: f32) -> MemJob {
        MemJob::queued(id, "cfg_6_online_100", "BB-BTN", flop, &["r250.c"], [7; 32], 2, priority)
    }

    fn spec(flop: &str) -> JobSpec {
        JobSpec {
            game_config_id: ConfigId::new("cfg_6_online_100").expect("an id"),
            position_pair: "BB-BTN".parse::<PositionPair>().expect("a pair"),
            flop: flop.parse::<Flop>().expect("a flop"),
            preflop_lines: vec!["r250.c".to_owned()],
            tree_config_hash: [7; 32],
            k_runouts: 2,
            priority: 0.5,
            estimated_bytes: 25,
        }
    }

    fn publication(job_id: &str, build_id: &str) -> Publication {
        Publication {
            job_id: job_id.to_owned(),
            build_id: build_id.to_owned(),
            config_id: "cfg_6_online_100".to_owned(),
            pair: "BB-BTN".to_owned(),
            flop: "Ah7d2c".to_owned(),
            flop_weight: 24,
            engine_version: "test".to_owned(),
            manifest_uri: format!("builds/x/{build_id}/manifest.json"),
            exploitability_pct_pot: [0.1, 0.2],
            scenarios: Vec::new(),
            bytes: 40,
        }
    }

    #[tokio::test]
    async fn r2_17_ties_go_to_the_row_inserted_first_and_a_named_claim_needs_queued() {
        let queue = MemQueue::new();
        queue.insert_job(job("a", "Ah7d2c", 1.0));
        queue.insert_job(job("b", "Kh7d2c", 1.0));
        let named = queue.claim("w", Some("b"), &gate(u64::MAX)).await.expect("a claim");
        assert!(matches!(named, Claim::Job(ref j) if j.id == "b"), "{named:?}");
        let again = queue.claim("w", Some("b"), &gate(u64::MAX)).await.expect("a claim");
        assert_eq!(again, Claim::Empty, "a running job is not claimable by name");
        let head = queue.claim("w", None, &gate(u64::MAX)).await.expect("a claim");
        assert!(matches!(head, Claim::Job(ref j) if j.id == "a"), "{head:?}");
    }

    #[tokio::test]
    async fn r2_17_publish_needs_the_lock_and_supersedes_the_previous_build() {
        let queue = MemQueue::new();
        queue.insert_job(job("a", "Ah7d2c", 1.0));
        let lost = queue.publish("w", &publication("a", "b1")).await;
        assert!(lost.is_err(), "a queued job cannot publish");
        let Claim::Job(_) = queue.claim("w", None, &gate(u64::MAX)).await.expect("claim") else {
            panic!("a job");
        };
        queue.publish("w", &publication("a", "b1")).await.expect("publishes");
        queue.insert_job(job("a2", "Ah7d2c", 1.0));
        let Claim::Job(_) = queue.claim("w", Some("a2"), &gate(u64::MAX)).await.expect("claim")
        else {
            panic!("a job");
        };
        queue.publish("w", &publication("a2", "b2")).await.expect("publishes");
        let state = queue.snapshot();
        let statuses: Vec<&str> = state.solutions.iter().map(|s| s.status.as_str()).collect();
        assert_eq!(statuses, ["superseded", "published"]);
        assert_eq!(state.ledger_bytes, 80);
        let builds = queue.published_builds().await.expect("builds");
        assert_eq!(builds.len(), 1);
        let broken = crate::queue::Unavailable {
            solution_id: "b2".to_owned(),
            tree_config_hash: None,
            bytes: 0,
            reason: "checksum".to_owned(),
        };
        queue.mark_unavailable(&broken).await.expect("marks");
        assert_eq!(queue.job("a2").expect("job").status, "queued");
        assert_eq!(queue.job("a2").expect("job").attempts, 0);
        assert_eq!(queue.published_builds().await.expect("builds"), Vec::new());
    }

    #[tokio::test]
    async fn r2_17_the_budget_gate_counts_the_ledger_and_running_jobs() {
        let queue = MemQueue::new();
        queue.insert_job(job("a", "Ah7d2c", 2.0));
        queue.insert_job(job("b", "Kh7d2c", 1.0));
        queue.set_ledger_bytes(10);
        let gate = gate(10 + 2 * queue.job("a").expect("a").estimate(&gate(0)) - 1);
        let first = queue.claim("w", None, &gate).await.expect("a claim");
        assert!(matches!(first, Claim::Job(_)), "{first:?}");
        let second = queue.claim("w", None, &gate).await.expect("a claim");
        let Claim::Blocked { job_id, reason } = second else { panic!("blocked: {second:?}") };
        assert_eq!(job_id, "b");
        assert!(reason.contains("budget"), "{reason}");
        let failure = Failure { job_id: "b".to_owned(), error: "x".to_owned(), ..failure() };
        assert!(queue.fail("w", &failure, 3).await.is_err(), "an unlocked job cannot fail");
    }

    fn failure() -> Failure {
        Failure { job_id: String::new(), error: String::new(), exploitability_pct_pot: None }
    }

    #[tokio::test]
    async fn r2_16_a_plan_inserts_once_and_promotes_blocked_rows() {
        let queue = MemQueue::new();
        let plan = Plan {
            queued: vec![spec("Ah7d2c")],
            blocked: vec![spec("Kh7d2c")],
            committed_bytes: 0,
        };
        let first = queue.write_plan(&plan).await.expect("written");
        assert_eq!(first, PlanWrite { queued: 1, blocked: 1, promoted: 0 });
        let again = queue.write_plan(&plan).await.expect("written");
        assert_eq!(again, PlanWrite::default());
        let (keys, committed) = queue.plan_inputs(&gate(0)).await.expect("inputs");
        assert_eq!(keys.len(), 1, "blocked rows are not existing keys");
        assert_eq!(committed, gate(0).estimate(1, 2));
        let promote = Plan { queued: vec![spec("Kh7d2c")], blocked: vec![], committed_bytes: 0 };
        let promoted = queue.write_plan(&promote).await.expect("written");
        assert_eq!(promoted, PlanWrite { queued: 0, blocked: 0, promoted: 1 });
        let depth = queue.queue_depth().await.expect("depth");
        assert_eq!(depth, vec![("queued".to_owned(), 2)]);
    }
}
