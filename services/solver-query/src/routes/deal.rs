//! `POST /v1/deal` and `GET /v1/deal/{id}/reveal` (A5 section 2, R2.13, O-145, O-152).
//! The handlers are thin: `deal::resolve_start` turns the filter into a start node through
//! the registry, `Deal::make` is the pure deal of plan C.4, and the store holds the deal
//! and reveals one street at a time. No board card is in the deal answer (A5 rule two).

use axum::Json;
use axum::extract::{Path, Query, State};
use gto_library::is_uuid;
use gto_model::Street;

use crate::api::deal::{DealRequest, DealResponse, RevealQuery, RevealResponse, Revealed};
use crate::api::problem::Problem;
use crate::app::AppState;
use crate::deal::{Deal, resolve_start};
use crate::error::ApiError;

/// Deals a scenario from a seed: the start node, both hands and the solutions in play.
/// The board stays server-side until each street is revealed (A5 rule two).
///
/// # Errors
///
/// `ApiError::BadRequest` for a configuration, pair, street, line, spot-class key or seed
/// that does not parse, or a filter v1 does not take (a texture, a street other than
/// preflop); `ApiError::NotFound` when no solution of the pair holds the start node;
/// `ApiError::Unavailable` when a solution of the pair is marked unavailable.
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
    State(state): State<AppState>,
    Json(request): Json<DealRequest>,
) -> Result<Json<DealResponse>, ApiError> {
    let start = resolve_start(&state.library, &request.filter).await?;
    let made = Deal::make(request.seed, start).map_err(|err| {
        ApiError::Internal(format!("the shuffled deck dealt a repeated card: {err}"))
    })?;
    let (held, revealed) = state.deals.hold(made);
    Ok(Json(response(&held, revealed)))
}

/// The deal answer: the start, both hands and the streets revealed so far, never the
/// board itself.
fn response(deal: &Deal, revealed: Revealed) -> DealResponse {
    DealResponse {
        deal_id: deal.id.clone(),
        solution_ids: deal.solution_ids.clone(),
        start_node_key: deal.start_key.to_string(),
        hero_position: deal.hero.as_str().to_owned(),
        villain_position: deal.villain.as_str().to_owned(),
        hero_hand: deal.hero_hand.to_string(),
        villain_hand: deal.villain_hand.to_string(),
        revealed,
    }
}

/// Reveals the next street of a deal: the flop first, then the turn, then the river. A
/// repeat answers the same cards.
///
/// # Errors
///
/// `ApiError::BadRequest` for an id that is not a lowercase UUID or a street other than
/// flop, turn or river; `ApiError::NotFound` for a deal the store does not hold (post the
/// seed and filter again to recreate it); `ApiError::Conflict` for a street revealed out
/// of order.
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
    State(state): State<AppState>,
    Path(id): Path<String>,
    Query(query): Query<RevealQuery>,
) -> Result<Json<RevealResponse>, ApiError> {
    if !is_uuid(&id) {
        return Err(ApiError::BadRequest(format!(
            "deal id {} is not a lowercase UUID",
            ApiError::quoted(&id)
        )));
    }
    let street: Street = query.street.parse()?;
    let revealed = state.deals.reveal(&id, street)?;
    Ok(Json(RevealResponse {
        deal_id: id,
        street: street.to_string(),
        cards: revealed.cards.iter().map(ToString::to_string).collect(),
        board: revealed.board,
    }))
}
