//! The per-process liveness signal and the stale reclaim that reads it (O-185, review M1,
//! L6, PR #22 re-review MEDIUM).
//!
//! Mechanism: [`hold`] takes the session-level advisory lock `pg_try_advisory_lock(k)`,
//! where `k` is [`liveness_key`] of the process's full worker id, on a connection detached
//! from the pool and kept in `PgQueue` for the life of the process. Postgres holds a
//! session lock until its session ends, so the lock is free exactly when that process (or
//! its connection) is gone. Every later call pings the held connection and takes the lock
//! again on a new one when the ping fails.
//!
//! [`reclaim_stale`] runs in one transaction: it lists the holders of running rows that
//! share this worker's stable id under another nonce, tests each holder's key with
//! `pg_try_advisory_xact_lock` (released by the commit, so the reclaim never keeps a dead
//! process's key), and re-queues only the rows whose holder's key it could take, plus the
//! rows locked longer than `stale_hours`. The transaction-scoped form is used rather than
//! `pg_try_advisory_lock` and an unlock so that no error path can leave the key held on a
//! pooled connection.

use sqlx::Connection as _;
use sqlx::postgres::{PgConnection, PgPool};

use super::super::liveness_key;
use crate::error::BuilderError;

/// The stale reclaim, one statement. `$1` is this process's full id, never taken; `$2` the
/// holders found dead; `$3` the stale hours; `$4` `max_attempts`. Every assignment reads the
/// row's old values, so the error names the holder; the text matches
/// `queue::reclaim_error`.
const RECLAIM_STALE: &str = "update build_job set attempts = attempts + 1, \
     status = case when attempts + 1 >= $4 then 'failed'::job_status \
     else 'queued'::job_status end, \
     error = 'stale reclaim from ' || coalesce(locked_by, '') || \
     case when attempts + 1 >= $4 then ': parked after ' || (attempts + 1)::text || ' attempts' \
     else ': re-queued at attempt ' || (attempts + 1)::text end, \
     locked_by = null, locked_at = null, updated_at = now() \
     where status = 'running' and locked_by is distinct from $1 and \
     (locked_by = any($2) or locked_at < now() - make_interval(hours => $3))";

/// The holders of running rows with this worker's stable id (`$2`, the holder's text
/// before its last `#`, the whole holder without one) other than this process (`$1`).
const SAME_WORKER_HOLDERS: &str = "select distinct locked_by from build_job \
     where status = 'running' and locked_by is distinct from $1 \
     and regexp_replace(locked_by, '#[^#]*$', '') = $2";

/// A `build_job` row's `locked_at` refreshed while `$2` holds it running.
const TOUCH: &str = "update build_job set locked_at = now(), updated_at = now() \
     where id = $1::uuid and status = 'running' and locked_by = $2";

/// Takes the liveness lock of `worker_id`, or checks the held connection still answers;
/// `held` is `PgQueue`'s slot for the connection (see the module docs). A key another
/// session already holds is logged and left: a session that holds it keeps this id live.
pub(super) async fn hold(
    pool: &PgPool,
    held: &mut Option<PgConnection>,
    worker_id: &str,
) -> Result<(), BuilderError> {
    if let Some(conn) = held.as_mut() {
        match conn.ping().await {
            Ok(()) => return Ok(()),
            Err(err) => {
                tracing::warn!(error = %err, "the liveness connection is gone; taking the lock again");
                *held = None;
            }
        }
    }
    let mut conn = pool.acquire().await?.detach();
    let taken: bool = sqlx::query_scalar("select pg_try_advisory_lock($1)")
        .bind(liveness_key(worker_id))
        .fetch_one(&mut conn)
        .await?;
    if taken {
        *held = Some(conn);
    } else {
        tracing::warn!(worker = %worker_id, "another session holds this process's liveness key");
        if let Err(err) = conn.close().await {
            tracing::warn!(error = %err, "the spare liveness connection did not close cleanly");
        }
    }
    Ok(())
}

/// The stale reclaim (see the module docs); `stable` is this worker's stable id.
pub(super) async fn reclaim_stale(
    pool: &PgPool,
    worker_id: &str,
    stable: &str,
    stale_hours: i32,
    max_attempts: i16,
) -> Result<u64, BuilderError> {
    let mut tx = pool.begin().await?;
    let holders: Vec<String> = sqlx::query_scalar(SAME_WORKER_HOLDERS)
        .bind(worker_id)
        .bind(stable)
        .fetch_all(&mut *tx)
        .await?;
    let mut dead = Vec::with_capacity(holders.len());
    for holder in holders {
        let free: bool = sqlx::query_scalar("select pg_try_advisory_xact_lock($1)")
            .bind(liveness_key(&holder))
            .fetch_one(&mut *tx)
            .await?;
        if free {
            dead.push(holder);
        }
    }
    let reclaimed = sqlx::query(RECLAIM_STALE)
        .bind(worker_id)
        .bind(&dead)
        .bind(stale_hours)
        .bind(max_attempts)
        .execute(&mut *tx)
        .await?
        .rows_affected();
    tx.commit().await?;
    Ok(reclaimed)
}

/// Refreshes `locked_at` of `job_id` while `worker_id` holds it running.
pub(super) async fn touch(
    pool: &PgPool,
    job_id: &str,
    worker_id: &str,
) -> Result<(), BuilderError> {
    sqlx::query(TOUCH).bind(job_id).bind(worker_id).execute(pool).await?;
    Ok(())
}
