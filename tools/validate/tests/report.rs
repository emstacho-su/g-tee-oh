//! Red test for the gate reports the `validate` binary writes (R2.4, R2.5, R2.6, in the
//! R0.11 envelope): `validate gates --out <dir>` must leave six files, one JSON
//! (JavaScript Object Notation) report and one Markdown twin per gate, each JSON file
//! following `validation/reports/report.schema.json` and passing. The schema itself is
//! checked by `scripts/check-reports.mjs`; this test reads the fields a reviewer reads
//! first, so a report that is written but empty, undated or failing is caught here in
//! Rust without an ajv dependency.

use std::path::PathBuf;
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{Value, json};

/// The three report ids and the requirement each proves (S13 plan, O-125).
const EXPECTED_REPORTS: [(&str, &str); 3] =
    [("g1-kuhn", "R2.4"), ("g2-akq", "R2.5"), ("g3-leduc", "R2.6")];

/// The machine name the test passes, so the report is independent of the host's
/// `VALIDATE_MACHINE`.
const MACHINE: &str = "test-machine";

/// A directory under the system temp dir, removed when the test ends.
struct TempDir(PathBuf);

impl TempDir {
    fn new() -> Self {
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_nanos());
        let path =
            std::env::temp_dir().join(format!("validate-report-{}-{nanos}", std::process::id()));
        std::fs::create_dir_all(&path)
            .unwrap_or_else(|error| panic!("{}: {error}", path.display()));
        TempDir(path)
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        if let Err(error) = std::fs::remove_dir_all(&self.0) {
            eprintln!("could not remove {}: {error}", self.0.display());
        }
    }
}

fn is_hex_40(text: &str) -> bool {
    text.len() == 40 && text.chars().all(|c| c.is_ascii_digit() || ('a'..='f').contains(&c))
}

/// `YYYY-MM-DDTHH:MM:SS`, an optional fraction of one to nine digits, then `Z`: the
/// schema's date pattern.
fn is_iso_8601_utc(text: &str) -> bool {
    let bytes = text.as_bytes();
    let digit = |i: usize| bytes.get(i).is_some_and(u8::is_ascii_digit);
    let is = |i: usize, c: u8| bytes.get(i) == Some(&c);
    let head = (0..4).all(digit)
        && is(4, b'-')
        && digit(5)
        && digit(6)
        && is(7, b'-')
        && digit(8)
        && digit(9)
        && is(10, b'T')
        && digit(11)
        && digit(12)
        && is(13, b':')
        && digit(14)
        && digit(15)
        && is(16, b':')
        && digit(17)
        && digit(18);
    if !head {
        return false;
    }
    match &bytes[19..] {
        [b'Z'] => true,
        [b'.', fraction @ .., b'Z'] => {
            (1..=9).contains(&fraction.len()) && fraction.iter().all(u8::is_ascii_digit)
        }
        _ => false,
    }
}

fn read_json(path: &PathBuf) -> Value {
    let text = std::fs::read_to_string(path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
}

/// R2.4: a usage error exits 2 before any gate runs or any file is written, here a
/// repeated `--allow-dirty`; the dirty-tree refusal shares that exit code.
#[test]
fn r2_4_repeated_allow_dirty_is_a_usage_error_with_exit_2() {
    let dir = TempDir::new();
    let output = Command::new(env!("CARGO_BIN_EXE_validate"))
        .args(["gates", "--allow-dirty", "--allow-dirty", "--out"])
        .arg(&dir.0)
        .output()
        .expect("the validate binary built by cargo should start");
    assert_eq!(output.status.code(), Some(2), "{output:?}");
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(stderr.contains("--allow-dirty given twice"), "{stderr}");
    let written = std::fs::read_dir(&dir.0).expect("the directory exists").count();
    assert_eq!(written, 0, "nothing is written on a usage error");
}

/// R2.4, R2.5, R2.6: `validate gates --out DIR --allow-dirty` exits 0, writes the six
/// report files, and every JSON report carries its id, its R ID, `pass: true`, non-empty
/// thresholds and measurements, a 40-hex commit, an ISO 8601 UTC date, the machine name
/// given and a toolchain; the Markdown twin names the report and the R ID.
#[test]
fn r2_4_r2_5_r2_6_gate_reports_follow_the_schema_envelope() {
    let dir = TempDir::new();
    let output = Command::new(env!("CARGO_BIN_EXE_validate"))
        .arg("gates")
        .arg("--out")
        .arg(&dir.0)
        .arg("--machine")
        .arg(MACHINE)
        // A development tree may be dirty; the clean-tree rule is unit-tested in
        // `machine` against canned `git status --porcelain` output.
        .arg("--allow-dirty")
        .output()
        .expect("the validate binary built by cargo should start");
    assert!(
        output.status.success(),
        "exit status {:?}\nstdout:\n{}\nstderr:\n{}",
        output.status,
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );

    let mut files: Vec<String> = std::fs::read_dir(&dir.0)
        .expect("the output directory exists")
        .map(|entry| entry.expect("entry").file_name().to_string_lossy().into_owned())
        .collect();
    files.sort();
    let expected: Vec<String> = EXPECTED_REPORTS
        .iter()
        .flat_map(|(id, _)| [format!("{id}.json"), format!("{id}.md")])
        .collect();
    assert_eq!(files, expected, "six report files, two per gate");

    for (id, r_id) in EXPECTED_REPORTS {
        let report = read_json(&dir.0.join(format!("{id}.json")));
        assert_eq!(report["report"], json!(id), "{id}: report id");
        assert_eq!(report["r_ids"], json!([r_id]), "{id}: r_ids");
        assert_eq!(report["pass"], json!(true), "{id}: pass");
        let thresholds = report["thresholds"].as_object().unwrap_or_else(|| panic!("{id}"));
        assert!(!thresholds.is_empty(), "{id}: thresholds are empty");
        let measurements = report["measurements"].as_array().unwrap_or_else(|| panic!("{id}"));
        assert!(!measurements.is_empty(), "{id}: measurements are empty");
        for measurement in measurements {
            assert!(measurement["id"].is_string(), "{id}: measurement id {measurement}");
            assert!(measurement["unit"].is_string(), "{id}: measurement unit {measurement}");
            assert!(measurement["value"].is_number(), "{id}: measurement value {measurement}");
        }
        let commit = report["commit"].as_str().unwrap_or_default();
        assert!(is_hex_40(commit), "{id}: commit {commit:?}");
        let date = report["date"].as_str().unwrap_or_default();
        assert!(is_iso_8601_utc(date), "{id}: date {date:?}");
        assert_eq!(report["machine"]["name"], json!(MACHINE), "{id}: machine name");
        assert!(report["machine"]["cores"].as_u64().is_some_and(|c| c >= 1), "{id}: cores");
        assert!(report["machine"]["memory_gb"].as_u64().is_some_and(|m| m >= 1), "{id}: memory");
        assert!(!report["toolchain"].as_str().unwrap_or_default().is_empty(), "{id}: toolchain");
        assert!(!report["notes"].as_str().unwrap_or_default().is_empty(), "{id}: notes");

        let markdown = std::fs::read_to_string(dir.0.join(format!("{id}.md")))
            .unwrap_or_else(|e| panic!("{id}.md: {e}"));
        assert!(markdown.contains(id), "{id}.md names the report");
        assert!(markdown.contains(r_id), "{id}.md names {r_id}");
        assert!(markdown.contains(commit), "{id}.md names the commit");
    }
}
