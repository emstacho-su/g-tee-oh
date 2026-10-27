//! The per-key checks behind `BuilderSettings::from_rows` (O-188): each key's value is read
//! from its JSON form, checked against its range, and applied to a copy of the settings.
//! A check that fails names the problem; the caller adds the default it keeps instead.

use gto_model::v1_configs;
use serde::Deserialize;
use serde_json::Value;

use super::{BuilderSettings, Overnight};

/// The largest UTC offset the boost window accepts, in minutes: just under a day.
const MAX_UTC_OFFSET_MINUTES: i32 = 24 * 60 - 1;

/// The last hour of a day.
const LAST_HOUR: u8 = 23;

/// Why a row was not applied.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) enum Problem {
    /// The key is not one of `KEYS`.
    Unknown,
    /// The value fails the key's check, with the reason.
    Invalid(String),
}

/// The reason text of a [`Problem`] on `key`, naming the default kept instead.
pub(super) fn reason(defaults: &BuilderSettings, key: &str, problem: &Problem) -> String {
    match problem {
        Problem::Unknown => {
            "not a builder setting; it is ignored and every default stays in force".to_owned()
        }
        Problem::Invalid(why) => {
            format!("{why}; the default {} is used", default_text(defaults, key))
        }
    }
}

/// `settings` with `key` set from `value`.
///
/// # Errors
///
/// `Problem::Unknown` for a key outside `KEYS`, `Problem::Invalid` naming the check.
pub(super) fn apply(
    settings: &BuilderSettings,
    key: &str,
    value: &Value,
) -> Result<BuilderSettings, Problem> {
    let base = settings.clone();
    let planner = settings.planner;
    let next = match key {
        "paused" => BuilderSettings { paused: boolean(value)?, ..base },
        "cpu_share" => BuilderSettings { cpu_share: share(value)?, ..base },
        "overnight" => BuilderSettings { overnight: overnight(value)?, ..base },
        "plan_configs" => BuilderSettings { plan_configs: plan_configs(value)?, ..base },
        "target_pct_pot" => BuilderSettings { target_pct_pot: target(value)?, ..base },
        "max_iterations" => BuilderSettings { max_iterations: positive_u32(value)?, ..base },
        "max_seconds_per_line" => {
            BuilderSettings { max_seconds_per_line: positive_u32(value)?, ..base }
        }
        "storage_bits" => BuilderSettings { storage_bits: storage_bits(value)?, ..base },
        "memory_cap_bytes" => BuilderSettings { memory_cap_bytes: positive_u64(value)?, ..base },
        "max_attempts" => BuilderSettings { max_attempts: max_attempts(value)?, ..base },
        "stale_hours" => BuilderSettings { stale_hours: positive_u32(value)?, ..base },
        "verify_interval_hours" => {
            BuilderSettings { verify_interval_hours: positive_u32(value)?, ..base }
        }
        "plan_interval_minutes" => {
            BuilderSettings { plan_interval_minutes: positive_u32(value)?, ..base }
        }
        "poll_seconds" => BuilderSettings { poll_seconds: positive_u32(value)?, ..base },
        "budget_bytes"
        | "bytes_per_runout"
        | "bytes_per_flop_tree"
        | "k_runouts"
        | "k_runouts_rare"
        | "k_frequent_pairs" => {
            BuilderSettings { planner: apply_planner(planner, key, value)?, ..base }
        }
        _ => return Err(Problem::Unknown),
    };
    Ok(next)
}

/// The planner's half of [`apply`].
fn apply_planner(
    planner: gto_planner::PlannerSettings,
    key: &str,
    value: &Value,
) -> Result<gto_planner::PlannerSettings, Problem> {
    use gto_planner::PlannerSettings as P;
    match key {
        "budget_bytes" => Ok(P { budget_bytes: positive_u64(value)?, ..planner }),
        "bytes_per_runout" => Ok(P { bytes_per_runout: positive_u64(value)?, ..planner }),
        "bytes_per_flop_tree" => Ok(P { bytes_per_flop_tree: positive_u64(value)?, ..planner }),
        "k_runouts" => Ok(P { k_runouts: positive_u16(value)?, ..planner }),
        "k_runouts_rare" => Ok(P { k_runouts_rare: positive_u16(value)?, ..planner }),
        "k_frequent_pairs" => Ok(P { k_frequent_pairs: positive_u16(value)?, ..planner }),
        _ => Err(Problem::Unknown),
    }
}

