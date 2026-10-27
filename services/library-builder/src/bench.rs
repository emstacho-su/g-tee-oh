//! The flop-line benchmark report (R2.18, O-50, O-190, O-200):
//! `validation/reports/bench-flop-line-<machine>.json` under `report.schema.json` and its
//! tool-written Markdown twin, from the summary of the judged `--once --job-spec` run
//! (32-bit storage at 0.3 percent of the pot), an optional informational 16-bit run at 0.5
//! percent (the O-194 floor) and the estimate sweep.
//!
//! The report id is `bench-flop-line`, not the `bench` baseline, so the schema requires
//! `pass` and `thresholds`: the report is judged against O-50, peak resident set size under
//! 5 GB (5,000,000,000 bytes) and every line at most 1,800 seconds to 0.3 percent of the
//! pot for both seats. The judged measurements carry their own `pass`; the informational
//! 16-bit and sweep rows carry none. A miss is reported as a miss (O-178), never hidden.
//!
//! Measurement ids: the judged run's rows start with `flop-line/` (`staged`, `peak-rss`,
//! and per line `<line>/seconds`, `<line>/gain-oop` and `<line>/gain-ip` judged, then
//! `<line>/iterations`, `<line>/estimate-bytes`, `<line>/flop-bytes`,
//! `<line>/mean-runout-bytes`, `bytes-written` and `job-seconds` informational); the
//! informational run repeats them under `flop-line-16bit/` without a verdict; the sweep
//! writes `sweep/<line>/max-estimate-bytes`, `sweep/<line>/min-estimate-bytes`,
//! `sweep/flops` and `sweep/cap-bytes`. A run that did not stage fails its `staged` row,
//! so the report's `pass` always has a failed measurement to point at
//! (`scripts/check-reports.mjs` requires that agreement).

mod markdown;

use std::path::Path;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use sysinfo::{CpuRefreshKind, MemoryRefreshKind, System};

use crate::error::BuilderError;
use crate::job::{ENGINE_VERSION, LineSummary, RunSummary};
use crate::spec::{OUTCOME_STAGED, Sweep};

pub use markdown::render_markdown;

/// The O-50 memory limit: 5 GB.
pub const O50_PEAK_RSS_BYTES: u64 = 5_000_000_000;

/// The O-50 time limit per line: 30 minutes.
pub const O50_SECONDS_PER_LINE: f64 = 1_800.0;

/// The O-50 target per seat, percent of the pot.
pub const O50_TARGET_PCT_POT: f64 = 0.3;

/// The R IDs the report proves.
pub const R_IDS: [&str; 4] = ["R2.12", "R2.16", "R2.17", "R2.18"];

/// The report id and the stem of its files before the machine suffix.
pub const REPORT_ID: &str = "bench-flop-line";

/// The machine name when `VALIDATE_MACHINE` is unset.
pub const DEFAULT_MACHINE: &str = "zenbook";

/// The prefix of the judged run's measurement ids.
const JUDGED_PREFIX: &str = "flop-line";

/// The prefix of the informational 16-bit run's measurement ids (O-200).
const SIXTEEN_BIT_PREFIX: &str = "flop-line-16bit";

/// Bytes in a gibibyte, for the machine block's memory (the validate tool's rounding).
const BYTES_PER_GIB: u64 = 1 << 30;

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
///
/// Three rules, one sentence each: peak resident set size strictly under
/// [`O50_PEAK_RSS_BYTES`], every line's seconds at most [`O50_SECONDS_PER_LINE`], and both
/// seats' gains of every line at most [`O50_TARGET_PCT_POT`]. A run that did not stage
/// fails whatever its numbers, with a fourth sentence saying so; a staged run with no line
/// fails the time and gain rules, since there is nothing to judge.
#[must_use]
pub fn o50_verdict(summary: &RunSummary) -> Verdict {
    let staged = summary.outcome == OUTCOME_STAGED;
    let (memory_ok, memory) = memory_rule(summary.peak_rss_bytes);
    let (time_ok, time) = time_rule(&summary.lines);
    let (gains_ok, gains) = gain_rule(&summary.lines);
    let staged_reason = (!staged).then(|| {
        let error = summary.error.as_deref().unwrap_or("no error recorded");
        format!("the run did not stage: outcome {}, {error}", summary.outcome)
    });
    let reasons =
        [Some(memory), Some(time), Some(gains), staged_reason].into_iter().flatten().collect();
    Verdict { pass: staged && memory_ok && time_ok && gains_ok, reasons }
}

