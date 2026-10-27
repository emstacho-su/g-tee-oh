//! The multi-statement transactions of [`super::PgQueue`] (plan section C): T1 the claim
//! and budget gate, T2 the publish, T3 the failure, the plan write and the verify pass's
//! re-queue. Each opens one transaction on the pool, runs bound statements only, and
//! commits; an error drops the transaction, which rolls it back.

use sqlx::Row;
use sqlx::postgres::{PgConnection, PgPool, PgRow};

use super::super::{
    BudgetGate, Claim, ClaimedJob, Failure, FailureOutcome, PlanWrite, Publication, job_key,
    row_k_and_priority,
};
use crate::error::BuilderError;
use crate::notify::{COVERAGE_ADDED, CoverageAdded};
use gto_planner::{JobSpec, Plan};

/// The queue head (ADR 0005): `for update skip locked`, so two workers never wait on or
/// share a row.
const CLAIM_HEAD: &str = "select id::text, game_config_id, position_pair, flop, \
     preflop_lines, tree_config_hash, k_runouts, priority, attempts from build_job \
     where status = 'queued' order by priority desc, created_at \
     limit 1 for update skip locked";

/// A named job, only while it is queued (`--once --job`).
const CLAIM_NAMED: &str = "select id::text, game_config_id, position_pair, flop, \
     preflop_lines, tree_config_hash, k_runouts, priority, attempts from build_job \
     where status = 'queued' and id = $1::uuid \
     order by priority desc, created_at limit 1 for update skip locked";

/// A new plan row, queued.
const INSERT_QUEUED: &str = "insert into build_job (game_config_id, position_pair, flop, \
     preflop_lines, tree_config_hash, k_runouts, priority, status) \
     values ($1, $2, $3, $4, $5, $6, $7, 'queued') \
     on conflict (game_config_id, position_pair, flop, tree_config_hash) do nothing";

/// A new plan row past the budget cut (O-204).
const INSERT_BLOCKED: &str = "insert into build_job (game_config_id, position_pair, flop, \
     preflop_lines, tree_config_hash, k_runouts, priority, status, error) \
     values ($1, $2, $3, $4, $5, $6, $7, 'blocked_budget', 'past the budget cut of the plan') \
     on conflict (game_config_id, position_pair, flop, tree_config_hash) do nothing";

/// Today's ledger row from the latest one plus a build's bytes; `reference_bytes` carried
/// forward (O-206). The table lock taken first serializes concurrent publishes, so no
/// addition is lost between reading the latest row and writing today's.
const LEDGER_UPSERT: &str = "insert into storage_ledger (day, library_bytes, reference_bytes) \
     values ((now() at time zone 'utc')::date, \
     coalesce((select library_bytes from storage_ledger order by day desc limit 1), 0) + $1, \
     coalesce((select reference_bytes from storage_ledger order by day desc limit 1), 0)) \
     on conflict (day) do update set library_bytes = excluded.library_bytes, \
     reference_bytes = excluded.reference_bytes";

/// A non-negative database integer as `u64`.
///
/// # Errors
///
/// `BuilderError::Malformed` naming `what` for a negative value.
pub(super) fn non_negative(value: i64, what: &str) -> Result<u64, BuilderError> {
    u64::try_from(value).map_err(|_| BuilderError::Malformed {
        path: what.to_owned(),
        reason: format!("{value} is negative"),
    })
}

/// A byte count as a `bigint`.
fn to_bigint(value: u64, what: &str) -> Result<i64, BuilderError> {
    i64::try_from(value).map_err(|_| BuilderError::Malformed {
        path: what.to_owned(),
        reason: format!("{value} does not fit a bigint"),
    })
}

/// The latest `storage_ledger.library_bytes`, 0 without a row.
pub(super) async fn ledger_bytes(conn: &mut PgConnection) -> Result<u64, BuilderError> {
    let latest: Option<i64> =
        sqlx::query_scalar("select library_bytes from storage_ledger order by day desc limit 1")
            .fetch_optional(conn)
            .await?;
    non_negative(latest.unwrap_or(0), "storage_ledger.library_bytes")
}

