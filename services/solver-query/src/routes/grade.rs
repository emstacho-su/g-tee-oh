//! `POST /v1/grade` (A5 section 2, R2.13, ADR 0004). A stub until the grade math path of
//! plan C.2 lands: it answers 501 with a problem body.

use axum::Json;
use axum::extract::State;

use crate::api::grade::{GradeRequest, GradeResponse};
use crate::api::problem::Problem;
use crate::app::AppState;
use crate::error::ApiError;

/// Grades one decision: expected value (EV) loss in big blinds and percent of the pot, the
/// floor (O-22), the bucket, the noise flags and the difficulty features.
///
/// # Errors
///
/// A stub: every call answers `ApiError::NotImplemented` (501) until the lane lands.
#[utoipa::path(
    post,
    path = "/v1/grade",
    tag = "grade",
    request_body = GradeRequest,
    responses(
        (status = 200, description = "The graded decision", body = GradeResponse),
        (status = 400, description = "A malformed solution id, node key or hand, an action \
            index out of range, or a reference over 64 characters",
            body = Problem, content_type = "application/problem+json"),
        (status = 404, description = "No such solution, node or hand",
            body = Problem, content_type = "application/problem+json"),
        (status = 503, description = "The solution is marked unavailable",
            body = Problem, content_type = "application/problem+json"),
    )
)]
pub async fn grade(
    State(_state): State<AppState>,
    Json(_request): Json<GradeRequest>,
) -> Result<Json<GradeResponse>, ApiError> {
    Err(ApiError::NotImplemented)
}
