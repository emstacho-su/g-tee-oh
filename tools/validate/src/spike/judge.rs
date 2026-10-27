//! The spike report (R2.21): the measurements under the fixed ids of `spike::ids`, the
//! O-80 and O-49 verdicts, and the notes S20 compares the Mac run against.
//!
//! Mechanism. Each judged measurement carries its threshold and its own verdict, and the
//! report passes only when every judged measurement passes. Push/fold judges its peak
//! (the largest reading, strictly under 5 GiB; with no reading at all the peak row fails
//! on the value 0, since an unread peak is not a small one) and its certificate gain (at most
//! `CERTIFICATE_GAIN_BB`); its seconds are recorded, not gated (O-80). A measured 100bb run
//! judges its peak (strictly under 4 GiB), its seconds (strictly under 12 hours) and its
//! gain (at most the O-227 target). A 100bb run that errored was not measured: its
//! extrapolated peak and seconds are recorded under the same ids, informational, since an
//! extrapolation proves nothing, and one judged row, `hu100/measured` with the value 0
//! against at least 1, fails the report, so an errored run can never pass O-49. The three
//! peak readings are recorded separately as well, so a reader sees which one was judged
//! (O-228).

use std::collections::BTreeMap;
use std::fmt::Write as _;

use gto_solve::preflop::CERTIFICATE_GAIN_BB;

use super::{
    HU100_LIMIT_BYTES, HU100_LIMIT_SECONDS, HU100_TARGET_PCT_POT, Hu100, PUSH_FOLD_LIMIT_BYTES,
    PeakBytes, R_ID, REPORT_PREFIX, SpikeRun, ids,
};
use crate::gates::GateReport;
use crate::report::{Measurement, Threshold};

/// The unit of byte measurements.
const BYTES: &str = "bytes";

/// The unit of wall-clock measurements.
const SECONDS: &str = "seconds";

/// The unit of iteration counts.
const ITERATIONS: &str = "iterations";

/// The unit of the push/fold certificate.
const BIG_BLINDS: &str = "bb";

/// The unit of the 100bb gain.
const PERCENT_OF_POT: &str = "percent of the starting pot";

/// The unit of the 100bb measured-run count.
const RUNS: &str = "runs";

/// O-49 needs the 100bb run measured once; an errored run counts 0.
const MEASURED_RUNS_REQUIRED: f64 = 1.0;

/// How the notes give a kernel reading that could not be read.
const NOT_READABLE: &str = "not readable";

/// How the notes give the accounted reading of a build without the accounting allocator.
const ACCOUNTED_ABSENT: &str = "unavailable (validate built without the peak-alloc feature)";

/// The id prefix of the push/fold measurements.
const PUSH_FOLD_PREFIX: &str = "push-fold";

/// The id prefix of the 100bb measurements.
const HU100_PREFIX: &str = "hu100";

/// The O-227 label of the 100bb configuration, part of the notes' first line.
const HU100_PLACEHOLDER_LABEL: &str = "O-227 placeholder: heads-up BB-BTN at 100bb, realization \
     factor 1.0 for both seats, rake-free, online seed sizing spec";

/// The pass rules, quoted in the notes.
const PASS_RULES: &str = "Pass rules. O-80: push/fold peak bytes under 5 GiB (the largest of \
     the accounted, VmHWM and cgroup readings) and the G6a certificate gain at most 1e-9 bb at \
     every depth; push/fold wall seconds are recorded, not gated. O-49: the measured 100bb run's \
     peak under 4 GiB, its seconds to target under 12 hours and its larger seat gain at most 0.3 \
     percent of the starting pot; a 100bb run that errored fails the report, and its \
     extrapolated figures are informational only.";

/// The report for `machine` from the two parts; see the module documentation.
#[must_use]
pub fn report(machine: &str, push_fold: &SpikeRun, hu100: &Hu100, notes: &str) -> GateReport {
    let measurements = [push_fold_measurements(push_fold), hu100_measurements(hu100)].concat();
    let thresholds: BTreeMap<String, Threshold> = measurements
        .iter()
        .filter_map(|m| m.threshold.clone().map(|threshold| (m.id.clone(), threshold)))
        .collect();
    let pass = measurements.iter().all(|m| m.pass != Some(false));
    GateReport {
        report: format!("{REPORT_PREFIX}-{machine}"),
        r_ids: vec![R_ID.to_owned()],
        pass,
        thresholds,
        measurements,
        notes: report_notes(push_fold, hu100, notes),
    }
}

