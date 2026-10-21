//! `GET /v1/insights` (A5 section 2, R2.14). A stub until the E3 computations of plan C.3
//! land: it answers 501 with a problem body.

use axum::Json;
use axum::extract::{Query, State};

use crate::api::insights::{InsightsQuery, InsightsResponse};
use crate::api::problem::Problem;
use crate::app::AppState;
use crate::error::ApiError;

/// The E3 insight data for one hand at one node: threshold card, equity distributions,
/// range and nut advantage, blockers, hand role and noise flags.
///
/// # Errors
///
/// A stub: every call answers `ApiError::NotImplemented` (501) until the lane lands.
#[utoipa::path(
    get,
    path = "/v1/insights",
    tag = "insights",
    params(InsightsQuery),
    responses(
        (status = 200, description = "The insight data", body = InsightsResponse),
        (status = 400, description = "A malformed solution id, node key or hand",
            body = Problem, content_type = "application/problem+json"),
        (status = 404, description = "No such solution, node or hand",
            body = Problem, content_type = "application/problem+json"),
        (status = 503, description = "The solution is marked unavailable",
            body = Problem, content_type = "application/problem+json"),
    )
)]
pub async fn insights(
    State(_state): State<AppState>,
    Query(_query): Query<InsightsQuery>,
) -> Result<Json<InsightsResponse>, ApiError> {
    Err(ApiError::NotImplemented)
}
