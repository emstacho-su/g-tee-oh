//! Unit tests of `report` (R2.4, the envelope of every G1 to G3 report): the dirty-tree
//! note and the date format.

use std::collections::BTreeMap;
use std::time::{Duration, UNIX_EPOCH};

use super::{
    Context, DIRTY_TREE_NOTE, Machine, Measurement, Report, ReportError, Threshold, iso_8601_utc,
};
use crate::gates::GateReport;

/// R2.11 (review finding F7): a strict upper bound refuses the bound itself while an
/// inclusive one admits it, a measurement judged by the strict bound fails at the bound,
/// and both bounds serialise to the same schema object, since `report.schema.json` has no
/// field for strictness: the JSON carries the bound and the verdict, the Markdown twin
/// the word, and a read-back is inclusive.
#[test]
fn r2_11_strict_threshold_refuses_its_bound_and_serialises_within_the_schema() {
    let strict = Threshold::under(2.0, "percentage_points");
    let inclusive = Threshold::at_most(2.0, "percentage_points");
    assert!(!strict.admits(2.0) && strict.admits(1.999) && !strict.admits(2.001));
    assert!(inclusive.admits(2.0) && !inclusive.admits(2.001));
    assert_ne!(strict, inclusive);
    assert_eq!(
        Measurement::judged("x", 2.0, "percentage_points", strict.clone()).pass,
        Some(false)
    );
    assert_eq!(
        Measurement::judged("x", 2.0, "percentage_points", inclusive.clone()).pass,
        Some(true)
    );
    let json = serde_json::to_value(&strict).expect("serialises");
    assert_eq!(json, serde_json::json!({ "max": 2.0, "unit": "percentage_points" }));
    assert_eq!(json, serde_json::to_value(&inclusive).expect("serialises"));
    let back: Threshold = serde_json::from_value(json).expect("deserialises");
    assert_eq!(back, inclusive, "the schema has no strict field, so a read-back is inclusive");
}

fn context(tree_dirty: bool) -> Context {
    let machine = Machine {
        name: "test-machine".to_owned(),
        os: "test 1.0".to_owned(),
        cpu: "test cpu".to_owned(),
        cores: 1,
        memory_gb: 1,
    };
    Context {
        machine,
        commit: "0".repeat(40),
        date: "2026-10-20T00:00:00Z".to_owned(),
        toolchain: "rustc 1.99.1 (test)".to_owned(),
        tree_dirty,
    }
}

/// R2.4 (the notes of every gate report): a run on a dirty tree under `--allow-dirty`
/// adds the dirty-tree line after the gate's notes; a clean run leaves them as is.
#[test]
fn r2_4_dirty_tree_run_adds_the_note_line() {
    let gate = GateReport {
        report: "g1-kuhn".to_owned(),
        r_ids: vec!["R2.4".to_owned()],
        pass: true,
        thresholds: BTreeMap::new(),
        measurements: Vec::new(),
        notes: "mode line".to_owned(),
    };
    assert_eq!(Report::from_gate(&gate, &context(false)).notes, "mode line");
    let dirty = Report::from_gate(&gate, &context(true)).notes;
    assert_eq!(dirty, format!("mode line\n{DIRTY_TREE_NOTE}"));
    assert_eq!(dirty.lines().last(), Some("working tree dirty at run time"));
}

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
