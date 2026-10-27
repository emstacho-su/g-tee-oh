//! The PR #22 re-review fixes against Postgres (R2.17): a publish records its job, tree
//! hash and bytes, so a build whose whole prefix is lost is undone from the database alone;
//! a superseded solution is never marked; a live process's liveness lock keeps its row from
//! the reclaim of another process with the same stable id; and a touch refreshes
//! `locked_at`. These need only Postgres: the build goes to a directory target with the
//! fake solver, so the bucket is never touched.

use std::path::Path;
use std::sync::Arc;

use super::{
    CONFIG_ID, HEAD, PAIR, Seed, TEST_FLOPS, add_to_ledger, admin, clean, database, insert_job,
    job_row, latest_ledger, seed,
};
use gto_planner::PriorReach;
use library_builder::job::Env;
use library_builder::ops::Status;
use library_builder::queue::pg::PgQueue;
use library_builder::queue::{JobQueue, Unavailable, liveness_key};
use library_builder::ranges::FixtureRanges;
use library_builder::run::run_once;
use library_builder::solve::FakeSolver;
use library_builder::store::{CheckDepth, LibraryTarget, VerifyOutcome};
use sqlx::Row;

/// An environment over Postgres with the fake solver and a directory target under `root`.
fn fs_env(root: &Path) -> Env<PgQueue> {
    let library = root.join("library");
    std::fs::create_dir_all(&library).expect("the library directory");
    Env {
        queue: Arc::new(PgQueue::connect_lazy(&database())),
        solver: Arc::new(FakeSolver::converging([0.1, 0.2])),
        target: Some(LibraryTarget::Fs { root: library }),
        ranges: Arc::new(
            FixtureRanges::load(&super::fixture("tiny-bb-btn-srp.json")).expect("ranges"),
        ),
        reach: Arc::new(PriorReach),
        scratch_dir: root.join("scratch"),
        worker_id: "itest-recorded#1".to_owned(),
        builder_threads: 2,
        status: Arc::new(Status::default()),
        limits: library_builder::settings::Limits::default(),
    }
}

/// The verify pass's steps on this one build (check, then mark), not `verify_once`: a shared dev
/// database may hold published builds that this test's directory target does not.
#[tokio::test]
#[ignore = "R2.17: needs Postgres migrated (just db-migrate) and BUILDER_DB_*, POSTGRES_PASSWORD"]
async fn r2_17_a_lost_build_prefix_is_undone_from_what_the_publish_recorded() {
    let admin = admin().await;
    clean(&admin).await;
    let dir = tempfile::tempdir().expect("a scratch directory");
    let env = fs_env(dir.path());
    let job_id = insert_job(&admin, TEST_FLOPS[8], HEAD).await;
    let summary = run_once(&env, Some(&job_id)).await.expect("the job runs");
    assert_eq!(summary.outcome, "published", "{summary:?}");
    let build_id = summary.build_id.expect("a build id");

    let row = sqlx::query(
        "select build_job_id::text, tree_config_hash, bytes, manifest_uri from solution
         where id = $1::uuid",
    )
    .bind(&build_id)
    .fetch_one(&admin)
    .await
    .expect("the solution row");
    assert_eq!(row.get::<Option<String>, _>(0).as_deref(), Some(job_id.as_str()));
    let hash: Option<Vec<u8>> = row.get(1);
    assert_eq!(hash, Some(common_hash()), "the job's tree hash is recorded");
    let bytes: i64 = row.get::<Option<i64>, _>(2).expect("the bytes are recorded");
    assert!(bytes > 0);
    let manifest_uri: String = row.get(3);
    let prefix = manifest_uri.trim_end_matches("/manifest.json").to_owned();

    std::fs::remove_dir_all(dir.path().join("library").join(&prefix)).expect("the prefix is gone");
    let target = env.target.as_ref().expect("a target");
    let VerifyOutcome::Broken { facts, reason } =
        target.check_build(&prefix, CheckDepth::Full).await
    else {
        panic!("a lost prefix is broken");
    };
    assert_eq!((facts.tree_hash.as_ref(), facts.bytes), (None, 0), "the store tells nothing");
    add_to_ledger(&admin, 9_000).await;
    let ledger_before = latest_ledger(&admin).await;
    let broken = Unavailable {
        solution_id: build_id.clone(),
        tree_config_hash: facts.tree_hash,
        bytes: facts.bytes,
        reason,
    };
    env.queue.mark_unavailable(&broken).await.expect("marked");

    let (status, attempts, ..) = job_row(&admin, &job_id).await;
    assert_eq!((status.as_str(), attempts), ("queued", 0), "the recorded job is re-queued");
    let solution: String = sqlx::query_scalar("select status from solution where id = $1::uuid")
        .bind(&build_id)
        .fetch_one(&admin)
        .await
        .expect("the solution");
    assert_eq!(solution, "unavailable");
    assert_eq!(latest_ledger(&admin).await, ledger_before - bytes, "the recorded bytes go back");
    clean(&admin).await;
}

fn common_hash() -> Vec<u8> {
    super::placeholder_tree_hash().to_vec()
}