fn memory_rule(peak: u64) -> (bool, String) {
    let held = peak < O50_PEAK_RSS_BYTES;
    let relation = if held { "is under" } else { "is not under" };
    (
        held,
        format!(
            "peak resident set size {peak} bytes {relation} the O-50 limit of {O50_PEAK_RSS_BYTES} bytes"
        ),
    )
}

fn time_rule(lines: &[LineSummary]) -> (bool, String) {
    let limit = format!("{O50_SECONDS_PER_LINE:.0}");
    let slow: Vec<String> = lines
        .iter()
        .filter(|line| line.seconds.is_nan() || line.seconds > O50_SECONDS_PER_LINE)
        .map(|line| format!("{} took {} seconds", line.line, line.seconds))
        .collect();
    if lines.is_empty() {
        return (
            false,
            format!("no line was solved, so the {limit} second limit per line is not met"),
        );
    }
    if slow.is_empty() {
        (true, format!("every line finished within the O-50 limit of {limit} seconds"))
    } else {
        (false, format!("{}, over the O-50 limit of {limit} seconds per line", slow.join("; ")))
    }
}

fn gain_rule(lines: &[LineSummary]) -> (bool, String) {
    let loose: Vec<String> = lines
        .iter()
        .filter(|line| !line.gains_pct_pot.iter().all(|gain| *gain <= O50_TARGET_PCT_POT))
        .map(|line| {
            let [oop, ip] = line.gains_pct_pot;
            format!("{} stopped at gains of {oop} and {ip} percent of the pot", line.line)
        })
        .collect();
    if lines.is_empty() {
        return (
            false,
            format!("no line was solved, so the {O50_TARGET_PCT_POT} percent target is not met"),
        );
    }
    if loose.is_empty() {
        (
            true,
            format!(
                "both seats of every line reached the O-50 target of {O50_TARGET_PCT_POT} percent of the pot"
            ),
        )
    } else {
        (
            false,
            format!("{}, above the O-50 target of {O50_TARGET_PCT_POT} percent", loose.join("; ")),
        )
    }
}

/// The machine block for `name` from sysinfo: the long operating system name, the first
/// CPU's brand, the logical cores and the memory rounded to whole gibibytes. Every field
/// has a floor the schema accepts (the compile-time OS and architecture names, at least
/// one core and one gigabyte), so a host that reports nothing still yields a valid block.
#[must_use]
pub fn machine(name: &str) -> Machine {
    let mut system = System::new();
    system.refresh_cpu_list(CpuRefreshKind::nothing());
    system.refresh_memory_specifics(MemoryRefreshKind::nothing().with_ram());
    let cpu = system
        .cpus()
        .first()
        .map(|cpu| cpu.brand().trim().to_owned())
        .filter(|brand| !brand.is_empty())
        .unwrap_or_else(|| std::env::consts::ARCH.to_owned());
    let cores = u32::try_from(system.cpus().len()).unwrap_or(u32::MAX).max(1);
    let memory_gb =
        (system.total_memory().saturating_add(BYTES_PER_GIB / 2) / BYTES_PER_GIB).max(1);
    let os = System::long_os_version()
        .map(|text| text.trim().to_owned())
        .filter(|text| !text.is_empty())
        .unwrap_or_else(|| std::env::consts::OS.to_owned());
    Machine { name: name.to_owned(), os, cpu, cores, memory_gb }
}

