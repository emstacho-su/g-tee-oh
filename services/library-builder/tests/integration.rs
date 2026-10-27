//! The builder against real Postgres and `SeaweedFS` in the compose dev profile with a tiny
//! real solve (R2.16, R2.17, R2.18): one-transaction publish of the solution and scenario
//! rows, `coverage_added` observed by a listener, a job parked after three failures, a
//! `SKIP LOCKED` claim, a budget block from a live setting, and the planner's writes.
//!
//! These tests are ignored in continuous integration; run them on a machine with the dev
//! profile up, the migrations applied and the service variables exported from `.env`
//! (`BUILDER_DB_PASSWORD`, `S3_ENDPOINT=http://127.0.0.1:8333`, `S3_LIBRARY_ACCESS_KEY`,
//! `S3_LIBRARY_SECRET_KEY`, and `POSTGRES_PASSWORD` for the superuser that seeds and
//! cleans the test rows):
//!
//! ```text
//! just dev-up; just db-migrate
//! cargo test --release -p library-builder --test integration -- --ignored --test-threads=1
//! just dev-down
//! ```
//!
//! One thread, because `builder_setting` is one table every test may change. Every test
//! works on flops of its own and removes its rows and settings before and after.

mod common;

use std::collections::BTreeSet;
use std::sync::Arc;
use std::time::Duration;

use common::{CONFIG_ID, LINE, PAIR, fixture, placeholder_tree_hash};
use gto_planner::PriorReach;
use library_builder::config::Config;
use library_builder::error::BuilderError;
use library_builder::job::Env;
use library_builder::notify::{COVERAGE_ADDED, CoverageAdded};
use library_builder::ops::Status;
use library_builder::queue::pg::PgQueue;
use library_builder::queue::{BudgetGate, Claim, JobQueue};
use library_builder::ranges::FixtureRanges;
use library_builder::run::{plan_once, run_once};
use library_builder::settings::BuilderSettings;
use library_builder::solve::EngineSolver;
use library_builder::store::LibraryTarget;
use sqlx::Row;
use sqlx::postgres::{PgConnectOptions, PgListener, PgPool, PgPoolOptions, PgSslMode};

/// The flops these tests own; nothing else in the dev database is touched.
const TEST_FLOPS: [&str; 5] = ["Ah7d2c", "Kh7d2c", "Qh7d2c", "Jh7d2c", "Th7d2c"];

/// The priority of a test job: above anything a real plan writes, so it is the head.
const HEAD: f32 = 1.0e9;

/// The settings keys the tests set.
const TEST_KEYS: [&str; 4] = ["memory_cap_bytes", "budget_bytes", "paused", "plan_configs"];

fn config() -> Config {
    let config = Config::from_env().expect("the BUILDER_* and S3_* variables are well formed");
    assert!(config.database.is_some(), "export BUILDER_DB_PASSWORD from .env");
    assert!(config.store.is_configured(), "export S3_ENDPOINT and the library identity");
    config
}

/// The superuser pool that seeds and cleans test rows.
async fn admin() -> PgPool {
    let password = std::env::var("POSTGRES_PASSWORD").expect("export POSTGRES_PASSWORD from .env");
    let database = config().database.expect("configured");
    let options = PgConnectOptions::new_without_pgpass()
        .host(&database.host)
        .port(database.port)
        .database(&database.name)
        .username("postgres")
        .password(&password)
        .ssl_mode(PgSslMode::Disable);
    PgPoolOptions::new().max_connections(2).connect_with(options).await.expect("the superuser")
}

