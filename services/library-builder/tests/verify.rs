//! The verify pass (R2.17, O-186; PR #22 review HIGH 1, H1, MEDIUM 6) against the in-memory
//! queue and a directory target: only an integrity failure marks a build, a store that
//! stops answering marks nothing, the cheap pass catches a missing object and reads one
//! build in full round-robin, and the pass never runs on the loop's first tick.

mod common;

use std::collections::BTreeSet;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use common::{FLOP, NOON_EPOCH, env_with, fake, queue_with, tiny_job};
use gto_planner::{JobKey, Plan};
use library_builder::error::BuilderError;
use library_builder::job::Env;
use library_builder::notify::{BuildProgress, StatePayload};
use library_builder::queue::mem::MemQueue;
use library_builder::queue::{
    BudgetGate, Claim, Failure, FailureOutcome, JobQueue, PlanWrite, Publication, PublishedBuild,
    Unavailable,
};
use library_builder::run::{LoopClock, TickOutcome, VerifyMode, run_loop, tick, verify_once};
use serde_json::{Value, json};

/// The second flop; no fixture combo holds one of its cards either.
const OTHER_FLOP: &str = "Kh7d2c";

/// A published build as the tests see it.
struct Built {
    solution_id: String,
    job_id: &'static str,
    dir: PathBuf,
    bytes: u64,
}

/// Two published builds, on `FLOP` (job-a) and `OTHER_FLOP` (job-b), in publish order.
async fn two_builds(root: &Path) -> (Env<MemQueue>, Vec<Built>) {
    let queue = queue_with(vec![tiny_job("job-a", FLOP, 2.0), tiny_job("job-b", OTHER_FLOP, 1.0)]);
    queue.set_setting("plan_configs", json!([]));
    let env = env_with(queue, fake([0.1, 0.2]), root);
    let mut clock = LoopClock::default();
    for _ in 0..2 {
        let outcome = tick(&env, &mut clock, NOON_EPOCH).await.expect("the tick runs");
        assert!(matches!(outcome, TickOutcome::Ran(_)), "{outcome:?}");
    }
    let library = root.join("library");
    let built = env
        .queue
        .snapshot()
        .solutions
        .iter()
        .zip(["job-a", "job-b"])
        .map(|(solution, job_id)| Built {
            solution_id: solution.publication.build_id.clone(),
            job_id,
            dir: library.join(solution.publication.manifest_uri.trim_end_matches("/manifest.json")),
            bytes: solution.publication.bytes,
        })
        .collect::<Vec<_>>();
    assert_eq!(built.len(), 2, "two builds published");
    (env, built)
}

/// The first file of a build's `flop` directory.
fn flop_file(build: &Built) -> PathBuf {
    let entries = std::fs::read_dir(build.dir.join("flop")).expect("the flop directory");
    entries.flatten().map(|entry| entry.path()).next().expect("a flop file")
}

/// Rewrites a file with the same length and different bytes.
fn rewrite_same_length(file: &Path) {
    let bytes = std::fs::read(file).expect("the file");
    let flipped: Vec<u8> = bytes.iter().map(|byte| byte ^ 0xff).collect();
    std::fs::write(file, flipped).expect("rewritten");
}

/// The status of each solution, in publish order.
fn statuses(env: &Env<MemQueue>) -> Vec<String> {
    env.queue.snapshot().solutions.iter().map(|s| s.status.clone()).collect()
}

#[tokio::test]
async fn r2_17_a_corrupted_file_marks_only_that_build_and_requeues_its_own_job() {
    let dir = tempfile::tempdir().expect("a scratch directory");
    let (env, built) = two_builds(dir.path()).await;
    let ledger_before = env.queue.snapshot().ledger_bytes;
    rewrite_same_length(&flop_file(&built[0]));

    let report = verify_once(&env, VerifyMode::Full).await.expect("the pass runs");

    assert_eq!(report.checked, 2);
    assert_eq!(report.read_in_full, 2);
    assert_eq!(report.unavailable, [built[0].solution_id.clone()]);
    assert_eq!(statuses(&env), ["unavailable", "published"]);
    let job = env.queue.job(built[0].job_id).expect("the job");
    assert_eq!(job.status, "queued", "the manifest's tree hash found the job");
    assert_eq!(job.attempts, 0);
    assert!(job.error.as_deref().is_some_and(|e| e.contains("checksum")), "{job:?}");
    assert_eq!(env.queue.job(built[1].job_id).expect("the job").status, "done");
    assert_eq!(
        env.queue.snapshot().ledger_bytes,
        ledger_before - built[0].bytes,
        "the build's bytes went back to the ledger"
    );
}