/// The estimates of rows in `statuses` under `gate`, the row `except` left out.
async fn estimates(
    conn: &mut PgConnection,
    gate: &BudgetGate,
    statuses: &[&str],
    except: Option<&str>,
) -> Result<u64, BuilderError> {
    let statuses: Vec<String> = statuses.iter().map(|s| (*s).to_owned()).collect();
    let rows: Vec<(Vec<String>, i16)> = sqlx::query_as(
        "select preflop_lines, k_runouts from build_job \
         where status::text = any($1) and ($2::text is null or id::text <> $2)",
    )
    .bind(&statuses)
    .bind(except)
    .fetch_all(conn)
    .await?;
    Ok(rows
        .iter()
        .fold(0_u64, |sum, (lines, k)| sum.saturating_add(gate.estimate(lines.len(), *k))))
}

/// A claimed row.
fn claimed_job(row: &PgRow) -> Result<ClaimedJob, BuilderError> {
    Ok(ClaimedJob {
        id: row.try_get(0)?,
        game_config_id: row.try_get(1)?,
        position_pair: row.try_get(2)?,
        flop: row.try_get(3)?,
        preflop_lines: row.try_get(4)?,
        tree_config_hash: row.try_get(5)?,
        k_runouts: row.try_get(6)?,
        priority: row.try_get(7)?,
        attempts: row.try_get(8)?,
    })
}

/// T1: the claim and the budget gate in one transaction (A5 section 4).
pub(super) async fn claim(
    pool: &PgPool,
    worker_id: &str,
    job_id: Option<&str>,
    gate: &BudgetGate,
) -> Result<Claim, BuilderError> {
    let mut tx = pool.begin().await?;
    let row = match job_id {
        Some(id) => sqlx::query(CLAIM_NAMED).bind(id).fetch_optional(&mut *tx).await?,
        None => sqlx::query(CLAIM_HEAD).fetch_optional(&mut *tx).await?,
    };
    let Some(row) = row else {
        tx.commit().await?;
        return Ok(Claim::Empty);
    };
    let job = claimed_job(&row)?;
    let estimate = gate.estimate(job.preflop_lines.len(), job.k_runouts);
    let running = estimates(&mut tx, gate, &["running"], Some(&job.id)).await?;
    let used = ledger_bytes(&mut tx).await?.saturating_add(running);
    let claim = if let Some(reason) = gate.refusal(estimate, used) {
        sqlx::query(
            "update build_job set status = 'blocked_budget', error = $2, updated_at = now() \
             where id = $1::uuid",
        )
        .bind(&job.id)
        .bind(&reason)
        .execute(&mut *tx)
        .await?;
        Claim::Blocked { job_id: job.id, reason }
    } else {
        sqlx::query(
            "update build_job set status = 'running', locked_by = $2, locked_at = now(), \
             updated_at = now() where id = $1::uuid",
        )
        .bind(&job.id)
        .bind(worker_id)
        .execute(&mut *tx)
        .await?;
        Claim::Job(job)
    };
    tx.commit().await?;
    Ok(claim)
}

/// `pg_notify(channel, payload)` on `conn`; inside a transaction Postgres delivers it at
/// commit.
pub(super) async fn notify(
    conn: &mut PgConnection,
    channel: &str,
    payload: &impl serde::Serialize,
) -> Result<(), BuilderError> {
    let text = serde_json::to_string(payload).map_err(|err| BuilderError::Malformed {
        path: channel.to_owned(),
        reason: err.to_string(),
    })?;
    sqlx::query("select pg_notify($1, $2)").bind(channel).bind(text).execute(conn).await?;
    Ok(())
}

