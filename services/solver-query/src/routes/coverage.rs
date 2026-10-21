//! `GET /v1/coverage` (A5 section 2, R2.13, O-28, O-146). A stub until the registry and
//! query-role reads of plan C.6 land: it answers 501 with a problem body.

use axum::Json;
use axum::extract::{Query, State};

use crate::api::coverage::{CoverageQuery, CoverageResponse};
use crate::api::problem::Problem;
use crate::app::AppState;
use crate::error::ApiError;

/// What the library holds for a configuration and pair: preflop availability, flops by
/// texture family and the build queue.
///
/// # Errors
///
/// A stub: every call answers `ApiError::NotImplemented` (501) until the lane lands.
#[utoipa::path(
    get,
    path = "/v1/coverage",
    tag = "coverage",
    params(CoverageQuery),
    responses(
        (status = 200, description = "The coverage", body = CoverageResponse),
        (status = 400, description = "A malformed configuration identifier or pair",
            body = Problem, content_type = "application/problem+json"),
        (status = 503, description = "The query database did not answer",
            body = Problem, content_type = "application/problem+json"),
    )
)]
pub async fn coverage(
    State(_state): State<AppState>,
    Query(_query): Query<CoverageQuery>,
) -> Result<Json<CoverageResponse>, ApiError> {
    Err(ApiError::NotImplemented)
}
