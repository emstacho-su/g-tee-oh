//! `GET /v1/nodes` (A5 section 2, R2.13, plan C.1 and C.2): one node of one solution with
//! its actions, the hand rows the `hands` filter selects, both range summaries, the
//! spot-class key and the node-level noise flags. The `#[utoipa::path]` attribute is the
//! contract; the body is assembled from `grade` and the view.
//!
//! Order of checks: the key and the filter parse before anything touches the store, then
//! `Library::node_blocking` resolves the solution (400 for a malformed id, 404 for one not
//! indexed, 503 for one marked unavailable) and reads the node (404 when the solution does
//! not hold the key), then a single hand is checked against the record's hand space (400
//! for a class at a 1,326-combo node, 404 for a hand the node does not hold).
//!
//! `hands=class` at a `postflop_1326` node aggregates the held combos of each class into
//! one row (O-159): strategy, EVs and losses are the mean over the class's combos weighted
//! by the acting seat's reach (equal weights without reach, or when no combo reaches), the
//! row's `ev_best_bb` is the mean of the combos' best EVs, so `ev_best_bb - ev_bb[a]` is the
//! mean loss of `a`, and the row's reach is the mean over the held combos. At a
//! `preflop_169` node it equals `all`. Every row's `mixed` flag is `grade::is_mixed` of the
//! row's own strategy, the aggregated one for a class row (O-301).

use std::collections::BTreeMap;
use std::sync::Arc;

use axum::Json;
use axum::extract::{Query, State};
use gto_library::{HandSpace, NodeView, RecordAction, narrow_f32};
use gto_model::{
    ActionFamily, ActionToken, Bucket, Cbb, ComboId, HandClass, NodeKey, SpotClass, Street,
};

use crate::api::nodes::{
    ActionKind, ActionShare, ActionView, HandRow, NodeResponse, NodesQuery, RangeSummary, SeatRange,
};
use crate::api::problem::Problem;
use crate::app::AppState;
use crate::error::ApiError;
use crate::grade::{self, HandNumbers, acting_seat, hand_numbers};
use crate::hand::parse_hand;

/// The `hands` value that lists every hand, the default.
pub const HANDS_ALL: &str = "all";
/// The `hands` value that lists one reach-weighted row per class (O-159).
pub const HANDS_CLASS: &str = "class";

/// Which hand rows a request asked for.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum HandsFilter {
    /// Every hand the node holds.
    All,
    /// One row per class.
    Class,
    /// One hand, as the caller wrote it.
    One(String),
}

impl HandsFilter {
    /// Parses the `hands` query value: absent or `all`, `class`, or a hand that is at least
    /// a class or a combo (the record's space decides more once the node is read).
    ///
    /// # Errors
    ///
    /// `ApiError::BadRequest` for text that is none of these.
    pub fn parse(hands: Option<&str>) -> Result<HandsFilter, ApiError> {
        match hands {
            None | Some(HANDS_ALL) => Ok(HandsFilter::All),
            Some(HANDS_CLASS) => Ok(HandsFilter::Class),
            Some(text) => {
                parse_hand(text, HandSpace::Preflop169)?;
                Ok(HandsFilter::One(text.to_owned()))
            }
        }
    }
}

/// One node of one solution with its actions, hand rows and range summaries.
///
/// # Errors
///
/// `ApiError::BadRequest` for a malformed node key, solution id or hand filter;
/// `ApiError::NotFound` for a solution, node or hand that does not exist;
/// `ApiError::Unavailable` for a solution the reader marked unavailable.
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
    State(state): State<AppState>,
    Query(query): Query<NodesQuery>,
) -> Result<Json<NodeResponse>, ApiError> {
    let key: NodeKey = query.node_key.parse()?;
    let filter = HandsFilter::parse(query.hands.as_deref())?;
    let library = Arc::clone(&state.library);
    let view = Arc::clone(&library).node_blocking(query.solution_id.clone(), key.clone()).await?;
    let tokens: Vec<ActionToken> = view.actions().iter().map(|action| action.token).collect();
    let next_keys =
        library.next_node_keys_blocking(query.solution_id.clone(), key.clone(), tokens).await?;
    let info = state.library.info(&query.solution_id).ok_or_else(|| {
        ApiError::Internal(format!("solution {} read but is not indexed", query.solution_id))
    })?;
    let solution = SolutionFacts {
        id: query.solution_id.clone(),
        exploitability_pct_pot: info.exploitability_pct_pot,
        synthetic: info.synthetic,
    };
    Ok(Json(node_response(solution, &key, &view, &next_keys, &filter)?))
}

