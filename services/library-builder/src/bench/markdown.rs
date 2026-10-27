//! The Markdown twin of the flop-line report, rendered from the same JSON value the JSON
//! file holds, so the two cannot disagree (the validate tool's rule for gate reports). The
//! page states the verdict against O-50 first, then the run's identity, the thresholds,
//! one table row per measurement and the notes. Every em dash and en dash is replaced by
//! a hyphen, so text copied from an error message cannot bring one in.

use serde_json::Value;

/// The Markdown twin of a JSON report.
#[must_use]
pub fn render_markdown(report: &Value) -> String {
    let pass = report["pass"].as_bool().unwrap_or(false);
    let verdict = if pass { "pass" } else { "fail" };
    let header = [
        format!("# Flop-line benchmark: {}", text(&report["report"])),
        String::new(),
        "Tool-written by `library-builder bench-report` from the run summaries; rerun the \
         tool to change a number, never edit this page."
            .to_owned(),
        String::new(),
        format!("- Verdict against O-50: {verdict}"),
        format!("- R IDs: {}", list(&report["r_ids"])),
        format!("- Commit: {}", text(&report["commit"])),
        format!("- Date: {}", text(&report["date"])),
        format!("- Machine: {}", machine(&report["machine"])),
        format!("- Toolchain: {}", text(&report["toolchain"])),
        String::new(),
    ];
    let lines: Vec<String> = header
        .into_iter()
        .chain(thresholds(&report["thresholds"]))
        .chain(measurements(&report["measurements"]))
        .chain(["## Notes".to_owned(), String::new(), text(&report["notes"]), String::new()])
        .collect();
    without_long_dashes(&lines.join("\n"))
}

/// A string field, or its JSON text when it is not a string.
fn text(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        Value::Null => "none".to_owned(),
        other => other.to_string(),
    }
}

/// An array's items as text, comma separated.
fn list(value: &Value) -> String {
    value
        .as_array()
        .map(|items| items.iter().map(text).collect::<Vec<_>>().join(", "))
        .unwrap_or_default()
}

/// The machine block in one line.
fn machine(value: &Value) -> String {
    format!(
        "{}, {}, {}, {} logical cores, {} GB of memory",
        text(&value["name"]),
        text(&value["os"]),
        text(&value["cpu"]),
        text(&value["cores"]),
        text(&value["memory_gb"])
    )
}

/// A threshold object as words: `under`, `at most` or `at least` the bound, with the unit.
fn bound(threshold: &Value, strict: bool) -> String {
    let unit = threshold["unit"].as_str().unwrap_or_default();
    match (threshold.get("max"), threshold.get("min")) {
        (Some(max), _) if strict => format!("under {max} {unit}"),
        (Some(max), _) => format!("at most {max} {unit}"),
        (None, Some(min)) => format!("at least {min} {unit}"),
        (None, None) => text(threshold),
    }
}

/// The thresholds section.
fn thresholds(value: &Value) -> Vec<String> {
    let rows = value.as_object().into_iter().flatten().map(|(name, threshold)| {
        let strict = name == "peak_rss_bytes";
        format!("| {name} | {} |", bound(threshold, strict))
    });
    [
        "## Thresholds (O-50)".to_owned(),
        String::new(),
        "| Limit | Bound |".to_owned(),
        "|---|---|".to_owned(),
    ]
    .into_iter()
    .chain(rows)
    .chain([String::new()])
    .collect()
}

/// The measurements table: judged rows carry their threshold and verdict, the others say
/// informational.
fn measurements(value: &Value) -> Vec<String> {
    let rows = value.as_array().into_iter().flatten().map(|measurement| {
        let strict = measurement["strict"].as_bool().unwrap_or(false);
        let (threshold, verdict) = match measurement["pass"].as_bool() {
            Some(pass) => {
                (bound(&measurement["threshold"], strict), if pass { "pass" } else { "fail" })
            }
            None => ("none".to_owned(), "informational"),
        };
        format!(
            "| {} | {} | {} | {threshold} | {verdict} |",
            text(&measurement["id"]),
            text(&measurement["value"]),
            text(&measurement["unit"])
        )
    });
    [
        "## Measurements".to_owned(),
        String::new(),
        "| Id | Value | Unit | Threshold | Verdict |".to_owned(),
        "|---|---|---|---|---|".to_owned(),
    ]
    .into_iter()
    .chain(rows)
    .chain([String::new()])
    .collect()
}

/// `text` with every em dash and en dash replaced by a hyphen.
fn without_long_dashes(text: &str) -> String {
    text.replace(['\u{2014}', '\u{2013}'], "-")
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{bound, render_markdown};

    #[test]
    fn r2_18_bounds_read_as_words_and_dashes_are_dropped() {
        assert_eq!(bound(&json!({"max": 5, "unit": "bytes"}), true), "under 5 bytes");
        assert_eq!(bound(&json!({"max": 5, "unit": "bytes"}), false), "at most 5 bytes");
        assert_eq!(bound(&json!({"min": 1, "unit": "boolean"}), false), "at least 1 boolean");
        let page = render_markdown(&json!({"pass": false, "notes": "a \u{2014} b"}));
        assert!(page.contains("Verdict against O-50: fail"));
        assert!(!page.contains('\u{2014}'));
    }
}
