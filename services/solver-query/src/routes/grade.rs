//! `POST /v1/grade` (A5 section 2, R2.13, ADR 0004, plan C.2): grades one decision against
//! the solution. Every number comes from `grade` over the record the reader returns: the
//! EV per action, the raw loss in bb and in percent of the pot, the O-22 floor with its
//! source, the pack-time bucket, the noise flags and the difficulty features. The
//! `reference` is an opaque string of at most `REFERENCE_MAX_CHARS` characters, echoed
//! back (O-156).
//!
//! Order of checks: the key, the reference and the hand's syntax before anything touches
//! the store (a hand must at least be a class or a combo); then `Library::node_blocking`
//! (400, 404 or 503 as for `/v1/nodes`); then the hand against the record's space (400 for
//! a class at a 1,326-combo node), the action index against the record's actions (400) and
//! the hand against the node's range (404).

use std::sync::Arc;

use axum::Json;
use axum::extract::State;
use gto_library::{HandSpace, NodeView, loss_bb};
use gto_model::NodeKey;

use crate::api::grade::{GradeRequest, GradeResponse, REFERENCE_MAX_CHARS};
use crate::api::problem::Problem;
use crate::app::AppState;
use crate::error::ApiError;
use crate::grade;
use crate::hand::parse_hand;

/// Grades one decision: expected value (EV) loss in big blinds and percent of the pot, the
/// floor (O-22), the bucket, the noise flags and the difficulty features.
///
/// # Errors
///
/// `ApiError::BadRequest` for a malformed solution id, node key or hand, an action index
/// out of range or a reference over 64 characters; `ApiError::NotFound` for a solution,
/// node or hand that does not exist; `ApiError::Unavailable` for a solution the reader
/// marked unavailable.
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
    State(state): State<AppState>,
    Json(request): Json<GradeRequest>,
) -> Result<Json<GradeResponse>, ApiError> {
    let key: NodeKey = request.node_key.parse()?;
    check_reference(request.reference.as_deref())?;
    parse_hand(&request.hand, HandSpace::Preflop169)?;
    let library = Arc::clone(&state.library);
    let view = library.node_blocking(request.solution_id.clone(), key.clone()).await?;
    let exploitability = state
        .library
        .info(&request.solution_id)
        .map(|info| info.exploitability_pct_pot)
        .ok_or_else(|| {
            let id = &request.solution_id;
            ApiError::Internal(format!("solution {id} read but is not indexed"))
        })?;
    Ok(Json(grade_response(request, &key, &view, exploitability)?))
}

/// Rejects a reference over `REFERENCE_MAX_CHARS` characters (O-156); the text itself is
/// opaque and never echoed in the problem.
fn check_reference(reference: Option<&str>) -> Result<(), ApiError> {
    let length = reference.map_or(0, |text| text.chars().count());
    if length > REFERENCE_MAX_CHARS {
        return Err(ApiError::BadRequest(format!(
            "reference is {length} characters; at most {REFERENCE_MAX_CHARS} are allowed"
        )));
    }
    Ok(())
}

/// The graded decision for `request` over `view` read under `key`.
fn grade_response(
    request: GradeRequest,
    key: &NodeKey,
    view: &NodeView,
    exploitability_pct_pot: Option<[f64; 2]>,
) -> Result<GradeResponse, ApiError> {
    let record = view.record();
    let hand = parse_hand(&request.hand, record.hand_space)?;
    let action = usize::from(request.action_index);
    let Some(chosen) = record.actions.get(action) else {
        let count = record.actions.len();
        return Err(ApiError::BadRequest(format!(
            "action_index {action} is outside the node's {count} actions"
        )));
    };
    let numbers = grade::hand_numbers(view, hand.index).ok_or_else(|| {
        let label = ApiError::quoted(&hand.label(record.hand_space));
        ApiError::NotFound(format!("hand {label} is not in the node's range"))
    })?;
    let floor = grade::floor(view, exploitability_pct_pot);
    let units = numbers.loss_units[action];
    let best = numbers.best_action();
    Ok(GradeResponse {
        solution_id: request.solution_id,
        node_key: key.to_string(),
        hand: request.hand,
        action_index: request.action_index,
        reference: request.reference,
        best_action_index: u8::try_from(best).unwrap_or(u8::MAX),
        ev_chosen_bb: numbers.ev_bb[action],
        ev_best_bb: numbers.ev_best_bb(),
        loss_bb: loss_bb(units, record.pot),
        loss_pct_pot: grade::loss_pct_pot(units),
        floor_pct_pot: floor.pct_pot,
        floor_source: grade::floor_source(floor.source),
        bucket: chosen.bucket.map(|bucket| bucket.as_str().to_owned()),
        noise_flags: grade::noise_flags(view, hand.index, floor.pct_pot),
        difficulty_features: grade::difficulty_features(
            &numbers.frequencies,
            &numbers.loss_units,
            floor.pct_pot,
        ),
        ev_by_action: numbers.ev_bb,
        freq_by_action: numbers.frequencies,
    })
}

#[cfg(test)]
mod tests {
    use super::check_reference;
    use crate::api::grade::REFERENCE_MAX_CHARS;
    use crate::error::ApiError;

    #[test]
    fn r2_13_reference_is_capped_at_64_characters_and_never_echoed_in_the_problem() {
        assert_eq!(check_reference(None), Ok(()));
        let limit = "x".repeat(REFERENCE_MAX_CHARS);
        assert_eq!(check_reference(Some(&limit)), Ok(()));
        let over = format!("{limit}y");
        let error = check_reference(Some(&over)).expect_err("one over the limit");
        assert!(matches!(error, ApiError::BadRequest(ref m) if !m.contains("xxx")), "{error}");
        assert_eq!(error.status().as_u16(), 400);
        let wide = "\u{e9}".repeat(REFERENCE_MAX_CHARS);
        assert_eq!(check_reference(Some(&wide)), Ok(()), "characters, not bytes");
    }
}