/// The push/fold measurements: judged peak and certificate, then the informational ones.
fn push_fold_measurements(run: &SpikeRun) -> Vec<Measurement> {
    let judged = vec![
        peak_measurement(ids::PUSH_FOLD_PEAK_BYTES, &run.peak, PUSH_FOLD_LIMIT_BYTES),
        Measurement::judged(
            ids::PUSH_FOLD_CERTIFICATE,
            run.gain,
            BIG_BLINDS,
            Threshold::at_most(CERTIFICATE_GAIN_BB, BIG_BLINDS),
        ),
        Measurement::informational(ids::PUSH_FOLD_SECONDS, run.seconds, SECONDS),
        iterations(PUSH_FOLD_PREFIX, run.iterations),
    ];
    [judged, readings(PUSH_FOLD_PREFIX, &run.peak)].concat()
}

/// The 100bb measurements: judged when measured, informational when extrapolated.
fn hu100_measurements(hu100: &Hu100) -> Vec<Measurement> {
    match hu100 {
        Hu100::Measured(run) => {
            let judged = vec![
                peak_measurement(ids::HU100_PEAK_BYTES, &run.peak, HU100_LIMIT_BYTES),
                Measurement::judged(
                    ids::HU100_SECONDS,
                    run.seconds,
                    SECONDS,
                    Threshold::under(HU100_LIMIT_SECONDS, SECONDS),
                ),
                Measurement::judged(
                    ids::HU100_GAIN,
                    run.gain,
                    PERCENT_OF_POT,
                    Threshold::at_most(HU100_TARGET_PCT_POT, PERCENT_OF_POT),
                ),
                iterations(HU100_PREFIX, run.iterations),
            ];
            [judged, readings(HU100_PREFIX, &run.peak)].concat()
        }
        Hu100::NotMeasured { peak_bytes, seconds, .. } => [
            Some(Measurement::judged(
                ids::HU100_MEASURED,
                0.0,
                RUNS,
                Threshold::at_least(MEASURED_RUNS_REQUIRED, RUNS),
            )),
            peak_bytes.map(|bytes| {
                Measurement::informational(ids::HU100_PEAK_BYTES, bytes_as_f64(bytes), BYTES)
            }),
            Some(Measurement::informational(ids::HU100_SECONDS, *seconds, SECONDS)),
        ]
        .into_iter()
        .flatten()
        .collect(),
    }
}

/// A run's judged peak against `limit_bytes`: the largest reading, or, when there is no
/// reading at all, a failed verdict on the value 0, so a missing reading never passes.
fn peak_measurement(id: &str, peak: &PeakBytes, limit_bytes: u64) -> Measurement {
    let threshold = Threshold::under(bytes_as_f64(limit_bytes), BYTES);
    match peak.judged() {
        Some(bytes) => Measurement::judged(id, bytes_as_f64(bytes), BYTES, threshold),
        None => Measurement::judged_as(id, 0.0, BYTES, threshold, false),
    }
}

/// The iteration count of a run, informational.
fn iterations(prefix: &str, count: u64) -> Measurement {
    Measurement::informational(&format!("{prefix}/iterations"), bytes_as_f64(count), ITERATIONS)
}

/// The three peak readings of a run, each informational, the absent ones left out.
fn readings(prefix: &str, peak: &PeakBytes) -> Vec<Measurement> {
    [
        ("peak-accounted", peak.accounted),
        ("peak-vmhwm", peak.vm_hwm),
        ("peak-cgroup", peak.cgroup_peak),
    ]
    .into_iter()
    .filter_map(|(name, reading)| {
        reading.map(|bytes| {
            Measurement::informational(&format!("{prefix}/{name}"), bytes_as_f64(bytes), BYTES)
        })
    })
    .collect()
}

/// The notes: the 100bb label first, then the pass rules, the runs and the caller's notes.
fn report_notes(push_fold: &SpikeRun, hu100: &Hu100, caller: &str) -> String {
    let mut notes = match hu100 {
        Hu100::Measured(_) => format!("100bb: measured ({HU100_PLACEHOLDER_LABEL})."),
        Hu100::NotMeasured { reason, .. } => format!(
            "100bb: not measured ({HU100_PLACEHOLDER_LABEL}); {reason}. The report fails \
             O-49 (hu100/measured is 0); the extrapolated 100bb peak and seconds are \
             informational and no gain is reported."
        ),
    };
    notes.push('\n');
    notes.push_str(PASS_RULES);
    let _ = write!(notes, "\n{}", run_line(push_fold));
    if let Hu100::Measured(run) = hu100 {
        let _ = write!(notes, "\n{}", run_line(run));
    }
    if !caller.trim().is_empty() {
        let _ = write!(notes, "\n{}", caller.trim_end());
    }
    notes
}

