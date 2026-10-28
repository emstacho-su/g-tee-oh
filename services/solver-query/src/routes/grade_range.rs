//! `POST /v1/grade-range` (O-300, R3.17, ADR 0004): grades a painted range. Each hand's
//! numbers are the ones `POST /v1/grade` returns for that hand and action, from `grade`
//! over the record the reader returns: the raw loss in big blinds (bb) through
//! `gto_library::loss_bb`, the loss in percent of the pot through `grade::loss_pct_pot`,
//! the best action through `HandNumbers::best_action` and the node's floor through
//! `grade::floor` (O-22, O-150). Nothing is clamped; the TypeScript policy applies the
//! floor (A6 section 4).
//!
//! Weights: a hand's share of the acting seat's range is `grade::reach_weighted_combos`
//! over the seat's reach-weighted total (`grade::seat_totals`), the same convention as the
//! range summary of `/v1/nodes` (reach 1 when the record has none), so the shares of the
//! held hands sum to 1; every share is 0 when the seat holds no reach-weighted combo. The
//! weighted loss is the emitted f32 `loss_bb` widened to f64 times the share, and the total
//! is their f64 sum in `per_hand` order.
//!
//! Order of checks: the key, then the paint's length (at most `PAINT_MAX_ENTRIES`, before
//! any entry is read), then each entry's hand (a class name) and duplicates, all before
//! anything touches the store; then `Library::node_blocking` (400, 404 or 503 as for
//! `/v1/nodes`); then the record's space (400 at a `postflop_1326` node: painting is
//! preflop only in v1), each entry's action index and its hand against the node's range
//! (400), and last that every held hand is painted (400 naming up to `MISSING_LISTED` of
//! the missing hands). Caller text is echoed only through `ApiError::quoted`, which caps it.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

use axum::Json;
use axum::extract::State;
use gto_library::{HandSpace, NodeView, loss_bb};
use gto_model::{HandClass, NodeKey};

use crate::api::grade_range::{
    GradeRangeRequest, GradeRangeResponse, PAINT_MAX_ENTRIES, PaintedHand, PaintedHandGrade,
};
use crate::api::problem::Problem;
use crate::app::AppState;
use crate::error::ApiError;
use crate::grade;

/// The most missing hands a 400 names; the count names the rest.
pub const MISSING_LISTED: usize = 5;

/// Grades a painted range: each hand's expected value (EV) loss in bb and percent of the
/// pot at its painted action, its share of the acting seat's range, the weighted loss and
/// the total, with the node's floor (O-22).
///
/// # Errors
///
/// `ApiError::BadRequest` for a malformed solution id or node key, a paint over 1,326
/// entries, a hand that is not a class, a class painted twice, a 1,326-combo node, an
/// action index out of range, a hand the node does not hold or a held hand left unpainted;
/// `ApiError::NotFound` for a solution or node that does not exist; `ApiError::Unavailable`
/// for a solution the reader marked unavailable.
#[utoipa::path(
    post,
    path = "/v1/grade-range",
    tag = "grade",
    request_body = GradeRangeRequest,
    responses(
        (status = 200, description = "The graded range", body = GradeRangeResponse),
        (status = 400, description = "A malformed solution id or node key, a paint over 1,326 \
            entries, a hand that is not a class, a class painted twice, a 1,326-combo node, an \
            action index out of range, a hand the node does not hold, or a held hand left \
            unpainted",
            body = Problem, content_type = "application/problem+json"),
        (status = 404, description = "No such solution or node",
            body = Problem, content_type = "application/problem+json"),
        (status = 503, description = "The solution is marked unavailable",
            body = Problem, content_type = "application/problem+json"),
    )
)]
pub async fn grade_range(
    State(state): State<AppState>,
    Json(request): Json<GradeRangeRequest>,
) -> Result<Json<GradeRangeResponse>, ApiError> {
    let key: NodeKey = request.node_key.parse()?;
    let painted = parse_paint(&request.paint)?;
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
    let (per_hand, total_weighted_loss_bb) = grade_painted(&view, &painted)?;
    let floor = grade::floor(&view, exploitability);
    Ok(Json(GradeRangeResponse {
        solution_id: request.solution_id,
        node_key: key.to_string(),
        floor_pct_pot: floor.pct_pot,
        floor_source: grade::floor_source(floor.source),
        per_hand,
        total_weighted_loss_bb,
    }))
}

/// One paint entry that parsed: its class and its action index.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Painted {
    /// The painted class.
    class: HandClass,
    /// The painted action's index in record order, not yet checked against the node.
    action: usize,
}

