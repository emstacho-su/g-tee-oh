//! The claim loop against the in-memory queue and the fake solver (R2.16, R2.17, R2.18):
//! the same `run::tick` the service runs, in milliseconds and without Postgres, so these
//! rules run in continuous integration (CI). The compose integration tests in
//! `integration.rs` repeat the central ones against Postgres, `SeaweedFS` and a real solve.

mod common;

use std::sync::Arc;

use common::{FLOP, NOON_EPOCH, WORKER, env_with, fake, files_under, queue_with, tiny_job};
use gto_library::Manifest;
use library_builder::error::BuilderError;
use library_builder::job::JobOutcome;
use library_builder::notify::{BUILDER_STATE, BuildProgress, COVERAGE_ADDED, CoverageAdded};
use library_builder::queue::mem::MemJob;
use library_builder::queue::{
    BudgetGate, Claim, FailureOutcome, JobQueue, Publication, Unavailable,
};
use library_builder::run::{LoopClock, TickOutcome, run_once, tick};
use library_builder::solve::FakeSolver;
use serde_json::json;

fn gate() -> BudgetGate {
    BudgetGate {
        budget_bytes: 650_000_000_000,
        bytes_per_runout: 1_000,
        bytes_per_flop_tree: 1_000,
    }
}

/// Settings that keep the automatic plan from enumerating the catalog in these tests.
fn no_plan(queue: &library_builder::queue::mem::MemQueue) {
    queue.set_setting("plan_configs", json!([]));
}

#[tokio::test]
async fn r2_17_a_job_publishes_its_build_scenarios_and_notify_in_one_step() {
    let dir = tempfile::tempdir().expect("a scratch directory");
    let queue = queue_with(vec![tiny_job("job-1", FLOP, 1.0)]);
    no_plan(&queue);
    let env = env_with(queue, fake([0.1, 0.2]), dir.path());
    let mut clock = LoopClock::default();

    let outcome = tick(&env, &mut clock, NOON_EPOCH).await.expect("the tick runs");
    let TickOutcome::Ran(JobOutcome::Published(summary)) = outcome else {
        panic!("expected a publish, got {outcome:?}");
    };
    let build_id = summary.build_id.clone().expect("a build id");
    assert_eq!(summary.outcome, "published");
    assert_eq!(summary.lines.len(), 1);
    assert_eq!(summary.lines[0].runout_bytes.len(), 2, "K = 2 runout files");

    let state = env.queue.snapshot();
    let job = env.queue.job("job-1").expect("the job");
    assert_eq!(job.status, "done");
    assert_eq!(job.locked_by, None);
    assert_eq!(state.solutions.len(), 1);
    let solution = &state.solutions[0];
    assert_eq!(solution.status, "published");
    assert_eq!(solution.publication.build_id, build_id);
    assert_eq!(solution.publication.flop, FLOP);
    assert_eq!(solution.publication.scenarios.len(), 2);
    assert_eq!(solution.publication.flop_weight, 24);
    assert_eq!(solution.publication.exploitability_pct_pot, [0.1, 0.2]);
    assert!(solution.publication.bytes > 0);
    assert_eq!(state.ledger_bytes, solution.publication.bytes, "the ledger grew by the build");

    let notified: Vec<CoverageAdded> = state
        .notifications
        .iter()
        .filter(|(channel, _)| channel == COVERAGE_ADDED)
        .map(|(_, payload)| serde_json::from_value(payload.clone()).expect("a payload"))
        .collect();
    assert_eq!(
        notified,
        vec![CoverageAdded {
            config_id: common::CONFIG_ID.to_owned(),
            pair: common::PAIR.to_owned(),
            flop: FLOP.to_owned(),
            build_id: build_id.clone(),
            scenario_count: 2,
        }]
    );

    let library = dir.path().join("library");
    let prefix = format!("builds/{}/{}/{FLOP}/{build_id}", common::CONFIG_ID, common::PAIR);
    let files = files_under(&library.join(&prefix));
    assert!(files.contains(&"manifest.json".to_owned()), "{files:?}");
    assert!(files.contains(&format!("flop/{}.bin.zst", common::LINE)), "{files:?}");
    assert_eq!(files.len(), 1 + 1 + 2, "manifest, flop file, two runout files: {files:?}");
    let manifest = Manifest::from_json(
        &std::fs::read(library.join(&prefix).join("manifest.json")).expect("the manifest"),
    )
    .expect("a manifest");
    assert_eq!(manifest.id, build_id, "the manifest id is the build id (O-177)");
    env.target
        .as_ref()
        .expect("a target")
        .verify_build(&prefix)
        .await
        .expect("every object checks against the manifest (O-184)");
    let view = env.status.view();
    assert_eq!(view.jobs[0], 1, "one job counted done");
    assert!(view.line_count >= 1);
}

