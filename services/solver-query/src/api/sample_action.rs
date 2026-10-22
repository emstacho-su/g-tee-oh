//! `POST /v1/sample-action` (A5 section 2, R2.13, O-151): the opponent's action at a node,
//! drawn from the node's frequencies for the hand with a `SplitMix64` generator seeded by
//! `rng_state`. The answer carries the generator's state after the draw, so the caller
//! threads it through the next request and a replay from the same state gives the same
//! action (plan C.5).

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::api::deal::Hex64;

/// The body of `POST /v1/sample-action`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct SampleActionRequest {
    /// The solution to read.
    #[schema(example = "5e7a1c2b-3d4f-8a6b-9c0d-1e2f3a4b5c6d")]
    pub solution_id: String,
    /// The node key in the A3 section 1 grammar.
    #[schema(example = "cfg_6_online_100/BB-BTN/r250")]
    pub node_key: String,
    /// The opponent's hand: a class (`AKs`) or a combo (`AhKh`).
    #[schema(example = "AKs")]
    pub hand: String,
    /// The generator state to draw from.
    pub rng_state: Hex64,
}

/// The body of a `POST /v1/sample-action` answer.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct SampleActionResponse {
    /// The drawn action's index in the node's record order.
    pub action_index: u8,
    /// The drawn action's token text.
    #[schema(example = "c")]
    pub token: String,
    /// The uniform draw in `[0, 1)` the action was picked with, for tests.
    pub roll: f64,
    /// The generator state after the draw, to send with the next request.
    pub rng_state: Hex64,
}