/// True when `name` fits the report schema's machine name, `^[a-z][a-z0-9-]*$`.
#[must_use]
pub fn is_machine_name(name: &str) -> bool {
    let mut chars = name.chars();
    chars.next().is_some_and(|first| first.is_ascii_lowercase())
        && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

/// The JSON report.
///
/// `toolchain` is the engine version every build records (`job::ENGINE_VERSION`): the
/// report is written from summaries after the run, so the process writing it is not the
/// one that was measured, and the version is what ties the two together.
#[must_use]
pub fn report_json(
    judged: &RunSummary,
    informational: Option<&RunSummary>,
    sweep: Option<&Sweep>,
    machine: &Machine,
    commit: &str,
    date: &str,
) -> Value {
    let verdict = o50_verdict(judged);
    let measurements = [
        judged_rows(judged),
        detail_rows(JUDGED_PREFIX, judged),
        informational.map(sixteen_bit_rows).unwrap_or_default(),
        sweep.map(sweep_rows).unwrap_or_default(),
    ]
    .concat();
    json!({
        "report": REPORT_ID,
        "r_ids": R_IDS,
        "machine": machine,
        "commit": commit,
        "date": date,
        "toolchain": ENGINE_VERSION,
        "pass": verdict.pass,
        "thresholds": {
            "peak_rss_bytes": { "max": O50_PEAK_RSS_BYTES, "unit": "bytes" },
            "seconds_per_line": { "max": O50_SECONDS_PER_LINE, "unit": "seconds" },
            "exploitability_pct_pot": { "max": O50_TARGET_PCT_POT, "unit": "pct_pot" },
        },
        "measurements": measurements,
        "notes": notes(judged, informational, sweep, &verdict),
    })
}

/// A measurement: `id`, a finite `value` and `unit`. A value that is not finite (a gain
/// the solver could not measure) is written as 0 with `"non_finite": true`, since the
/// schema needs a number.
fn row(id: &str, value: f64, unit: &str) -> Map<String, Value> {
    let mut map = Map::new();
    map.insert("id".to_owned(), Value::from(id));
    map.insert(
        "value".to_owned(),
        if value.is_finite() { Value::from(value) } else { Value::from(0) },
    );
    map.insert("unit".to_owned(), Value::from(unit));
    if !value.is_finite() {
        map.insert("non_finite".to_owned(), Value::Bool(true));
    }
    map
}

/// An integer measurement.
fn count_row(id: &str, value: u64, unit: &str) -> Value {
    json!({ "id": id, "value": value, "unit": unit })
}

/// A judged measurement: the row with its threshold and verdict.
fn judged_row(base: Map<String, Value>, threshold: Value, pass: bool) -> Value {
    let mut map = base;
    map.insert("threshold".to_owned(), threshold);
    map.insert("pass".to_owned(), Value::Bool(pass));
    Value::Object(map)
}

/// The judged rows of the judged run.
fn judged_rows(summary: &RunSummary) -> Vec<Value> {
    let staged = summary.outcome == OUTCOME_STAGED;
    let staged_row = judged_row(
        row(&format!("{JUDGED_PREFIX}/staged"), if staged { 1.0 } else { 0.0 }, "boolean"),
        json!({ "min": 1, "unit": "boolean" }),
        staged,
    );
    let mut rss = Map::new();
    rss.insert("id".to_owned(), Value::from(format!("{JUDGED_PREFIX}/peak-rss")));
    rss.insert("value".to_owned(), Value::from(summary.peak_rss_bytes));
    rss.insert("unit".to_owned(), Value::from("bytes"));
    rss.insert("strict".to_owned(), Value::Bool(true));
    let rss_row = judged_row(
        rss,
        json!({ "max": O50_PEAK_RSS_BYTES, "unit": "bytes" }),
        summary.peak_rss_bytes < O50_PEAK_RSS_BYTES,
    );
    let lines = summary.lines.iter().flat_map(|line| {
        let seconds = judged_row(
            row(&format!("{JUDGED_PREFIX}/{}/seconds", line.line), line.seconds, "seconds"),
            json!({ "max": O50_SECONDS_PER_LINE, "unit": "seconds" }),
            line.seconds <= O50_SECONDS_PER_LINE,
        );
        let gains = ["oop", "ip"].into_iter().zip(line.gains_pct_pot).map(|(seat, gain)| {
            judged_row(
                row(&format!("{JUDGED_PREFIX}/{}/gain-{seat}", line.line), gain, "pct_pot"),
                json!({ "max": O50_TARGET_PCT_POT, "unit": "pct_pot" }),
                gain <= O50_TARGET_PCT_POT,
            )
        });
        std::iter::once(seconds).chain(gains).collect::<Vec<Value>>()
    });
    [staged_row, rss_row].into_iter().chain(lines).collect()
}

/// The informational detail rows of a run under `prefix`.
fn detail_rows(prefix: &str, summary: &RunSummary) -> Vec<Value> {
    let lines = summary.lines.iter().flat_map(|line| {
        let runouts = u64::try_from(line.runout_bytes.len()).unwrap_or(u64::MAX).max(1);
        let mean_runout = line.runout_bytes.iter().sum::<u64>() / runouts;
        let id = |name: &str| format!("{prefix}/{}/{name}", line.line);
        vec![
            count_row(&id("iterations"), u64::from(line.iterations), "iterations"),
            count_row(&id("estimate-bytes"), line.estimate_bytes, "bytes"),
            count_row(&id("flop-bytes"), line.flop_bytes, "bytes"),
            count_row(&id("mean-runout-bytes"), mean_runout, "bytes"),
        ]
    });
    lines
        .chain([
            count_row(&format!("{prefix}/bytes-written"), summary.bytes_written, "bytes"),
            Value::Object(row(&format!("{prefix}/job-seconds"), summary.seconds, "seconds")),
        ])
        .collect()
}

/// The informational 16-bit run: the judged quantities without a verdict, then its
/// details (O-200).
fn sixteen_bit_rows(summary: &RunSummary) -> Vec<Value> {
    let staged = u64::from(summary.outcome == OUTCOME_STAGED);
    let head = [
        count_row(&format!("{SIXTEEN_BIT_PREFIX}/staged"), staged, "boolean"),
        count_row(&format!("{SIXTEEN_BIT_PREFIX}/peak-rss"), summary.peak_rss_bytes, "bytes"),
    ];
    let lines = summary.lines.iter().flat_map(|line| {
        let id = |name: &str| format!("{SIXTEEN_BIT_PREFIX}/{}/{name}", line.line);
        let [oop, ip] = line.gains_pct_pot;
        [
            Value::Object(row(&id("seconds"), line.seconds, "seconds")),
            Value::Object(row(&id("gain-oop"), oop, "pct_pot")),
            Value::Object(row(&id("gain-ip"), ip, "pct_pot")),
        ]
    });
    head.into_iter().chain(lines).chain(detail_rows(SIXTEEN_BIT_PREFIX, summary)).collect()
}

/// The informational estimate sweep rows (O-194).
fn sweep_rows(sweep: &Sweep) -> Vec<Value> {
    let lines = sweep.lines.iter().flat_map(|line| {
        [
            count_row(
                &format!("sweep/{}/max-estimate-bytes", line.line),
                line.estimate_bytes,
                "bytes",
            ),
            count_row(&format!("sweep/{}/min-estimate-bytes", line.line), line.min_bytes, "bytes"),
        ]
    });
    [
        count_row("sweep/flops", u64::from(sweep.flops), "flops"),
        count_row("sweep/cap-bytes", sweep.cap_bytes, "bytes"),
    ]
    .into_iter()
    .chain(lines)
    .collect()
}

/// The notes: the rule, the verdict sentences, the storage of each run, the stop reasons
/// and the sweep's largest estimates.
fn notes(
    judged: &RunSummary,
    informational: Option<&RunSummary>,
    sweep: Option<&Sweep>,
    verdict: &Verdict,
) -> String {
    let rule = format!(
        "Judged against O-50: peak resident set size under {O50_PEAK_RSS_BYTES} bytes and \
         every line at most {O50_SECONDS_PER_LINE:.0} seconds to {O50_TARGET_PCT_POT} percent \
         of the pot for both seats; a miss is recorded as a miss (O-178)."
    );
    let verdict_text =
        format!("Verdict: {}. {}.", pass_word(verdict.pass), verdict.reasons.join("; "));
    let storage = "By the bench method the judged summary is the 32-bit run at the 0.3 percent \
                   target (O-194, O-200), the judged storage of O-50 by the O-200 erratum.";
    let sixteen = informational.map(|summary| {
        format!(
            "The {SIXTEEN_BIT_PREFIX} rows are the informational 16-bit run at the 0.5 percent \
             floor of O-194, never judged (O-200); its stop reasons: {}.",
            stop_reasons(summary)
        )
    });
    let stops = format!("Judged run stop reasons: {}.", stop_reasons(judged));
    let sweep_text = sweep.map(|sweep| {
        let largest: Vec<String> = sweep
            .lines
            .iter()
            .map(|line| {
                format!("{} at most {} bytes on {}", line.line, line.estimate_bytes, line.flop)
            })
            .collect();
        format!(
            "The sweep estimated {} canonical flops per line at {}-bit storage against a cap of \
             {} bytes (O-194): {}.",
            sweep.flops,
            sweep.storage_bits,
            sweep.cap_bytes,
            largest.join("; ")
        )
    });
    [Some(rule), Some(verdict_text), Some(storage.to_owned()), Some(stops), sixteen, sweep_text]
        .into_iter()
        .flatten()
        .collect::<Vec<String>>()
        .join(" ")
}

/// `pass` or `fail`.
fn pass_word(pass: bool) -> &'static str {
    if pass { "pass" } else { "fail" }
}