#[tokio::test]
async fn r2_17_a_build_above_target_is_never_published_and_three_failures_park_it() {
    let dir = tempfile::tempdir().expect("a scratch directory");
    let queue = queue_with(vec![tiny_job("job-1", FLOP, 1.0)]);
    no_plan(&queue);
    let env = env_with(queue, fake([0.5, 0.1]), dir.path());
    let mut clock = LoopClock::default();
    let mut outcomes = Vec::new();
    for _ in 0..3 {
        match tick(&env, &mut clock, NOON_EPOCH).await.expect("the tick runs") {
            TickOutcome::Ran(JobOutcome::Failed { outcome, summary }) => {
                assert!(
                    summary.error.as_deref().is_some_and(|e| e.contains("target")),
                    "{summary:?}"
                );
                outcomes.push(outcome);
            }
            other => panic!("expected a failure, got {other:?}"),
        }
    }
    assert_eq!(
        outcomes,
        vec![
            FailureOutcome::Requeued { attempts: 1 },
            FailureOutcome::Requeued { attempts: 2 },
            FailureOutcome::Parked { attempts: 3 },
        ]
    );
    let job = env.queue.job("job-1").expect("the job");
    assert_eq!(job.status, "failed", "parked (O-176)");
    assert_eq!(job.attempts, 3);
    assert_eq!(job.last_exploitability_pct_pot, Some([0.5, 0.1]));
    assert!(env.queue.snapshot().solutions.is_empty(), "nothing published");
    assert!(files_under(&dir.path().join("library")).is_empty(), "nothing left in the library");
    let fourth = tick(&env, &mut clock, NOON_EPOCH).await.expect("the tick runs");
    assert!(!matches!(fourth, TickOutcome::Ran(_)), "a parked job is not claimed: {fourth:?}");
}

#[tokio::test]
async fn r2_17_a_memory_cap_refusal_counts_toward_parking() {
    let dir = tempfile::tempdir().expect("a scratch directory");
    let queue = queue_with(vec![tiny_job("job-1", FLOP, 1.0)]);
    no_plan(&queue);
    queue.set_setting("memory_cap_bytes", json!(1024));
    let env = env_with(queue, fake([0.1, 0.1]), dir.path());
    let mut clock = LoopClock::default();
    for attempt in 1..=3_i16 {
        let outcome = tick(&env, &mut clock, NOON_EPOCH).await.expect("the tick runs");
        let TickOutcome::Ran(JobOutcome::Failed { summary, .. }) = outcome else {
            panic!("expected a refusal, got {outcome:?}");
        };
        let error = summary.error.expect("an error");
        assert!(error.contains("memory cap") && error.contains("1024"), "{error}");
        assert_eq!(env.queue.job("job-1").expect("job").attempts, attempt);
    }
    assert_eq!(env.queue.job("job-1").expect("job").status, "failed");
}

#[tokio::test]
async fn r2_16_a_claim_over_the_budget_blocks_the_job() {
    let dir = tempfile::tempdir().expect("a scratch directory");
    let queue = queue_with(vec![tiny_job("job-1", FLOP, 1.0)]);
    no_plan(&queue);
    queue.set_setting("budget_bytes", json!(10));
    let env = env_with(queue, fake([0.1, 0.1]), dir.path());
    let mut clock = LoopClock::default();
    let outcome = tick(&env, &mut clock, NOON_EPOCH).await.expect("the tick runs");
    assert!(
        matches!(&outcome, TickOutcome::Blocked { job_id, .. } if job_id == "job-1"),
        "{outcome:?}"
    );
    let job = env.queue.job("job-1").expect("the job");
    assert_eq!(job.status, "blocked_budget");
    assert!(job.error.as_deref().is_some_and(|e| e.contains("budget")), "{:?}", job.error);
    assert_eq!(job.attempts, 0, "a budget block is not a failure");
}

