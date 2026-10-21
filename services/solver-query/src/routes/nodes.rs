//! `GET /v1/nodes` (A5 section 2, R2.13). A stub until the reader lookup of plan C.2
//! lands: it answers 501 with a problem body. The `#[utoipa::path]` attribute is the
//! contract; the signature fixes the extractors the implementation keeps.

use axum::Json;
use axum::extract::{Query, State};

use crate::api::nodes::{NodeResponse, NodesQuery};
use crate::api::problem::Problem;
use crate::app::AppState;
use crate::error::ApiError;

/// One node of one solution with its actions, hand rows and range summaries.
///
/// # Errors
///
/// A stub: every call answers `ApiError::NotImplemented` (501) until the lane lands.
#[utoipa::path(
    get,
    path = "/v1/nodes",
    tag = "nodes",
    params(NodesQuery),
    responses(
        (status = 200, description = "The node", body = NodeResponse),
        (status = 400, description = "A malformed solution id, node key or hand filter",
            body = Problem, content_type = "application/problem+json"),
        (status = 404, description = "No such solution or node",
            body = Problem, content_type = "application/problem+json"),
        (status = 503, description = "The solution is marked unavailable",
            body = Problem, content_type = "application/problem+json"),
    )
)]
pub async fn nodes(
    State(_state): State<AppState>,
    Query(_query): Query<NodesQuery>,
) -> Result<Json<NodeResponse>, ApiError> {
    Err(ApiError::NotImplemented)
}