/// The solution row of a publish, after marking the previous own build superseded.
async fn insert_solution(conn: &mut PgConnection, p: &Publication) -> Result<(), BuilderError> {
    sqlx::query(
        "update solution set status = 'superseded' where kind = 'flop_build' and \
         source = 'own' and status = 'published' and game_config_id = $1 and \
         position_pair = $2 and flop = $3",
    )
    .bind(&p.config_id)
    .bind(&p.pair)
    .bind(&p.flop)
    .execute(&mut *conn)
    .await?;
    sqlx::query(
        "insert into solution (id, kind, source, game_config_id, position_pair, flop, \
         engine_version, manifest_uri, exploitability_pct_pot, status) \
         values ($1::uuid, 'flop_build', 'own', $2, $3, $4, $5, $6, $7, 'published')",
    )
    .bind(&p.build_id)
    .bind(&p.config_id)
    .bind(&p.pair)
    .bind(&p.flop)
    .bind(&p.engine_version)
    .bind(&p.manifest_uri)
    .bind(p.exploitability_pct_pot.to_vec())
    .execute(&mut *conn)
    .await?;
    for scenario in &p.scenarios {
        sqlx::query(
            "insert into scenario (solution_id, game_config_id, position_pair, flop, turn, \
             river, flop_weight) values ($1::uuid, $2, $3, $4, $5, $6, $7)",
        )
        .bind(&p.build_id)
        .bind(&p.config_id)
        .bind(&p.pair)
        .bind(&p.flop)
        .bind(&scenario.turn)
        .bind(&scenario.river)
        .bind(p.flop_weight)
        .execute(&mut *conn)
        .await?;
    }
    Ok(())
}

/// Today's ledger row grows by `bytes` (O-206).
async fn add_to_ledger(conn: &mut PgConnection, bytes: u64) -> Result<(), BuilderError> {
    sqlx::query("lock table storage_ledger in share row exclusive mode")
        .execute(&mut *conn)
        .await?;
    sqlx::query(LEDGER_UPSERT)
        .bind(to_bigint(bytes, "publication bytes")?)
        .execute(&mut *conn)
        .await?;
    Ok(())
}

/// T2: the publish (A5 section 4, R2.17). The lock check comes first: a row a stale
/// reclaim gave away aborts with `LostLock` and nothing is written.
pub(super) async fn publish(
    pool: &PgPool,
    worker_id: &str,
    p: &Publication,
) -> Result<(), BuilderError> {
    let mut tx = pool.begin().await?;
    let lock: Option<(String, Option<String>)> = sqlx::query_as(
        "select status::text, locked_by from build_job where id = $1::uuid for update",
    )
    .bind(&p.job_id)
    .fetch_optional(&mut *tx)
    .await?;
    let held =
        lock.is_some_and(|(status, by)| status == "running" && by.as_deref() == Some(worker_id));
    if !held {
        tx.rollback().await?;
        return Err(BuilderError::LostLock(p.job_id.clone()));
    }
    insert_solution(&mut tx, p).await?;
    add_to_ledger(&mut tx, p.bytes).await?;
    sqlx::query(
        "update build_job set status = 'done', last_exploitability_pct_pot = $2, error = null, \
         locked_by = null, locked_at = null, updated_at = now() where id = $1::uuid",
    )
    .bind(&p.job_id)
    .bind(p.exploitability_pct_pot.to_vec())
    .execute(&mut *tx)
    .await?;
    let coverage = CoverageAdded {
        config_id: p.config_id.clone(),
        pair: p.pair.clone(),
        flop: p.flop.clone(),
        build_id: p.build_id.clone(),
        scenario_count: u32::try_from(p.scenarios.len()).unwrap_or(u32::MAX),
    };
    notify(&mut tx, COVERAGE_ADDED, &coverage).await?;
    tx.commit().await?;
    Ok(())
}

/// T3: the failure (A5 section 4, O-176), one statement guarded by the lock.
pub(super) async fn fail(
    pool: &PgPool,
    worker_id: &str,
    failure: &Failure,
    max_attempts: i16,
) -> Result<FailureOutcome, BuilderError> {
    let row: Option<(i16, String)> = sqlx::query_as(
        "update build_job set attempts = attempts + 1, error = $3, \
         last_exploitability_pct_pot = coalesce($4, last_exploitability_pct_pot), \
         status = case when attempts + 1 >= $5 then 'failed'::job_status \
         else 'queued'::job_status end, \
         locked_by = null, locked_at = null, updated_at = now() \
         where id = $1::uuid and locked_by = $2 returning attempts, status::text",
    )
    .bind(&failure.job_id)
    .bind(worker_id)
    .bind(&failure.error)
    .bind(failure.exploitability_pct_pot.map(|gains| gains.to_vec()))
    .bind(max_attempts)
    .fetch_optional(pool)
    .await?;
    match row {
        None => Err(BuilderError::LostLock(failure.job_id.clone())),
        Some((attempts, status)) if status == "failed" => Ok(FailureOutcome::Parked { attempts }),
        Some((attempts, _)) => Ok(FailureOutcome::Requeued { attempts }),
    }
}

