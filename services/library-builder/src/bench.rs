//! The flop-line benchmark report (R2.18, O-50, O-190, O-200):
//! `validation/reports/bench-flop-line-<machine>.json` under `report.schema.json` and its
//! tool-written Markdown twin, from the summary of the judged `--once --job-spec` run
//! (32-bit storage at 0.3 percent of the pot), an optional informational 16-bit run at 0.5
//! percent (the O-194 floor) and the estimate sweep.
//!
//! The report id is `bench-flop-line`, not the `bench` baseline, so the schema requires
//! `pass` and `thresholds`: the report is judged against O-50, peak resident set size under
//! 5 GB (5,000,000,000 bytes) and every line under 1,800 seconds to 0.3 percent of the pot
//! for both seats. The judged measurements carry their own `pass`; the informational
//! 16-bit and sweep rows carry none. A miss is reported as a miss (O-178), never hidden.

use std::path::Path;

use serde::Serialize;
use serde_json::Value;

use crate::error::BuilderError;
use crate::job::RunSummary;
use crate::spec::Sweep;

/// The O-50 memory limit: 5 GB.
pub const O50_PEAK_RSS_BYTES: u64 = 5_000_000_000;

/// The O-50 time limit per line: 30 minutes.
pub const O50_SECONDS_PER_LINE: f64 = 1_800.0;

/// The O-50 target per seat, percent of the pot.
pub const O50_TARGET_PCT_POT: f64 = 0.3;

/// The R IDs the report proves.
pub const R_IDS: [&str; 4] = ["R2.12", "R2.16", "R2.17", "R2.18"];

/// The machine block of the report schema.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Machine {
    /// `VALIDATE_MACHINE`, for example `zenbook`.
    pub name: String,
    /// The operating system as sysinfo reports it.
    pub os: String,
    /// The processor brand.
    pub cpu: String,
    /// Logical cores.
    pub cores: u32,
    /// Memory in gigabytes.
    pub memory_gb: u64,
}

/// The O-50 verdict of a judged run.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Verdict {
    /// True when every rule holds.
    pub pass: bool,
    /// One sentence per rule, held or missed, with the numbers.
    pub reasons: Vec<String>,
}

/// The verdict of `summary` against O-50.
#[must_use]
pub fn o50_verdict(summary: &RunSummary) -> Verdict {
    let _ = summary;
    Verdict { pass: false, reasons: Vec::new() }
}

/// The machine block for `name` from sysinfo.
#[must_use]
pub fn machine(name: &str) -> Machine {
    Machine { name: name.to_owned(), os: String::new(), cpu: String::new(), cores: 0, memory_gb: 0 }
}

/// The JSON report.
#[must_use]
pub fn report_json(
    judged: &RunSummary,
    informational: Option<&RunSummary>,
    sweep: Option<&Sweep>,
    machine: &Machine,
    commit: &str,
    date: &str,
) -> Value {
    let _ = (judged, informational, sweep, machine, commit, date);
    Value::Null
}

/// The Markdown twin of a JSON report.
#[must_use]
pub fn render_markdown(report: &Value) -> String {
    let _ = report;
    String::new()
}

/// Writes `<stem>.json` and `<stem>.md` into `dir`.
///
/// # Errors
///
/// `BuilderError::Io` naming the file.
pub fn write_report(dir: &Path, stem: &str, report: &Value) -> Result<(), BuilderError> {
    let _ = (dir, stem, report);
    Err(BuilderError::NotImplemented("bench::write_report"))
}
