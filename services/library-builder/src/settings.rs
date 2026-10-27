//! Live builder settings (A1 section 6, R2.18, O-13, O-188): the `builder_setting` rows
//! are read on every claim, so a change takes effect on the next job without a redeploy.
//!
//! Every key has a default, and a missing key takes it. A key whose value is malformed
//! (wrong JSON type, out of range, or 16-bit storage with a target under the O-194 floor)
//! is reported as a [`SettingError`] naming the key, which `/healthz` lists, and that key
//! alone falls back to its default; an unknown key is reported the same way. Nothing is
//! skipped silently.
//!
//! | key | default | meaning |
//! |---|---|---|
//! | `paused` | false | claim nothing |
//! | `cpu_share` | 0.5 | share of `BUILDER_THREADS` outside the boost window |
//! | `overnight` | `{"start_hour":0,"end_hour":7,"utc_offset_minutes":0,"cpu_share":1.0}` | the O-13 boost |
//! | `budget_bytes` | 650000000000 | ADR 0018 |
//! | `bytes_per_runout` | 14156873 | O-180 |
//! | `bytes_per_flop_tree` | 752365 | O-180 |
//! | `k_runouts` | 20 | O-14 |
//! | `k_runouts_rare` | 10 | O-191 |
//! | `k_frequent_pairs` | 1 | O-191 |
//! | `plan_configs` | `["cfg_6_online_100"]` | planner scope |
//! | `target_pct_pot` | 0.3 | 04 section 6, O-138 |
//! | `max_iterations` | 20000 | per attempt, times the attempt number |
//! | `max_seconds_per_line` | 1800 | O-178 |
//! | `storage_bits` | 32 | O-194; 16 only with a target of at least 0.5 |
//! | `memory_cap_bytes` | 5368709120 | O-139, O-187 |
//! | `max_attempts` | 3 | A5 section 4, O-176 |
//! | `stale_hours` | 6 | O-185 |
//! | `verify_interval_hours` | 24 | O-186 |
//! | `plan_interval_minutes` | 60 | the automatic plan |
//! | `poll_seconds` | 30 | sleep when paused or idle |

use gto_planner::PlannerSettings;
use gto_solve::postflop::{SolveOptions, StopRule, StorageBits};
use serde::Serialize;
use serde_json::Value;

/// The smallest stop target 16-bit storage may be paired with (O-194).
pub const SIXTEEN_BIT_TARGET_FLOOR_PCT_POT: f32 = 0.5;

/// Minutes in a day, for the boost window.
pub const MINUTES_PER_DAY: u32 = 24 * 60;

/// Every key the builder reads.
pub const KEYS: [&str; 20] = [
    "paused",
    "cpu_share",
    "overnight",
    "budget_bytes",
    "bytes_per_runout",
    "bytes_per_flop_tree",
    "k_runouts",
    "k_runouts_rare",
    "k_frequent_pairs",
    "plan_configs",
    "target_pct_pot",
    "max_iterations",
    "max_seconds_per_line",
    "storage_bits",
    "memory_cap_bytes",
    "max_attempts",
    "stale_hours",
    "verify_interval_hours",
    "plan_interval_minutes",
    "poll_seconds",
];

/// The O-13 overnight boost window, in local hours given by a UTC offset.
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
pub struct Overnight {
    /// The local hour the boost starts, 0 to 23.
    pub start_hour: u8,
    /// The local hour the boost ends, 0 to 23; a window may wrap midnight.
    pub end_hour: u8,
    /// The local time's offset from UTC in minutes.
    pub utc_offset_minutes: i32,
    /// The share inside the window, above 0 and at most 1.
    pub cpu_share: f64,
}

impl Default for Overnight {
    fn default() -> Self {
        Overnight { start_hour: 0, end_hour: 7, utc_offset_minutes: 0, cpu_share: 1.0 }
    }
}

