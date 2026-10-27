//! The Postgres [`JobQueue`] as the `builder` role (O-28, A4 section 3), over a lazy sqlx
//! pool built from the `BUILDER_DB_*` parts (O-146): no connection string is ever formed,
//! so the password cannot leak through one. Every statement is a runtime-checked
//! `sqlx::query` with bound parameters (O-147: no macros, no `.sqlx` directory, no string
//! interpolation of values). The transactions are the ones the module docs of `queue`
//! name and live in [`tx`]; `pg_notify` is used rather than `NOTIFY` so the payload is a
//! bound parameter. Enum columns are compared and read as text (`status::text`) and ids
//! as `id::text` with `$n::uuid` casts, so no sqlx type feature beyond the defaults is
//! needed.

mod tx;

use std::collections::BTreeSet;
use std::time::Duration;

use gto_planner::{JobKey, Plan};
use serde_json::Value;
use sqlx::postgres::{PgConnectOptions, PgPool, PgPoolOptions, PgSslMode};

use super::{
    BudgetGate, Claim, Failure, FailureOutcome, JobQueue, PlanWrite, Publication, PublishedBuild,
};
use crate::config::{DatabaseConfig, SslMode};
use crate::error::BuilderError;
use crate::notify::{BUILD_PROGRESS, BUILDER_STATE, BuildProgress, StatePayload};

/// The most connections the pool opens: the loop, the progress writer, the health probe
/// and the metrics scrape.
pub const MAX_CONNECTIONS: u32 = 4;

/// How long a statement waits for a connection before failing.
pub const ACQUIRE_TIMEOUT: Duration = Duration::from_secs(5);

/// The builder role every login of this service must hold.
pub const BUILDER_ROLE: &str = "builder";

/// The queue over Postgres.
#[derive(Clone, Debug)]
pub struct PgQueue {
    pool: PgPool,
}

impl PgQueue {
    /// A lazy pool over `database`; nothing is opened until the first statement.
    #[must_use]
    pub fn connect_lazy(database: &DatabaseConfig) -> PgQueue {
        let options = PgConnectOptions::new_without_pgpass()
            .host(&database.host)
            .port(database.port)
            .database(&database.name)
            .username(&database.user)
            .password(database.password.expose())
            .ssl_mode(pg_ssl_mode(database.ssl_mode));
        let pool = PgPoolOptions::new()
            .max_connections(MAX_CONNECTIONS)
            .acquire_timeout(ACQUIRE_TIMEOUT)
            .connect_lazy_with(options);
        PgQueue { pool }
    }

    /// The pool, for the health probe and the tests.
    #[must_use]
    pub fn pool(&self) -> &PgPool {
        &self.pool
    }
}

/// sqlx's mode for a configured one.
fn pg_ssl_mode(mode: SslMode) -> PgSslMode {
    match mode {
        SslMode::Disable => PgSslMode::Disable,
        SslMode::Allow => PgSslMode::Allow,
        SslMode::Prefer => PgSslMode::Prefer,
        SslMode::Require => PgSslMode::Require,
        SslMode::VerifyCa => PgSslMode::VerifyCa,
        SslMode::VerifyFull => PgSslMode::VerifyFull,
    }
}

// Each method is one statement or one transaction of `tx`; sqlx errors become
// `BuilderError::Database` through `?`.
impl JobQueue for PgQueue {
    async fn settings(&self) -> Result<Vec<(String, Value)>, BuilderError> {
        let rows: Vec<(String, Value)> =
            sqlx::query_as("select key, value from builder_setting order by key")
                .fetch_all(&self.pool)
                .await?;
        Ok(rows)
    }

