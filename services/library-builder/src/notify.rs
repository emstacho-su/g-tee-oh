//! The `LISTEN/NOTIFY` channels the builder writes (A4 section 4) and their payloads.
//! `coverage_added` is sent inside the publish transaction, so Postgres delivers it exactly
//! when the publish commits; `build_progress` and `builder_state` are sent on their own.

use serde::{Deserialize, Serialize};

/// The channel announcing a published build.
pub const COVERAGE_ADDED: &str = "coverage_added";

/// The channel carrying a running job's progress.
pub const BUILD_PROGRESS: &str = "build_progress";

/// The channel carrying the builder's state changes.
pub const BUILDER_STATE: &str = "builder_state";

/// `coverage_added`: `{config_id, pair, flop, build_id, scenario_count}`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CoverageAdded {
    /// The configuration.
    pub config_id: String,
    /// The pair, for example `BB-BTN`.
    pub pair: String,
    /// The raw flop.
    pub flop: String,
    /// The solution id.
    pub build_id: String,
    /// The scenario rows inserted.
    pub scenario_count: u32,
}

/// `build_progress`: `{job_id, line, iteration, exploitability}`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct BuildProgress {
    /// The job.
    pub job_id: String,
    /// The preflop line being solved.
    pub line: String,
    /// The iteration reached.
    pub iteration: u32,
    /// Both seats' gains in percent of the pot at the last measurement, if any.
    pub exploitability: Option<[f32; 2]>,
}

/// The builder's state as `builder_state` and `/healthz` report it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BuilderState {
    /// Solving at full share.
    Running,
    /// Solving below full share (outside the overnight boost, O-13).
    Throttled,
    /// The `paused` setting is on.
    Paused,
    /// Nothing claimable in the queue.
    Idle,
}

/// `builder_state`: `{state, reason}`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct StatePayload {
    /// The state.
    pub state: BuilderState,
    /// Why, in words.
    pub reason: String,
}
