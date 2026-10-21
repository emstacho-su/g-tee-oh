//! `POST /v1/deal` and `GET /v1/deal/{id}/reveal` (A5 section 2, R2.13, O-152). Stubs
//! until the seeded deal of plan C.4 lands: both answer 501 with a problem body.

use axum::Json;
use axum::extract::{Path, Query, State};

use crate::api::deal::{DealRequest, DealResponse, RevealQuery, RevealResponse};
use crate::api::problem::Problem;
use crate::app::AppState;
use crate::error::ApiError;

/// Deals a scenario from a seed: the start node, both hands and the solutions in play.
/// The board stays server-side until each street is revealed (A5 rule two).
///
/// # Errors
///
/// A stub: every call answers `ApiError::NotImplemented` (501) until the lane lands.
#[utoipa::path(
    post,
    path = "/v1/deal",
    tag = "deal",
    request_body = DealRequest,
    responses(
        (status = 200, description = "The deal, with no board card", body = DealResponse),
        (status = 400, description = "A malformed configuration, pair, line, seed or a \
            filter v1 does not support (a texture, a street other than preflop)",
            body = Problem, content_type = "application/problem+json"),
        (status = 404, description = "No solution holds the start node",
            body = Problem, content_type = "application/problem+json"),
        (status = 503, description = "The solution is marked unavailable",
            body = Problem, content_type = "application/problem+json"),
    )
)]
pub async fn deal(
    State(_state): State<AppState>,
    Json(_request): Json<DealRequest>,
) -> Result<Json<DealResponse>, ApiError> {
    Err(ApiError::NotImplemented)
}

/// Reveals the next street of a deal: the flop first, then the turn, then the river. A
/// repeat answers the same cards.
///
/// # Errors
///
/// A stub: every call answers `ApiError::NotImplemented` (501) until the lane lands.
#[utoipa::path(
    get,
    path = "/v1/deal/{id}/reveal",
    tag = "deal",
    params(
        ("id" = String, Path, description = "The deal id from POST /v1/deal"),
        RevealQuery,
    ),
    responses(
        (status = 200, description = "The street's cards and the board so far",
            body = RevealResponse),
        (status = 400, description = "A street other than flop, turn or river",
            body = Problem, content_type = "application/problem+json"),
        (status = 404, description = "No such deal; post the seed again to recreate it",
            body = Problem, content_type = "application/problem+json"),
        (status = 409, description = "The street is revealed out of order",
            body = Problem, content_type = "application/problem+json"),
    )
)]
pub async fn reveal(
    State(_state): State<AppState>,
    Path(_id): Path<String>,
    Query(_query): Query<RevealQuery>,
) -> Result<Json<RevealResponse>, ApiError> {
    Err(ApiError::NotImplemented)
}