/// The default of `key` as the reason text shows it.
fn default_text(defaults: &BuilderSettings, key: &str) -> String {
    let planner = defaults.planner;
    match key {
        "paused" => defaults.paused.to_string(),
        "cpu_share" => defaults.cpu_share.to_string(),
        "overnight" => serde_json::to_string(&defaults.overnight)
            .unwrap_or_else(|error| format!("window (unprintable: {error})")),
        "budget_bytes" => planner.budget_bytes.to_string(),
        "bytes_per_runout" => planner.bytes_per_runout.to_string(),
        "bytes_per_flop_tree" => planner.bytes_per_flop_tree.to_string(),
        "k_runouts" => planner.k_runouts.to_string(),
        "k_runouts_rare" => planner.k_runouts_rare.to_string(),
        "k_frequent_pairs" => planner.k_frequent_pairs.to_string(),
        "plan_configs" => format!("{:?}", defaults.plan_configs),
        "target_pct_pot" => defaults.target_pct_pot.to_string(),
        "max_iterations" => defaults.max_iterations.to_string(),
        "max_seconds_per_line" => defaults.max_seconds_per_line.to_string(),
        "storage_bits" => defaults.storage_bits.to_string(),
        "memory_cap_bytes" => defaults.memory_cap_bytes.to_string(),
        "max_attempts" => defaults.max_attempts.to_string(),
        "stale_hours" => defaults.stale_hours.to_string(),
        "verify_interval_hours" => defaults.verify_interval_hours.to_string(),
        "plan_interval_minutes" => defaults.plan_interval_minutes.to_string(),
        "poll_seconds" => defaults.poll_seconds.to_string(),
        _ => "value".to_owned(),
    }
}

/// A non-negative `f64` rounded half away from zero as a count; negative and non-finite
/// values give 0 and a value past `usize::MAX` saturates.
pub(super) fn whole_count(value: f64) -> usize {
    if !value.is_finite() || value <= 0.0 {
        return 0;
    }
    format!("{:.0}", value.round()).parse::<usize>().unwrap_or(usize::MAX)
}

fn invalid(why: impl Into<String>) -> Problem {
    Problem::Invalid(why.into())
}

fn boolean(value: &Value) -> Result<bool, Problem> {
    value.as_bool().ok_or_else(|| invalid(format!("{value} is not true or false")))
}

/// A share of the threads: above 0 and at most 1.
fn share(value: &Value) -> Result<f64, Problem> {
    let number = value.as_f64().ok_or_else(|| invalid(format!("{value} is not a number")))?;
    if number.is_finite() && number > 0.0 && number <= 1.0 {
        Ok(number)
    } else {
        Err(invalid(format!("{number} is not above 0 and at most 1")))
    }
}

/// A stop target in percent of the pot: finite and above 0.
fn target(value: &Value) -> Result<f32, Problem> {
    let number = value.as_f64().ok_or_else(|| invalid(format!("{value} is not a number")))?;
    let narrowed = format!("{number}").parse::<f32>().unwrap_or(f32::NAN);
    if narrowed.is_finite() && narrowed > 0.0 {
        Ok(narrowed)
    } else {
        Err(invalid(format!("{number} is not a positive percent of the pot")))
    }
}

fn positive_u64(value: &Value) -> Result<u64, Problem> {
    match value.as_u64() {
        Some(number) if number > 0 => Ok(number),
        _ => Err(invalid(format!("{value} is not a positive whole number"))),
    }
}

fn positive_u32(value: &Value) -> Result<u32, Problem> {
    let number = positive_u64(value)?;
    u32::try_from(number).map_err(|_| invalid(format!("{number} is above {}", u32::MAX)))
}

fn positive_u16(value: &Value) -> Result<u16, Problem> {
    let number = positive_u64(value)?;
    u16::try_from(number).map_err(|_| invalid(format!("{number} is above {}", u16::MAX)))
}

/// 16 or 32; the 16-bit floor on the target is checked once every row is read.
fn storage_bits(value: &Value) -> Result<u8, Problem> {
    match value.as_u64() {
        Some(16) => Ok(16),
        Some(32) => Ok(32),
        _ => Err(invalid(format!("{value} is not 16 or 32"))),
    }
}

