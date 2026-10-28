//! `GET /v1/coverage` (A5 section 2, R2.13, O-28, O-146): what the library holds for a
//! configuration and pair. Preflop availability comes from the fixture registry and, when
//! `QUERY_DB_PASSWORD` is set, from the `solution` table under the read-only query role;
//! flops, textures and queue positions come from the database only, so without one they
//! are empty and `database` says `unconfigured`.
//!
//! S31 (O-270, R4.10) adds the spot-class catalog, additively: with `classes=true` the
//! response lists the spot classes the pair's first indexed preflop solution holds, each
//! with its line reach and its most frequent start nodes (`routes::spot_classes`).

use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};

/// The query string of `GET /v1/coverage`.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct CoverageQuery {
    /// The configuration identifier.
    #[param(example = "cfg_6_online_100")]
    pub config_id: String,
    /// The position pair, out of position first.
    #[param(example = "BB-BTN")]
    pub pair: String,
    /// True to list the pair's spot classes in `spot_classes` (O-270); absent or false
    /// leaves it empty, so a plain coverage call walks no tree.
    #[param(example = false)]
    pub classes: Option<bool>,
}

/// Where a preflop solution was found.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum CoverageSource {
    /// The fixture registry scanned from `FIXTURE_LIBRARY_PATH`.
    Fixture,
    /// The `solution` table.
    Library,
}

/// Whether the database answered.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum DatabaseState {
    /// The query role answered.
    Connected,
    /// No `QUERY_DB_PASSWORD` is set, so no database is configured.
    Unconfigured,
    /// The connection or a query failed.
    Unavailable,
}

/// Preflop availability for the configuration and pair.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct PreflopCoverage {
    /// True when at least one preflop solution is held.
    pub available: bool,
    /// The solution ids held, registry first.
    pub solution_ids: Vec<String>,
    /// Where each id in `solution_ids` was found, in the same order.
    pub sources: Vec<CoverageSource>,
    /// True when a held preflop solution is synthetic test data, so the web shows the
    /// synthetic banner (O-57, O-229); additive, from the manifest flag.
    pub synthetic: bool,
}

/// One flop with its scenario count.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct FlopCoverage {
    /// The canonical flop text, for example `Ah7d2c`.
    #[schema(example = "Ah7d2c")]
    pub flop: String,
    /// The texture family of the flop.
    #[schema(example = "rainbow-dry")]
    pub texture_family: String,
    /// How many scenarios the library holds on the flop.
    pub scenarios: u32,
    /// The scenario status as the database records it.
    #[schema(example = "published")]
    pub status: String,
}

/// One texture family with its counts.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct TextureCoverage {
    /// The texture family.
    pub family: String,
    /// How many flops of the family are held.
    pub flops: u32,
    /// How many scenarios across those flops.
    pub scenarios: u32,
}

/// One queued build job.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct QueueEntry {
    /// The job id.
    pub job_id: String,
    /// The flop the job builds.
    pub flop: String,
    /// The job's priority, higher first.
    pub priority: i32,
    /// The job status as the database records it.
    #[schema(example = "queued")]
    pub status: String,
    /// The job's place in the queue, 1 first.
    pub position: u32,
}

/// The body of `GET /v1/coverage`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct CoverageResponse {
    /// The configuration identifier as given.
    pub config_id: String,
    /// The pair as given.
    pub pair: String,
    /// Preflop availability.
    pub preflop: PreflopCoverage,
    /// Flops held, from the database; empty without one.
    pub flops: Vec<FlopCoverage>,
    /// Texture families held, from the database; empty without one.
    pub textures: Vec<TextureCoverage>,
    /// Queued build jobs, from the database; empty without one.
    pub queue: Vec<QueueEntry>,
    /// Whether the database answered.
    pub database: DatabaseState,
    /// The spot classes of the pair's first indexed preflop solution, by key (O-270).
    /// Always present; empty unless `classes=true`, and empty when the pair holds no
    /// preflop solution or the configuration is outside the v1 catalog.
    pub spot_classes: Vec<SpotClassEntry>,
}

/// One action on the way from the pair's root to a class spot, labelled as `/v1/nodes`
/// labels its buttons.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct ClassHistoryEntry {
    /// The seat that took the action.
    #[schema(example = "BTN")]
    pub position: String,
    /// The action token text.
    #[schema(example = "r250")]
    pub token: String,
    /// The button label of the action.
    #[schema(example = "Raise to 2.5bb")]
    pub label: String,
}

/// One decision node of a spot class: where a hand of the class is dealt.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct ClassSpot {
    /// The dotted preflop line from the pair's root; null for the root itself.
    #[schema(example = "r250")]
    pub line: Option<String>,
    /// The node key of the decision.
    #[schema(example = "cfg_6_online_100/BB-BTN/r250")]
    pub start_node_key: String,
    /// The seat to act at the node, the hero of a hand dealt there.
    #[schema(example = "BB")]
    pub hero_position: String,
    /// The pot at the node in centi-big-blinds (cbb).
    pub pot_cbb: u32,
    /// The probability that play reaches the node from the root: the product, over the
    /// line, of the acting seat's reach-weighted share of each action taken (O-270).
    pub line_reach: f32,
    /// The actions of the line, in order.
    pub history: Vec<ClassHistoryEntry>,
}

/// One spot class of a (configuration, pair), with its most frequent spots (O-270).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct SpotClassEntry {
    /// The spot-class key, as `/v1/nodes` names it.
    #[schema(example = "preflop/online/100/facing-open/BB-BTN")]
    pub spot_class_key: String,
    /// The action family, as `/v1/nodes` names it in `action_family`.
    #[schema(example = "facing-open")]
    pub family: String,
    /// The configuration's format.
    #[schema(example = "online")]
    pub format: String,
    /// The configuration's depth band.
    #[schema(example = "100")]
    pub depth_band: String,
    /// The configuration's seats.
    pub table_size: u8,
    /// The solution the class was read from.
    pub solution_id: String,
    /// The probability that any decision of the class arises in the pair's tree: the sum
    /// of the line reach of the class's first nodes along each line (a node under another
    /// node of the same class is not counted again), in (0, 1].
    pub line_reach: f32,
    /// The class's spots, by line reach descending then line, at most
    /// `MAX_SPOTS_PER_CLASS` (8).
    pub spots: Vec<ClassSpot>,
}
