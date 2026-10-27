//! `GET /v1/nodes` (A5 section 2, R2.13): one node of one solution with its actions, the
//! per-hand strategy and expected values (EVs), the range summaries, the spot-class key
//! and the node-level noise flags. The `hands` filter takes `all` (the default), `class`
//! (a 1,326-combo node aggregated into 169 reach-weighted class rows, O-159) or one hand.

use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};

use crate::api::{HandSpaceName, NoiseFlag};

/// The query string of `GET /v1/nodes`.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct NodesQuery {
    /// The solution to read: a lowercase universally unique identifier (UUID) the library
    /// registry indexed at startup (O-144).
    #[param(example = "5e7a1c2b-3d4f-8a6b-9c0d-1e2f3a4b5c6d")]
    pub solution_id: String,
    /// The node key in the A3 section 1 grammar.
    #[param(example = "cfg_6_online_100/BB-BTN/r250")]
    pub node_key: String,
    /// Which hands to list: `all` (the default), `class`, or one hand given as a class
    /// (`AKs`) or a combo (`AhKh`, mapped to its class at a preflop node).
    #[param(example = "all")]
    pub hands: Option<String>,
}

/// The kind of an action, the token letter spelled out.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ActionKind {
    /// `f`
    Fold,
    /// `x`
    Check,
    /// `c`
    Call,
    /// `l`
    Limp,
    /// `s<cbb>`
    Straddle,
    /// `b<cbb>`
    Bet,
    /// `r<cbb>`
    Raise,
    /// `a`
    AllIn,
}

/// One action of the node in record order.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct ActionView {
    /// The action's index in the record, the one `/v1/grade` takes.
    pub index: u8,
    /// The action token text, for example `r250`.
    #[schema(example = "r250")]
    pub token: String,
    /// The kind of action.
    pub kind: ActionKind,
    /// The total wager in centi-big-blinds (cbb); 0 for a fold or a check.
    pub size_cbb: u32,
    /// The bet-size bucket as `gto_model::Bucket::as_str` (`tiny`, `small`, `medium`, `pot`,
    /// `overbet-small`, `overbet-large`, `all-in`), computed at pack time and never
    /// recomputed here (ADR 0004, O-120); null for a fold, check, call, limp or straddle.
    #[schema(example = "small")]
    pub bucket: Option<String>,
    /// The button label: the bucket's Grouped label postflop (`Overbet small`) and the exact
    /// size at a preflop node, for example `Raise to 2.5bb` (O-22).
    #[schema(example = "Raise to 2.5bb")]
    pub label: String,
    /// The node this action leads to when the solution holds it; null when the action
    /// ends the solution (a fold, or the action that closes its last street). The api walks
    /// trees through it and never builds a child key itself (O-245, ADR 0004); additive.
    #[schema(example = "cfg_6_online_100/BB-BTN/r250")]
    pub next_node_key: Option<String>,
}

/// One hand's row of the node.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct HandRow {
    /// The hand, a class name or a combo depending on the node's hand space.
    #[schema(example = "AKs")]
    pub hand: String,
    /// Reach per seat in pair order (out of position first); null when the record has none.
    pub reach: Option<[f32; 2]>,
    /// The frequency of each action in record order, summing to 1.
    pub strategy: Vec<f32>,
    /// The EV of each action in big blinds (bb), in record order.
    pub ev_bb: Vec<f32>,
    /// The loss of each action in percent of the pot, in record order; 0 for the best.
    pub loss_pct_pot: Vec<f32>,
    /// The best action's EV in bb.
    pub ev_best_bb: f32,
}

/// One seat's range at the node.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct SeatRange {
    /// How many combos the seat's range holds at the node.
    pub combos: u32,
    /// The reach-weighted combo count.
    pub reach_weighted_combos: f32,
}

/// The reach-weighted share of the acting seat's range taking one action.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct ActionShare {
    /// The action's index in the record.
    pub index: u8,
    /// The share of the acting seat's range taking it, 0 to 1.
    pub share: f32,
}

/// Both ranges and how the acting seat's range splits over the actions.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct RangeSummary {
    /// The out-of-position seat's range.
    pub oop: SeatRange,
    /// The in-position seat's range.
    pub ip: SeatRange,
    /// One entry per action in record order.
    pub by_action: Vec<ActionShare>,
}

/// The body of `GET /v1/nodes`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct NodeResponse {
    /// The solution read.
    pub solution_id: String,
    /// The node key as given, in its canonical text.
    pub node_key: String,
    /// The street as `gto_model::Street::as_str`: `preflop`, `flop`, `turn` or `river`.
    #[schema(example = "preflop")]
    pub street: String,
    /// The configuration identifier of the key.
    #[schema(example = "cfg_6_online_100")]
    pub config_id: String,
    /// The position pair of the key, out of position first.
    #[schema(example = "BB-BTN")]
    pub pair: String,
    /// The seat to act as `gto_model::Position::as_str`.
    #[schema(example = "BB")]
    pub to_act: String,
    /// The total pot at the node in cbb, including any outstanding bet.
    pub pot_cbb: u32,
    /// Remaining stacks in cbb in pair order.
    pub stacks_cbb: [u32; 2],
    /// The hand space of the rows.
    pub hand_space: HandSpaceName,
    /// The solve's accuracy at this node in percent of the pot, when the record carries it.
    pub accuracy_pct_pot: Option<f32>,
    /// The grading floor at this node in percent of the pot (O-22, O-150).
    pub floor_pct_pot: f32,
    /// The spot-class key of a preflop node under a catalog configuration; null otherwise.
    #[schema(example = "preflop/online/100/facing-open/BB-BTN")]
    pub spot_class_key: Option<String>,
    /// The actions in record order.
    pub actions: Vec<ActionView>,
    /// The hand rows the filter selected.
    pub hands: Vec<HandRow>,
    /// Both ranges and the split over the actions.
    pub range_summary: RangeSummary,
    /// Node-level flags: `rare_line` only.
    pub noise_flags: Vec<NoiseFlag>,
    /// True when the solution is synthetic test data, from its manifest flag, so the web
    /// shows the synthetic banner (O-57, O-229); additive.
    pub synthetic: bool,
}
