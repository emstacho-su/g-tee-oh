//! The data transfer objects (DTOs) of every A5 section 2 endpoint, frozen by the contract
//! commit of S16 (O-38, ADR 0004). A field change here goes through the integrator and a
//! contract regeneration (`just contracts`), because
//! `packages/contracts/solver-query.openapi.json` and the TypeScript client are generated
//! from these types. Each submodule holds one endpoint's request and response types; this
//! root holds what several endpoints share.
//!
//! Conventions (plan C.1): positions are written as `gto_model::Position::as_str` (`BTN`,
//! `BB`), streets as `gto_model::Street::as_str`, buckets as `gto_model::Bucket::as_str`
//! (kebab-case) and action tokens as their `gto_model::ActionToken` text (`f`, `c`,
//! `r250`). Amounts in big blinds (bb) are f32, the record's precision; a loss in percent of
//! the pot is the stored 0.01 percent unit divided by 100, so it is exact. Sizes are in
//! centi-big-blinds (cbb). Sixty-four bit seeds and generator states travel as sixteen
//! hexadecimal digits (`deal::Hex64`, O-151). Every error body is a `problem::Problem`
//! (Request for Comments (RFC) 9457, O-158).

pub mod coverage;
pub mod deal;
pub mod grade;
pub mod grade_range;
pub mod health;
pub mod insights;
pub mod nodes;
pub mod problem;
pub mod sample_action;

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

pub use coverage::{
    ClassHistoryEntry, ClassSpot, CoverageQuery, CoverageResponse, CoverageSource, DatabaseState,
    FlopCoverage, PreflopCoverage, QueueEntry, SpotClassEntry, TextureCoverage,
};
pub use deal::{
    DealFilter, DealRequest, DealResponse, Hex64, InvalidHex64, RevealQuery, RevealResponse,
    Revealed,
};
pub use grade::{DifficultyFeatures, FloorSource, GradeRequest, GradeResponse};
pub use grade_range::{GradeRangeRequest, GradeRangeResponse, PaintedHand, PaintedHandGrade};
pub use health::{DatabaseHealth, FixtureLibrary, Healthz, LibraryHealth};
pub use insights::{
    BlockedClass, Blockers, EquityDistribution, HandPosition, HandRole, InsightsQuery,
    InsightsResponse, NutAdvantage, RangeAdvantage, Relative, RelativePosition, ThresholdAction,
    ThresholdCard,
};
pub use nodes::{
    ActionKind, ActionShare, ActionView, HandRow, NodeResponse, NodesQuery, RangeSummary, SeatRange,
};
pub use problem::{PROBLEM_JSON, Problem};
pub use sample_action::{SampleActionRequest, SampleActionResponse};

/// A warning that a number is near the solver's noise, at the node or for one hand
/// (05 section 9, O-153).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum NoiseFlag {
    /// Two or more actions are played at 5 percent or more and the largest loss among them
    /// is under the floor, so the mix is within solver noise.
    CloseEvMix,
    /// The acting seat reaches the node with this hand under 0.5 percent of the time.
    RareLine,
    /// On a 1,326-combo node the combos of one class split their best action by suit.
    SuitMixing,
}

/// The hand space of a node: the 169 preflop classes or the 1,326 combos (A3 section 4).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
pub enum HandSpaceName {
    /// Hands are `HandClass` names such as `AKs`, 169 of them.
    #[serde(rename = "preflop_169")]
    Preflop169,
    /// Hands are combos such as `AhKh`, 1,326 of them.
    #[serde(rename = "postflop_1326")]
    Postflop1326,
}

impl From<gto_library::HandSpace> for HandSpaceName {
    fn from(space: gto_library::HandSpace) -> Self {
        match space {
            gto_library::HandSpace::Preflop169 => HandSpaceName::Preflop169,
            gto_library::HandSpace::Postflop1326 => HandSpaceName::Postflop1326,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{HandSpaceName, NoiseFlag};

    #[test]
    fn r2_13_noise_flags_and_hand_spaces_serialize_to_their_contract_names() {
        let flags = serde_json::to_string(&[NoiseFlag::CloseEvMix, NoiseFlag::RareLine])
            .expect("flags serialize");
        assert_eq!(flags, r#"["close_ev_mix","rare_line"]"#);
        let suit = serde_json::to_string(&NoiseFlag::SuitMixing).expect("a flag serializes");
        assert_eq!(suit, r#""suit_mixing""#);
        let spaces =
            serde_json::to_string(&[HandSpaceName::Preflop169, HandSpaceName::Postflop1326])
                .expect("spaces serialize");
        assert_eq!(spaces, r#"["preflop_169","postflop_1326"]"#);
        assert_eq!(
            HandSpaceName::from(gto_library::HandSpace::Preflop169),
            HandSpaceName::Preflop169
        );
    }
}
