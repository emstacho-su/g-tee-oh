//! `POST /v1/grade-range` (O-300, R3.17, ADR 0004): grades a painted range. The caller
//! paints every hand the node holds with one action; the answer is each hand's expected
//! value (EV) loss in big blinds (bb) and in percent of the pot, its share of the acting
//! seat's range, the loss
//! weighted by that share, and the total. Painting is preflop only in v1, so a
//! `postflop_1326` node answers 400.
//!
//! Precision: `loss_bb` and `loss_pct_pot` are the f32 values `POST /v1/grade` returns for
//! the same hand and action. `weight`, `weighted_loss_bb` and `total_weighted_loss_bb` are
//! f64: `weighted_loss_bb` is the emitted `loss_bb` widened to f64 times `weight`, and the
//! total is the f64 sum of the `weighted_loss_bb` values in `per_hand` order, so a client
//! summing them in that order in f64 gets the total exactly.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::api::FloorSource;

/// The most entries a `paint` may carry: one per combo of the deck, the largest range any
/// node can hold, so the cap rejects only bodies no node could need (O-300).
pub const PAINT_MAX_ENTRIES: usize = 1_326;

/// One painted hand: a class and the action it is painted with.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct PaintedHand {
    /// The hand, a class name such as `AKs`.
    #[schema(example = "AKs")]
    pub hand: String,
    /// The index of the painted action, in the node's record order.
    pub action_index: u8,
}

/// The body of `POST /v1/grade-range`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct GradeRangeRequest {
    /// The solution to grade against.
    #[schema(example = "5e7a1c2b-3d4f-8a6b-9c0d-1e2f3a4b5c6d")]
    pub solution_id: String,
    /// The node key in the A3 section 1 grammar; a `preflop_169` node in v1.
    #[schema(example = "cfg_6_online_100/BB-BTN/r250")]
    pub node_key: String,
    /// Every hand the node holds, each exactly once, with its painted action; at most
    /// 1,326 entries.
    #[schema(max_items = 1326)]
    pub paint: Vec<PaintedHand>,
}

/// One painted hand graded.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct PaintedHandGrade {
    /// The hand's canonical class name.
    #[schema(example = "AKs")]
    pub hand: String,
    /// The painted action.
    pub action_index: u8,
    /// The first action with zero loss: the highest EV, the first on ties (O-130).
    pub best_action_index: u8,
    /// The painted action's loss in bb, raw and never clamped; equal to `POST /v1/grade`'s
    /// `loss_bb` for the same hand and action.
    pub loss_bb: f32,
    /// The painted action's loss in percent of the pot, raw and never clamped.
    pub loss_pct_pot: f32,
    /// The hand's share of the acting seat's range: its reach times its combos over the
    /// same sum across every hand the node holds (reach 1 when the record has none), so
    /// the weights sum to 1; every weight is 0 when the seat holds no reach-weighted combo.
    pub weight: f64,
    /// `loss_bb` times `weight`, in bb.
    pub weighted_loss_bb: f64,
}

/// The body of a `POST /v1/grade-range` answer.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct GradeRangeResponse {
    /// The solution graded against.
    pub solution_id: String,
    /// The node key in its canonical text.
    pub node_key: String,
    /// The floor in percent of the pot the policy subtracts per hand (O-22).
    pub floor_pct_pot: f32,
    /// Which term set the floor.
    pub floor_source: FloorSource,
    /// One entry per held hand, in the record's hand order.
    pub per_hand: Vec<PaintedHandGrade>,
    /// The sum of `weighted_loss_bb`: the painted range's EV loss in bb per hand dealt to
    /// the acting seat at this node.
    pub total_weighted_loss_bb: f64,
}
