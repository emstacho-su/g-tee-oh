//! `GET /v1/coverage` (A5 section 2, R2.13, O-28, O-146): what the library holds for a
//! configuration and pair. Preflop availability comes from the fixture registry and, when
//! `QUERY_DB_PASSWORD` is set, from the `solution` table under the read-only query role;
//! flops, textures and queue positions come from the database only, so without one they
//! are empty and `database` says `unconfigured`.

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
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
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
}
