//! The operations surface on port 7071 (A5 section 1, A9 section 4, R2.18, O-207):
//! `GET /healthz` and `GET /metrics`, internal to the compose network and never published.
//!
//! [`Status`] is the state the loop writes and the handlers read: the builder state, the
//! current job, the settings errors, the latest queue and storage figures and the
//! monotonic counters, all under one mutex. A handler copies them into an immutable
//! [`StatusView`] per request, so a scrape never holds the lock while it formats or probes.
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

mod metrics;
mod probe;

use std::net::SocketAddr;
use std::sync::Mutex;
use std::time::Duration;

use axum::Router;
use axum::extract::State;
use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Json};
use axum::routing::get;
use serde::Serialize;
use sqlx::PgPool;

use crate::error::BuilderError;
use crate::notify::BuilderState;
use crate::settings::SettingError;
use crate::store::LibraryTarget;

pub use metrics::render_metrics;

/// The content type of `/metrics`: the Prometheus text exposition format 0.0.4.
pub const METRICS_CONTENT_TYPE: &str = "text/plain; version=0.0.4";

/// The `/healthz` status when every configured dependency answers.
pub const STATUS_OK: &str = "ok";

/// The `/healthz` status when a configured dependency does not answer.
pub const STATUS_DEGRADED: &str = "degraded";

/// The database probe: the login and whether it holds the builder role (O-28).
const DATABASE_PROBE_SQL: &str =
    "select current_user::text, pg_has_role(current_user, 'builder', 'member')";

/// A dependency that is not configured.
const UNCONFIGURED: &str = "unconfigured";

/// The state's name as `/healthz` and `builder_state{state}` write it, the `snake_case`
/// form `notify` serializes.
#[must_use]
pub fn state_name(state: BuilderState) -> &'static str {
    match state {
        BuilderState::Running => "running",
        BuilderState::Throttled => "throttled",
        BuilderState::Paused => "paused",
        BuilderState::Idle => "idle",
    }
}

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
        if let Some(index) = JOB_OUTCOMES.iter().position(|known| *known == outcome) {
            self.update(|view| view.jobs[index] = view.jobs[index].saturating_add(1));
        } else {
            tracing::warn!(outcome, "not a counted job outcome; builder_jobs_total unchanged");
        }
    }

    /// Records one solved line: its seconds into the sum, one into the count, and its
    /// iterations into the total.
    pub fn record_line(&self, seconds: f64, iterations: u32) {
        self.update(|view| {
            view.line_seconds_sum += seconds;
            view.line_count = view.line_count.saturating_add(1);
            view.line_iterations = view.line_iterations.saturating_add(u64::from(iterations));
        });
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

/// The router: `GET /healthz` and `GET /metrics`; every other path answers 404.
pub fn router(state: OpsState) -> Router {
    Router::new()
        .route("/healthz", get(healthz))
        .route("/metrics", get(metrics_handler))
        .with_state(state)
}

/// `GET /metrics`: the Prometheus text of the current view and the process's peak resident
/// set size.
async fn metrics_handler(State(state): State<OpsState>) -> impl IntoResponse {
    let view = state.status.view();
    let text = render_metrics(&view, crate::job::peak_rss_bytes());
    ([(header::CONTENT_TYPE, METRICS_CONTENT_TYPE)], text)
}

/// `GET /healthz`: probes the configured dependencies and answers 200 when every one
/// answers, 503 when one does not (O-207). An unconfigured dependency is not a failure.
async fn healthz(State(state): State<OpsState>) -> impl IntoResponse {
    let body = health_body(&state).await;
    let code =
        if body.status == STATUS_OK { StatusCode::OK } else { StatusCode::SERVICE_UNAVAILABLE };
    (code, Json(body))
}

/// The `/healthz` body for `state`, with both probes run.
pub async fn health_body(state: &OpsState) -> HealthBody {
    let view = state.status.view();
    let database = match &state.database {
        None => UNCONFIGURED.to_owned(),
        Some(pool) => probe_database(pool).await.to_owned(),
    };
    let store = match &state.target {
        None => StoreHealth { kind: UNCONFIGURED.to_owned(), reachable: false },
        Some(target) => {
            StoreHealth { kind: target.kind().to_owned(), reachable: probe_store(target).await }
        }
    };
    let database_failed = state.database.is_some() && database != STATUS_OK;
    let store_failed = state.target.is_some() && !store.reachable;
    let status = if database_failed || store_failed { STATUS_DEGRADED } else { STATUS_OK };
    HealthBody {
        status: status.to_owned(),
        version: crate::VERSION.to_owned(),
        worker_id: state.worker_id.clone(),
        state: state_name(view.state).to_owned(),
        reason: view.reason,
        database,
        store,
        current_job: view.current_job,
        settings_errors: view
            .settings_errors
            .iter()
            .map(|error| format!("{}: {}", error.key, error.reason))
            .collect(),
    }
}

/// `ok` when the probe query answers within [`PROBE_TIMEOUT`] and the login holds the
/// builder role, `unavailable` otherwise; the failure is logged without the password.
async fn probe_database(pool: &PgPool) -> &'static str {
    let query = sqlx::query_as::<_, (String, bool)>(DATABASE_PROBE_SQL).fetch_one(pool);
    match tokio::time::timeout(PROBE_TIMEOUT, query).await {
        Ok(Ok((_, true))) => STATUS_OK,
        Ok(Ok((login, false))) => {
            tracing::warn!(login, "the database login does not hold the builder role");
            "unavailable"
        }
        Ok(Err(error)) => {
            tracing::warn!(%error, "database probe failed");
            "unavailable"
        }
        Err(_) => {
            tracing::warn!(timeout = ?PROBE_TIMEOUT, "database probe timed out");
            "unavailable"
        }
    }
}

