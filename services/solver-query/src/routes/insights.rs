//! `GET /v1/insights` (A5 section 2, R2.14, O-32, O-153): the E3 insight data for one
//! hand at one node. Mechanism, in order (as `/v1/nodes`, plan C.2 steps 1 to 3): the key
//! parses through `NodeKey::from_str` (400 otherwise), the node is read through
//! `Library::node_blocking` (400 for a malformed id, 404 for an unknown solution or key,
//! 503 for an unavailable solution), the hand parses against the record's hand space
//! through `hand::parse_hand` (400) and must be held by the node (404); then
//! `insights::compute` fills the blocks over `AppState.equity`. The noise flags take the
//! O-22 floor from the record's accuracy, else the manifest's exploitability (the larger
//! seat), else the 0.02 bb fallback (plan C.2 step 5).
//!
//! Two states no request can cause answer 500 exactly as `/v1/nodes` and `/v1/grade` do: a
//! solution the reader returned but the registry does not index (`floor_for`), and a
//! record whose seat byte names neither seat of the pair (`grade::acting_seat_or_internal`,
//! the one decoder of that byte).

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
        return Err(ApiError::HandNotInRange(format!(
            "hand {} is not in the node's range",
            ApiError::quoted(&query.hand)
        )));
    }
    let info = state.library.info(&query.solution_id);
    let floor = floor_for(&view, &query.solution_id, info)?;
    Ok(Json(insights::compute(&state.equity, &view, hand, &query.hand, floor)?))
}

/// The O-22 floor of a node in percent of the pot: its own accuracy, else the manifest's
/// exploitability (the larger seat), else the 0.02 bb fallback, the precedence of
/// `gto_model::grading::floor_pct_pot` (O-150) as `/v1/grade` applies it.
///
/// # Errors
///
/// `ApiError::Internal` when `info` is `None`: `solution_id` was read but is not indexed,
/// a registry state no request can cause, answered as `/v1/nodes` and `/v1/grade` answer it.
fn floor_for(
    view: &NodeView,
    solution_id: &str,
    info: Option<&SolutionInfo>,
) -> Result<f32, ApiError> {
    let info = info.ok_or_else(|| {
        ApiError::Internal(format!("solution {solution_id} read but is not indexed"))
    })?;
    Ok(grade::floor(view, info.exploitability_pct_pot).pct_pot)
}

#[cfg(test)]
mod tests {
    use gto_library::{
        HandSpace, ManifestKind, NodeRecord, NodeView, SolvedHand, SolvedNode, Source,
    };
    use gto_model::{ActionToken, Cbb, ConfigId, HandClass, NodeKey, Position, PositionPair};

    use super::floor_for;
    use crate::equity::EquityTable;
    use crate::error::ApiError;
    use crate::grade::{acting_seat, acting_seat_or_internal};
    use crate::hand::parse_hand;
    use crate::insights;
    use crate::library::SolutionInfo;

    /// A seat byte outside the pair (A3 section 4: 0 out of position, 1 in position).
    const MALFORMED_SEAT: u8 = 2;
    /// The pot of the test node in centi-big-blinds, 5 bb.
    const POT: Cbb = Cbb(500);
    /// The solution id the test registry entry carries.
    const SOLUTION_ID: &str = "s";
    /// How close an f32 floor must be to its expectation.
    const TOLERANCE: f32 = 1e-6;

    /// A `preflop_169` node at `cfg_6_online_100/BB-BTN/r250` holding AA with the big blind
    /// to act and no accuracy, as the reader returns it.
    fn record() -> NodeRecord {
        let config_id = ConfigId::new("cfg_6_online_100").expect("a catalog configuration");
        let pair = PositionPair::new(Position::Bb, Position::Btn).expect("two seats");
        let aa: HandClass = "AA".parse().expect("a class");
        let solved = SolvedNode {
            key: NodeKey::preflop(config_id, pair, vec![ActionToken::Raise(Cbb(250))]),
            to_act: Position::Bb,
            pot: POT,
            stacks: [Cbb(10_000), Cbb(10_000)],
            actions: vec![(ActionToken::Fold, Cbb::ZERO), (ActionToken::Raise(Cbb(800)), Cbb(800))],
            hand_space: HandSpace::Preflop169,
            hands: vec![SolvedHand {
                hand: u16::from(aa.index()),
                reach: Some([1.0, 1.0]),
                frequencies: vec![0.0, 1.0],
                ev_bb: vec![-0.5, 1.0],
            }],
            accuracy_pct_pot: None,
        };
        NodeRecord::from_solved(&solved, pair).expect("the node quantizes")
    }

    /// The registry entry of the solution with the given manifest exploitability.
    fn info(exploitability_pct_pot: Option<[f64; 2]>) -> SolutionInfo {
        SolutionInfo {
            id: SOLUTION_ID.to_owned(),
            prefix: format!("preflop/cfg_6_online_100/{SOLUTION_ID}"),
            kind: ManifestKind::Preflop,
            source: Source::Reference,
            synthetic: true,
            exploitability_pct_pot,
        }
    }

    #[test]
    fn r2_14_a_solution_read_but_not_indexed_answers_internal_as_nodes_and_grade_do() {
        let view = NodeView::from(record());
        let error = floor_for(&view, SOLUTION_ID, None).expect_err("not indexed");
        assert!(matches!(error, ApiError::Internal(ref m) if m.contains("not indexed")), "{error}");
        let fallback = floor_for(&view, SOLUTION_ID, Some(&info(None))).expect("indexed");
        assert!((fallback - 0.4).abs() < TOLERANCE, "2 cbb of 500 is 0.4 percent: {fallback}");
        let seats = Some(&info(Some([1.0, 2.0])));
        let exploitability = floor_for(&view, SOLUTION_ID, seats).expect("indexed");
        assert!((exploitability - 2.0).abs() < TOLERANCE, "the larger seat: {exploitability}");
    }

    #[test]
    fn r2_14_a_malformed_seat_byte_answers_internal_as_nodes_and_deal_do() {
        let mut malformed = record();
        malformed.to_act = MALFORMED_SEAT;
        let view = NodeView::from(malformed);
        assert_eq!(acting_seat(&view), None, "neither seat of the pair");
        let expected = acting_seat_or_internal(&view).expect_err("the one decoder refuses");
        let names_the_byte =
            matches!(expected, ApiError::Internal(ref m) if m.contains("seat index 2"));
        assert!(names_the_byte, "{expected}");
        let hand = parse_hand("AA", HandSpace::Preflop169).expect("a class");
        let floor = floor_for(&view, SOLUTION_ID, Some(&info(None))).expect("indexed");
        let result = insights::compute(&EquityTable::embedded(), &view, hand, "AA", floor);
        assert_eq!(result, Err(expected));
    }
}
