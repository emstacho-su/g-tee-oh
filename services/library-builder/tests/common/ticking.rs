//! A queue over [`MemQueue`] that moves the queue's clock one hour forward before every
//! progress write and every touch, and records what each refresh left in `locked_at` and
//! whether the build's manifest was already in the library by then (R2.17, PR #22
//! re-review LOW 3). The manifest is uploaded last, so a refresh that sees it ran after
//! the upload; one that does not ran while the build was staged.

use std::collections::BTreeSet;
use std::future::Future;
use std::path::PathBuf;
use std::sync::{Mutex, PoisonError};

use gto_planner::{JobKey, Plan};
use library_builder::error::BuilderError;
use library_builder::notify::{BuildProgress, StatePayload};
use library_builder::queue::mem::MemQueue;
use library_builder::queue::{
    BudgetGate, Claim, Failure, FailureOutcome, JobQueue, PlanWrite, Publication, PublishedBuild,
    Unavailable,
};
use serde_json::Value;

use super::files_under;

/// Seconds the clock moves before each refresh.
pub const STEP_SECONDS: u64 = 3_600;

/// One refresh as the wrapper saw it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Beat {
    /// `progress` or `touch`.
    pub kind: &'static str,
    /// The queue's clock when the refresh ran.
    pub now: u64,
    /// The job's `locked_at` right after it.
    pub locked_at: Option<u64>,
    /// True when a `manifest.json` was already in the library.
    pub uploaded: bool,
}

/// The wrapper.
pub struct Ticking {
    /// The queue underneath.
    pub inner: MemQueue,
    /// The library directory the build is uploaded to.
    pub library: PathBuf,
    beats: Mutex<Vec<Beat>>,
}

impl Ticking {
    /// A wrapper over `inner` watching `library`.
    pub fn new(inner: MemQueue, library: PathBuf) -> Ticking {
        Ticking { inner, library, beats: Mutex::new(Vec::new()) }
    }

    /// Every refresh so far.
    pub fn beats(&self) -> Vec<Beat> {
        self.beats.lock().unwrap_or_else(PoisonError::into_inner).clone()
    }

    /// Moves the clock one step and answers the new time.
    fn advance(&self) -> u64 {
        let now = self.inner.snapshot().now + STEP_SECONDS;
        self.inner.set_now(now);
        now
    }

    /// Records a refresh of `job_id` that ran at `now`.
    fn record(&self, kind: &'static str, job_id: &str, now: u64) {
        let locked_at = self.inner.job(job_id).and_then(|job| job.locked_at);
        let uploaded = files_under(&self.library).iter().any(|f| f.ends_with("manifest.json"));
        let beat = Beat { kind, now, locked_at, uploaded };
        self.beats.lock().unwrap_or_else(PoisonError::into_inner).push(beat);
    }
}

impl JobQueue for Ticking {
    fn settings(&self) -> impl Future<Output = Result<Vec<(String, Value)>, BuilderError>> + Send {
        self.inner.settings()
    }

    fn hold_liveness(
        &self,
        worker_id: &str,
    ) -> impl Future<Output = Result<(), BuilderError>> + Send {
        self.inner.hold_liveness(worker_id)
    }

    fn reclaim_stale(
        &self,
        worker_id: &str,
        stale_hours: u32,
        max_attempts: i16,
    ) -> impl Future<Output = Result<u64, BuilderError>> + Send {
        self.inner.reclaim_stale(worker_id, stale_hours, max_attempts)
    }

    fn claim(
        &self,
        worker_id: &str,
        job_id: Option<&str>,
        gate: &BudgetGate,
    ) -> impl Future<Output = Result<Claim, BuilderError>> + Send {
        self.inner.claim(worker_id, job_id, gate)
    }

    fn new_build_id(&self) -> impl Future<Output = Result<String, BuilderError>> + Send {
        self.inner.new_build_id()
    }

    fn sizing_convention(
        &self,
        config_id: &str,
    ) -> impl Future<Output = Result<Value, BuilderError>> + Send {
        self.inner.sizing_convention(config_id)
    }

    fn progress(
        &self,
        progress: &BuildProgress,
    ) -> impl Future<Output = Result<(), BuilderError>> + Send {
        let now = self.advance();
        let job_id = progress.job_id.clone();
        let inner = self.inner.progress(progress);
        async move {
            let result = inner.await;
            self.record("progress", &job_id, now);
            result
        }
    }

    fn touch(
        &self,
        job_id: &str,
        worker_id: &str,
    ) -> impl Future<Output = Result<(), BuilderError>> + Send {
        let now = self.advance();
        let id = job_id.to_owned();
        let inner = self.inner.touch(job_id, worker_id);
        async move {
            let result = inner.await;
            self.record("touch", &id, now);
            result
        }
    }

    fn publish(
        &self,
        worker_id: &str,
        publication: &Publication,
    ) -> impl Future<Output = Result<(), BuilderError>> + Send {
        self.inner.publish(worker_id, publication)
    }

    fn fail(
        &self,
        worker_id: &str,
        failure: &Failure,
        max_attempts: i16,
    ) -> impl Future<Output = Result<FailureOutcome, BuilderError>> + Send {
        self.inner.fail(worker_id, failure, max_attempts)
    }

    fn notify_state(
        &self,
        state: &StatePayload,
    ) -> impl Future<Output = Result<(), BuilderError>> + Send {
        self.inner.notify_state(state)
    }

    fn plan_inputs(
        &self,
        gate: &BudgetGate,
    ) -> impl Future<Output = Result<(BTreeSet<JobKey>, u64), BuilderError>> + Send {
        self.inner.plan_inputs(gate)
    }

    fn write_plan(
        &self,
        plan: &Plan,
    ) -> impl Future<Output = Result<PlanWrite, BuilderError>> + Send {
        self.inner.write_plan(plan)
    }

    fn published_builds(
        &self,
    ) -> impl Future<Output = Result<Vec<PublishedBuild>, BuilderError>> + Send {
        self.inner.published_builds()
    }

    fn mark_unavailable(
        &self,
        build: &Unavailable,
    ) -> impl Future<Output = Result<(), BuilderError>> + Send {
        self.inner.mark_unavailable(build)
    }

    fn queue_depth(&self) -> impl Future<Output = Result<Vec<(String, i64)>, BuilderError>> + Send {
        self.inner.queue_depth()
    }

    fn ledger_bytes(&self) -> impl Future<Output = Result<u64, BuilderError>> + Send {
        self.inner.ledger_bytes()
    }
}
