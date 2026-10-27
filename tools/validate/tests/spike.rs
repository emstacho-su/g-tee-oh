//! R2.21 preflop spike tests (O-48, O-49, O-80, O-227, O-228). R2.21 is a requirement
//! identifier (R ID).
//!
//! Mechanism: the committed Zenbook report must carry the measurements S20 compares the Mac
//! against, under the fixed ids of `validate::spike::ids`, with the 100bb part labeled as
//! measured or extrapolated; and a one-depth in-process run must report real peak bytes.

use validate::equity_fixture;
use validate::report::Report;
use validate::spike::{
    self, HU100_LIMIT_BYTES, HU100_LIMIT_SECONDS, Hu100, PUSH_FOLD_LIMIT_BYTES, PeakBytes, ids,
};

/// The committed report's file name (O-87).
const ZENBOOK_REPORT: &str = "validation/reports/spike-preflop-zenbook.json";

fn committed_report() -> Report {
    let path = validate::repo_root().join(ZENBOOK_REPORT);
    let text = std::fs::read_to_string(&path).expect("the committed spike report");
    serde_json::from_str(&text).expect("the report envelope")
}

fn value(report: &Report, id: &str) -> f64 {
    report
        .measurements
        .iter()
        .find(|m| m.id == id)
        .unwrap_or_else(|| panic!("measurement {id}"))
        .value
}

#[test]
fn r2_21_committed_spike_report_has_the_schema_s20_reads() {
    let report = committed_report();
    assert_eq!(report.report, "spike-preflop-zenbook");
    assert_eq!(report.r_ids, vec!["R2.21".to_owned()]);
    assert!(report.pass, "O-80 holds");
    let limit_bytes = 5.0 * 1024.0 * 1024.0 * 1024.0;
    assert!(value(&report, ids::PUSH_FOLD_PEAK_BYTES) < limit_bytes, "O-80: under 5 GiB");
    assert!(value(&report, ids::PUSH_FOLD_PEAK_BYTES) > 0.0);
    assert!(value(&report, ids::PUSH_FOLD_SECONDS) > 0.0);
    assert!(value(&report, ids::PUSH_FOLD_CERTIFICATE) <= 1e-9);
    assert!(report.thresholds.contains_key(ids::PUSH_FOLD_PEAK_BYTES));
    assert!(value(&report, ids::HU100_PEAK_BYTES) > 0.0);
    assert!(value(&report, ids::HU100_SECONDS) > 0.0);
    let labeled =
        report.notes.contains("100bb: measured") || report.notes.contains("100bb: extrapolated");
    assert!(labeled, "the 100bb part says measured or extrapolated: {}", report.notes);
    assert!(report.notes.contains("--memory 5g"), "the container limit is recorded");
    assert!(report.notes.contains("concurrent"), "concurrent heavy work is recorded");
}

#[test]
fn r2_21_peak_bytes_judges_the_largest_reading() {
    let peak = PeakBytes { accounted: 10, vm_hwm: Some(30), cgroup_peak: Some(20) };
    assert_eq!(peak.judged(), 30);
    assert_eq!(PeakBytes { accounted: 7, vm_hwm: None, cgroup_peak: None }.judged(), 7);
}

#[test]
fn r2_21_report_judges_o80_and_o49() {
    let run = |label: &str, bytes: u64, seconds: f64, gain: f64| spike::SpikeRun {
        label: label.to_owned(),
        seconds,
        iterations: 1,
        gain,
        peak: PeakBytes { accounted: bytes, vm_hwm: None, cgroup_peak: None },
    };
    let push_fold = run("push/fold", 1 << 20, 1.0, 0.0);
    let hu100 = Hu100::Measured(run("hu100", 1 << 24, 60.0, 0.2));
    let good = spike::report("zenbook", &push_fold, &hu100, "concurrent: none");
    assert!(good.pass, "{:#?}", good.measurements);
    assert_eq!(good.report, "spike-preflop-zenbook");

    let fat = run("push/fold", PUSH_FOLD_LIMIT_BYTES, 1.0, 0.0);
    assert!(!spike::report("zenbook", &fat, &hu100, "").pass, "5 GiB is not under 5 GiB");
    let slow = Hu100::Measured(run("hu100", HU100_LIMIT_BYTES - 1, HU100_LIMIT_SECONDS + 1.0, 0.2));
    assert!(!spike::report("zenbook", &push_fold, &slow, "").pass, "over 12 hours fails O-49");
}

#[test]
fn r2_21_one_depth_push_fold_run_reports_peak_bytes() {
    let path = validate::repo_root().join(equity_fixture::DEFAULT_PATH);
    let equity = equity_fixture::load(&path).expect("the equity table").to_table();
    let run = spike::run_push_fold(&equity, &[10]).expect("a measured run");
    assert!(run.peak.judged() > 0);
    assert!(run.seconds >= 0.0);
    assert!(run.gain <= 1e-9, "the certificate holds");
}