/// Failures before a job parks: at least 1 (A5 section 4, O-176).
fn max_attempts(value: &Value) -> Result<i16, Problem> {
    let number = positive_u64(value)?;
    i16::try_from(number).map_err(|_| invalid(format!("{number} is above {}", i16::MAX)))
}

/// A list of configuration ids, each in `gto_model::v1_configs` (O-182). An empty list is
/// accepted and turns planning off: the loop then claims what is queued and never plans,
/// and its idle reason says so, so an operator can tell it from a broken setting.
fn plan_configs(value: &Value) -> Result<Vec<String>, Problem> {
    let ids: Vec<String> = serde_json::from_value(value.clone())
        .map_err(|_| invalid(format!("{value} is not a list of configuration ids")))?;
    let known: Vec<String> =
        v1_configs().iter().map(|config| config.config_id().to_string()).collect();
    match ids.iter().find(|id| !known.contains(id)) {
        Some(unknown) => Err(invalid(format!("{unknown} is not a v1 configuration"))),
        None => Ok(ids),
    }
}

/// The JSON form of the boost window; every field is required and no other is allowed.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct OvernightRow {
    start_hour: u8,
    end_hour: u8,
    utc_offset_minutes: i32,
    cpu_share: Value,
}

/// The O-13 boost window: hours 0 to 23, an offset under a day, a share above 0 and at
/// most 1.
fn overnight(value: &Value) -> Result<Overnight, Problem> {
    let row: OvernightRow = serde_json::from_value(value.clone()).map_err(|error| {
        invalid(format!("not {{start_hour, end_hour, utc_offset_minutes, cpu_share}}: {error}"))
    })?;
    for (name, hour) in [("start_hour", row.start_hour), ("end_hour", row.end_hour)] {
        if hour > LAST_HOUR {
            return Err(invalid(format!("{name} {hour} is not an hour from 0 to {LAST_HOUR}")));
        }
    }
    if row.utc_offset_minutes.abs() > MAX_UTC_OFFSET_MINUTES {
        return Err(invalid(format!(
            "utc_offset_minutes {} is not within a day",
            row.utc_offset_minutes
        )));
    }
    let cpu_share = share(&row.cpu_share).map_err(|_| {
        invalid(format!("cpu_share {} is not above 0 and at most 1", row.cpu_share))
    })?;
    Ok(Overnight {
        start_hour: row.start_hour,
        end_hour: row.end_hour,
        utc_offset_minutes: row.utc_offset_minutes,
        cpu_share,
    })
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{Problem, apply, reason, whole_count};
    use crate::settings::BuilderSettings;

    #[test]
    fn r2_18_whole_count_rounds_and_clamps() {
        assert_eq!(whole_count(2.5), 3);
        assert_eq!(whole_count(-1.0), 0);
        assert_eq!(whole_count(f64::NAN), 0);
        assert_eq!(whole_count(9.0), 9);
    }

    #[test]
    fn r2_18_each_check_names_its_problem() {
        let defaults = BuilderSettings::default();
        for (key, value) in [
            ("paused", json!("yes")),
            ("target_pct_pot", json!(0)),
            ("max_iterations", json!(5_000_000_000_u64)),
            ("k_runouts", json!(70_000)),
            ("max_attempts", json!(40_000)),
            ("plan_configs", json!(["cfg_bogus"])),
            ("plan_configs", json!("cfg_6_online_100")),
            (
                "overnight",
                json!({"start_hour": 1, "end_hour": 24, "utc_offset_minutes": 0, "cpu_share": 1}),
            ),
            (
                "overnight",
                json!({"start_hour": 1, "end_hour": 2, "utc_offset_minutes": 1440, "cpu_share": 1}),
            ),
            (
                "overnight",
                json!({"start_hour": 1, "end_hour": 2, "utc_offset_minutes": 0, "cpu_share": 0}),
            ),
            ("overnight", json!({"start_hour": 1, "end_hour": 2})),
        ] {
            let problem = apply(&defaults, key, &value).expect_err(key);
            let text = reason(&defaults, key, &problem);
            assert!(text.contains("the default"), "{key}: {text}");
        }
        let unknown = apply(&defaults, "nope", &json!(1)).expect_err("unknown");
        assert_eq!(unknown, Problem::Unknown);
        assert!(reason(&defaults, "nope", &unknown).contains("default"));
    }
}