/// What the response needs to know about the solution beyond the node itself.
struct SolutionFacts {
    /// The solution id.
    id: String,
    /// The manifest exploitability per seat, for the floor (O-150).
    exploitability_pct_pot: Option<[f64; 2]>,
    /// The manifest's synthetic flag (O-57, O-229).
    synthetic: bool,
}

/// The response body for `view` read under `key`; `next_keys` holds each action's child.
fn node_response(
    solution: SolutionFacts,
    key: &NodeKey,
    view: &NodeView,
    next_keys: &[Option<NodeKey>],
    filter: &HandsFilter,
) -> Result<NodeResponse, ApiError> {
    let SolutionFacts { id: solution_id, exploitability_pct_pot, synthetic } = solution;
    let record = view.record();
    let to_act = match acting_seat(view) {
        Some(0) => key.pair.oop(),
        Some(_) => key.pair.ip(),
        None => {
            let seat = record.to_act;
            return Err(ApiError::Internal(format!("node {key} names seat index {seat}")));
        }
    };
    Ok(NodeResponse {
        solution_id,
        node_key: key.to_string(),
        street: record.street.as_str().to_owned(),
        config_id: key.config_id.to_string(),
        pair: key.pair.to_string(),
        to_act: to_act.as_str().to_owned(),
        pot_cbb: record.pot.get(),
        stacks_cbb: [record.stacks[0].get(), record.stacks[1].get()],
        hand_space: record.hand_space.into(),
        accuracy_pct_pot: record.accuracy_pct_pot,
        floor_pct_pot: grade::floor(view, exploitability_pct_pot).pct_pot,
        action_family: action_family(key),
        spot_class_key: spot_class_key(key),
        actions: action_views(view, next_keys),
        hands: hand_rows(view, filter)?,
        range_summary: range_summary(view),
        noise_flags: grade::node_noise_flags(view),
        synthetic,
    })
}

/// The preflop action family of a preflop node (`ActionFamily::classify`); `None` postflop.
pub(crate) fn action_family(key: &NodeKey) -> Option<String> {
    (key.street() == Street::Preflop)
        .then(|| ActionFamily::classify(key.pair, &key.preflop).as_str().to_owned())
}

/// The spot-class key of a preflop node under a catalog configuration; `None` for a
/// configuration outside the catalog or a postflop node (`SpotClass::classify`).
pub(crate) fn spot_class_key(key: &NodeKey) -> Option<String> {
    let config = gto_model::v1_configs().into_iter().find(|c| c.config_id() == key.config_id)?;
    let class = SpotClass::classify(&config, key).ok()?;
    class.key().ok().map(|class_key| class_key.as_str().to_owned())
}

/// The actions in record order with their pack-time buckets, labels and child keys.
fn action_views(view: &NodeView, next_keys: &[Option<NodeKey>]) -> Vec<ActionView> {
    let street = view.record().street;
    view.actions()
        .iter()
        .enumerate()
        .map(|(index, action)| ActionView {
            next_node_key: next_keys.get(index).cloned().flatten().map(|key| key.to_string()),
            index: u8::try_from(index).unwrap_or(u8::MAX),
            token: action.token.to_string(),
            kind: action_kind(action.token),
            size_cbb: action.size.get(),
            bucket: action.bucket.map(|bucket| bucket.as_str().to_owned()),
            label: action_label(action, street),
        })
        .collect()
}

