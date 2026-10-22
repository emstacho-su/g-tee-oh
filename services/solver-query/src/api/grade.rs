//! `POST /v1/grade` (A5 section 2, R2.13, ADR 0004): grades one decision against the
//! solution. The expected value (EV) loss, the floor (O-22) and the bucket come from here
//! and nowhere in TypeScript. The loss is reported raw; the TypeScript policy applies
//! `max(0, loss - floor)` (A6 section 4, R3.8).

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::api::NoiseFlag;

/// The most characters a `reference` may carry (O-156).
pub const REFERENCE_MAX_CHARS: usize = 64;

/// The body of `POST /v1/grade`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct GradeRequest {
    /// The solution to grade against.
    #[schema(example = "5e7a1c2b-3d4f-8a6b-9c0d-1e2f3a4b5c6d")]
    pub solution_id: String,
    /// The node key in the A3 section 1 grammar.
    #[schema(example = "cfg_6_online_100/BB-BTN/r250")]
    pub node_key: String,
    /// The hand graded: a class (`AKs`) or a combo (`AhKh`).
    #[schema(example = "AKs")]
    pub hand: String,
    /// The index of the action taken, in the node's record order.
    pub action_index: u8,
    /// An opaque string of at most 64 characters, echoed back so the api service can
    /// correlate attempts (O-156).
    #[schema(max_length = 64)]
    pub reference: Option<String>,
}

/// Which source set the floor (O-22, O-150).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum FloorSource {
    /// The 0.2 percent noise floor was the largest term.
    NoiseFloor,
    /// The record's own accuracy was the largest term.
    NodeAccuracy,
    /// The manifest's exploitability (the larger seat) was the largest term.
    Exploitability,
    /// No accuracy was known, so 0.02 bb over the pot was the largest term.
    FallbackBb,
}

/// How hard the decision was, for the trainer's scheduling (R4.4).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct DifficultyFeatures {
    /// The best action's EV minus the second best, in percent of the pot; 0 with one action.
    pub ev_gap_pct_pot: f32,
    /// The largest frequency of any action.
    pub purity: f32,
    /// How many actions the node offers.
    pub n_actions: u8,
    /// True when two or more actions are played at 5 percent or more.
    pub mixed: bool,
    /// True when every nonzero loss is under the floor, so no action can be graded wrong.
    pub all_within_floor: bool,
}

/// The body of a `POST /v1/grade` answer.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct GradeResponse {
    /// The solution graded against.
    pub solution_id: String,
    /// The node key in its canonical text.
    pub node_key: String,
    /// The hand as given.
    pub hand: String,
    /// The action graded.
    pub action_index: u8,
    /// The request's `reference`, echoed.
    pub reference: Option<String>,
    /// The EV of each action in big blinds (bb), in record order.
    pub ev_by_action: Vec<f32>,
    /// The frequency of each action, in record order.
    pub freq_by_action: Vec<f32>,
    /// The first action with zero loss: the highest EV, the first on ties (O-130).
    pub best_action_index: u8,
    /// The EV of the chosen action in bb.
    pub ev_chosen_bb: f32,
    /// The EV of the best action in bb.
    pub ev_best_bb: f32,
    /// The loss of the chosen action in bb, raw and never clamped.
    pub loss_bb: f32,
    /// The loss of the chosen action in percent of the pot, raw and never clamped.
    pub loss_pct_pot: f32,
    /// The floor in percent of the pot the policy subtracts (O-22).
    pub floor_pct_pot: f32,
    /// Which term set the floor.
    pub floor_source: FloorSource,
    /// The chosen action's bucket as `gto_model::Bucket::as_str`; null when it has none.
    pub bucket: Option<String>,
    /// Hand-level flags: `close_ev_mix`, `rare_line`, `suit_mixing`.
    pub noise_flags: Vec<NoiseFlag>,
    /// How hard the decision was.
    pub difficulty_features: DifficultyFeatures,
}