async fn clean(admin: &PgPool) {
    let flops: Vec<String> = TEST_FLOPS.iter().map(|f| (*f).to_owned()).collect();
    sqlx::query(
        "delete from scenario where solution_id in (select id from solution
         where game_config_id = $1 and position_pair = $2 and flop = any($3))",
    )
    .bind(CONFIG_ID)
    .bind(PAIR)
    .bind(&flops)
    .execute(admin)
    .await
    .expect("scenarios cleaned");
    sqlx::query(
        "delete from solution where game_config_id = $1 and position_pair = $2 and flop = any($3)",
    )
    .bind(CONFIG_ID)
    .bind(PAIR)
    .bind(&flops)
    .execute(admin)
    .await
    .expect("solutions cleaned");
    sqlx::query(
        "delete from build_job where game_config_id = $1 and position_pair = $2 and flop = any($3)",
    )
    .bind(CONFIG_ID)
    .bind(PAIR)
    .bind(&flops)
    .execute(admin)
    .await
    .expect("jobs cleaned");
    let keys: Vec<String> = TEST_KEYS.iter().map(|k| (*k).to_owned()).collect();
    sqlx::query("delete from builder_setting where key = any($1)")
        .bind(&keys)
        .execute(admin)
        .await
        .expect("settings cleaned");
}

async fn set(admin: &PgPool, key: &str, value: serde_json::Value) {
    sqlx::query(
        "insert into builder_setting (key, value) values ($1, $2)
         on conflict (key) do update set value = excluded.value",
    )
    .bind(key)
    .bind(value)
    .execute(admin)
    .await
    .expect("the setting is written");
}

/// Inserts a queued test job on `flop` as the builder role would see it.
async fn insert_job(admin: &PgPool, flop: &str, priority: f32) -> String {
    sqlx::query(
        "insert into build_job (game_config_id, position_pair, flop, preflop_lines,
         tree_config_hash, k_runouts, priority) values ($1, $2, $3, $4, $5, 2, $6)
         returning id::text",
    )
    .bind(CONFIG_ID)
    .bind(PAIR)
    .bind(flop)
    .bind(vec![LINE.to_owned()])
    .bind(placeholder_tree_hash().to_vec())
    .bind(priority)
    .fetch_one(admin)
    .await
    .expect("the job is inserted")
    .get(0)
}

fn env(config: &Config) -> Env<PgQueue> {
    let database = config.database.as_ref().expect("configured");
    let scratch = tempfile::tempdir().expect("scratch").keep();
    Env {
        queue: Arc::new(PgQueue::connect_lazy(database)),
        solver: Arc::new(EngineSolver),
        target: Some(LibraryTarget::from_config(&config.store).expect("the S3 target")),
        ranges: Arc::new(FixtureRanges::load(&fixture("tiny-bb-btn-srp.json")).expect("ranges")),
        reach: Arc::new(PriorReach),
        scratch_dir: scratch,
        worker_id: "integration-test".to_owned(),
        builder_threads: 4,
        status: Arc::new(Status::default()),
        limits: library_builder::settings::Limits::default(),
    }
}

