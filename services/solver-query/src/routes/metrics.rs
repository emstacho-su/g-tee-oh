//! `GET /metrics` (A5 section 2, A9 section 4, R2.13, O-155): the Prometheus text
//! exposition. The counters and the histogram come from the registry the latency
//! middleware writes (`Metrics::render`); the gauges are read at scrape time from the
//! library (`Library::stats`), the query-role pool (`Db::is_connected`, the probe bounded
//! by its timeout) and the deal store (`DealStore::held`). The body is served as
//! `text/plain; version=0.0.4`, the exposition media type.

use axum::extract::State;
use axum::http::header;
use axum::response::{IntoResponse, Response};

use crate::api::problem::Problem;
use crate::app::AppState;
use crate::error::ApiError;
use crate::metrics::Gauges;

/// The media type of the exposition, Prometheus text format version 0.0.4.
pub const METRICS_CONTENT_TYPE: &str = "text/plain; version=0.0.4";

/// The request counters, the latency histogram and the library gauges as Prometheus text.
///
/// # Errors
///
/// None today: the registry's lock is reused when poisoned, so every scrape answers.
#[utoipa::path(
    get,
    path = "/metrics",
    tag = "ops",
    responses(
        (status = 200, description = "The Prometheus exposition",
            body = String, content_type = "text/plain; version=0.0.4"),
        (status = 503, description = "The registry could not be read",
            body = Problem, content_type = "application/problem+json"),
    )
)]
pub async fn metrics(State(state): State<AppState>) -> Result<Response, ApiError> {
    let db_connected = match state.db.as_deref() {
        Some(db) => db.is_connected().await,
        None => false,
    };
    let gauges =
        Gauges { library: state.library.stats(), db_connected, deals_held: state.deals.held() };
    let text = state.metrics.render(&gauges);
    Ok(([(header::CONTENT_TYPE, METRICS_CONTENT_TYPE)], text).into_response())
}
