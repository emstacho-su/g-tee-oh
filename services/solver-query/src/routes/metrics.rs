//! `GET /metrics` (A5 section 2, A9 section 4, R2.13, O-155): the Prometheus text
//! exposition. A stub until the registry of plan C.8 lands: it answers 501 with a problem
//! body.

use axum::extract::State;
use axum::response::Response;

use crate::api::problem::Problem;
use crate::app::AppState;
use crate::error::ApiError;

/// The media type of the exposition, Prometheus text format version 0.0.4.
pub const METRICS_CONTENT_TYPE: &str = "text/plain; version=0.0.4";

/// The request counters, the latency histogram and the library gauges as Prometheus text.
///
/// # Errors
///
/// A stub: every call answers `ApiError::NotImplemented` (501) until the lane lands.
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
pub async fn metrics(State(_state): State<AppState>) -> Result<Response, ApiError> {
    Err(ApiError::NotImplemented)
}