/// The paint's entries in request order, once its length, every hand's syntax and the
/// absence of duplicates are checked; nothing here needs the node.
fn parse_paint(paint: &[PaintedHand]) -> Result<Vec<Painted>, ApiError> {
    if paint.len() > PAINT_MAX_ENTRIES {
        let count = paint.len();
        return Err(ApiError::BadRequest(format!(
            "paint has {count} entries; at most {PAINT_MAX_ENTRIES} are allowed"
        )));
    }
    let mut seen = BTreeSet::new();
    paint
        .iter()
        .enumerate()
        .map(|(position, entry)| {
            let class: HandClass = entry.hand.parse().map_err(|_| {
                let shown = ApiError::quoted(&entry.hand);
                ApiError::BadRequest(format!(
                    "paint[{position}] hand {shown} is not a class such as AKs"
                ))
            })?;
            if !seen.insert(class.index()) {
                let shown = ApiError::quoted(&class.to_string());
                return Err(ApiError::BadRequest(format!(
                    "paint[{position}] paints {shown} more than once"
                )));
            }
            Ok(Painted { class, action: usize::from(entry.action_index) })
        })
        .collect()
}

/// The graded hands in record order and their total, once the paint covers exactly the
/// node's held hands with actions it offers.
fn grade_painted(
    view: &NodeView,
    painted: &[Painted],
) -> Result<(Vec<PaintedHandGrade>, f64), ApiError> {
    let by_hand = check_painted(view, painted)?;
    let seat = grade::acting_seat_or_internal(view)?;
    let (_, range_total) = grade::seat_totals(view, seat);
    let pot = view.record().pot;
    let per_hand = by_hand
        .into_iter()
        .map(|(hand, entry)| {
            let numbers = grade::hand_numbers(view, hand).ok_or_else(|| {
                ApiError::Internal(format!("hand {hand} is listed but has no column"))
            })?;
            let units = numbers.loss_units[entry.action];
            let loss = loss_bb(units, pot);
            let weight = if range_total > 0.0 {
                grade::reach_weighted_combos(view, seat, hand) / range_total
            } else {
                0.0
            };
            Ok(PaintedHandGrade {
                hand: entry.class.to_string(),
                action_index: u8::try_from(entry.action).unwrap_or(u8::MAX),
                best_action_index: u8::try_from(numbers.best_action()).unwrap_or(u8::MAX),
                loss_bb: loss,
                loss_pct_pot: grade::loss_pct_pot(units),
                weight,
                weighted_loss_bb: f64::from(loss) * weight,
            })
        })
        .collect::<Result<Vec<PaintedHandGrade>, ApiError>>()?;
    let total = per_hand.iter().map(|row| row.weighted_loss_bb).sum();
    Ok((per_hand, total))
}

/// The paint keyed by record index, once the node is a `preflop_169` node, every action
/// index is one it offers, every hand is one it holds and every held hand is painted.
fn check_painted(view: &NodeView, painted: &[Painted]) -> Result<BTreeMap<u16, Painted>, ApiError> {
    let record = view.record();
    if record.hand_space != HandSpace::Preflop169 {
        return Err(ApiError::BadRequest(
            "painting is preflop only in v1; this node holds 1,326 combos, not 169 classes"
                .to_owned(),
        ));
    }
    let actions = record.actions.len();
    let mut by_hand = BTreeMap::new();
    for entry in painted {
        let shown = ApiError::quoted(&entry.class.to_string());
        if entry.action >= actions {
            let action = entry.action;
            return Err(ApiError::BadRequest(format!(
                "action_index {action} for {shown} is outside the node's {actions} actions"
            )));
        }
        let hand = u16::from(entry.class.index());
        if view.frequencies(hand).is_none() {
            return Err(ApiError::BadRequest(format!("hand {shown} is not in the node's range")));
        }
        by_hand.insert(hand, *entry);
    }
    let missing: Vec<u16> =
        view.hands().into_iter().filter(|hand| !by_hand.contains_key(hand)).collect();
    if missing.is_empty() { Ok(by_hand) } else { Err(missing_hands(&missing)) }
}

/// The 400 for held hands left unpainted: their count and the first `MISSING_LISTED`.
fn missing_hands(missing: &[u16]) -> ApiError {
    let count = missing.len();
    let noun = if count == 1 { "hand" } else { "hands" };
    let names: Vec<String> = missing
        .iter()
        .take(MISSING_LISTED)
        .filter_map(|hand| u8::try_from(*hand).ok())
        .filter_map(|index| HandClass::from_index(index).ok())
        .map(|class| class.to_string())
        .collect();
    let more = if count > MISSING_LISTED { ", ..." } else { "" };
    let names = names.join(", ");
    ApiError::BadRequest(format!("paint misses {count} held {noun}: {names}{more}"))
}

#[cfg(test)]
mod tests;
