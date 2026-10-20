//! The report envelope `validation/reports/report.schema.json` fixes (R0.11), as serde
//! structs, and the writers of a gate report's JSON (JavaScript Object Notation) file and
//! its Markdown twin. The types and the threshold judgment are settled here; the writers
//! and the clock are owned by the G1 agent (R2.4).
//!
//! Mechanism. A gate hands back a [`crate::gates::GateReport`], its own data only;
//! [`Report::from_gate`] attaches the run [`Context`] (machine, commit, date, toolchain)
//! to make the envelope. [`write_json`] serialises it pretty-printed with a trailing
//! newline, field order as the README lists it. [`write_markdown`] renders the same
//! value as the Markdown twin through the `markdown` child module, title, R IDs, commit,
//! date, machine, the notes line and one table row per measurement with its threshold
//! and verdict, so the two files cannot disagree (A2 section 6; the README's "assembled
//! by hand" rule is updated by S13). [`iso_8601_utc`] formats a clock reading as
//! `YYYY-MM-DDTHH:MM:SSZ` through a civil-from-days conversion, so no date crate is
//! pulled in. Both writers go through `std::fs`, which does no newline translation, so
//! the files are LF on every platform.

use std::collections::BTreeMap;
use std::fmt;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::gates::GateReport;

mod markdown;

/// Path of the report directory relative to the repository root (A1 section 1).
pub const REPORTS_RELATIVE_TO_REPO_ROOT: &str = "validation/reports";

/// Seconds in one day, for the date conversion.
const SECONDS_PER_DAY: u64 = 86_400;

/// Days from 0000-03-01 to 1970-01-01 in the proleptic Gregorian calendar, the shift
/// that puts the Unix epoch on the 400-year cycle the civil-from-days conversion walks.
const DAYS_FROM_CIVIL_ORIGIN_TO_EPOCH: u64 = 719_468;

/// Days in one 400-year Gregorian cycle (era).
const DAYS_PER_ERA: u64 = 146_097;

/// The machine that produced the measurements; `name` is also the file name suffix of
/// a baseline report.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Machine {
    /// Lowercase letters, digits and dashes, starting with a letter.
    pub name: String,
    /// The operating system name and release.
    pub os: String,
    /// The model string of the first CPU (central processing unit) core.
    pub cpu: String,
    /// Logical cores.
    pub cores: u32,
    /// Physical memory in gibibytes, rounded.
    pub memory_gb: u32,
}

/// A limit a measurement is judged against: a bare number, read as an upper bound in
/// the measurement's unit, or an object naming the bound.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Threshold {
    /// A bare upper bound in the measurement's unit (the O-40 latency form).
    Number(f64),
    /// Named bounds, at least one of them present.
    Bound {
        /// Lower bound, inclusive.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        min: Option<f64>,
        /// Upper bound, inclusive.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        max: Option<f64>,
        /// The unit of both bounds.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        unit: Option<String>,
    },
}

impl Threshold {
    /// An inclusive upper bound.
    #[must_use]
    pub fn at_most(max: f64, unit: &str) -> Self {
        Self::Bound { min: None, max: Some(max), unit: Some(unit.to_owned()) }
    }

    /// An inclusive lower bound.
    #[must_use]
    pub fn at_least(min: f64, unit: &str) -> Self {
        Self::Bound { min: Some(min), max: None, unit: Some(unit.to_owned()) }
    }

    /// An inclusive range.
    #[must_use]
    pub fn between(min: f64, max: f64, unit: &str) -> Self {
        Self::Bound { min: Some(min), max: Some(max), unit: Some(unit.to_owned()) }
    }

    /// Whether `value` meets the threshold, bounds inclusive. A rule that is strict, such
    /// as the G1 exploitability floor, is judged by its gate; the report then carries the
    /// inclusive bound beside the verdict the gate made.
    #[must_use]
    pub fn admits(&self, value: f64) -> bool {
        match self {
            Self::Number(limit) => value <= *limit,
            Self::Bound { min, max, .. } => {
                min.is_none_or(|low| value >= low) && max.is_none_or(|high| value <= high)
            }
        }
    }
}

/// One measured quantity, the general `value` form of the schema.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Measurement {
    /// The measurement id, for example `kuhn/standard/nash-conv`.
    pub id: String,
    /// The measured value.
    pub value: f64,
    /// The unit, for example `chips` or `frequency`.
    pub unit: String,
    /// The limit it was judged against; absent for an informational measurement.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub threshold: Option<Threshold>,
    /// The verdict; absent for an informational measurement.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pass: Option<bool>,
}

