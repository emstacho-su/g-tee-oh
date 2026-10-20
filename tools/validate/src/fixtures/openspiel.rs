//! The `OpenSpiel` exploitability curve fixture (O-30):
//! `validation/fixtures/openspiel/leduc_exploitability.json`, written once by
//! `leduc_curve.py` in the same directory and never edited by hand.
//!
//! The file records what produced it (library version, solver and its switches, seed,
//! command arguments), then one row per checkpoint iteration with the exploitability of
//! the average policy at that point, and the final average-policy value. Gate G3 compares
//! the engine's exploitability at the same iterations against these rows within the
//! O-79 tolerance (R2.6).

use std::collections::BTreeMap;
use std::path::Path;

use serde::Deserialize;

use super::{FixtureError, check_schema_version, invalid, read_json};

/// The curve fixture file.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OpenSpielCurve {
    /// Always [`super::SCHEMA_VERSION`].
    pub schema_version: u32,
    /// The fixture identifier the generator writes.
    pub fixture: String,
    /// The requirement identifiers the file serves.
    pub r_ids: Vec<String>,
    /// The open-question identifiers the file answers.
    pub o_ids: Vec<String>,
    /// The game as `OpenSpiel` loaded it.
    pub game: CurveGame,
    /// What produced the file.
    pub generator: Generator,
    /// The recorded seed; plain CFR is deterministic, so it changes nothing.
    pub seed: u64,
    /// What each measured field means.
    pub measure: Measure,
    /// One row per checkpoint, iterations strictly increasing.
    pub checkpoints: Vec<Checkpoint>,
    /// The state at the last checkpoint.
    #[serde(rename = "final")]
    pub final_state: FinalState,
    /// When the file was written, ISO 8601 in Coordinated Universal Time (UTC).
    pub generated_at: String,
}

/// The game as the generator loaded it.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurveGame {
    /// The `OpenSpiel` game name, `leduc_poker`.
    pub name: String,
    /// The game string with parameters, as `OpenSpiel` prints it.
    pub string: String,
    /// The game parameters as plain JSON values.
    pub parameters: BTreeMap<String, serde_json::Value>,
    /// Number of players.
    pub num_players: u8,
    /// Number of information states in the average policy.
    pub information_states: u64,
    /// Maximum number of player moves in one game.
    pub max_game_length: u64,
}

/// What produced the file.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Generator {
    /// The Python distribution, `open_spiel`.
    pub library: String,
    /// Its exact version.
    pub version: String,
    /// The module the solver came from.
    pub module: String,
    /// The solver class.
    pub solver: String,
    /// Regret matching plus switched on.
    pub regret_matching_plus: bool,
    /// Alternating player updates switched on.
    pub alternating_updates: bool,
    /// Linear averaging switched on.
    pub linear_averaging: bool,
    /// The Python version.
    pub python: String,
    /// The platform string of the container.
    pub platform: String,
    /// The script, relative to the repository root.
    pub script: String,
    /// The script's command-line arguments.
    pub arguments: Vec<String>,
}

/// What each measured field means.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Measure {
    /// Definition of `exploitability`.
    pub exploitability: String,
    /// Definition of `nash_conv`.
    pub nash_conv: String,
}

/// One checkpoint row.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Checkpoint {
    /// Iterations run so far in one continuous run.
    pub iteration: u64,
    /// Mean best-response gain of the average policy, chips.
    pub exploitability: f64,
    /// Sum of best-response gains over the players, chips.
    pub nash_conv: f64,
    /// Wall-clock seconds since the run started.
    pub elapsed_seconds: f64,
}

/// The state at the last checkpoint.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FinalState {
    /// Total iterations run, equal to the last checkpoint.
    pub iterations: u64,
    /// Exploitability at the end, equal to the last checkpoint's.
    pub exploitability: f64,
    /// `NashConv` at the end, equal to the last checkpoint's.
    pub nash_conv: f64,
    /// Expected value of the average policy to each player, chips.
    pub average_policy_value: Vec<f64>,
}

impl OpenSpielCurve {
    /// Load and validate the curve fixture.
    ///
    /// # Errors
    ///
    /// Any [`FixtureError`]: unreadable file, parse failure or unknown field, a
    /// `schema_version` other than [`super::SCHEMA_VERSION`], no checkpoints, iterations
    /// not strictly increasing, a measurement that is negative or not finite, or a final
    /// state that does not match the last checkpoint.
    pub fn load(path: &Path) -> Result<Self, FixtureError> {
        let curve: Self = read_json(path)?;
        check_schema_version(path, curve.schema_version)?;
        curve.check_structure().map_err(|reason| invalid(path, reason))?;
        Ok(curve)
    }

    /// The checkpoint iterations, in order.
    #[must_use]
    pub fn iterations(&self) -> Vec<u64> {
        self.checkpoints.iter().map(|row| row.iteration).collect()
    }

    fn check_structure(&self) -> Result<(), String> {
        let Some(last) = self.checkpoints.last() else {
            return Err("no checkpoints".to_owned());
        };
        for pair in self.checkpoints.windows(2) {
            if pair[1].iteration <= pair[0].iteration {
                return Err(format!(
                    "checkpoint iterations not strictly increasing at {}",
                    pair[1].iteration
                ));
            }
        }
        for row in &self.checkpoints {
            check_measurement(row.iteration, row.exploitability)?;
            check_measurement(row.iteration, row.nash_conv)?;
        }
        if self.final_state.iterations != last.iteration {
            return Err("final.iterations is not the last checkpoint".to_owned());
        }
        if usize::from(self.game.num_players) != self.final_state.average_policy_value.len() {
            return Err("final.average_policy_value has one entry per player".to_owned());
        }
        if self.final_state.average_policy_value.iter().any(|v| !v.is_finite()) {
            return Err("final.average_policy_value is not finite".to_owned());
        }
        Ok(())
    }
}

fn check_measurement(iteration: u64, value: f64) -> Result<(), String> {
    if value.is_finite() && value >= 0.0 {
        Ok(())
    } else {
        Err(format!(
            "measurement at iteration {iteration} is {value}, not a finite non-negative number"
        ))
    }
}
