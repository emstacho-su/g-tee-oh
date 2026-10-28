//! `POST /v1/sample-action` (A5 section 2, R2.13, O-151, plan C.5). The node is read as
//! the grade path reads it (the key, then the solution through the registry on the
//! blocking pool, then the hand in the record's hand space); the hand's renormalized
//! frequencies from `NodeView::frequencies` are the bands a unit draw from `SplitMix64`
//! seeded with `rng_state` falls into, in record order; the answer carries the index, the
//! token, the roll and the generator's state after the draw, so a replay from the same
//! state gives the same action.

use std::sync::Arc;

use axum::Json;
use axum::extract::State;
use gto_model::NodeKey;

use crate::api::deal::Hex64;
use crate::api::problem::Problem;
use crate::api::sample_action::{SampleActionRequest, SampleActionResponse};
use crate::app::AppState;
use crate::error::ApiError;
use crate::hand::parse_hand;
use crate::rng::{SplitMix64, pick_by_frequency};

/// Draws the opponent's action at a node from the hand's frequencies and returns the
/// generator state to send next.
///
/// # Errors
///
/// `ApiError::BadRequest` for a key, solution id, hand or state that does not parse;
/// `ApiError::NotFound` for a solution, node or hand the library does not hold;
/// `ApiError::Unavailable` when the solution is marked unavailable; `ApiError::Internal`
/// for a record without an action, which no request can cause.
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
    State(state): State<AppState>,
    Json(request): Json<SampleActionRequest>,
) -> Result<Json<SampleActionResponse>, ApiError> {
    let key: NodeKey = request.node_key.parse()?;
    let view = Arc::clone(&state.library).node_blocking(request.solution_id.clone(), key).await?;
    let space = view.record().hand_space;
    let hand = parse_hand(&request.hand, space)?;
    let frequencies = view.frequencies(hand.index).ok_or_else(|| {
        ApiError::HandNotInRange(format!("hand {} is not held at this node", hand.label(space)))
    })?;
    let mut generator = SplitMix64::from(request.rng_state);
    let roll = generator.next_unit();
    let index = pick_by_frequency(roll, &frequencies)
        .ok_or_else(|| ApiError::Internal("the node record holds no action".to_owned()))?;
    let token = view
        .actions()
        .get(index)
        .map(|action| action.token.to_string())
        .ok_or_else(|| ApiError::Internal(format!("action {index} has no record entry")))?;
    let action_index = u8::try_from(index)
        .map_err(|_| ApiError::Internal(format!("action index {index} exceeds the record")))?;
    Ok(Json(SampleActionResponse { action_index, token, roll, rng_state: Hex64::from(generator) }))
}
