//! The Postgres [`JobQueue`] as the `builder` role (O-28, A4 section 3), over a lazy sqlx
//! pool built from the `BUILDER_DB_*` parts (O-146): no connection string is ever formed,
//! so the password cannot leak through one. Every statement is a runtime-checked
//! `sqlx::query` with bound parameters (O-147: no macros, no `.sqlx` directory, no string
//! interpolation of values). The transactions are the ones the module docs of `queue`
//! name; `pg_notify` is used rather than `NOTIFY` so the payload is a bound parameter.

use std::collections::BTreeSet;
use std::future::{Future, ready};
use std::time::Duration;

use gto_planner::{JobKey, Plan};
use serde_json::Value;
use sqlx::postgres::{PgConnectOptions, PgPool, PgPoolOptions, PgSslMode};

use super::{
    BudgetGate, Claim, Failure, FailureOutcome, JobQueue, PlanWrite, Publication, PublishedBuild,
};
use crate::config::{DatabaseConfig, SslMode};
use crate::error::BuilderError;
use crate::notify::{BuildProgress, StatePayload};

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

// Skeleton: every method answers at once with NotImplemented until its lane lands.
impl JobQueue for PgQueue {
    fn settings(&self) -> impl Future<Output = Result<Vec<(String, Value)>, BuilderError>> + Send {
        ready(Err(BuilderError::NotImplemented("PgQueue::settings")))
    }

    fn reclaim_stale(
        &self,
        _worker_id: &str,
        _stale_hours: u32,
    ) -> impl Future<Output = Result<u64, BuilderError>> + Send {
        ready(Err(BuilderError::NotImplemented("PgQueue::reclaim_stale")))
    }

    fn claim(
        &self,
        _worker_id: &str,
        _job_id: Option<&str>,
        _gate: &BudgetGate,
    ) -> impl Future<Output = Result<Claim, BuilderError>> + Send {
        ready(Err(BuilderError::NotImplemented("PgQueue::claim")))
    }

    fn new_build_id(&self) -> impl Future<Output = Result<String, BuilderError>> + Send {
        ready(Err(BuilderError::NotImplemented("PgQueue::new_build_id")))
    }

    fn sizing_convention(
        &self,
        _config_id: &str,
    ) -> impl Future<Output = Result<Value, BuilderError>> + Send {
        ready(Err(BuilderError::NotImplemented("PgQueue::sizing_convention")))
    }

    fn progress(
        &self,
        _progress: &BuildProgress,
    ) -> impl Future<Output = Result<(), BuilderError>> + Send {
        ready(Err(BuilderError::NotImplemented("PgQueue::progress")))
    }

    fn publish(
        &self,
        _worker_id: &str,
        _publication: &Publication,
    ) -> impl Future<Output = Result<(), BuilderError>> + Send {
        ready(Err(BuilderError::NotImplemented("PgQueue::publish")))
    }

    fn fail(
        &self,
        _worker_id: &str,
        _failure: &Failure,
        _max_attempts: i16,
    ) -> impl Future<Output = Result<FailureOutcome, BuilderError>> + Send {
        ready(Err(BuilderError::NotImplemented("PgQueue::fail")))
    }

    fn notify_state(
        &self,
        _state: &StatePayload,
    ) -> impl Future<Output = Result<(), BuilderError>> + Send {
        ready(Err(BuilderError::NotImplemented("PgQueue::notify_state")))
    }

    fn plan_inputs(
        &self,
        _gate: &BudgetGate,
    ) -> impl Future<Output = Result<(BTreeSet<JobKey>, u64), BuilderError>> + Send {
        ready(Err(BuilderError::NotImplemented("PgQueue::plan_inputs")))
    }

    fn write_plan(
        &self,
        _plan: &Plan,
    ) -> impl Future<Output = Result<PlanWrite, BuilderError>> + Send {
        ready(Err(BuilderError::NotImplemented("PgQueue::write_plan")))
    }

    fn published_builds(
        &self,
    ) -> impl Future<Output = Result<Vec<PublishedBuild>, BuilderError>> + Send {
        ready(Err(BuilderError::NotImplemented("PgQueue::published_builds")))
    }

    fn mark_unavailable(
        &self,
        _solution_id: &str,
        _reason: &str,
    ) -> impl Future<Output = Result<(), BuilderError>> + Send {
        ready(Err(BuilderError::NotImplemented("PgQueue::mark_unavailable")))
    }

    fn queue_depth(&self) -> impl Future<Output = Result<Vec<(String, i64)>, BuilderError>> + Send {
        ready(Err(BuilderError::NotImplemented("PgQueue::queue_depth")))
    }

    fn ledger_bytes(&self) -> impl Future<Output = Result<u64, BuilderError>> + Send {
        ready(Err(BuilderError::NotImplemented("PgQueue::ledger_bytes")))
    }
}