/// The kind of a token, its letter spelled out.
const fn action_kind(token: ActionToken) -> ActionKind {
    match token {
        ActionToken::Fold => ActionKind::Fold,
        ActionToken::Check => ActionKind::Check,
        ActionToken::Call => ActionKind::Call,
        ActionToken::Limp => ActionKind::Limp,
        ActionToken::Straddle(_) => ActionKind::Straddle,
        ActionToken::Bet(_) => ActionKind::Bet,
        ActionToken::Raise(_) => ActionKind::Raise,
        ActionToken::AllIn => ActionKind::AllIn,
    }
}

/// The button label: the exact size at a preflop node (O-22), the bucket's Grouped label
/// (`Bucket::label`) postflop, and the token's name for an action without a bucket.
pub(crate) fn action_label(action: &RecordAction, street: Street) -> String {
    match (street, action.bucket) {
        (Street::Preflop, _) | (_, None) => exact_label(action.token),
        (_, Some(bucket)) => Bucket::label(bucket).to_owned(),
    }
}

/// The token's name with its exact size in bb: `Fold`, `Call`, `Raise to 2.5bb`.
fn exact_label(token: ActionToken) -> String {
    match token {
        ActionToken::Fold => "Fold".to_owned(),
        ActionToken::Check => "Check".to_owned(),
        ActionToken::Call => "Call".to_owned(),
        ActionToken::Limp => "Limp".to_owned(),
        ActionToken::AllIn => "All-in".to_owned(),
        ActionToken::Straddle(size) => format!("Straddle {}bb", bb(size)),
        ActionToken::Bet(size) => format!("Bet {}bb", bb(size)),
        ActionToken::Raise(size) => format!("Raise to {}bb", bb(size)),
    }
}

/// A size in bb, written `2.5` or `8`.
fn bb(size: Cbb) -> f64 {
    f64::from(size.get()) / f64::from(Cbb::PER_BB)
}

/// The rows the filter selects.
fn hand_rows(view: &NodeView, filter: &HandsFilter) -> Result<Vec<HandRow>, ApiError> {
    let space = view.record().hand_space;
    match filter {
        HandsFilter::All => view.hands().into_iter().map(|hand| hand_row(view, hand)).collect(),
        HandsFilter::Class => match space {
            HandSpace::Preflop169 => hand_rows(view, &HandsFilter::All),
            HandSpace::Postflop1326 => Ok(class_rows(view)),
        },
        HandsFilter::One(text) => {
            let hand = parse_hand(text, space)?;
            let label = hand.label(space);
            match hand_numbers(view, hand.index) {
                Some(numbers) => Ok(vec![row(label, &numbers)]),
                None => Err(ApiError::HandNotInRange(format!(
                    "hand {} is not in the node's range",
                    ApiError::quoted(&label)
                ))),
            }
        }
    }
}

/// The row of one held hand, labelled by its space.
fn hand_row(view: &NodeView, hand: u16) -> Result<HandRow, ApiError> {
    let space = view.record().hand_space;
    let label = hand_label(space, hand)?;
    let numbers = hand_numbers(view, hand)
        .ok_or_else(|| ApiError::Internal(format!("hand {hand} is listed but has no column")))?;
    Ok(row(label, &numbers))
}

/// The class name at a `preflop_169` node, the combo text at a `postflop_1326` node.
fn hand_label(space: HandSpace, hand: u16) -> Result<String, ApiError> {
    let label = match space {
        HandSpace::Preflop169 => u8::try_from(hand)
            .ok()
            .and_then(|index| HandClass::from_index(index).ok())
            .map(|class| class.to_string()),
        HandSpace::Postflop1326 => ComboId::from_index(hand).ok().map(|combo| combo.to_string()),
    };
    label.ok_or_else(|| {
        let size = space.size();
        ApiError::Internal(format!("hand {hand} is outside the record's {size} hands"))
    })
}