impl Measurement {
    /// A measurement judged by `threshold`, verdict included.
    #[must_use]
    pub fn judged(id: &str, value: f64, unit: &str, threshold: Threshold) -> Self {
        let pass = Some(threshold.admits(value));
        Self { id: id.to_owned(), value, unit: unit.to_owned(), threshold: Some(threshold), pass }
    }

    /// A measurement judged by `threshold` with a verdict the gate made itself, for a
    /// strict rule.
    #[must_use]
    pub fn judged_as(id: &str, value: f64, unit: &str, threshold: Threshold, pass: bool) -> Self {
        Self {
            id: id.to_owned(),
            value,
            unit: unit.to_owned(),
            threshold: Some(threshold),
            pass: Some(pass),
        }
    }

    /// A measurement recorded for the reader, with no threshold.
    #[must_use]
    pub fn informational(id: &str, value: f64, unit: &str) -> Self {
        Self { id: id.to_owned(), value, unit: unit.to_owned(), threshold: None, pass: None }
    }
}

/// What a run attaches to every report it writes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Context {
    /// The machine block.
    pub machine: Machine,
    /// `git rev-parse HEAD`, 40 hex characters.
    pub commit: String,
    /// When the report was written, ISO 8601 in Coordinated Universal Time (UTC) with
    /// the `Z` suffix.
    pub date: String,
    /// `rustc --version` of the compiler that built the tool.
    pub toolchain: String,
}

/// A gate report, field order as the README lists it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Report {
    /// The report id, the file name without the extension: `g1-kuhn`.
    pub report: String,
    /// The requirement identifiers the report proves.
    pub r_ids: Vec<String>,
    /// The machine block.
    pub machine: Machine,
    /// The commit the report was written at.
    pub commit: String,
    /// When it was written.
    pub date: String,
    /// The compiler that built the tool.
    pub toolchain: String,
    /// True when every judged measurement met its threshold.
    pub pass: bool,
    /// The limits, keyed by measurement id.
    pub thresholds: BTreeMap<String, Threshold>,
    /// One entry per measured quantity.
    pub measurements: Vec<Measurement>,
    /// The mode line and the fixture provenance, for the reader.
    pub notes: String,
}

impl Report {
    /// The envelope of `gate`'s data under `context`.
    #[must_use]
    pub fn from_gate(gate: &GateReport, context: &Context) -> Self {
        Self {
            report: gate.report.clone(),
            r_ids: gate.r_ids.clone(),
            machine: context.machine.clone(),
            commit: context.commit.clone(),
            date: context.date.clone(),
            toolchain: context.toolchain.clone(),
            pass: gate.pass,
            thresholds: gate.thresholds.clone(),
            measurements: gate.measurements.clone(),
            notes: gate.notes.clone(),
        }
    }
}

/// Why a report could not be written or dated.
#[derive(Debug)]
pub enum ReportError {
    /// The report could not be serialised.
    Serialize {
        /// The target path.
        path: PathBuf,
        /// The serde error.
        source: serde_json::Error,
    },
    /// The file could not be written.
    Write {
        /// The target path.
        path: PathBuf,
        /// The input/output error.
        source: std::io::Error,
    },
    /// The clock reads before the Unix epoch, so no date can be formatted.
    ClockBeforeEpoch,
}

impl fmt::Display for ReportError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Serialize { path, source } => {
                write!(f, "cannot serialise report {}: {source}", path.display())
            }
            Self::Write { path, source } => {
                write!(f, "cannot write report {}: {source}", path.display())
            }
            Self::ClockBeforeEpoch => write!(f, "the system clock reads before 1970"),
        }
    }
}

impl std::error::Error for ReportError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Serialize { source, .. } => Some(source),
            Self::Write { source, .. } => Some(source),
            Self::ClockBeforeEpoch => None,
        }
    }
}

/// Write `report` as pretty-printed JSON with a trailing newline, creating the parent
/// directory when it is missing.
///
/// # Errors
///
/// `ReportError::Serialize` when serde fails, `ReportError::Write` when the directory
/// or the file cannot be written.
pub fn write_json(report: &Report, path: &Path) -> Result<(), ReportError> {
    let mut text = serde_json::to_string_pretty(report)
        .map_err(|source| ReportError::Serialize { path: path.to_path_buf(), source })?;
    text.push('\n');
    write_text(path, &text)
}

