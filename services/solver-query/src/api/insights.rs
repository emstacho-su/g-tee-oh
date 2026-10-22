//! `GET /v1/insights` (A5 section 2, R2.14, O-32, O-153): the E3 insight data for one hand
//! at one node. Hand strength is the hand's equity against the villain's reach-weighted
//! range, from the 169 by 169 preflop equity table (O-126). At a postflop (1,326-combo)
//! node the equity-based blocks are null in v1 (O-32); the blockers block is always present.

use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};

use crate::api::NoiseFlag;

/// The query string of `GET /v1/insights`.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct InsightsQuery {
    /// The solution to read.
    #[param(example = "5e7a1c2b-3d4f-8a6b-9c0d-1e2f3a4b5c6d")]
    pub solution_id: String,
    /// The node key in the A3 section 1 grammar.
    #[param(example = "cfg_6_online_100/BB-BTN/r250")]
    pub node_key: String,
    /// The hand: a class (`AKs`) or a combo (`AhKh`).
    #[param(example = "AKs")]
    pub hand: String,
}

/// Where the queried hand sits against one action's threshold.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum Relative {
    /// Stronger than the weakest hand taking the action.
    Above,
    /// The weakest hand taking the action itself.
    At,
    /// Weaker than the weakest hand taking the action.
    Below,
}

/// One aggressive action's threshold.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct ThresholdAction {
    /// The action's index in the record.
    pub index: u8,
    /// The action token text.
    #[schema(example = "r250")]
    pub token: String,
    /// The weakest hand playing the action at or above half its frequency; null when none.
    #[schema(example = "A5s")]
    pub weakest_hand_taking_half: Option<String>,
    /// The reach-weighted share of the range taking the action.
    pub share_taking: f32,
}

/// The queried hand's place in the acting seat's range.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct HandPosition {
    /// The hand as given.
    pub hand: String,
    /// The hand's equity against the villain's reach-weighted range, 0 to 1.
    pub equity_vs_villain: f32,
    /// The hand's reach-weighted percentile by equity in the range, 0 to 1, 1 strongest.
    pub rank_in_range: f32,
    /// The hand against each aggressive action's threshold, in `actions` order.
    pub relative: Vec<RelativePosition>,
}

/// The queried hand against one threshold.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct RelativePosition {
    /// The action's index in the record.
    pub index: u8,
    /// Above, at or below the threshold.
    pub position: Relative,
}

/// The threshold card: which hands take each aggressive action and where the hand sits.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct ThresholdCard {
    /// One entry per aggressive action (bet, raise, all-in), in record order.
    pub actions: Vec<ThresholdAction>,
    /// The strongest hand folding at or above half its frequency; null when none folds.
    #[schema(example = "K9o")]
    pub strongest_folding_hand: Option<String>,
    /// The queried hand's place.
    pub hand_position: HandPosition,
}

/// Each seat's range equity as a histogram of ten bins from 0 to 1.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct EquityDistribution {
    /// The eleven bin edges, 0.0 to 1.0.
    pub bin_edges: [f32; 11],
    /// The out-of-position range's reach-weighted share per bin, summing to 1.
    pub oop: [f32; 10],
    /// The in-position range's reach-weighted share per bin, summing to 1.
    pub ip: [f32; 10],
}

/// Which range has more equity.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct RangeAdvantage {
    /// The out-of-position range's reach-weighted mean equity.
    pub oop_mean_equity: f32,
    /// The in-position range's reach-weighted mean equity.
    pub ip_mean_equity: f32,
    /// The acting seat's mean minus one half, in percentage points.
    pub to_act_advantage_pct_points: f32,
}

/// Which range holds more hands at or above the nut threshold (O-153).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct NutAdvantage {
    /// The equity a hand needs to count as a nut hand, 0.80.
    pub threshold_equity: f32,
    /// The out-of-position range's reach-weighted share at or above the threshold.
    pub oop_share: f32,
    /// The in-position range's reach-weighted share at or above the threshold.
    pub ip_share: f32,
    /// The acting seat's share minus the other seat's.
    pub to_act_advantage: f32,
}

/// One villain class the hand blocks.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct BlockedClass {
    /// The villain class.
    #[schema(example = "AA")]
    pub hand: String,
    /// The villain reach the hand's cards remove from that class.
    pub reach_removed: f32,
}

/// What the hand's cards remove from the villain's range.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct Blockers {
    /// The hand as given.
    pub hand: String,
    /// How many villain combos the hand's cards remove.
    pub villain_combos_removed: u32,
    /// The removed reach as a share of the villain's reach-weighted combos (the mean over
    /// the combos of a class when the hand was given as a class).
    pub villain_reach_removed_share: f32,
    /// The five most blocked villain classes, most blocked first.
    pub top_blocked: Vec<BlockedClass>,
}

/// The role the hand plays at the node (O-153, plan C.3).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum HandRole {
    /// Strong and aggressive.
    Value,
    /// Neither clearly strong nor clearly weak.
    Marginal,
    /// Weak and aggressive.
    Bluff,
    /// Folds at or above half its frequency.
    Fold,
    /// Strong and passive.
    Trap,
}

/// The body of `GET /v1/insights`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct InsightsResponse {
    /// The threshold card; null at a postflop node in v1.
    pub threshold_card: Option<ThresholdCard>,
    /// Both ranges' equity histograms; null at a postflop node in v1.
    pub equity_distribution: Option<EquityDistribution>,
    /// The range advantage; null at a postflop node in v1.
    pub range_advantage: Option<RangeAdvantage>,
    /// The nut advantage; null at a postflop node in v1.
    pub nut_advantage: Option<NutAdvantage>,
    /// The hand's blockers, present at every node.
    pub blockers: Blockers,
    /// The hand's role; null at a postflop node in v1.
    pub hand_role: Option<HandRole>,
    /// Hand-level flags, as `/v1/grade` reports them.
    pub noise_flags: Vec<NoiseFlag>,
}