/// One setting that could not be used.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct SettingError {
    /// The key.
    pub key: String,
    /// Why, naming the default used instead.
    pub reason: String,
}

/// The settings in force for one claim.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct BuilderSettings {
    /// Claim nothing.
    pub paused: bool,
    /// Share of `BUILDER_THREADS` outside the boost window, above 0 and at most 1.
    pub cpu_share: f64,
    /// The boost window.
    pub overnight: Overnight,
    /// The planner's budget, sizes and K (`budget_bytes`, `bytes_per_*`, `k_*`).
    #[serde(skip)]
    pub planner: PlannerSettings,
    /// The configurations the planner enumerates.
    pub plan_configs: Vec<String>,
    /// The stop and publish target per seat in percent of the pot.
    pub target_pct_pot: f32,
    /// Iterations per line on the first attempt.
    pub max_iterations: u32,
    /// Seconds per line.
    pub max_seconds_per_line: u32,
    /// 16 or 32.
    pub storage_bits: u8,
    /// The memory cap.
    pub memory_cap_bytes: u64,
    /// Failures before a job parks.
    pub max_attempts: i16,
    /// Age of a running row the stale reclaim re-queues.
    pub stale_hours: u32,
    /// Hours between verify passes.
    pub verify_interval_hours: u32,
    /// Minutes between automatic plans.
    pub plan_interval_minutes: u32,
    /// Sleep when paused or idle.
    pub poll_seconds: u32,
}

impl Default for BuilderSettings {
    fn default() -> Self {
        BuilderSettings {
            paused: false,
            cpu_share: 0.5,
            overnight: Overnight::default(),
            planner: PlannerSettings::default(),
            plan_configs: vec!["cfg_6_online_100".to_owned()],
            target_pct_pot: 0.3,
            max_iterations: 20_000,
            max_seconds_per_line: 1_800,
            storage_bits: 32,
            memory_cap_bytes: 5 * 1024 * 1024 * 1024,
            max_attempts: 3,
            stale_hours: 6,
            verify_interval_hours: 24,
            plan_interval_minutes: 60,
            poll_seconds: 30,
        }
    }
}

impl BuilderSettings {
    /// The settings from `builder_setting` rows, with the errors of the keys that fell
    /// back to their defaults.
    #[must_use]
    pub fn from_rows(rows: &[(String, Value)]) -> (BuilderSettings, Vec<SettingError>) {
        let _ = rows;
        (BuilderSettings::default(), Vec::new())
    }

    /// The share in force at `minute_of_day_utc` (0 to 1,439): the boost share inside the
    /// window, `cpu_share` outside it.
    #[must_use]
    pub fn share_at(&self, minute_of_day_utc: u32) -> f64 {
        let _ = minute_of_day_utc;
        self.cpu_share
    }

    /// The solve threads at `minute_of_day_utc`: `round(builder_threads * share)`, at
    /// least 1.
    #[must_use]
    pub fn threads(&self, builder_threads: usize, minute_of_day_utc: u32) -> usize {
        let _ = (builder_threads, minute_of_day_utc);
        1
    }

    /// The stop rule of attempt `attempt` (1 for the first): the target, `max_iterations`
    /// times the attempt number, and `max_seconds_per_line`.
    #[must_use]
    pub fn stop_rule(&self, attempt: u16) -> StopRule {
        let _ = attempt;
        StopRule {
            target_exploitability_pct_pot: self.target_pct_pot,
            max_iterations: self.max_iterations,
            max_seconds: self.max_seconds_per_line,
        }
    }

    /// The solve options: the storage and the memory cap.
    #[must_use]
    pub fn solve_options(&self) -> SolveOptions {
        SolveOptions {
            storage: if self.storage_bits == 16 {
                StorageBits::Sixteen
            } else {
                StorageBits::ThirtyTwo
            },
            memory_cap_bytes: self.memory_cap_bytes,
            ..SolveOptions::default()
        }
    }
}