/// One hand's row from its numbers.
fn row(hand: String, numbers: &HandNumbers) -> HandRow {
    HandRow {
        hand,
        reach: numbers.reach,
        strategy: numbers.frequencies.clone(),
        ev_bb: numbers.ev_bb.clone(),
        loss_pct_pot: numbers.loss_pct_pot(),
        ev_best_bb: numbers.ev_best_bb(),
        mixed: grade::is_mixed(&numbers.frequencies),
    }
}

/// One reach-weighted row per class holding at least one combo at a 1,326-combo node
/// (O-159), in class index order.
fn class_rows(view: &NodeView) -> Vec<HandRow> {
    let seat = acting_seat(view).unwrap_or_default();
    let mut classes: BTreeMap<u8, Vec<HandNumbers>> = BTreeMap::new();
    for hand in view.hands() {
        let Some((combo, numbers)) = ComboId::from_index(hand).ok().zip(hand_numbers(view, hand))
        else {
            continue;
        };
        classes.entry(combo.class().index()).or_default().push(numbers);
    }
    classes
        .into_iter()
        .filter_map(|(index, members)| {
            let class = HandClass::from_index(index).ok()?;
            Some(class_row(class.to_string(), &members, seat))
        })
        .collect()
}

/// The mean row of one class's held combos, weighted by the acting seat's reach (see the
/// module docs).
fn class_row(hand: String, members: &[HandNumbers], seat: usize) -> HandRow {
    let mut weights: Vec<f64> =
        members.iter().map(|m| m.reach.map_or(1.0, |reach| f64::from(reach[seat]))).collect();
    if weights.iter().sum::<f64>() <= 0.0 {
        weights.fill(1.0);
    }
    let total: f64 = weights.iter().sum();
    let mean = |values: &dyn Fn(&HandNumbers) -> Vec<f32>| -> Vec<f32> {
        let n = members.first().map_or(0, |m| m.frequencies.len());
        let mut sums = vec![0.0_f64; n];
        for (member, weight) in members.iter().zip(&weights) {
            for (sum, value) in sums.iter_mut().zip(values(member)) {
                *sum += weight * f64::from(value);
            }
        }
        sums.into_iter().map(|sum| narrow_f32(sum / total)).collect()
    };
    let best_sum: f64 =
        members.iter().zip(&weights).map(|(m, w)| w * f64::from(m.ev_best_bb())).sum();
    let ev_best_bb = narrow_f32(best_sum / total);
    let count = f64::from(u32::try_from(members.len()).unwrap_or(u32::MAX));
    let reach = members.iter().map(|m| m.reach).collect::<Option<Vec<[f32; 2]>>>().map(|all| {
        let sum = all
            .iter()
            .fold([0.0_f64; 2], |acc, r| [acc[0] + f64::from(r[0]), acc[1] + f64::from(r[1])]);
        sum.map(|s| narrow_f32(s / count))
    });
    let strategy = mean(&|m| m.frequencies.clone());
    HandRow {
        hand,
        reach,
        mixed: grade::is_mixed(&strategy),
        strategy,
        ev_bb: mean(&|m| m.ev_bb.clone()),
        loss_pct_pot: mean(&HandNumbers::loss_pct_pot),
        ev_best_bb,
    }
}

/// Both ranges and the acting seat's split over the actions.
fn range_summary(view: &NodeView) -> RangeSummary {
    let seat_range = |seat: usize| {
        let (combos, weighted) = grade::seat_totals(view, seat);
        SeatRange { combos, reach_weighted_combos: narrow_f32(weighted) }
    };
    let by_action = grade::action_shares(view)
        .into_iter()
        .enumerate()
        .map(|(index, share)| ActionShare {
            index: u8::try_from(index).unwrap_or(u8::MAX),
            share: narrow_f32(share),
        })
        .collect();
    RangeSummary { oop: seat_range(0), ip: seat_range(1), by_action }
}

#[cfg(test)]
mod tests;
