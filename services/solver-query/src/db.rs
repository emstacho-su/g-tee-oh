//! The query-role database connection (R2.13, O-28, O-146, O-147, plan C.6): a lazy
//! sqlx pool as `query_login`, the coverage reads and the role probe.
//!
//! Mechanism: `Db::connect_lazy` builds sqlx's connect options from the `QUERY_DB_*` parts
//! (`config::DatabaseConfig`) and opens nothing, so the service starts before Postgres is
//! healthy (compose gives solver-query no `depends_on`); the first query opens a
//! connection, up to `MAX_CONNECTIONS`. Every read is a runtime-checked `sqlx::query` (no
//! macros, so no `DATABASE_URL` at build and no `.sqlx` directory, O-147) over the tables
//! the query role may select (`db/migrations/20261020001000_grants.sql`): preflop
//! availability from `solution`, flops and scenario counts from `scenario` joined to the
//! solution's status, and queue positions from `build_job`; the three are independent and
//! run concurrently, each on its own pooled connection. The role probe behind `/healthz`
//! and `/metrics` runs `select current_user, pg_has_role(current_user, 'query', 'member')`,
//! bounded by `PROBE_TIMEOUT` so a database that is down never holds the liveness answer.
//!
//! A failure of any kind is `ApiError::DatabaseUnavailable` (503), never a 500. Its detail
//! names the failure class only; the server's text goes to the log, and no path carries
//! the password: there is no connection string to redact, `config::Password` prints
//! redacted, and `Db`'s `Debug` shows the pool's size only (A9 section 3).

use std::fmt;
use std::time::Duration;

use gto_model::{ConfigId, PositionPair};
use sqlx::postgres::{PgConnectOptions, PgPool, PgPoolOptions, PgSslMode};

use crate::config::{DatabaseConfig, SslMode};
use crate::error::ApiError;

/// The most connections the lazy pool opens (plan C.6): the three coverage reads side by
/// side and the role probe.
pub const MAX_CONNECTIONS: u32 = 4;

/// How long a query waits for a connection before the answer is `database-unavailable`
/// (O-146). The pool retries a refused connection until this deadline, so without it a
/// stopped Postgres would hold a coverage request for sqlx's default of thirty seconds.
pub const ACQUIRE_TIMEOUT: Duration = Duration::from_secs(5);

/// How long the role probe behind `/healthz` and `/metrics` may take (O-146). The
/// container health check gives the whole probe three seconds (`probe::TIMEOUT` is two),
/// so the database block must answer well inside that whether or not Postgres is up.
pub const PROBE_TIMEOUT: Duration = Duration::from_secs(1);

/// The group role the login must be a member of (O-28,
/// `db/migrations/20261020000200_roles.sql`).
pub const QUERY_ROLE: &str = "query";

/// The SQLSTATE of a privilege failure, what any write under the query role reports.
pub const INSUFFICIENT_PRIVILEGE: &str = "42501";

/// The role probe: who the pool connected as and whether that login holds `$1`.
const ROLE_PROBE_SQL: &str = "select current_user::text, pg_has_role(current_user, $1, 'member')";

/// Published preflop solutions of one configuration and pair, by id.
const PREFLOP_SOLUTIONS_SQL: &str = "select id::text from solution \
    where kind = 'preflop' and status = 'published' \
    and game_config_id = $1 and position_pair = $2 \
    order by id";

/// Scenario counts by flop and by the status of the solution that holds them.
const FLOPS_SQL: &str = "select sc.flop, s.status, count(*) \
    from scenario sc join solution s on s.id = sc.solution_id \
    where sc.game_config_id = $1 and sc.position_pair = $2 \
    group by sc.flop, s.status \
    order by sc.flop, s.status";

/// Queued build jobs of one configuration and pair with their place in the whole queue,
/// highest priority first, ties by age (the builder's claim order, ADR 0005).
const QUEUE_SQL: &str = "select id::text, flop, round(priority)::int4, status::text, position \
    from (select id, flop, priority, status, game_config_id, position_pair, \
        row_number() over (order by priority desc, created_at, id) as position \
        from build_job where status = 'queued') queued \
    where game_config_id = $1 and position_pair = $2 \
    order by position";

/// The query-role pool.
#[derive(Clone)]
pub struct Db {
    pool: PgPool,
}

/// What the role probe answered.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RoleProbe {
    /// `current_user` as Postgres reports it, `query_login` on the dev profile.
    pub current_user: String,
    /// True when that login is a member of [`QUERY_ROLE`].
    pub is_query_member: bool,
}

impl RoleProbe {
    /// The role `/healthz` reports: [`QUERY_ROLE`] when the login holds it, else the login
    /// itself, so a connection under the wrong role is visible.
    #[must_use]
    pub fn role(&self) -> String {
        if self.is_query_member { QUERY_ROLE.to_owned() } else { self.current_user.clone() }
    }
}

/// One flop of the `scenario` table: its scenarios under one solution status.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FlopRow {
    /// The flop text as stored, for example `Ah7d2c`.
    pub flop: String,
    /// The status of the solution holding the scenarios (`published`, `unavailable`,
    /// `superseded`).
    pub status: String,
    /// How many scenarios the flop holds under that status.
    pub scenarios: u32,
}

