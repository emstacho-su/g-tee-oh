//! R2.21 preflop spike tests (O-48, O-49, O-80, O-227, O-228). R2.21 is a requirement
//! identifier (R ID).
//!
//! Mechanism: the committed Zenbook report must carry the measurements S20 compares the Mac
//! against, under the fixed ids of `validate::spike::ids`, with the 100bb part measured (a
//! 100bb run that errored is labeled not measured and fails the report); and a one-depth
//! in-process run must report real peak bytes.

use gto_solve::equity::EquityTable;
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
    // A passing report measured its 100bb run: a run that was not measured fails (O-49).
    assert!(report.notes.starts_with("100bb: measured"), "{}", report.notes);
    assert!(!report.measurements.iter().any(|m| m.id == ids::HU100_MEASURED));
    assert!(report.notes.contains("--memory 5g"), "the container limit is recorded");
    assert!(report.notes.contains("concurrent"), "concurrent heavy work is recorded");
}

#[test]
fn r2_21_peak_bytes_judges_the_largest_reading() {
    let peak = PeakBytes { accounted: Some(10), vm_hwm: Some(30), cgroup_peak: Some(20) };
    assert_eq!(peak.judged(), Some(30));
    assert_eq!(PeakBytes { accounted: Some(7), vm_hwm: None, cgroup_peak: None }.judged(), Some(7));
    assert_eq!(PeakBytes::default().judged(), None, "no reading is no figure, not 0 bytes");
}

#[test]
fn r2_21_report_judges_o80_and_o49() {
    let run = |label: &str, bytes: u64, seconds: f64, gain: f64| spike::SpikeRun {
        label: label.to_owned(),
        seconds,
        iterations: 1,
        gain,
        peak: PeakBytes { accounted: Some(bytes), vm_hwm: None, cgroup_peak: None },
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
fn r2_21_an_errored_100bb_run_fails_the_report() {
    // An empty equity table is refused by the preflop game, so the 100bb run errors after its
    // spec and tree are built: the path a real failure of the measured run takes.
    let empty = EquityTable { classes: Vec::new(), equity: Vec::new(), pairs: Vec::new() };
    let push_fold = spike::SpikeRun {
        label: "push/fold".to_owned(),
        seconds: 1.0,
        iterations: 1,
        gain: 0.0,
        peak: PeakBytes { accounted: Some(1 << 20), vm_hwm: None, cgroup_peak: None },
    };
    let hu100 = spike::measure_hu100(&empty, &validate::repo_root(), &push_fold);
    let report = spike::report("dryrun", &push_fold, &hu100, "");
    assert!(!report.pass, "an errored 100bb run is no pass: {}", report.notes);
    assert!(report.notes.starts_with("100bb: not measured"), "{}", report.notes);
    assert!(report.notes.contains("100bb run: game"), "the error is in the notes");
    let pass_of = |id: &str| report.measurements.iter().find(|m| m.id == id).map(|m| m.pass);
    assert_eq!(pass_of(ids::HU100_PEAK_BYTES), Some(None), "the extrapolation is informational");
    assert_eq!(pass_of(ids::HU100_SECONDS), Some(None));
    assert_eq!(pass_of(ids::HU100_MEASURED), Some(Some(false)), "the judged row that fails");
}

#[test]
#[cfg_attr(
    not(feature = "peak-alloc"),
    ignore = "R2.21: the accounted peak needs the peak-alloc feature; just rust-test runs this \
              with cargo test -p validate --features peak-alloc --test spike"
)]
fn r2_21_one_depth_push_fold_run_reports_peak_bytes() {
    let path = validate::repo_root().join(equity_fixture::DEFAULT_PATH);
    let equity = equity_fixture::load(&path).expect("the equity table").to_table();
    let run = spike::run_push_fold(&equity, &[10]).expect("a measured run");
    assert!(run.peak.accounted.is_some_and(|bytes| bytes > 0), "{:?}", run.peak);
    assert!(run.peak.judged().is_some_and(|bytes| bytes > 0));
    assert!(run.seconds >= 0.0);
    assert!(run.gain <= 1e-9, "the certificate holds");
}
