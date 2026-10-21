//! `POST /v1/sample-action` (A5 section 2, R2.13, O-151). A stub until the draw of plan
//! C.5 lands: it answers 501 with a problem body.

use axum::Json;
use axum::extract::State;

use crate::api::problem::Problem;
use crate::api::sample_action::{SampleActionRequest, SampleActionResponse};
use crate::app::AppState;
use crate::error::ApiError;

/// Draws the opponent's action at a node from the hand's frequencies and returns the
/// generator state to send next.
///
/// # Errors
///
/// A stub: every call answers `ApiError::NotImplemented` (501) until the lane lands.
#[utoipa::path(
    post,
    path = "/v1/sample-action",
    tag = "sample-action",
    request_body = SampleActionRequest,
    responses(
        (status = 200, description = "The drawn action", body = SampleActionResponse),
        (status = 400, description = "A malformed solution id, node key, hand or state",
            body = Problem, content_type = "application/problem+json"),
        (status = 404, description = "No such solution, node or hand",
            body = Problem, content_type = "application/problem+json"),
        (status = 503, description = "The solution is marked unavailable",
            body = Problem, content_type = "application/problem+json"),
    )
)]
pub async fn sample_action(
    State(_state): State<AppState>,
    Json(_request): Json<SampleActionRequest>,
) -> Result<Json<SampleActionResponse>, ApiError> {
    Err(ApiError::NotImplemented)
}
