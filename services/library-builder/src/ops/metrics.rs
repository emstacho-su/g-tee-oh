//! The `/metrics` text, hand-rolled in the Prometheus exposition format 0.0.4 (the O-155
//! pattern): every family in `METRIC_FAMILIES` gets its `# HELP` and `# TYPE` lines even
//! when it has no sample yet, so a scrape always names the whole surface.

use std::fmt::Write as _;

use super::{JOB_OUTCOMES, StatusView, state_name};
use crate::notify::BuilderState;

/// Every state, in the order `builder_state` lists them.
const STATES: [BuilderState; 4] =
    [BuilderState::Running, BuilderState::Throttled, BuilderState::Paused, BuilderState::Idle];

/// The seats of `builder_last_exploitability_pct_pot`, out of position first.
const SEATS: [&str; 2] = ["oop", "ip"];

/// One family: its name, type and help line.
struct Family {
    name: &'static str,
    kind: &'static str,
    help: &'static str,
}

/// Appends a family's header and its samples, each `(labels, value)`; an empty label
/// string writes a bare sample.
fn family(out: &mut String, family: &Family, samples: &[(String, String)]) {
    let Family { name, kind, help } = family;
    // Writing into a String cannot fail, so the results are discarded on purpose.
    let _ = writeln!(out, "# HELP {name} {help}");
    let _ = writeln!(out, "# TYPE {name} {kind}");
    for (labels, value) in samples {
        if labels.is_empty() {
            let _ = writeln!(out, "{name} {value}");
        } else {
            let _ = writeln!(out, "{name}{{{labels}}} {value}");
        }
    }
}

/// One unlabelled sample.
fn bare(value: &impl ToString) -> Vec<(String, String)> {
    vec![(String::new(), value.to_string())]
}

/// One sample per value, labelled `label="<name>"`.
fn labelled<V: ToString>(
    label: &str,
    pairs: impl IntoIterator<Item = (String, V)>,
) -> Vec<(String, String)> {
    pairs
        .into_iter()
        .map(|(name, value)| (format!("{label}=\"{name}\""), value.to_string()))
        .collect()
}

/// The Prometheus text for `view` and the peak resident set size.
#[must_use]
pub fn render_metrics(view: &StatusView, peak_rss_bytes: u64) -> String {
    let mut out = String::new();
    family(
        &mut out,
        &Family { name: "builder_up", kind: "gauge", help: "1 while the builder process runs." },
        &bare(&1),
    );
    let states = STATES.map(|state| (state_name(state).to_owned(), u8::from(state == view.state)));
    family(
        &mut out,
        &Family {
            name: "builder_state",
            kind: "gauge",
            help: "1 for the state the builder is in, 0 for the others.",
        },
        &labelled("state", states),
    );
    let jobs =
        JOB_OUTCOMES.iter().zip(view.jobs).map(|(outcome, count)| ((*outcome).to_owned(), count));
    family(
        &mut out,
        &Family {
            name: "builder_jobs_total",
            kind: "counter",
            help: "Jobs finished since start, by outcome.",
        },
        &labelled("outcome", jobs),
    );
    family(
        &mut out,
        &Family {
            name: "builder_queue_depth",
            kind: "gauge",
            help: "build_job rows per status at the last refresh.",
        },
        &labelled("status", view.queue_depth.iter().cloned()),
    );
    render_storage_and_lines(&mut out, view);
    let gains = view
        .last_exploitability_pct_pot
        .map(|gains| labelled("seat", SEATS.iter().map(|seat| (*seat).to_owned()).zip(gains)))
        .unwrap_or_default();
    family(
        &mut out,
        &Family {
            name: "builder_last_exploitability_pct_pot",
            kind: "gauge",
            help: "Each seat's gain in percent of the pot of the last published build.",
        },
        &gains,
    );
    family(
        &mut out,
        &Family {
            name: "builder_peak_rss_bytes",
            kind: "gauge",
            help: "The process's peak resident set size in bytes.",
        },
        &bare(&peak_rss_bytes),
    );
    out
}

/// The storage and per-line families.
fn render_storage_and_lines(out: &mut String, view: &StatusView) {
    family(
        out,
        &Family {
            name: "builder_storage_used_bytes",
            kind: "gauge",
            help: "Library bytes on the storage ledger.",
        },
        &bare(&view.storage_used_bytes),
    );
    family(
        out,
        &Family {
            name: "builder_storage_budget_bytes",
            kind: "gauge",
            help: "The library budget in force (budget_bytes).",
        },
        &bare(&view.storage_budget_bytes),
    );
    family(
        out,
        &Family {
            name: "builder_line_seconds_sum",
            kind: "counter",
            help: "Wall seconds of every solved line since start.",
        },
        &bare(&view.line_seconds_sum),
    );
    family(
        out,
        &Family {
            name: "builder_line_seconds_count",
            kind: "counter",
            help: "Lines solved since start.",
        },
        &bare(&view.line_count),
    );
    family(
        out,
        &Family {
            name: "builder_line_iterations_total",
            kind: "counter",
            help: "Solver iterations over every solved line since start.",
        },
        &bare(&view.line_iterations),
    );
}

#[cfg(test)]
mod tests {
    use super::render_metrics;
    use crate::ops::{METRIC_FAMILIES, Status};

    #[test]
    fn r2_18_an_empty_view_still_names_every_family() {
        let text = render_metrics(&Status::default().view(), 0);
        for name in METRIC_FAMILIES {
            assert!(text.contains(&format!("# HELP {name} ")), "{name}");
        }
        assert!(!text.contains("builder_last_exploitability_pct_pot{"), "no gains yet");
        assert!(text.contains("builder_state{state=\"idle\"} 1"), "{text}");
        assert!(text.contains("builder_jobs_total{outcome=\"requeued\"} 0"), "{text}");
    }

    #[test]
    fn r2_18_unknown_outcomes_are_not_counted() {
        let status = Status::default();
        status.count_job("exploded");
        assert_eq!(status.view().jobs, [0; 5]);
    }
}
