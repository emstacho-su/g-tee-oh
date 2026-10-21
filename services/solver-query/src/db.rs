#![allow(unused_variables, dead_code, reason = "S16 stub: lane D fills this file")]
//! The query-role database connection (R2.13, O-28, O-146, O-147, plan C.6): a lazy
//! sqlx pool as `query_login`, the coverage queries and the role probe.
//!
//! S16 lands `Db::connect_lazy`, which `AppState::from_config` calls when
//! `QUERY_DATABASE_URL` is set: `PgPoolOptions::connect_lazy` with `MAX_CONNECTIONS`
//! parses the string and opens nothing, so the service starts before Postgres is healthy
//! (compose gives solver-query no `depends_on`). Lane D adds the runtime-checked
//! `sqlx::query` reads (no macros, so no `DATABASE_URL` at build and no `.sqlx`
//! directory, O-147): preflop availability from `solution`, flops and scenario counts
//! from `scenario`, queue positions from `build_job`, and the role probe
//! `select current_user, pg_has_role(current_user, 'query', 'member')` for `/healthz`.
//! A failed query answers 503 `database-unavailable`, never a 500. Lane D removes the
//! allowance at the top of this file.

use sqlx::postgres::{PgPool, PgPoolOptions};

use crate::error::ApiError;

/// The most connections the lazy pool opens (plan C.6).
pub const MAX_CONNECTIONS: u32 = 4;

/// The query-role pool.
#[derive(Debug, Clone)]
pub struct Db {
    pool: PgPool,
}

impl Db {
    /// A pool over `url` that connects on first use.
    ///
    /// # Errors
    ///
    /// `ApiError::DatabaseUnavailable` when the string is not a Postgres connection
    /// string; the parse error is logged, the detail never carries the value.
    pub fn connect_lazy(url: &str) -> Result<Db, ApiError> {
        let pool = PgPoolOptions::new()
            .max_connections(MAX_CONNECTIONS)
            .connect_lazy(url)
            .map_err(|err| {
                tracing::error!(error = %err, "QUERY_DATABASE_URL is not a connection string");
                ApiError::DatabaseUnavailable(
                    "QUERY_DATABASE_URL is not a Postgres connection string".to_owned(),
                )
            })?;
        Ok(Db { pool })
    }

    /// The pool, for the queries.
    #[must_use]
    pub fn pool(&self) -> &PgPool {
        &self.pool
    }
}