#[tokio::test]
#[ignore = "R2.17: needs the compose dev profile (just dev-up, just db-migrate) and .env exported"]
async fn r2_17_publishes_one_build_and_notifies() {
    let admin = admin().await;
    clean(&admin).await;
    let config = config();
    let env = env(&config);
    let job_id = insert_job(&admin, TEST_FLOPS[0], HEAD).await;
    let mut listener = PgListener::connect_with(&admin).await.expect("a listener");
    listener.listen(COVERAGE_ADDED).await.expect("listening");

    let summary = run_once(&env, Some(&job_id)).await.expect("the job runs");
    assert_eq!(summary.outcome, "published", "{summary:?}");
    let build_id = summary.build_id.clone().expect("a build id");

    let notification = tokio::time::timeout(Duration::from_secs(10), listener.recv())
        .await
        .expect("the notify arrives within 10 seconds")
        .expect("a notification");
    let payload: CoverageAdded = serde_json::from_str(notification.payload()).expect("the payload");
    assert_eq!(payload.build_id, build_id);
    assert_eq!(payload.config_id, CONFIG_ID);
    assert_eq!(payload.pair, PAIR);
    assert_eq!(payload.flop, TEST_FLOPS[0]);
    assert_eq!(payload.scenario_count, 2);

    let row = sqlx::query(
        "select status, kind::text, source::text, manifest_uri, exploitability_pct_pot
         from solution where id = $1::uuid",
    )
    .bind(&build_id)
    .fetch_one(&admin)
    .await
    .expect("the solution row");
    assert_eq!(row.get::<String, _>(0), "published");
    assert_eq!(row.get::<String, _>(1), "flop_build");
    assert_eq!(row.get::<String, _>(2), "own");
    let manifest_uri: String = row.get(3);
    assert!(manifest_uri.ends_with(&format!("{build_id}/manifest.json")), "{manifest_uri}");
    let gains: Vec<f32> = row.get(4);
    assert!(gains.iter().all(|g| *g <= 0.3), "{gains:?}");

    let runouts: Vec<(String, String)> =
        sqlx::query_as("select turn, river from scenario where solution_id = $1::uuid")
            .bind(&build_id)
            .fetch_all(&admin)
            .await
            .expect("the scenario rows");
    assert_eq!(runouts.len(), 2);
    assert_eq!(runouts.iter().collect::<BTreeSet<_>>().len(), 2, "two distinct runouts");

    let job: (String, Option<String>) =
        sqlx::query_as("select status::text, locked_by from build_job where id = $1::uuid")
            .bind(&job_id)
            .fetch_one(&admin)
            .await
            .expect("the job");
    assert_eq!(job, ("done".to_owned(), None));
    let ledger: i64 =
        sqlx::query_scalar("select library_bytes from storage_ledger order by day desc limit 1")
            .fetch_one(&admin)
            .await
            .expect("a ledger row");
    assert!(ledger >= i64::try_from(summary.bytes_written).expect("fits"));

    let prefix = manifest_uri.trim_end_matches("/manifest.json");
    let target = env.target.as_ref().expect("a target");
    target.verify_build(prefix).await.expect("every object reads back with its sha256");
    clean(&admin).await;
}

#[tokio::test]
#[ignore = "R2.17: needs the compose dev profile (just dev-up, just db-migrate) and .env exported"]
async fn r2_17_parks_a_job_after_three_failures() {
    let admin = admin().await;
    clean(&admin).await;
    set(&admin, "memory_cap_bytes", serde_json::json!(1024)).await;
    let config = config();
    let env = env(&config);
    let job_id = insert_job(&admin, TEST_FLOPS[1], HEAD).await;
    for attempt in 1..=3 {
        let summary = run_once(&env, Some(&job_id)).await.expect("the attempt is recorded");
        let expected = if attempt < 3 { "requeued" } else { "parked" };
        assert_eq!(summary.outcome, expected, "attempt {attempt}: {summary:?}");
    }
    let (status, attempts, error): (String, i16, Option<String>) =
        sqlx::query_as("select status::text, attempts, error from build_job where id = $1::uuid")
            .bind(&job_id)
            .fetch_one(&admin)
            .await
            .expect("the job");
    assert_eq!(status, "failed", "parked (O-176)");
    assert_eq!(attempts, 3);
    assert!(error.is_some_and(|e| e.contains("memory cap")), "the refusal names the cap");
    let fourth = run_once(&env, Some(&job_id)).await;
    assert!(matches!(fourth, Err(BuilderError::JobNotQueued(_))), "{fourth:?}");
    let published: i64 =
        sqlx::query_scalar("select count(*) from solution where game_config_id = $1 and flop = $2")
            .bind(CONFIG_ID)
            .bind(TEST_FLOPS[1])
            .fetch_one(&admin)
            .await
            .expect("a count");
    assert_eq!(published, 0);
    clean(&admin).await;
}

#[tokio::test]
#[ignore = "R2.17: needs the compose dev profile (just dev-up, just db-migrate) and .env exported"]
async fn r2_17_skip_locked_gives_two_workers_two_jobs() {
    let admin = admin().await;
    clean(&admin).await;
    let config = config();
    let database = config.database.as_ref().expect("configured");
    let first = insert_job(&admin, TEST_FLOPS[2], HEAD).await;
    let second = insert_job(&admin, TEST_FLOPS[3], HEAD - 1.0).await;
    let (a, b) = (PgQueue::connect_lazy(database), PgQueue::connect_lazy(database));
    let gate = BudgetGate { budget_bytes: u64::MAX, bytes_per_runout: 1, bytes_per_flop_tree: 1 };
    let (one, two) =
        tokio::join!(a.claim("worker-a", None, &gate), b.claim("worker-b", None, &gate));
    let ids: BTreeSet<String> = [one.expect("a claim"), two.expect("a claim")]
        .into_iter()
        .map(|claim| match claim {
            Claim::Job(job) => job.id,
            other => panic!("expected a job, got {other:?}"),
        })
        .collect();
    assert_eq!(ids, [first, second].into_iter().collect(), "each worker got its own job");
    clean(&admin).await;
}