/// Write the Markdown twin of `report`: the title with the R IDs, the commit, the date,
/// the machine, the notes, then one table row per measurement with value, unit,
/// threshold and verdict.
///
/// # Errors
///
/// `ReportError::Write` when the directory or the file cannot be written.
pub fn write_markdown(report: &Report, path: &Path) -> Result<(), ReportError> {
    write_text(path, &markdown::render(report))
}

/// Write `text` to `path` as is (LF stays LF), creating the parent directory first.
fn write_text(path: &Path, text: &str) -> Result<(), ReportError> {
    let write_error = |source| ReportError::Write { path: path.to_path_buf(), source };
    if let Some(parent) = path.parent().filter(|parent| !parent.as_os_str().is_empty()) {
        std::fs::create_dir_all(parent).map_err(write_error)?;
    }
    std::fs::write(path, text).map_err(write_error)
}

/// `time` as `YYYY-MM-DDTHH:MM:SSZ`, whole seconds, through the civil-from-days
/// conversion (Howard Hinnant's algorithm) so the proleptic Gregorian date is exact.
///
/// # Errors
///
/// `ReportError::ClockBeforeEpoch` when `time` is before the Unix epoch.
pub fn iso_8601_utc(time: SystemTime) -> Result<String, ReportError> {
    let seconds =
        time.duration_since(UNIX_EPOCH).map_err(|_| ReportError::ClockBeforeEpoch)?.as_secs();
    let (year, month, day) = civil_from_days(seconds / SECONDS_PER_DAY);
    let second_of_day = seconds % SECONDS_PER_DAY;
    let (hour, minute, second) =
        (second_of_day / 3_600, (second_of_day / 60) % 60, second_of_day % 60);
    Ok(format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}Z"))
}

/// The proleptic Gregorian `(year, month, day)` of the day `days` after 1970-01-01.
///
/// Mechanism (Hinnant, "chrono-Compatible Low-Level Date Algorithms"): shift the origin
/// to 0000-03-01 so a year runs March to February and the leap day is the last day of the
/// year; split into 400-year eras, then the day of era, the year of era (corrected for
/// the 4, 100 and 400 year leap rules), the day of year and a month index where March is
/// 0; map the month back and bump the year for January and February. Every intermediate
/// is non-negative for a non-negative input, so the arithmetic stays in `u64`.
fn civil_from_days(days: u64) -> (u64, u64, u64) {
    let shifted = days + DAYS_FROM_CIVIL_ORIGIN_TO_EPOCH;
    let era = shifted / DAYS_PER_ERA;
    let day_of_era = shifted % DAYS_PER_ERA;
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_from_march = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_from_march + 2) / 5 + 1;
    let month = if month_from_march < 10 { month_from_march + 3 } else { month_from_march - 9 };
    let year = year_of_era + era * 400 + u64::from(month <= 2);
    (year, month, day)
}

#[cfg(test)]
mod tests {
    use std::time::{Duration, UNIX_EPOCH};

    use super::{ReportError, iso_8601_utc};

    /// R2.4 (the date every gate report carries): known instants format as ISO 8601 UTC
    /// with the `Z` suffix, leap days and century rules included, and a clock before the
    /// epoch is an error.
    #[test]
    fn r2_4_iso_8601_utc_formats_known_dates() {
        let cases = [
            (0, "1970-01-01T00:00:00Z"),
            (86_399, "1970-01-01T23:59:59Z"),
            (951_782_400, "2000-02-29T00:00:00Z"),
            (1_000_000_000, "2001-09-09T01:46:40Z"),
            (1_792_454_400, "2026-10-20T00:00:00Z"),
            (4_102_444_800, "2100-01-01T00:00:00Z"),
            (4_102_444_799, "2099-12-31T23:59:59Z"),
        ];
        for (seconds, expected) in cases {
            let time = UNIX_EPOCH + Duration::from_secs(seconds);
            assert_eq!(iso_8601_utc(time).expect("after the epoch"), expected, "{seconds}");
        }
        let before = UNIX_EPOCH - Duration::from_secs(1);
        assert!(matches!(iso_8601_utc(before), Err(ReportError::ClockBeforeEpoch)));
    }
}