/// The keys of the rows not `blocked_budget` and the committed bytes.
pub(super) async fn plan_inputs(
    pool: &PgPool,
    gate: &BudgetGate,
) -> Result<(std::collections::BTreeSet<gto_planner::JobKey>, u64), BuilderError> {
    let mut conn = pool.acquire().await?;
    let rows: Vec<(String, String, String, Vec<u8>)> = sqlx::query_as(
        "select game_config_id, position_pair, flop, tree_config_hash from build_job \
         where status <> 'blocked_budget'",
    )
    .fetch_all(&mut *conn)
    .await?;
    let keys = rows
        .iter()
        .map(|(config, pair, flop, hash)| job_key(config, pair, flop, hash))
        .collect::<Result<_, _>>()?;
    let queued = estimates(&mut conn, gate, &["queued", "running"], None).await?;
    let committed = ledger_bytes(&mut conn).await?.saturating_add(queued);
    Ok((keys, committed))
}

/// Inserts one planned row; true when it was new.
async fn insert_spec(
    conn: &mut PgConnection,
    spec: &JobSpec,
    sql: &str,
) -> Result<bool, BuilderError> {
    let key = spec.key();
    let (k_runouts, priority) = row_k_and_priority(spec)?;
    let inserted = sqlx::query(sql)
        .bind(&key.game_config_id)
        .bind(&key.position_pair)
        .bind(&key.flop)
        .bind(&spec.preflop_lines)
        .bind(key.tree_config_hash.to_vec())
        .bind(k_runouts)
        .bind(priority)
        .execute(conn)
        .await?
        .rows_affected();
    Ok(inserted > 0)
}

/// Moves the `blocked_budget` row of `spec`'s key to `queued`; true when one moved.
async fn promote(conn: &mut PgConnection, spec: &JobSpec) -> Result<bool, BuilderError> {
    let key = spec.key();
    let moved = sqlx::query(
        "update build_job set status = 'queued', error = null, updated_at = now() \
         where game_config_id = $1 and position_pair = $2 and flop = $3 and \
         tree_config_hash = $4 and status = 'blocked_budget'",
    )
    .bind(&key.game_config_id)
    .bind(&key.position_pair)
    .bind(&key.flop)
    .bind(key.tree_config_hash.to_vec())
    .execute(conn)
    .await?
    .rows_affected();
    Ok(moved > 0)
}

/// Writes a plan in one transaction (plan section B, O-204).
pub(super) async fn write_plan(pool: &PgPool, plan: &Plan) -> Result<PlanWrite, BuilderError> {
    let mut tx = pool.begin().await?;
    let mut write = PlanWrite::default();
    for spec in &plan.queued {
        if insert_spec(&mut tx, spec, INSERT_QUEUED).await? {
            write.queued += 1;
        } else if promote(&mut tx, spec).await? {
            write.promoted += 1;
        }
    }
    for spec in &plan.blocked {
        if insert_spec(&mut tx, spec, INSERT_BLOCKED).await? {
            write.blocked += 1;
        }
    }
    tx.commit().await?;
    Ok(write)
}

/// Marks a solution unavailable and re-queues its job with attempts reset (O-186).
pub(super) async fn mark_unavailable(
    pool: &PgPool,
    solution_id: &str,
    reason: &str,
) -> Result<(), BuilderError> {
    let mut tx = pool.begin().await?;
    let solution: Option<(String, Option<String>, Option<String>)> = sqlx::query_as(
        "update solution set status = 'unavailable' where id = $1::uuid \
         returning game_config_id, position_pair, flop",
    )
    .bind(solution_id)
    .fetch_optional(&mut *tx)
    .await?;
    let Some((config_id, pair, flop)) = solution else {
        tx.rollback().await?;
        tracing::warn!(solution_id, "mark_unavailable: no such solution");
        return Ok(());
    };
    sqlx::query(
        "update build_job set status = 'queued', attempts = 0, error = $4, locked_by = null, \
         locked_at = null, updated_at = now() \
         where game_config_id = $1 and position_pair = $2 and flop = $3",
    )
    .bind(&config_id)
    .bind(pair)
    .bind(flop)
    .bind(reason)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(())
}