#[tokio::test]
async fn r2_18_a_setting_change_takes_effect_on_the_next_claim() {
    let dir = tempfile::tempdir().expect("a scratch directory");
    let queue = queue_with(vec![tiny_job("job-1", FLOP, 1.0)]);
    no_plan(&queue);
    queue.set_setting("paused", json!(true));
    let env = env_with(queue, fake([0.1, 0.1]), dir.path());
    let mut clock = LoopClock::default();

    let paused = tick(&env, &mut clock, NOON_EPOCH).await.expect("the tick runs");
    assert_eq!(paused, TickOutcome::Paused);
    assert_eq!(env.queue.job("job-1").expect("job").status, "queued", "nothing claimed");
    let states: Vec<_> = env
        .queue
        .snapshot()
        .notifications
        .into_iter()
        .filter(|(c, _)| c == BUILDER_STATE)
        .collect();
    assert!(states.iter().any(|(_, p)| p["state"] == "paused"), "{states:?}");

    // A cap the fake's estimate exceeds fails the next claim; restoring it lets the one
    // after that publish: both changes act on the next claim, with no restart.
    env.queue.set_setting("paused", json!(false));
    env.queue.set_setting("memory_cap_bytes", json!(1024));
    let refused = tick(&env, &mut clock, NOON_EPOCH).await.expect("the tick runs");
    assert!(matches!(refused, TickOutcome::Ran(JobOutcome::Failed { .. })), "{refused:?}");
    env.queue.set_setting("memory_cap_bytes", json!(5_368_709_120_u64));
    let published = tick(&env, &mut clock, NOON_EPOCH).await.expect("the tick runs");
    assert!(matches!(published, TickOutcome::Ran(JobOutcome::Published(_))), "{published:?}");
}

#[tokio::test]
async fn r2_18_a_malformed_setting_falls_back_and_shows_in_the_status() {
    let dir = tempfile::tempdir().expect("a scratch directory");
    let queue = queue_with(vec![]);
    no_plan(&queue);
    queue.set_setting("cpu_share", json!("lots"));
    let env = env_with(queue, fake([0.1, 0.1]), dir.path());
    let mut clock = LoopClock::default();
    let _ = tick(&env, &mut clock, NOON_EPOCH).await.expect("the tick runs");
    let errors = env.status.view().settings_errors;
    assert_eq!(errors.len(), 1, "{errors:?}");
    assert_eq!(errors[0].key, "cpu_share");
}

#[tokio::test]
async fn r2_17_skip_locked_gives_two_claims_two_jobs() {
    let queue = queue_with(vec![tiny_job("job-a", FLOP, 2.0), tiny_job("job-b", "Kh7d2c", 1.0)]);
    let first = queue.claim("worker-1", None, &gate()).await.expect("a claim");
    let second = queue.claim("worker-2", None, &gate()).await.expect("a claim");
    let third = queue.claim("worker-3", None, &gate()).await.expect("a claim");
    let (Claim::Job(a), Claim::Job(b)) = (first, second) else { panic!("two jobs") };
    assert_eq!(a.id, "job-a", "highest priority first");
    assert_eq!(b.id, "job-b");
    assert_eq!(third, Claim::Empty);
    assert_eq!(queue.job("job-a").expect("job").locked_by.as_deref(), Some("worker-1"));
}

/// A previous process of this worker: the same stable id, another nonce.
const DEAD_PROCESS: &str = "test-worker#dead";

/// This live process.
const LIVE_PROCESS: &str = "test-worker#live";

const HOUR: u64 = 3_600;

/// `job` running under `worker` since `locked_at`, with `attempts` so far.
fn running(job: MemJob, worker: &str, locked_at: u64, attempts: i16) -> MemJob {
    MemJob {
        status: "running".to_owned(),
        locked_by: Some(worker.to_owned()),
        locked_at: Some(locked_at),
        attempts,
        ..job
    }
}

#[tokio::test]
async fn r2_17_stale_reclaim_requeues_this_workers_running_rows() {
    let queue = queue_with(vec![tiny_job("job-1", FLOP, 1.0)]);
    let Claim::Job(_) = queue.claim(DEAD_PROCESS, None, &gate()).await.expect("a claim") else {
        panic!("a job");
    };
    assert_eq!(queue.job("job-1").expect("job").status, "running");
    let requeued = queue.reclaim_stale(LIVE_PROCESS, 6, 3).await.expect("the reclaim");
    assert_eq!(requeued, 1, "a previous nonce of this stable id is a dead process");
    let job = queue.job("job-1").expect("job");
    assert_eq!(job.status, "queued");
    assert_eq!(job.locked_by, None);
    assert_eq!(job.locked_at, None);
    assert_eq!(job.attempts, 1, "a reclaim counts as an attempt (review M1)");
    assert!(job.error.as_deref().is_some_and(|e| e.contains("reclaim")), "{:?}", job.error);
}