#[tokio::test]
async fn r2_17_the_cheap_pass_catches_a_missing_object_and_reads_one_build_in_full() {
    let dir = tempfile::tempdir().expect("a scratch directory");
    let (env, built) = two_builds(dir.path()).await;
    std::fs::remove_file(flop_file(&built[0])).expect("removed");
    rewrite_same_length(&flop_file(&built[1]));

    let first = verify_once(&env, VerifyMode::Sampled { pass: 0 }).await.expect("pass 0");
    assert_eq!(first.read_in_full, 1);
    assert_eq!(first.unavailable, [built[0].solution_id.clone()], "the missing file");
    assert_eq!(statuses(&env), ["unavailable", "published"], "a same-length rewrite passes a HEAD");

    let second = verify_once(&env, VerifyMode::Sampled { pass: 1 }).await.expect("pass 1");
    assert_eq!(second.checked, 1, "only the published build is left");
    assert_eq!(second.unavailable, [built[1].solution_id.clone()], "read in full on its turn");
}

#[tokio::test]
async fn r2_17_an_unreachable_target_aborts_the_pass_and_marks_nothing() {
    let dir = tempfile::tempdir().expect("a scratch directory");
    let (env, built) = two_builds(dir.path()).await;
    rewrite_same_length(&flop_file(&built[0]));
    std::fs::remove_dir_all(dir.path().join("library")).expect("the root is gone");

    let aborted = verify_once(&env, VerifyMode::Full).await;

    assert!(matches!(aborted, Err(BuilderError::Store { operation: "probe", .. })), "{aborted:?}");
    assert_eq!(statuses(&env), ["published", "published"]);
}

#[tokio::test]
async fn r2_17_a_root_that_disappears_mid_pass_marks_nothing() {
    let dir = tempfile::tempdir().expect("a scratch directory");
    let (env, built) = two_builds(dir.path()).await;
    rewrite_same_length(&flop_file(&built[0]));
    let vanishing = Env {
        queue: Arc::new(Vanishing {
            inner: Arc::clone(&env.queue),
            root: dir.path().join("library"),
        }),
        solver: Arc::clone(&env.solver),
        target: env.target.clone(),
        ranges: Arc::clone(&env.ranges),
        reach: Arc::clone(&env.reach),
        scratch_dir: env.scratch_dir.clone(),
        worker_id: env.worker_id.clone(),
        builder_threads: env.builder_threads,
        status: Arc::clone(&env.status),
        limits: env.limits,
    };

    let aborted = verify_once(&vanishing, VerifyMode::Full).await;

    assert!(aborted.is_err(), "a vanished root is unreachable, not every build missing");
    assert_eq!(statuses(&env), ["published", "published"]);
    assert_eq!(env.queue.job(built[0].job_id).expect("the job").status, "done");
}

#[tokio::test]
async fn r2_17_the_loop_never_verifies_on_its_first_tick() {
    let dir = tempfile::tempdir().expect("a scratch directory");
    let (env, built) = two_builds(dir.path()).await;
    rewrite_same_length(&flop_file(&built[0]));
    std::fs::remove_file(flop_file(&built[1])).expect("removed");

    run_loop(&env, tokio::time::sleep(Duration::from_millis(300))).await.expect("the loop stops");

    assert_eq!(statuses(&env), ["published", "published"], "no pass ran at start");
}

/// The in-memory queue, but listing the published builds removes the library root: the
/// probe before the pass succeeds and every read after it finds nothing.
struct Vanishing {
    inner: Arc<MemQueue>,
    root: PathBuf,
}

impl JobQueue for Vanishing {
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
        self.inner.progress(progress)
    }

    fn touch(
        &self,
        job_id: &str,
        worker_id: &str,
    ) -> impl Future<Output = Result<(), BuilderError>> + Send {
        self.inner.touch(job_id, worker_id)
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
        std::fs::remove_dir_all(&self.root).expect("the root is removed mid-pass");
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
