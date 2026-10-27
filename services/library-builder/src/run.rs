//! The claim loop (plan section C), `--once`, the planner pass and the verify pass.
//!
//! [`tick`] is one iteration: read the settings (every claim, R2.18); publish the state on
//! change (`paused`, `throttled`, `running`, `idle`); when paused, claim nothing; take or
//! check this process's liveness signal (`JobQueue::hold_liveness`, which `--once` takes
//! too, so the reclaim of another process never takes its job); run the stale reclaim when
//! due (O-185); claim under the budget gate (T1); run the job; when the
//! queue is empty, run the planner when due. [`run_loop`] repeats it, sleeping
//! `poll_seconds` when paused or idle, until shutdown. Beside it, [`run_loop`] spawns the
//! verify pass (O-186) as its own tokio task with its own schedule (see [`verify`]), so a
//! pass never holds a claim back; the task stops when the loop returns. Tests drive
//! [`tick`] directly with an injected clock so the boost window and the intervals are
//! deterministic.
//!
//! A malformed setting is logged once when the set of settings errors changes, and is
//! shown in `/healthz` for as long as it stays malformed (O-188).

use std::future::Future;
use std::time::Duration;

use gto_planner::ConfigScope;
use gto_tree::SizingConventionSpec;

use crate::error::BuilderError;
use crate::job::now_epoch_seconds;
use crate::job::{Env, JobOutcome, RunSummary, catalog_config, minute_of_day_utc, run_job};
use crate::notify::{BuilderState, StatePayload};
use crate::queue::{BudgetGate, Claim, JobQueue, PlanWrite};
use crate::settings::BuilderSettings;

pub mod verify;

pub use verify::{VerifyMode, VerifyReport, VerifySchedule, verify_once};

/// Consecutive failed ticks the loop retries before it stops with the error.
pub const MAX_TICK_RETRIES: u32 = 3;

/// The idle reason while `plan_configs` is empty (planning off).
pub const PLANNING_OFF_REASON: &str = "plan_configs is empty: planning is off";

/// Seconds in an hour.
const SECONDS_PER_HOUR: u64 = 3_600;

/// What one [`tick`] did.
#[derive(Clone, Debug, PartialEq)]
#[allow(
    clippy::large_enum_variant,
    reason = "one value per tick, never stored in bulk; boxing would break the Ran(..) patterns"
)]
pub enum TickOutcome {
    /// The `paused` setting is on; nothing was claimed.
    Paused,
    /// The queue head went to `blocked_budget`.
    Blocked {
        /// The job.
        job_id: String,
        /// The reason.
        reason: String,
    },
    /// A job ran.
    Ran(JobOutcome),
    /// The queue was empty and the planner ran.
    Planned(PlanWrite),
    /// The queue was empty and the planner was not due.
    Idle,
}

/// Loop timing the ticks share.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct LoopClock {
    /// Seconds since the epoch of the last stale reclaim, 0 for never.
    pub last_reclaim: u64,
    /// Seconds since the epoch of the last plan, 0 for never.
    pub last_plan: u64,
}

/// True when an action last run at `last` (0 for never) is due at `now` every
/// `interval_seconds`.
fn due(last: u64, now: u64, interval_seconds: u64) -> bool {
    last == 0 || now.saturating_sub(last) >= interval_seconds
}

/// Reads the settings, records their errors and the budget in the status, and logs the
/// errors when they changed.
async fn read_settings<Q: JobQueue>(env: &Env<Q>) -> Result<BuilderSettings, BuilderError> {
    let rows = env.queue.settings().await?;
    let (settings, errors) = BuilderSettings::from_rows_with(&rows, &env.limits);
    if env.status.view().settings_errors != errors {
        for error in &errors {
            tracing::warn!(key = %error.key, reason = %error.reason, "setting falls back");
        }
    }
    let budget = settings.planner.budget_bytes;
    env.status.update(|view| {
        view.settings_errors = errors;
        view.storage_budget_bytes = budget;
    });
    Ok(settings)
}

/// Records `state` and notifies `builder_state` when it differs from the current one.
async fn set_state<Q: JobQueue>(
    env: &Env<Q>,
    state: BuilderState,
    reason: String,
) -> Result<(), BuilderError> {
    let view = env.status.view();
    if view.state == state && view.reason == reason {
        return Ok(());
    }
    tracing::info!(?state, reason = %reason, "builder state");
    env.status.update(|view| {
        view.state = state;
        view.reason.clone_from(&reason);
    });
    env.queue.notify_state(&StatePayload { state, reason }).await
}

/// The state of a claim at `minute`: `throttled` below full share, else `running`.
fn active_state(settings: &BuilderSettings, threads: usize, minute: u32) -> (BuilderState, String) {
    let share = settings.share_at(minute);
    let solve_threads = settings.threads(threads, minute);
    if share < 1.0 {
        (
            BuilderState::Throttled,
            format!("cpu share {share}: {solve_threads} of {threads} threads"),
        )
    } else {
        (BuilderState::Running, format!("full share: {solve_threads} threads"))
    }
}

