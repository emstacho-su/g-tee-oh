//! The verify pass (O-186; PR #22 review HIGH 1, H1, MEDIUM 6).
//!
//! A pass first probes the target, then checks every published own build through
//! [`LibraryTarget::check_build`]. The default pass is cheap: each object's existence and
//! size (a HEAD request, or the file's metadata), with one build per pass read in full and
//! checked against its sha256, chosen round-robin by the pass number. `library-builder
//! verify --full` reads every build in full.
//!
//! Only an integrity failure marks a build unavailable: a checksum mismatch, a manifest
//! that does not decode, or a definite not-found while the target still answers. Any other
//! error, a failed probe included, aborts the pass before anything is marked; the next
//! interval tries again. The marks are written only after every build was checked, so a
//! store that stops answering halfway marks nothing at all.
//!
//! In the service the pass runs as its own tokio task, spawned by `run_loop` beside the
//! claim loop, so a long pass never holds a claim back. The task wakes every
//! `poll_seconds`, reads the settings, and runs a pass when `verify_interval_hours` have
//! passed since the last pass, counting the first from the task's start: a pass never runs
//! on the first tick after a start. The pass does not run while `paused` is on.

use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;

use crate::error::BuilderError;
use crate::job::{Env, now_epoch_seconds};
use crate::queue::{JobQueue, PublishedBuild, Unavailable};
use crate::settings::{BuilderSettings, Limits};
use crate::store::{CheckDepth, LibraryTarget, VerifyOutcome};

/// Seconds in an hour.
const SECONDS_PER_HOUR: u64 = 3_600;

/// The suffix a published build's `manifest_uri` carries after its prefix.
const MANIFEST_SUFFIX: &str = "/manifest.json";

/// How much of every build a pass reads.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum VerifyMode {
    /// Existence and size of every object, and a full read of the build at position
    /// `pass % builds` (round-robin over passes).
    Sampled {
        /// The pass number.
        pass: u64,
    },
    /// Every build read in full (`library-builder verify --full`).
    Full,
}

impl VerifyMode {
    /// The depth for the build at `index` of `count`.
    fn depth(self, index: usize, count: usize) -> CheckDepth {
        match self {
            VerifyMode::Full => CheckDepth::Full,
            VerifyMode::Sampled { pass } => {
                let count = u64::try_from(count).unwrap_or(u64::MAX).max(1);
                if u64::try_from(index).ok() == Some(pass % count) {
                    CheckDepth::Full
                } else {
                    CheckDepth::Head
                }
            }
        }
    }
}

/// What a verify pass found (O-186).
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
pub struct VerifyReport {
    /// Builds checked.
    pub checked: u64,
    /// Builds read in full and checked against their sha256.
    pub read_in_full: u64,
    /// Solution ids marked unavailable and re-queued.
    pub unavailable: Vec<String>,
}

/// One pass over every published own build (see the module docs).
///
/// # Errors
///
/// `BuilderError::StoreUnconfigured`; the probe's error, or the error of the first build
/// the store did not answer for, with nothing marked; the database errors.
pub async fn verify_once<Q: JobQueue>(
    env: &Env<Q>,
    mode: VerifyMode,
) -> Result<VerifyReport, BuilderError> {
    let target = env.target.as_ref().ok_or(BuilderError::StoreUnconfigured)?;
    verify_pass(env.queue.as_ref(), target, mode).await
}

/// [`verify_once`] over its parts, so the spawned task needs no whole `Env`.
async fn verify_pass<Q: JobQueue>(
    queue: &Q,
    target: &LibraryTarget,
    mode: VerifyMode,
) -> Result<VerifyReport, BuilderError> {
    target.probe().await?;
    let builds = queue.published_builds().await?;
    let mut report = VerifyReport::default();
    let mut broken = Vec::new();
    for (index, build) in builds.iter().enumerate() {
        let depth = mode.depth(index, builds.len());
        report.checked += 1;
        if depth == CheckDepth::Full {
            report.read_in_full += 1;
        }
        if let Some(found) = check_one(target, build, depth).await? {
            broken.push(found);
        }
    }
    for found in broken {
        queue.mark_unavailable(&found).await?;
        report.unavailable.push(found.solution_id);
    }
    Ok(report)
}

/// Checks one build: `Some` when it is broken, an error when the store did not answer.
async fn check_one(
    target: &LibraryTarget,
    build: &PublishedBuild,
    depth: CheckDepth,
) -> Result<Option<Unavailable>, BuilderError> {
    let Some(prefix) = build.manifest_uri.strip_suffix(MANIFEST_SUFFIX) else {
        let reason =
            format!("manifest_uri {} does not end in {MANIFEST_SUFFIX}", build.manifest_uri);
        return Ok(Some(unavailable(build, None, 0, reason)));
    };
    match target.check_build(prefix, depth).await {
        VerifyOutcome::Ok(_) => Ok(None),
        VerifyOutcome::Broken { facts, reason } => {
            tracing::warn!(solution_id = %build.solution_id, reason = %reason,
                "published build failed verification");
            Ok(Some(unavailable(build, facts.tree_hash, facts.bytes, reason)))
        }
        VerifyOutcome::Unreachable(err) => Err(err),
    }
}

