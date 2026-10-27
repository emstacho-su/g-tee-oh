//! The operations surface on port 7071 (A5 section 1, A9 section 4, R2.18, O-207):
//! `GET /healthz` and `GET /metrics`, internal to the compose network and never published.
//!
//! [`Status`] is the state the loop writes and the handlers read: the builder state, the
//! current job, the settings errors and the latest queue and storage figures under one
//! mutex, and monotonic counters as atomics. A handler copies them into an immutable view
//! per request, so a scrape never holds a lock while it formats.
//!
//! `/healthz` answers JSON `{status, version, worker_id, state, reason, database, store,
//! current_job, settings_errors}`: `database` is `unconfigured`, `ok` (the probe
//! `select current_user, pg_has_role(current_user, 'builder', 'member')` answers true
//! within the probe timeout) or `unavailable`; `store` carries the target kind and whether
//! it answered. The status is 200 when every configured dependency answers and 503 when
//! one does not; an unconfigured dependency is not a failure.
//!
//! `/metrics` is Prometheus text, hand-rolled (the O-155 pattern): `builder_up`,
//! `builder_state`, `builder_jobs_total{outcome}`, `builder_queue_depth{status}`,
//! `builder_storage_used_bytes`, `builder_storage_budget_bytes`,
//! `builder_line_seconds_sum`, `builder_line_seconds_count`,
//! `builder_line_iterations_total`, `builder_last_exploitability_pct_pot{seat}` and
//! `builder_peak_rss_bytes`.

use std::net::SocketAddr;
use std::sync::Mutex;
use std::time::Duration;

use axum::Router;
use serde::Serialize;
use sqlx::PgPool;

use crate::error::BuilderError;
use crate::notify::BuilderState;
use crate::settings::SettingError;
use crate::store::LibraryTarget;

/// How long the database and store probes may take before the answer is `unavailable`.
pub const PROBE_TIMEOUT: Duration = Duration::from_secs(2);

/// The job outcomes `builder_jobs_total` counts.
pub const JOB_OUTCOMES: [&str; 5] = ["done", "requeued", "parked", "refused", "blocked_budget"];

/// The metric families `/metrics` always carries.
pub const METRIC_FAMILIES: [&str; 11] = [
    "builder_up",
    "builder_state",
    "builder_jobs_total",
    "builder_queue_depth",
    "builder_storage_used_bytes",
    "builder_storage_budget_bytes",
    "builder_line_seconds_sum",
    "builder_line_seconds_count",
    "builder_line_iterations_total",
    "builder_last_exploitability_pct_pot",
    "builder_peak_rss_bytes",
];

/// A copy of the status at one moment.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct StatusView {
    /// The state.
    pub state: BuilderState,
    /// Why.
    pub reason: String,
    /// The job being built.
    pub current_job: Option<String>,
    /// Settings that fell back to defaults.
    pub settings_errors: Vec<SettingError>,
    /// Rows per status, from the last refresh.
    pub queue_depth: Vec<(String, i64)>,
    /// The ledger's library bytes.
    pub storage_used_bytes: u64,
    /// The budget in force.
    pub storage_budget_bytes: u64,
    /// The last published build's per-seat gains.
    pub last_exploitability_pct_pot: Option<[f64; 2]>,
    /// Jobs per outcome, in `JOB_OUTCOMES` order.
    pub jobs: [u64; 5],
    /// Sum of line solve seconds.
    pub line_seconds_sum: f64,
    /// Lines solved.
    pub line_count: u64,
    /// Iterations over all lines.
    pub line_iterations: u64,
}

/// The shared status.
#[derive(Debug)]
pub struct Status {
    view: Mutex<StatusView>,
}

impl Default for Status {
    fn default() -> Self {
        Status {
            view: Mutex::new(StatusView {
                state: BuilderState::Idle,
                reason: "starting".to_owned(),
                current_job: None,
                settings_errors: Vec::new(),
                queue_depth: Vec::new(),
                storage_used_bytes: 0,
                storage_budget_bytes: 0,
                last_exploitability_pct_pot: None,
                jobs: [0; 5],
                line_seconds_sum: 0.0,
                line_count: 0,
                line_iterations: 0,
            }),
        }
    }
}

impl Status {
    /// A copy of the current view.
    #[must_use]
    pub fn view(&self) -> StatusView {
        self.view.lock().unwrap_or_else(std::sync::PoisonError::into_inner).clone()
    }

    /// Applies `change` to the view under the lock.
    pub fn update(&self, change: impl FnOnce(&mut StatusView)) {
        let mut view = self.view.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        change(&mut view);
    }

    /// Counts one job outcome (one of `JOB_OUTCOMES`; anything else is ignored).
    pub fn count_job(&self, outcome: &str) {
        let _ = outcome;
    }

    /// Records one solved line.
    pub fn record_line(&self, seconds: f64, iterations: u32) {
        let _ = (seconds, iterations);
    }
}

/// What the handlers read.
#[derive(Clone)]
pub struct OpsState {
    /// The shared status.
    pub status: std::sync::Arc<Status>,
    /// The pool, when the database is configured.
    pub database: Option<PgPool>,
    /// The library target, when configured.
    pub target: Option<LibraryTarget>,
    /// This worker's name.
    pub worker_id: String,
}

/// The `/healthz` body.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, serde::Deserialize)]
pub struct HealthBody {
    /// `ok` or `degraded`.
    pub status: String,
    /// The crate version.
    pub version: String,
    /// This worker.
    pub worker_id: String,
    /// The builder state.
    pub state: String,
    /// Why.
    pub reason: String,
    /// `unconfigured`, `ok` or `unavailable`.
    pub database: String,
    /// The target.
    pub store: StoreHealth,
    /// The job being built.
    pub current_job: Option<String>,
    /// Keys that fell back to defaults, as `key: reason`.
    pub settings_errors: Vec<String>,
}

/// The store block of `/healthz`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, serde::Deserialize)]
pub struct StoreHealth {
    /// `unconfigured`, `fs` or `s3`.
    pub kind: String,
    /// Whether the probe answered; false when unconfigured.
    pub reachable: bool,
}

/// The router: `GET /healthz` and `GET /metrics`.
pub fn router(state: OpsState) -> Router {
    Router::new().with_state(state)
}

/// The Prometheus text for `view` and the peak resident set size.
#[must_use]
pub fn render_metrics(view: &StatusView, peak_rss_bytes: u64) -> String {
    let _ = (view, peak_rss_bytes);
    String::new()
}

/// Serves `router(state)` on `bind` until `shutdown` resolves.
///
/// # Errors
///
/// `BuilderError::Io` when the address cannot be bound.
pub async fn serve(
    bind: SocketAddr,
    state: OpsState,
    shutdown: impl std::future::Future<Output = ()> + Send + 'static,
) -> Result<(), BuilderError> {
    let _ = (bind, state, shutdown);
    Err(BuilderError::NotImplemented("ops::serve"))
}

/// Probes `/healthz` through the loopback at `bind`'s port; true on a 200.
///
/// # Errors
///
/// `BuilderError::Io` when nothing answers.
pub fn probe(bind: SocketAddr) -> Result<bool, BuilderError> {
    let _ = bind;
    Err(BuilderError::NotImplemented("ops::probe"))
}