    async fn reclaim_stale(&self, worker_id: &str, stale_hours: u32) -> Result<u64, BuilderError> {
        let hours = i32::try_from(stale_hours).unwrap_or(i32::MAX);
        let requeued = sqlx::query(
            "update build_job set status = 'queued', locked_by = null, locked_at = null, \
             updated_at = now() where status = 'running' and \
             (locked_by = $1 or locked_at < now() - make_interval(hours => $2))",
        )
        .bind(worker_id)
        .bind(hours)
        .execute(&self.pool)
        .await?
        .rows_affected();
        Ok(requeued)
    }

    async fn claim(
        &self,
        worker_id: &str,
        job_id: Option<&str>,
        gate: &BudgetGate,
    ) -> Result<Claim, BuilderError> {
        tx::claim(&self.pool, worker_id, job_id, gate).await
    }

    async fn new_build_id(&self) -> Result<String, BuilderError> {
        let id: String = sqlx::query_scalar("select uuidv7()::text").fetch_one(&self.pool).await?;
        Ok(id)
    }

    async fn sizing_convention(&self, config_id: &str) -> Result<Value, BuilderError> {
        let spec: Option<Value> = sqlx::query_scalar(
            "select sc.spec from game_config gc join sizing_convention sc \
             on sc.id = gc.sizing_convention_id where gc.id = $1",
        )
        .bind(config_id)
        .fetch_optional(&self.pool)
        .await?;
        spec.ok_or_else(|| BuilderError::UnknownConfig(config_id.to_owned()))
    }

    async fn progress(&self, progress: &BuildProgress) -> Result<(), BuilderError> {
        let value = serde_json::to_value(progress).map_err(|err| BuilderError::Malformed {
            path: BUILD_PROGRESS.to_owned(),
            reason: err.to_string(),
        })?;
        sqlx::query("update build_job set progress = $2, updated_at = now() where id = $1::uuid")
            .bind(&progress.job_id)
            .bind(&value)
            .execute(&self.pool)
            .await?;
        let mut conn = self.pool.acquire().await?;
        tx::notify(&mut conn, BUILD_PROGRESS, progress).await
    }

    async fn publish(
        &self,
        worker_id: &str,
        publication: &Publication,
    ) -> Result<(), BuilderError> {
        tx::publish(&self.pool, worker_id, publication).await
    }

    async fn fail(
        &self,
        worker_id: &str,
        failure: &Failure,
        max_attempts: i16,
    ) -> Result<FailureOutcome, BuilderError> {
        tx::fail(&self.pool, worker_id, failure, max_attempts).await
    }

    async fn notify_state(&self, state: &StatePayload) -> Result<(), BuilderError> {
        let mut conn = self.pool.acquire().await?;
        tx::notify(&mut conn, BUILDER_STATE, state).await
    }

    async fn plan_inputs(
        &self,
        gate: &BudgetGate,
    ) -> Result<(BTreeSet<JobKey>, u64), BuilderError> {
        tx::plan_inputs(&self.pool, gate).await
    }

    async fn write_plan(&self, plan: &Plan) -> Result<PlanWrite, BuilderError> {
        tx::write_plan(&self.pool, plan).await
    }

    async fn published_builds(&self) -> Result<Vec<PublishedBuild>, BuilderError> {
        let rows: Vec<(String, String)> = sqlx::query_as(
            "select id::text, manifest_uri from solution where kind = 'flop_build' and \
             source = 'own' and status = 'published' order by created_at",
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|(solution_id, manifest_uri)| PublishedBuild { solution_id, manifest_uri })
            .collect())
    }

    async fn mark_unavailable(&self, solution_id: &str, reason: &str) -> Result<(), BuilderError> {
        tx::mark_unavailable(&self.pool, solution_id, reason).await
    }

    async fn queue_depth(&self) -> Result<Vec<(String, i64)>, BuilderError> {
        let rows: Vec<(String, i64)> = sqlx::query_as(
            "select status::text, count(*) from build_job group by status order by status::text",
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows)
    }

    async fn ledger_bytes(&self) -> Result<u64, BuilderError> {
        let mut conn = self.pool.acquire().await?;
        tx::ledger_bytes(&mut conn).await
    }
}