/// One queued build job.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct QueueRow {
    /// The job id.
    pub job_id: String,
    /// The flop the job builds.
    pub flop: String,
    /// The priority, rounded to the nearest integer.
    pub priority: i32,
    /// The job status, `queued`.
    pub status: String,
    /// The place in the whole queue, 1 first.
    pub position: u32,
}

/// What the database holds for one configuration and pair.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct DbCoverage {
    /// Published preflop solution ids.
    pub preflop_ids: Vec<String>,
    /// Flops with scenarios, by flop and status.
    pub flops: Vec<FlopRow>,
    /// Queued build jobs, queue order.
    pub queue: Vec<QueueRow>,
}

impl Db {
    /// A pool over the parts of `database` that connects on first use. The parts go
    /// through sqlx's builder, never a connection string, so a password may hold any
    /// character. The libpq `PG*` variables fill only what no part covers (certificates,
    /// the application name, `PGOPTIONS`), as they would for libpq itself.
    #[must_use]
    pub fn connect_lazy(database: &DatabaseConfig) -> Db {
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
        Db { pool }
    }

    /// The pool, for the queries.
    #[must_use]
    pub fn pool(&self) -> &PgPool {
        &self.pool
    }

    /// Who the pool connects as and whether that login holds [`QUERY_ROLE`], within
    /// [`PROBE_TIMEOUT`].
    ///
    /// # Errors
    ///
    /// `ApiError::DatabaseUnavailable` when the connection or the query fails or the
    /// deadline passes.
    pub async fn probe_role(&self) -> Result<RoleProbe, ApiError> {
        let query = sqlx::query_as::<_, (String, bool)>(ROLE_PROBE_SQL)
            .bind(QUERY_ROLE)
            .fetch_one(&self.pool);
        let (current_user, is_query_member) = match tokio::time::timeout(PROBE_TIMEOUT, query).await
        {
            Ok(answer) => answer.map_err(|err| unavailable("role probe", &err))?,
            Err(_elapsed) => return Err(probe_timed_out()),
        };
        Ok(RoleProbe { current_user, is_query_member })
    }

    /// True when the role probe answered, for the `solver_query_db_connected` gauge.
    pub async fn is_connected(&self) -> bool {
        self.probe_role().await.is_ok()
    }

    /// Everything the database holds for `config_id` and `pair`: published preflop
    /// solutions, flops with their scenario counts, and queued jobs with their positions.
    /// The three reads are independent and run concurrently.
    ///
    /// # Errors
    ///
    /// `ApiError::DatabaseUnavailable` from the first read that fails; the other reads are
    /// dropped.
    pub async fn coverage(
        &self,
        config_id: &ConfigId,
        pair: PositionPair,
    ) -> Result<DbCoverage, ApiError> {
        let (config_id, pair) = (config_id.as_str(), pair.to_string());
        let (preflop_ids, flops, queue) = tokio::try_join!(
            self.preflop_ids(config_id, &pair),
            self.flops(config_id, &pair),
            self.queue(config_id, &pair),
        )?;
        Ok(DbCoverage { preflop_ids, flops, queue })
    }

    async fn preflop_ids(&self, config_id: &str, pair: &str) -> Result<Vec<String>, ApiError> {
        let rows = sqlx::query_as::<_, (String,)>(PREFLOP_SOLUTIONS_SQL)
            .bind(config_id)
            .bind(pair)
            .fetch_all(&self.pool)
            .await
            .map_err(|err| unavailable("preflop solutions", &err))?;
        Ok(rows.into_iter().map(|(id,)| id).collect())
    }

    async fn flops(&self, config_id: &str, pair: &str) -> Result<Vec<FlopRow>, ApiError> {
        let rows = sqlx::query_as::<_, (String, String, i64)>(FLOPS_SQL)
            .bind(config_id)
            .bind(pair)
            .fetch_all(&self.pool)
            .await
            .map_err(|err| unavailable("flops", &err))?;
        Ok(rows
            .into_iter()
            .map(|(flop, status, scenarios)| FlopRow {
                flop,
                status,
                scenarios: saturated(scenarios),
            })
            .collect())
    }

    async fn queue(&self, config_id: &str, pair: &str) -> Result<Vec<QueueRow>, ApiError> {
        let rows = sqlx::query_as::<_, (String, String, i32, String, i64)>(QUEUE_SQL)
            .bind(config_id)
            .bind(pair)
            .fetch_all(&self.pool)
            .await
            .map_err(|err| unavailable("queue", &err))?;
        Ok(rows
            .into_iter()
            .map(|(job_id, flop, priority, status, position)| QueueRow {
                job_id,
                flop,
                priority,
                status,
                position: saturated(position),
            })
            .collect())
    }
}

impl fmt::Debug for Db {
    /// The pool's size only: its options hold the password.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Db")
            .field("connections", &self.pool.size())
            .field("max_connections", &MAX_CONNECTIONS)
            .finish_non_exhaustive()
    }
}

