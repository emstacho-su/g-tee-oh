//! `GET /v1/insights` (A5 section 2, R2.14, O-32, O-153): the E3 insight data for one
//! hand at one node. Mechanism, in order (as `/v1/nodes`, plan C.2 steps 1 to 3): the key
//! parses through `NodeKey::from_str` (400 otherwise), the node is read through
//! `Library::node_blocking` (400 for a malformed id, 404 for an unknown solution or key,
//! 503 for an unavailable solution), the hand parses against the record's hand space
//! through `hand::parse_hand` (400) and must be held by the node (404); then
//! `insights::compute` fills the blocks over `AppState.equity`. The noise flags take the
//! O-22 floor from the record's accuracy, else the manifest's exploitability (the larger
//! seat), else the 0.02 bb fallback (plan C.2 step 5).

use std::sync::Arc;

use axum::Json;
use axum::extract::{Query, State};
use gto_library::NodeView;
use gto_model::NodeKey;

use crate::api::insights::{InsightsQuery, InsightsResponse};
use crate::api::problem::Problem;
use crate::app::AppState;
use crate::error::ApiError;
use crate::grade;
use crate::hand::parse_hand;
use crate::insights;
use crate::library::SolutionInfo;

/// The E3 insight data for one hand at one node: threshold card, equity distributions,
/// range and nut advantage, blockers, hand role and noise flags.
///
/// # Errors
///
/// `ApiError::BadRequest` for a key, solution id or hand that does not parse (or a class
/// at a 1,326-combo node); `ApiError::NotFound` for a solution or node the library does
/// not hold or a hand the node does not hold; `ApiError::Unavailable` when the solution
/// is marked unavailable.
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
    State(state): State<AppState>,
    Query(query): Query<InsightsQuery>,
) -> Result<Json<InsightsResponse>, ApiError> {
    let key: NodeKey = query.node_key.parse()?;
    let library = Arc::clone(&state.library);
    let view = library.node_blocking(query.solution_id.clone(), key).await?;
    let hand = parse_hand(&query.hand, view.record().hand_space)?;
    if view.frequencies(hand.index).is_none() {
        return Err(ApiError::NotFound(format!(
            "hand {} is not in the node's range",
            ApiError::quoted(&query.hand)
        )));
    }
    let floor = floor_for(&view, state.library.info(&query.solution_id));
    Ok(Json(insights::compute(&state.equity, &view, hand, &query.hand, floor)))
}

/// The O-22 floor of a node in percent of the pot: its own accuracy, else the manifest's
/// exploitability (the larger seat), else the 0.02 bb fallback, the precedence of
/// `gto_model::grading::floor_pct_pot` (O-150) as `/v1/grade` applies it.
fn floor_for(view: &NodeView, info: Option<&SolutionInfo>) -> f32 {
    grade::floor(view, info.and_then(|info| info.exploitability_pct_pot)).pct_pot
}