#[tokio::test]
#[ignore = "R2.18: needs the compose dev profile (just dev-up, just db-migrate) and .env exported"]
async fn r2_18_a_live_budget_setting_blocks_the_next_claim() {
    let admin = admin().await;
    clean(&admin).await;
    let config = config();
    let queue = PgQueue::connect_lazy(config.database.as_ref().expect("configured"));
    let job_id = insert_job(&admin, TEST_FLOPS[4], HEAD).await;
    set(&admin, "budget_bytes", serde_json::json!(10)).await;
    let (settings, errors) = BuilderSettings::from_rows(&queue.settings().await.expect("rows"));
    assert!(errors.is_empty(), "{errors:?}");
    assert_eq!(settings.planner.budget_bytes, 10, "the change is read on the next claim");
    let gate = BudgetGate {
        budget_bytes: settings.planner.budget_bytes,
        bytes_per_runout: settings.planner.bytes_per_runout,
        bytes_per_flop_tree: settings.planner.bytes_per_flop_tree,
    };
    let claim = queue.claim("integration-test", Some(&job_id), &gate).await.expect("a claim");
    assert!(matches!(&claim, Claim::Blocked { job_id: id, .. } if *id == job_id), "{claim:?}");
    let (status, error): (String, Option<String>) =
        sqlx::query_as("select status::text, error from build_job where id = $1::uuid")
            .bind(&job_id)
            .fetch_one(&admin)
            .await
            .expect("the job");
    assert_eq!(status, "blocked_budget");
    assert!(error.is_some_and(|e| e.contains("budget")));
    clean(&admin).await;
}

#[tokio::test]
#[ignore = "R2.16: needs the compose dev profile (just dev-up, just db-migrate) and .env exported"]
async fn r2_16_plan_writes_queued_and_blocked_rows_once() {
    let admin = admin().await;
    clean(&admin).await;
    let started: chrono_free::Stamp = chrono_free::now(&admin).await;
    let config = config();
    let env = env(&config);
    let settings = BuilderSettings {
        planner: gto_planner::PlannerSettings {
            budget_bytes: 5 * gto_planner::estimated_bytes(
                3,
                20,
                &gto_planner::PlannerSettings::default(),
            ),
            ..gto_planner::PlannerSettings::default()
        },
        ..BuilderSettings::default()
    };
    let written = plan_once(&env, &settings).await.expect("the plan is written");
    assert!(written.queued > 0, "{written:?}");
    assert!(written.blocked > 0, "{written:?}");
    let again = plan_once(&env, &settings).await.expect("the plan is written again");
    assert_eq!(again.queued + again.blocked + again.promoted, 0, "nothing new: {again:?}");
    chrono_free::delete_jobs_since(&admin, &started).await;
    clean(&admin).await;
}

/// Timestamps from the database clock, so the test needs no time crate.
mod chrono_free {
    use sqlx::PgPool;

    /// A database timestamp as text.
    pub struct Stamp(pub String);

    pub async fn now(pool: &PgPool) -> Stamp {
        Stamp(sqlx::query_scalar("select now()::text").fetch_one(pool).await.expect("now"))
    }

    pub async fn delete_jobs_since(pool: &PgPool, since: &Stamp) {
        sqlx::query(
            "delete from build_job where game_config_id = $1 and created_at >= $2::timestamptz",
        )
        .bind(super::CONFIG_ID)
        .bind(&since.0)
        .execute(pool)
        .await
        .expect("the planned rows are removed");
    }
}