/// sqlx's value for a configured mode; the variants carry the same names.
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

/// A count from Postgres (`bigint`) as the contract's `u32`; a negative or oversized count
/// cannot come from `count(*)` or `row_number()`, and saturates rather than panics.
fn saturated(count: i64) -> u32 {
    u32::try_from(count).unwrap_or(if count < 0 { 0 } else { u32::MAX })
}

/// The `database-unavailable` answer for a sqlx failure during `context`: the class of
/// the failure for the caller, the server's text for the log.
fn unavailable(context: &str, err: &sqlx::Error) -> ApiError {
    tracing::warn!(context, error = %err, "the query database did not answer");
    ApiError::DatabaseUnavailable(format!("{context}: {}", failure_class(err)))
}

/// The probe did not answer within [`PROBE_TIMEOUT`].
fn probe_timed_out() -> ApiError {
    tracing::warn!(timeout_ms = PROBE_TIMEOUT.as_millis(), "the role probe timed out");
    ApiError::DatabaseUnavailable(format!(
        "role probe: no answer within {} ms",
        PROBE_TIMEOUT.as_millis()
    ))
}

/// A short, fixed description per failure class, so the detail never echoes server text.
fn failure_class(err: &sqlx::Error) -> &'static str {
    match err {
        sqlx::Error::PoolTimedOut => "no connection within the acquire timeout",
        sqlx::Error::PoolClosed => "the pool is closed",
        sqlx::Error::Io(_) | sqlx::Error::Tls(_) | sqlx::Error::Protocol(_) => {
            "the connection failed"
        }
        sqlx::Error::Database(_) => "the database rejected the query",
        sqlx::Error::RowNotFound => "no row answered",
        sqlx::Error::ColumnDecode { .. }
        | sqlx::Error::ColumnNotFound(_)
        | sqlx::Error::ColumnIndexOutOfBounds { .. }
        | sqlx::Error::TypeNotFound { .. }
        | sqlx::Error::Decode(_) => "the answer did not decode",
        _ => "an unexpected failure",
    }
}

#[cfg(test)]
mod tests {
    use sqlx::postgres::PgSslMode;

    use super::{Db, QUERY_ROLE, RoleProbe, failure_class, pg_ssl_mode, saturated};
    use crate::config::{DatabaseConfig, Password, SslMode};

    /// A dev placeholder password, never a real secret.
    const PASSWORD: &str = "change-me-query";

    fn database() -> DatabaseConfig {
        DatabaseConfig {
            host: "db.internal".to_owned(),
            port: 5433,
            name: "gto".to_owned(),
            user: "query_login".to_owned(),
            password: Password::new(PASSWORD.to_owned()),
            ssl_mode: SslMode::Disable,
        }
    }

    #[test]
    fn r2_13_role_probe_reports_the_group_role_or_the_login() {
        let member = RoleProbe { current_user: "query_login".to_owned(), is_query_member: true };
        assert_eq!(member.role(), QUERY_ROLE);
        let stray = RoleProbe { current_user: "app_login".to_owned(), is_query_member: false };
        assert_eq!(stray.role(), "app_login");
    }

    #[test]
    fn r2_13_counts_from_postgres_saturate_into_the_contract() {
        assert_eq!(saturated(0), 0);
        assert_eq!(saturated(7), 7);
        assert_eq!(saturated(i64::from(u32::MAX) + 1), u32::MAX);
        assert_eq!(saturated(-1), 0);
    }

    #[test]
    fn r2_13_failure_class_never_echoes_server_text() {
        let io = sqlx::Error::Io(std::io::Error::other("secret host text"));
        assert_eq!(failure_class(&io), "the connection failed");
        assert_eq!(
            failure_class(&sqlx::Error::PoolTimedOut),
            "no connection within the acquire timeout"
        );
        assert_eq!(failure_class(&sqlx::Error::RowNotFound), "no row answered");
        assert_eq!(
            failure_class(&sqlx::Error::ColumnNotFound("x".into())),
            "the answer did not decode"
        );
    }

    #[tokio::test]
    async fn r2_13_pool_options_carry_every_part_and_db_debug_hides_the_password() {
        let db = Db::connect_lazy(&database());
        let options = db.pool().connect_options();
        assert_eq!(options.get_host(), "db.internal");
        assert_eq!(options.get_port(), 5433);
        assert_eq!(options.get_database(), Some("gto"));
        assert_eq!(options.get_username(), "query_login");
        let ssl_mode = options.get_ssl_mode();
        assert!(matches!(ssl_mode, PgSslMode::Disable), "{ssl_mode:?}");
        assert!(format!("{options:?}").contains(PASSWORD), "the pool holds the password");
        let shown = format!("{db:?}");
        assert!(!shown.contains(PASSWORD), "{shown}");
        assert!(shown.starts_with("Db {"), "{shown}");
    }

    #[test]
    fn r2_13_every_ssl_mode_maps_to_the_sqlx_variant_of_the_same_name() {
        for mode in SslMode::ALL {
            assert_eq!(format!("{:?}", pg_ssl_mode(mode)), format!("{mode:?}"));
        }
    }
}