/// Whether the target answers within [`PROBE_TIMEOUT`]; a failure is logged.
async fn probe_store(target: &LibraryTarget) -> bool {
    match tokio::time::timeout(PROBE_TIMEOUT, target.probe()).await {
        Ok(Ok(())) => true,
        Ok(Err(error)) => {
            tracing::warn!(%error, kind = target.kind(), "store probe failed");
            false
        }
        Err(_) => {
            tracing::warn!(timeout = ?PROBE_TIMEOUT, kind = target.kind(), "store probe timed out");
            false
        }
    }
}

/// Serves `router(state)` on `bind` until `shutdown` resolves, letting in-flight requests
/// finish (axum's graceful shutdown).
///
/// # Errors
///
/// `BuilderError::Io` when the address cannot be bound or the accept loop fails.
pub async fn serve(
    bind: SocketAddr,
    state: OpsState,
    shutdown: impl std::future::Future<Output = ()> + Send + 'static,
) -> Result<(), BuilderError> {
    let io_error =
        |source: std::io::Error| BuilderError::Io { path: format!("listen {bind}"), source };
    let listener = tokio::net::TcpListener::bind(bind).await.map_err(io_error)?;
    tracing::info!(%bind, "operations surface listening");
    axum::serve(listener, router(state)).with_graceful_shutdown(shutdown).await.map_err(io_error)
}

/// Probes `/healthz` through the loopback at `bind`'s port; true on a 200.
///
/// One plain HTTP/1.1 `GET /healthz` with `Connection: close` over a standard-library TCP
/// connection to `127.0.0.1:<port>`, read to the end of the stream (the solver-query
/// pattern), so the container `HEALTHCHECK` needs neither curl nor an async runtime.
///
/// # Errors
///
/// `BuilderError::Io` when nothing answers, `BuilderError::Malformed` when the answer has
/// no HTTP status line.
pub fn probe(bind: SocketAddr) -> Result<bool, BuilderError> {
    probe::healthz_status(bind.port()).map(|status| status == StatusCode::OK.as_u16())
}