#[tokio::test]
async fn r2_17_stale_reclaim_never_takes_this_live_process_or_a_fresh_other_host() {
    let queue = queue_with(vec![
        running(tiny_job("mine", FLOP, 1.0), LIVE_PROCESS, 0, 0),
        running(tiny_job("other-fresh", "Kh7d2c", 1.0), "other-host#1", 5 * HOUR, 0),
        running(tiny_job("other-stale", "Qh7d2c", 1.0), "other-host#2", 0, 0),
    ]);
    queue.set_now(7 * HOUR);
    let requeued = queue.reclaim_stale(LIVE_PROCESS, 6, 3).await.expect("the reclaim");
    assert_eq!(requeued, 1, "only the row locked longer than stale_hours");
    let mine = queue.job("mine").expect("job");
    assert_eq!(mine.status, "running", "this process's own row, even when old");
    assert_eq!(mine.locked_by.as_deref(), Some(LIVE_PROCESS));
    assert_eq!(queue.job("other-fresh").expect("job").status, "running");
    let stale = queue.job("other-stale").expect("job");
    assert_eq!((stale.status.as_str(), stale.attempts), ("queued", 1));
}

#[tokio::test]
async fn r2_17_a_reclaim_at_max_attempts_parks_the_job() {
    let queue = queue_with(vec![running(tiny_job("oom", FLOP, 1.0), DEAD_PROCESS, 0, 2)]);
    let reclaimed = queue.reclaim_stale(LIVE_PROCESS, 6, 3).await.expect("the reclaim");
    assert_eq!(reclaimed, 1);
    let job = queue.job("oom").expect("job");
    assert_eq!(job.status, "failed", "parked (O-176), so an OOM-killed job cannot loop");
    assert_eq!(job.attempts, 3);
    assert_eq!(job.locked_by, None);
    assert!(job.error.as_deref().is_some_and(|e| e.contains("reclaim")), "{:?}", job.error);
    let next = queue.claim(LIVE_PROCESS, None, &gate()).await.expect("a claim");
    assert_eq!(next, Claim::Empty, "a parked job is not claimed");
}

#[tokio::test]
async fn r2_17_progress_refreshes_the_lock_so_a_live_long_job_is_not_stale() {
    let queue = queue_with(vec![tiny_job("long", FLOP, 1.0)]);
    let Claim::Job(_) = queue.claim("other-host#busy", None, &gate()).await.expect("a claim")
    else {
        panic!("a job");
    };
    assert_eq!(queue.job("long").expect("job").locked_at, Some(0), "the claim stamps the lock");
    queue.set_now(5 * HOUR);
    let progress = BuildProgress {
        job_id: "long".to_owned(),
        line: common::LINE.to_owned(),
        iteration: 100,
        exploitability: None,
    };
    queue.progress(&progress).await.expect("progress");
    assert_eq!(queue.job("long").expect("job").locked_at, Some(5 * HOUR));
    queue.set_now(8 * HOUR);
    let requeued = queue.reclaim_stale(LIVE_PROCESS, 6, 3).await.expect("the reclaim");
    assert_eq!(requeued, 0, "3 hours since the last progress is under stale_hours");
    assert_eq!(queue.job("long").expect("job").status, "running");
}

/// A publication of `job_id` on `flop` adding `bytes`.
fn publication(job_id: &str, build_id: &str, flop: &str, bytes: u64) -> Publication {
    Publication {
        job_id: job_id.to_owned(),
        build_id: build_id.to_owned(),
        config_id: common::CONFIG_ID.to_owned(),
        pair: common::PAIR.to_owned(),
        flop: flop.to_owned(),
        flop_weight: 24,
        engine_version: "test".to_owned(),
        manifest_uri: format!("builds/x/{build_id}/manifest.json"),
        exploitability_pct_pot: [0.1, 0.1],
        scenarios: Vec::new(),
        bytes,
    }
}

/// A job on `FLOP` with tree hash `[byte; 32]`, in `status`.
fn same_flop(id: &str, byte: u8, status: &str) -> MemJob {
    let job = MemJob::queued(
        id,
        common::CONFIG_ID,
        common::PAIR,
        FLOP,
        &[common::LINE],
        [byte; 32],
        2,
        1.0,
    );
    MemJob { status: status.to_owned(), ..job }
}