/// Refreshes the queue and storage figures `/metrics` reports; a failure is logged.
async fn refresh_figures<Q: JobQueue>(env: &Env<Q>) {
    match env.queue.queue_depth().await {
        Ok(depth) => env.status.update(|view| view.queue_depth = depth),
        Err(err) => tracing::warn!(error = %err, "queue depth was not refreshed"),
    }
    match env.queue.ledger_bytes().await {
        Ok(bytes) => env.status.update(|view| view.storage_used_bytes = bytes),
        Err(err) => tracing::warn!(error = %err, "storage figure was not refreshed"),
    }
}

/// The stale reclaim when due (O-185).
async fn reclaim_if_due<Q: JobQueue>(
    env: &Env<Q>,
    clock: &mut LoopClock,
    now: u64,
    settings: &BuilderSettings,
) -> Result<(), BuilderError> {
    if !due(clock.last_reclaim, now, u64::from(settings.stale_hours) * SECONDS_PER_HOUR) {
        return Ok(());
    }
    let requeued = env
        .queue
        .reclaim_stale(&env.worker_id, settings.stale_hours, settings.max_attempts)
        .await?;
    if requeued > 0 {
        tracing::info!(requeued, "stale running jobs re-queued");
    }
    clock.last_reclaim = now;
    Ok(())
}

/// An empty queue: idle, and the planner when due.
async fn idle<Q: JobQueue>(
    env: &Env<Q>,
    clock: &mut LoopClock,
    now: u64,
    settings: &BuilderSettings,
) -> Result<TickOutcome, BuilderError> {
    // An empty plan_configs list turns planning off; the reason says so in /healthz and
    // in builder_state, so an idle builder that never plans is visible.
    let reason =
        if settings.plan_configs.is_empty() { PLANNING_OFF_REASON } else { "nothing is queued" };
    set_state(env, BuilderState::Idle, reason.to_owned()).await?;
    if !due(clock.last_plan, now, u64::from(settings.plan_interval_minutes) * 60) {
        return Ok(TickOutcome::Idle);
    }
    clock.last_plan = now;
    if settings.plan_configs.is_empty() {
        return Ok(TickOutcome::Planned(PlanWrite::default()));
    }
    Ok(TickOutcome::Planned(plan_once(env, settings).await?))
}

/// One iteration, returning the settings it read as well.
async fn tick_with_settings<Q: JobQueue>(
    env: &Env<Q>,
    clock: &mut LoopClock,
    now: u64,
) -> Result<(TickOutcome, BuilderSettings), BuilderError> {
    let settings = read_settings(env).await?;
    if settings.paused {
        set_state(env, BuilderState::Paused, "the paused setting is on".to_owned()).await?;
        return Ok((TickOutcome::Paused, settings));
    }
    env.queue.hold_liveness(&env.worker_id).await?;
    reclaim_if_due(env, clock, now, &settings).await?;
    let gate = BudgetGate::from_planner(&settings.planner);
    let outcome = match env.queue.claim(&env.worker_id, None, &gate).await? {
        Claim::Job(job) => {
            let minute = minute_of_day_utc(now);
            let (state, reason) = active_state(&settings, env.builder_threads, minute);
            set_state(env, state, reason).await?;
            TickOutcome::Ran(run_job(env, job, &settings).await?)
        }
        Claim::Blocked { job_id, reason } => {
            env.status.count_job("blocked_budget");
            tracing::info!(job_id = %job_id, reason = %reason, "job blocked by the budget");
            TickOutcome::Blocked { job_id, reason }
        }
        Claim::Empty => idle(env, clock, now, &settings).await?,
    };
    refresh_figures(env).await;
    Ok((outcome, settings))
}

/// One loop iteration at `now_epoch_seconds`.
///
/// # Errors
///
/// A database or store error the iteration cannot record as a job failure.
pub async fn tick<Q: JobQueue>(
    env: &Env<Q>,
    clock: &mut LoopClock,
    now_epoch_seconds: u64,
) -> Result<TickOutcome, BuilderError> {
    tick_with_settings(env, clock, now_epoch_seconds).await.map(|(outcome, _)| outcome)
}

/// True when the loop should wait `poll_seconds` before the next tick.
fn waits_after(outcome: &TickOutcome) -> bool {
    match outcome {
        TickOutcome::Paused | TickOutcome::Idle => true,
        TickOutcome::Planned(write) => write.queued + write.promoted == 0,
        TickOutcome::Ran(_) | TickOutcome::Blocked { .. } => false,
    }
}

/// Aborts the spawned verify task when the loop returns, on every path.
struct AbortOnDrop(tokio::task::JoinHandle<()>);

impl Drop for AbortOnDrop {
    fn drop(&mut self) {
        self.0.abort();
    }
}