/// Each line's stop reason, `line stop`, or `none` without lines.
fn stop_reasons(summary: &RunSummary) -> String {
    if summary.lines.is_empty() {
        return "none, no line was solved".to_owned();
    }
    summary
        .lines
        .iter()
        .map(|line| format!("{} {}", line.line, line.stop_reason))
        .collect::<Vec<_>>()
        .join(", ")
}

/// A run summary as `--once --job-spec --summary-out` writes it. `RunSummary` itself is
/// only `Serialize`, so the report reads the file through this mirror and converts it.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SummaryFile {
    job_id: String,
    build_id: Option<String>,
    outcome: String,
    error: Option<String>,
    lines: Vec<LineFile>,
    bytes_written: u64,
    peak_rss_bytes: u64,
    seconds: f64,
}

/// One line of a [`SummaryFile`].
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct LineFile {
    line: String,
    seconds: f64,
    iterations: u32,
    gains_pct_pot: [f64; 2],
    stop_reason: String,
    estimate_bytes: u64,
    flop_bytes: u64,
    runout_bytes: Vec<u64>,
}

impl From<LineFile> for LineSummary {
    fn from(line: LineFile) -> Self {
        LineSummary {
            line: line.line,
            seconds: line.seconds,
            iterations: line.iterations,
            gains_pct_pot: line.gains_pct_pot,
            stop_reason: line.stop_reason,
            estimate_bytes: line.estimate_bytes,
            flop_bytes: line.flop_bytes,
            runout_bytes: line.runout_bytes,
        }
    }
}

