//! The Markdown twin of a gate report, rendered from the same [`Report`] value the JSON
//! (JavaScript Object Notation) file is written from, so the two cannot disagree (A2
//! section 6, O-125). Owner: the G1 agent (R2.4). Child module of `report`.
//!
//! Layout. The title names the report id and the R IDs; a two-column table carries the
//! run context (R IDs, commit, date, machine, toolchain, verdict); the notes follow as a
//! paragraph; then one table row per measurement with its value, unit, threshold in
//! words and verdict (`yes`, `no`, or `informational` when the gate recorded it without
//! a rule). Values print with `f64`'s own `Display`, so a reader sees exactly the number
//! the JSON carries. Pipes and line breaks inside a cell are escaped or flattened so a
//! value never breaks the table.

use std::fmt::Write as _;

use super::{Report, Threshold};

/// The Markdown twin of `report` as text, LF line endings, trailing newline.
pub(super) fn render(report: &Report) -> String {
    let machine = &report.machine;
    let verdict = if report.pass { "pass" } else { "FAIL" };
    let mut text = format!("# Gate report {} ({})\n\n", report.report, report.r_ids.join(", "));
    text.push_str("| Field | Value |\n|---|---|\n");
    let rows = [
        ("R IDs", report.r_ids.join(", ")),
        ("Commit", report.commit.clone()),
        ("Date", report.date.clone()),
        (
            "Machine",
            format!(
                "{} ({}, {} cores, {} GB, {})",
                machine.name, machine.cpu, machine.cores, machine.memory_gb, machine.os
            ),
        ),
        ("Toolchain", report.toolchain.clone()),
        ("Verdict", verdict.to_owned()),
    ];
    for (field, value) in rows {
        let _ = writeln!(text, "| {field} | {} |", cell(&value));
    }
    let _ = write!(text, "\n{}\n\n", report.notes.trim());
    text.push_str("| Measurement | Value | Unit | Threshold | Pass |\n|---|---|---|---|---|\n");
    for measurement in &report.measurements {
        let threshold = measurement.threshold.as_ref().map_or_else(|| "none".to_owned(), describe);
        let pass = match measurement.pass {
            Some(true) => "yes",
            Some(false) => "no",
            None => "informational",
        };
        let _ = writeln!(
            text,
            "| {} | {} | {} | {} | {pass} |",
            cell(&measurement.id),
            measurement.value,
            cell(&measurement.unit),
            cell(&threshold)
        );
    }
    text
}

/// A threshold in words: `at most 0.001 chips`, `under 2 percentage_points` for a strict
/// upper bound, `at least 0.5 ratio`, `0.1 to 0.2 frequency`, or `at most 0.3` for the
/// bare-number form.
fn describe(threshold: &Threshold) -> String {
    match threshold {
        Threshold::Number(limit) => format!("at most {limit}"),
        Threshold::Bound { min, max, unit, strict } => {
            let at_most = if *strict { "under" } else { "at most" };
            let bound = match (min, max) {
                (Some(low), Some(high)) => format!("{low} to {high}"),
                (Some(low), None) => format!("at least {low}"),
                (None, Some(high)) => format!("{at_most} {high}"),
                (None, None) => "unbounded".to_owned(),
            };
            match unit {
                Some(unit) => format!("{bound} {unit}"),
                None => bound,
            }
        }
    }
}

/// `text` as one Markdown table cell: pipes escaped and line breaks flattened.
fn cell(text: &str) -> String {
    text.replace('|', "\\|").replace(['\r', '\n'], " ")
}

#[cfg(test)]
mod tests {
    use super::super::{Machine, Measurement, Report, Threshold};
    use super::{describe, render};

    /// R2.11 (review finding F7): a strict upper bound renders as `under`, so the twin
    /// tells `under 2 percentage_points` from `at most 0.3 pct_pot`.
    #[test]
    fn r2_11_markdown_twin_renders_a_strict_bound_as_under() {
        assert_eq!(
            describe(&Threshold::under(2.0, "percentage_points")),
            "under 2 percentage_points"
        );
        assert_eq!(describe(&Threshold::at_most(0.3, "pct_pot")), "at most 0.3 pct_pot");
    }

    /// R2.4: thresholds render in words, and the twin carries the report id, the R IDs,
    /// the commit, the machine line with its pipe escaped, the verdict, the notes and one
    /// row per measurement, LF only.
    #[test]
    fn r2_4_markdown_twin_renders_thresholds_and_rows() {
        assert_eq!(describe(&Threshold::Number(0.3)), "at most 0.3");
        assert_eq!(describe(&Threshold::at_most(0.001, "chips")), "at most 0.001 chips");
        assert_eq!(describe(&Threshold::at_least(0.5, "ratio")), "at least 0.5 ratio");
        assert_eq!(describe(&Threshold::between(0.1, 0.2, "frequency")), "0.1 to 0.2 frequency");
        let bare = Threshold::Bound { min: Some(1.0), max: None, unit: None, strict: false };
        assert_eq!(describe(&bare), "at least 1");

        let report = Report {
            report: "g1-kuhn".to_owned(),
            r_ids: vec!["R2.4".to_owned()],
            machine: Machine {
                name: "test-machine".to_owned(),
                os: "Windows 11".to_owned(),
                cpu: "cpu|model".to_owned(),
                cores: 4,
                memory_gb: 16,
            },
            commit: "0123456789abcdef0123456789abcdef01234567".to_owned(),
            date: "2026-10-20T00:00:00Z".to_owned(),
            toolchain: "rustc 1.90.0".to_owned(),
            pass: false,
            thresholds: [("a".to_owned(), Threshold::at_most(1.0, "chips"))].into(),
            measurements: vec![
                Measurement::judged("a", 2.0, "chips", Threshold::at_most(1.0, "chips")),
                Measurement::informational("b", 0.25, "frequency"),
            ],
            notes: "mode line\n".to_owned(),
        };
        let markdown = render(&report);
        assert!(markdown.starts_with("# Gate report g1-kuhn (R2.4)\n\n"));
        assert!(markdown.contains("| Commit | 0123456789abcdef0123456789abcdef01234567 |\n"));
        let machine = "| Machine | test-machine (cpu\\|model, 4 cores, 16 GB, Windows 11) |\n";
        assert!(markdown.contains(machine), "{markdown}");
        assert!(markdown.contains("| Verdict | FAIL |\n"));
        assert!(markdown.contains("\nmode line\n\n| Measurement |"));
        assert!(markdown.contains("| a | 2 | chips | at most 1 chips | no |\n"));
        assert!(markdown.contains("| b | 0.25 | frequency | none | informational |\n"));
        assert!(markdown.ends_with('\n'));
        assert!(!markdown.contains('\r'), "LF only");
    }
}