#[tokio::test]
async fn r2_17_mark_unavailable_requeues_only_its_own_done_job_and_gives_bytes_back() {
    let own = MemJob { attempts: 2, ..tiny_job("own", FLOP, 1.0) };
    let queue = queue_with(vec![own]);
    let Claim::Job(_) = queue.claim(WORKER, None, &gate()).await.expect("a claim") else {
        panic!("a job");
    };
    queue.publish(WORKER, &publication("own", "build-1", FLOP, 100)).await.expect("published");
    queue.set_ledger_bytes(250);
    queue.insert_job(running(same_flop("running", 1, "queued"), "other-host#1", 0, 0));
    queue.insert_job(MemJob { attempts: 3, ..same_flop("parked", 2, "failed") });
    queue.insert_job(same_flop("blocked", 3, "blocked_budget"));
    queue.insert_job(same_flop("done-other-hash", 4, "done"));
    let before = queue.snapshot();

    let broken = Unavailable {
        solution_id: "build-1".to_owned(),
        tree_config_hash: Some(common::placeholder_tree_hash().to_vec()),
        bytes: 100,
        reason: "checksum mismatch".to_owned(),
    };
    queue.mark_unavailable(&broken).await.expect("marked");

    let own = queue.job("own").expect("job");
    assert_eq!(own.status, "queued");
    assert_eq!(own.attempts, 0, "attempts reset");
    assert_eq!(own.error.as_deref(), Some("checksum mismatch"));
    for id in ["running", "parked", "blocked", "done-other-hash"] {
        let was = before.jobs.iter().find(|job| job.id == id).expect("seeded");
        assert_eq!(&queue.job(id).expect("job"), was, "{id} is untouched");
    }
    let state = queue.snapshot();
    assert_eq!(state.ledger_bytes, 150, "the ledger gives the build's bytes back");
    assert_eq!(state.solutions[0].status, "unavailable");
    queue.mark_unavailable(&broken).await.expect("a repeat is a no-op");
    assert_eq!(queue.snapshot().ledger_bytes, 150, "a repeat does not subtract twice");
}

#[tokio::test]
async fn r2_17_mark_unavailable_without_a_hash_requeues_nothing_and_floors_the_ledger() {
    let queue = queue_with(vec![tiny_job("own", FLOP, 1.0)]);
    let Claim::Job(_) = queue.claim(WORKER, None, &gate()).await.expect("a claim") else {
        panic!("a job");
    };
    queue.publish(WORKER, &publication("own", "build-1", FLOP, 100)).await.expect("published");
    queue.set_ledger_bytes(40);
    let broken = Unavailable {
        solution_id: "build-1".to_owned(),
        tree_config_hash: None,
        bytes: 100,
        reason: "missing manifest".to_owned(),
    };
    queue.mark_unavailable(&broken).await.expect("marked");
    assert_eq!(queue.job("own").expect("job").status, "done", "no hash, no re-queue");
    let state = queue.snapshot();
    assert_eq!(state.ledger_bytes, 0, "never below 0");
    assert_eq!(state.solutions[0].status, "unavailable");
}

#[tokio::test]
async fn r2_18_once_runs_one_job_and_reports_nothing_queued_after() {
    let dir = tempfile::tempdir().expect("a scratch directory");
    let queue = queue_with(vec![tiny_job("job-1", FLOP, 1.0)]);
    no_plan(&queue);
    let env = env_with(queue, fake([0.1, 0.2]), dir.path());
    let summary = run_once(&env, None).await.expect("one job runs");
    assert_eq!(summary.job_id, "job-1");
    assert_eq!(summary.outcome, "published");
    let nothing = run_once(&env, None).await;
    assert!(matches!(nothing, Err(BuilderError::JobNotQueued(_))), "{nothing:?}");
}

#[tokio::test]
async fn r2_17_a_failing_solver_is_recorded_with_its_error() {
    let dir = tempfile::tempdir().expect("a scratch directory");
    let queue = queue_with(vec![tiny_job("job-1", FLOP, 1.0)]);
    no_plan(&queue);
    let solver = FakeSolver {
        fail_with: Some("engine exploded".to_owned()),
        ..FakeSolver::converging([0.1, 0.1])
    };
    let env = env_with(queue, Arc::new(solver), dir.path());
    let mut clock = LoopClock::default();
    let outcome = tick(&env, &mut clock, NOON_EPOCH).await.expect("the tick runs");
    assert!(matches!(outcome, TickOutcome::Ran(JobOutcome::Failed { .. })), "{outcome:?}");
    let job = env.queue.job("job-1").expect("job");
    assert!(job.error.as_deref().is_some_and(|e| e.contains("engine exploded")), "{:?}", job.error);
}