#[tokio::test]
#[ignore = "R2.17: needs Postgres migrated (just db-migrate) and BUILDER_DB_*, POSTGRES_PASSWORD"]
async fn r2_17_mark_unavailable_leaves_a_superseded_solution_and_its_job_alone() {
    let admin = admin().await;
    clean(&admin).await;
    let flop = TEST_FLOPS[9];
    let done = Seed { flop, byte: 41, status: "done", locked_by: None, hours_ago: 0, attempts: 1 };
    let job_id = seed(&admin, &done).await;
    let solution_id: String = sqlx::query_scalar(
        "insert into solution (kind, source, game_config_id, position_pair, flop, manifest_uri,
         status, build_job_id, tree_config_hash, bytes) values ('flop_build', 'own', $1, $2, $3,
         'builds/test/manifest.json', 'superseded', $4::uuid, $5, 5000) returning id::text",
    )
    .bind(CONFIG_ID)
    .bind(PAIR)
    .bind(flop)
    .bind(&job_id)
    .bind(vec![41_u8; 32])
    .fetch_one(&admin)
    .await
    .expect("the solution");
    add_to_ledger(&admin, 5_000).await;
    let ledger_before = latest_ledger(&admin).await;
    let job_before = job_row(&admin, &job_id).await;

    let queue = PgQueue::connect_lazy(&database());
    let broken = Unavailable {
        solution_id: solution_id.clone(),
        tree_config_hash: Some(vec![41; 32]),
        bytes: 5_000,
        reason: "checksum mismatch".to_owned(),
    };
    queue.mark_unavailable(&broken).await.expect("a no-op");

    assert_eq!(job_row(&admin, &job_id).await, job_before, "the job is untouched");
    let status: String = sqlx::query_scalar("select status from solution where id = $1::uuid")
        .bind(&solution_id)
        .fetch_one(&admin)
        .await
        .expect("the solution");
    assert_eq!(status, "superseded");
    assert_eq!(latest_ledger(&admin).await, ledger_before, "no bytes are taken off");
    clean(&admin).await;
}

#[tokio::test]
#[ignore = "R2.17: needs Postgres migrated (just db-migrate) and BUILDER_DB_*, POSTGRES_PASSWORD"]
async fn r2_17_a_live_holder_with_the_same_stable_id_keeps_its_row_until_its_lock_ends() {
    const HOLDER: &str = "itest-live#once";
    const RECLAIMER: &str = "itest-live#loop";
    let admin = admin().await;
    clean(&admin).await;
    let running = Seed {
        flop: TEST_FLOPS[10],
        byte: 51,
        status: "running",
        locked_by: Some(HOLDER),
        hours_ago: 0,
        attempts: 0,
    };
    let id = seed(&admin, &running).await;
    // The holder's process: a session holding its liveness key.
    let mut holder = admin.acquire().await.expect("a connection");
    let taken: bool = sqlx::query_scalar("select pg_try_advisory_lock($1)")
        .bind(liveness_key(HOLDER))
        .fetch_one(&mut *holder)
        .await
        .expect("the lock");
    assert!(taken, "nobody else holds the holder's key");

    let queue = PgQueue::connect_lazy(&database());
    queue.hold_liveness(RECLAIMER).await.expect("this process is live");
    queue.reclaim_stale(RECLAIMER, 6, 3).await.expect("the reclaim");
    let (status, _, locked_by, ..) = job_row(&admin, &id).await;
    assert_eq!((status.as_str(), locked_by.as_deref()), ("running", Some(HOLDER)), "live: kept");

    let released: bool = sqlx::query_scalar("select pg_advisory_unlock($1)")
        .bind(liveness_key(HOLDER))
        .fetch_one(&mut *holder)
        .await
        .expect("the unlock");
    assert!(released);
    queue.reclaim_stale(RECLAIMER, 6, 3).await.expect("the reclaim");
    let (status, attempts, locked_by, ..) = job_row(&admin, &id).await;
    assert_eq!((status.as_str(), attempts, locked_by), ("queued", 1, None), "dead: reclaimed");

    // The queue holds its own key on a connection of its own.
    let free: bool = sqlx::query_scalar("select pg_try_advisory_lock($1)")
        .bind(liveness_key(RECLAIMER))
        .fetch_one(&mut *holder)
        .await
        .expect("the probe");
    assert!(!free, "hold_liveness keeps the reclaimer's key");
    clean(&admin).await;
}

#[tokio::test]
#[ignore = "R2.17: needs Postgres migrated (just db-migrate) and BUILDER_DB_*, POSTGRES_PASSWORD"]
async fn r2_17_touch_refreshes_locked_at_only_for_the_holder() {
    let admin = admin().await;
    clean(&admin).await;
    let busy = Seed {
        flop: TEST_FLOPS[11],
        byte: 61,
        status: "running",
        locked_by: Some("other-host#busy"),
        hours_ago: 7,
        attempts: 0,
    };
    let id = seed(&admin, &busy).await;
    let queue = PgQueue::connect_lazy(&database());
    let fresh = || async {
        sqlx::query_scalar::<_, bool>(
            "select locked_at > now() - interval '1 minute' from build_job where id = $1::uuid",
        )
        .bind(&id)
        .fetch_one(&admin)
        .await
        .expect("the lock time")
    };
    queue.touch(&id, "someone-else#1").await.expect("a no-op");
    assert!(!fresh().await, "another worker's touch leaves the lock alone");
    queue.touch(&id, "other-host#busy").await.expect("a touch");
    assert!(fresh().await, "the holder's touch refreshed locked_at");
    clean(&admin).await;
}