/// The mark for a broken build.
fn unavailable(
    build: &PublishedBuild,
    tree_config_hash: Option<Vec<u8>>,
    bytes: u64,
    reason: String,
) -> Unavailable {
    Unavailable { solution_id: build.solution_id.clone(), tree_config_hash, bytes, reason }
}

/// When the spawned task runs a pass.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct VerifySchedule {
    /// Seconds since the epoch of the last pass, or of the task's start before the first.
    pub last: u64,
    /// Passes started, which picks the round-robin build.
    pub passes: u64,
}

impl VerifySchedule {
    /// A schedule started at `now`: the first pass is one interval away.
    #[must_use]
    pub const fn started_at(now: u64) -> Self {
        VerifySchedule { last: now, passes: 0 }
    }

    /// True when `interval_hours` have passed since the last pass (or the start).
    #[must_use]
    pub const fn due(&self, now: u64, interval_hours: u32) -> bool {
        now.saturating_sub(self.last) >= interval_hours as u64 * SECONDS_PER_HOUR
    }

    /// The schedule after a pass started at `now`, failed or not: the next is one
    /// interval away and reads the next build in full.
    #[must_use]
    pub const fn after_pass(self, now: u64) -> Self {
        VerifySchedule { last: now, passes: self.passes.wrapping_add(1) }
    }
}

/// The parts of `Env` the spawned verify task holds.
pub(super) struct VerifyTask<Q> {
    /// The queue.
    pub queue: Arc<Q>,
    /// The library target; without one the task never verifies.
    pub target: Option<LibraryTarget>,
    /// The settings ceilings.
    pub limits: Limits,
}

impl<Q: JobQueue> VerifyTask<Q> {
    /// The task's parts from `env`.
    pub fn of(env: &Env<Q>) -> Self {
        VerifyTask { queue: Arc::clone(&env.queue), target: env.target.clone(), limits: env.limits }
    }

    /// The settings now; a read failure is logged and gives the defaults, paused, so
    /// nothing runs on a value nobody set.
    async fn settings(&self) -> BuilderSettings {
        match self.queue.settings().await {
            Ok(rows) => BuilderSettings::from_rows_with(&rows, &self.limits).0,
            Err(err) => {
                tracing::warn!(error = %err, "verify task: settings were not read");
                BuilderSettings { paused: true, ..BuilderSettings::default() }
            }
        }
    }

    /// Runs passes on the schedule until the task is aborted.
    pub async fn run(self) {
        let Some(target) = self.target.clone() else {
            tracing::info!("no library target: the verify pass is off");
            return;
        };
        let mut schedule = VerifySchedule::started_at(now_epoch_seconds());
        loop {
            let settings = self.settings().await;
            let now = now_epoch_seconds();
            if !settings.paused && schedule.due(now, settings.verify_interval_hours) {
                let mode = VerifyMode::Sampled { pass: schedule.passes };
                schedule = schedule.after_pass(now);
                log_pass(verify_pass(self.queue.as_ref(), &target, mode).await);
            }
            tokio::time::sleep(Duration::from_secs(u64::from(settings.poll_seconds))).await;
        }
    }
}

/// Logs a pass's result; a failed pass is retried at the next interval.
fn log_pass(result: Result<VerifyReport, BuilderError>) {
    match result {
        Ok(report) => tracing::info!(
            checked = report.checked,
            read_in_full = report.read_in_full,
            unavailable = report.unavailable.len(),
            "verify pass"
        ),
        Err(err) => {
            tracing::warn!(error = %err, "verify pass aborted, nothing marked; retried next interval");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{CheckDepth, VerifyMode, VerifySchedule};

    const START: u64 = 1_793_102_400;
    const DAY: u64 = 24 * 3_600;

    #[test]
    fn r2_17_the_first_verify_pass_waits_a_full_interval_after_start() {
        let schedule = VerifySchedule::started_at(START);
        assert!(!schedule.due(START, 24), "never on the first tick");
        assert!(!schedule.due(START + DAY - 1, 24));
        assert!(schedule.due(START + DAY, 24));
        let next = schedule.after_pass(START + DAY);
        assert_eq!(next.passes, 1);
        assert!(!next.due(START + DAY, 24), "the next pass is an interval later");
    }

    #[test]
    fn r2_17_a_sampled_pass_reads_one_build_in_full_round_robin() {
        let full = |pass: u64| {
            (0..3)
                .filter(|&index| VerifyMode::Sampled { pass }.depth(index, 3) == CheckDepth::Full)
                .collect::<Vec<_>>()
        };
        assert_eq!(full(0), [0]);
        assert_eq!(full(1), [1]);
        assert_eq!(full(4), [1]);
        assert_eq!(VerifyMode::Full.depth(2, 3), CheckDepth::Full);
    }
}