/// Ticks until `shutdown` resolves, with the verify pass running beside it in its own task
/// (see [`verify`]).
///
/// # Errors
///
/// The first error a tick returns after the loop has logged it and retried
/// `poll_seconds` later three times in a row.
pub async fn run_loop<Q: JobQueue + 'static>(
    env: &Env<Q>,
    shutdown: impl Future<Output = ()> + Send,
) -> Result<(), BuilderError> {
    let _verify = AbortOnDrop(tokio::spawn(verify::VerifyTask::of(env).run()));
    let mut shutdown = std::pin::pin!(shutdown);
    let mut clock = LoopClock::default();
    let mut failures = 0_u32;
    loop {
        let now = now_epoch_seconds();
        let (wait, poll_seconds) = match tick_with_settings(env, &mut clock, now).await {
            Ok((outcome, settings)) => {
                failures = 0;
                (waits_after(&outcome), settings.poll_seconds)
            }
            Err(err) => {
                failures += 1;
                tracing::warn!(error = %err, failures, "tick failed");
                if failures > MAX_TICK_RETRIES {
                    return Err(err);
                }
                (true, BuilderSettings::default().poll_seconds)
            }
        };
        let pause =
            if wait { Duration::from_secs(u64::from(poll_seconds)) } else { Duration::ZERO };
        tokio::select! {
            biased;
            () = &mut shutdown => return Ok(()),
            () = tokio::time::sleep(pause) => {}
        }
    }
}

/// `--once`: claims the next job, or `job_id`, runs it in the foreground and returns its
/// summary.
///
/// # Errors
///
/// `BuilderError::JobNotQueued` when there is nothing to claim (or the claim was blocked
/// by the budget), and as [`tick`].
pub async fn run_once<Q: JobQueue>(
    env: &Env<Q>,
    job_id: Option<&str>,
) -> Result<RunSummary, BuilderError> {
    let settings = read_settings(env).await?;
    env.queue.hold_liveness(&env.worker_id).await?;
    let gate = BudgetGate::from_planner(&settings.planner);
    let job = match env.queue.claim(&env.worker_id, job_id, &gate).await? {
        Claim::Job(job) => job,
        Claim::Blocked { job_id, reason } => {
            env.status.count_job("blocked_budget");
            tracing::warn!(job_id = %job_id, reason = %reason, "job blocked by the budget");
            return Err(BuilderError::JobNotQueued(job_id));
        }
        Claim::Empty => {
            return Err(BuilderError::JobNotQueued(job_id.unwrap_or("next").to_owned()));
        }
    };
    match run_job(env, job, &settings).await? {
        JobOutcome::Published(summary) | JobOutcome::Failed { summary, .. } => Ok(summary),
    }
}

/// One planner pass under `settings` (`library-builder plan` and the automatic plan).
///
/// # Errors
///
/// `BuilderError::Plan`, `BuilderError::UnknownConfig` for a `plan_configs` entry outside
/// the catalog, and the database errors.
pub async fn plan_once<Q: JobQueue>(
    env: &Env<Q>,
    settings: &BuilderSettings,
) -> Result<PlanWrite, BuilderError> {
    let mut scopes = Vec::with_capacity(settings.plan_configs.len());
    for config_id in &settings.plan_configs {
        let config = catalog_config(config_id)?;
        let stored = env.queue.sizing_convention(config_id).await?;
        let convention = SizingConventionSpec::from_json(&stored.to_string())?;
        scopes.push(ConfigScope { config, convention });
    }
    let gate = BudgetGate::from_planner(&settings.planner);
    let (existing, committed) = env.queue.plan_inputs(&gate).await?;
    let plan =
        gto_planner::plan(&scopes, env.reach.as_ref(), &settings.planner, &existing, committed)?;
    let written = env.queue.write_plan(&plan).await?;
    tracing::info!(
        queued = written.queued,
        blocked = written.blocked,
        promoted = written.promoted,
        committed_bytes = plan.committed_bytes,
        "plan written"
    );
    Ok(written)
}

#[cfg(test)]
mod tests {
    use super::{TickOutcome, due, waits_after};
    use crate::queue::PlanWrite;

    #[test]
    fn r2_17_intervals_are_due_first_and_then_after_their_length() {
        assert!(due(0, 100, 3_600), "never run is due");
        assert!(!due(100, 200, 3_600));
        assert!(due(100, 3_700, 3_600));
    }

    #[test]
    fn r2_17_the_loop_waits_only_when_there_is_nothing_to_do() {
        assert!(waits_after(&TickOutcome::Idle));
        assert!(waits_after(&TickOutcome::Paused));
        assert!(waits_after(&TickOutcome::Planned(PlanWrite::default())));
        let queued = PlanWrite { queued: 1, ..PlanWrite::default() };
        assert!(!waits_after(&TickOutcome::Planned(queued)));
    }

    /// The loop's futures are `Send`, so `main` can spawn them on the runtime.
    #[allow(dead_code, reason = "a compile-time check, never called")]
    fn r2_17_loop_futures_are_send(env: &crate::job::Env<crate::queue::mem::MemQueue>) {
        fn send<T: Send>(_: T) {}
        let mut clock = super::LoopClock::default();
        send(super::tick(env, &mut clock, 0));
        send(super::run_once(env, None));
        send(super::verify_once(env, super::VerifyMode::Full));
        send(super::run_loop(env, std::future::pending::<()>()));
    }
}