/// One run as a notes line: label, seconds, iterations, gain and the peak readings.
fn run_line(run: &SpikeRun) -> String {
    let reading = |value: Option<u64>, absent: &str| {
        value.map_or_else(|| absent.to_owned(), |b| format!("{b} bytes"))
    };
    format!(
        "{}: {:.3} s, {} iterations, gain {:e}; peak accounted {}, VmHWM {}, cgroup {}.",
        run.label,
        run.seconds,
        run.iterations,
        run.gain,
        reading(run.peak.accounted, ACCOUNTED_ABSENT),
        reading(run.peak.vm_hwm, NOT_READABLE),
        reading(run.peak.cgroup_peak, NOT_READABLE),
    )
}

/// A byte or iteration count as a report value: exact below 2^53 bytes (8 PiB), far
/// above anything a 5 GiB container holds.
#[allow(clippy::cast_precision_loss, reason = "counts stay far below 2^53")]
fn bytes_as_f64(count: u64) -> f64 {
    count as f64
}

#[cfg(test)]
mod tests {
    use super::{Hu100, PeakBytes, SpikeRun, ids, report};

    fn run(bytes: u64, seconds: f64, gain: f64) -> SpikeRun {
        SpikeRun {
            label: "run".to_owned(),
            seconds,
            iterations: 3,
            gain,
            peak: PeakBytes { accounted: Some(bytes), vm_hwm: Some(bytes + 1), cgroup_peak: None },
        }
    }

    #[test]
    fn r2_21_a_not_measured_hu100_fails_and_its_extrapolation_is_informational() {
        let hu100 = Hu100::NotMeasured {
            reason: "the tree did not build".to_owned(),
            peak_bytes: Some(u64::MAX / 2),
            seconds: 1e9,
        };
        let built = report("dryrun", &run(10, 1.0, 0.0), &hu100, "Container: none");
        assert!(!built.pass, "a 100bb run that was not measured fails the report");
        assert!(built.thresholds.contains_key(ids::HU100_MEASURED));
        assert!(built.notes.starts_with("100bb: not measured"), "{}", built.notes);
        assert!(built.notes.contains("the tree did not build"));
        assert!(built.notes.ends_with("Container: none"));
        let peak = built.measurements.iter().find(|m| m.id == ids::HU100_PEAK_BYTES);
        assert_eq!(peak.and_then(|m| m.pass), None);
        assert!(!built.thresholds.contains_key(ids::HU100_SECONDS));
    }

    #[test]
    fn r2_21_measured_hu100_records_every_reading_and_judges_the_largest() {
        let built = report("dryrun", &run(10, 1.0, 0.0), &Hu100::Measured(run(20, 2.0, 0.1)), "");
        assert!(built.pass);
        assert!(built.notes.starts_with("100bb: measured"));
        let value = |id: &str| built.measurements.iter().find(|m| m.id == id).map(|m| m.value);
        assert_eq!(value(ids::PUSH_FOLD_PEAK_BYTES), Some(11.0));
        assert_eq!(value("push-fold/peak-accounted"), Some(10.0));
        assert_eq!(value("hu100/peak-vmhwm"), Some(21.0));
        assert_eq!(value("hu100/peak-cgroup"), None);
        assert_eq!(value("hu100/iterations"), Some(3.0));
    }

    #[test]
    fn r2_21_a_run_with_no_peak_reading_fails_the_peak_judge() {
        // What a build without the peak-alloc feature reads off Linux: no reading at all.
        let unread = SpikeRun { peak: PeakBytes::default(), ..run(0, 1.0, 0.0) };
        let built = report("m", &unread, &Hu100::Measured(run(20, 2.0, 0.1)), "");
        let peak = built.measurements.iter().find(|m| m.id == ids::PUSH_FOLD_PEAK_BYTES);
        assert_eq!(peak.and_then(|m| m.pass), Some(false), "no reading is not 0 bytes passing");
        assert!(!built.pass);
        assert!(built.notes.contains("accounted unavailable"), "{}", built.notes);
    }

    #[test]
    fn r2_21_a_failed_certificate_or_gain_fails_the_report() {
        let hu100 = Hu100::Measured(run(20, 2.0, 0.1));
        assert!(!report("m", &run(10, 1.0, 1e-6), &hu100, "").pass, "certificate over 1e-9 bb");
        assert!(!report("m", &run(10, 1.0, f64::NAN), &hu100, "").pass, "a NaN certificate");
        let loose = Hu100::Measured(run(20, 2.0, 0.31));
        assert!(!report("m", &run(10, 1.0, 0.0), &loose, "").pass, "gain over 0.3 percent");
    }
}