/// Reads and parses the JSON file at `path`.
fn read_json<T: serde::de::DeserializeOwned>(path: &Path) -> Result<T, BuilderError> {
    let text = std::fs::read_to_string(path).map_err(|source| BuilderError::io(path, source))?;
    serde_json::from_str(&text).map_err(|error| BuilderError::Malformed {
        path: path.display().to_string(),
        reason: error.to_string(),
    })
}

/// The run summary in the file at `path`.
///
/// # Errors
///
/// `BuilderError::Io` or `BuilderError::Malformed` naming the file.
pub fn read_summary(path: &Path) -> Result<RunSummary, BuilderError> {
    let file: SummaryFile = read_json(path)?;
    Ok(RunSummary {
        job_id: file.job_id,
        build_id: file.build_id,
        outcome: file.outcome,
        error: file.error,
        lines: file.lines.into_iter().map(LineSummary::from).collect(),
        bytes_written: file.bytes_written,
        peak_rss_bytes: file.peak_rss_bytes,
        seconds: file.seconds,
    })
}

/// The estimate sweep in the file at `path`.
///
/// # Errors
///
/// `BuilderError::Io` or `BuilderError::Malformed` naming the file.
pub fn read_sweep(path: &Path) -> Result<Sweep, BuilderError> {
    read_json(path)
}

/// Writes `<stem>.json` and `<stem>.md` into `dir`.
///
/// # Errors
///
/// `BuilderError::Io` naming the file.
pub fn write_report(dir: &Path, stem: &str, report: &Value) -> Result<(), BuilderError> {
    std::fs::create_dir_all(dir).map_err(|source| BuilderError::io(dir, source))?;
    let json_path = dir.join(format!("{stem}.json"));
    let text = serde_json::to_string_pretty(report).map_err(|error| BuilderError::Malformed {
        path: json_path.display().to_string(),
        reason: error.to_string(),
    })?;
    std::fs::write(&json_path, format!("{text}\n"))
        .map_err(|source| BuilderError::io(&json_path, source))?;
    let md_path = dir.join(format!("{stem}.md"));
    std::fs::write(&md_path, render_markdown(report))
        .map_err(|source| BuilderError::io(&md_path, source))
}

#[cfg(test)]
mod tests {
    use super::{is_machine_name, pass_word};

    #[test]
    fn r2_18_machine_names_follow_the_schema() {
        assert!(is_machine_name("zenbook"));
        assert!(is_machine_name("mac-m2"));
        assert!(!is_machine_name("Zenbook"));
        assert!(!is_machine_name("1box"));
        assert!(!is_machine_name(""));
        assert_eq!(pass_word(false), "fail");
    }
}
