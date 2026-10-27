//! The published heads-up push/fold chart gate G6a compares against (R2.19, O-221).
//!
//! The transcription is never committed: the site's terms grant no right to redistribute
//! it (validation/fixtures/PROVENANCE-g6a.md), so the file lives outside the repository
//! and is named by `--chart` or `G6A_CHART_PATH`. Per hand class the chart gives the
//! effective stacks, in big blinds before the blinds, at which the small blind pushes and
//! the big blind calls, as closed intervals; most hands have one interval from the
//! smallest stack up to their threshold, a few have gaps.

use std::collections::BTreeSet;
use std::fmt;
use std::path::Path;

use gto_model::HandClass;

/// The environment variable naming the local chart transcription (O-221).
pub const CHART_ENV: &str = "G6A_CHART_PATH";

/// A closed interval of effective stacks in big blinds.
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Interval {
    /// The smallest stack inside the interval.
    pub from_bb: f64,
    /// The largest stack inside the interval.
    pub to_bb: f64,
}

/// One hand class of the chart.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ChartHand {
    /// The class label in gto-model's spelling, such as `AKs`.
    pub hand: String,
    /// The stacks at which the small blind pushes.
    pub push: Vec<Interval>,
    /// The stacks at which the big blind calls an all-in.
    pub call: Vec<Interval>,
}

/// The chart with its provenance.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Chart {
    /// The chart's name as published.
    pub source: String,
    /// Where it was read.
    pub url: String,
    /// The date it was read, `YYYY-MM-DD`.
    pub retrieved: String,
    /// The game parameters the chart states.
    pub parameters: String,
    /// The 169 classes.
    pub hands: Vec<ChartHand>,
}

/// Why a chart could not be read.
#[derive(Debug)]
pub struct ChartError {
    message: String,
}

impl ChartError {
    /// An error with `message`.
    #[must_use]
    pub fn new(message: impl Into<String>) -> Self {
        ChartError { message: message.into() }
    }
}

impl fmt::Display for ChartError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for ChartError {}

/// The classes a complete chart lists.
const CLASS_COUNT: usize = HandClass::COUNT as usize;

/// The largest chart file read, far above the about 40 kilobytes a transcription takes.
const MAX_CHART_BYTES: u64 = 4 * 1024 * 1024;

impl Chart {
    /// Reads and checks a chart file: everything `from_json` checks, plus all 169
    /// classes present.
    ///
    /// # Errors
    ///
    /// `ChartError` naming the file and the first problem.
    pub fn load(path: &Path) -> Result<Chart, ChartError> {
        let named = |message: String| ChartError::new(format!("{}: {message}", path.display()));
        let size = std::fs::metadata(path).map_err(|error| named(error.to_string()))?.len();
        if size > MAX_CHART_BYTES {
            return Err(named(format!("{size} bytes is above the {MAX_CHART_BYTES} byte limit")));
        }
        let text = std::fs::read_to_string(path).map_err(|error| named(error.to_string()))?;
        let chart = Chart::from_json(&text).map_err(|error| named(error.message))?;
        if chart.hands.len() != CLASS_COUNT {
            return Err(named(format!("{} classes, not {CLASS_COUNT}", chart.hands.len())));
        }
        Ok(chart)
    }

    /// Parses and checks a chart from JSON text: the provenance fields are not empty,
    /// every class is canonical and listed once, and every interval is finite, ordered
    /// and at or above zero. The class count is left to `load`, so a partial chart parses.
    ///
    /// # Errors
    ///
    /// `ChartError` naming the first problem.
    pub fn from_json(text: &str) -> Result<Chart, ChartError> {
        let chart: Chart = serde_json::from_str(text)
            .map_err(|error| ChartError::new(format!("not a chart: {error}")))?;
        let provenance = [&chart.source, &chart.url, &chart.retrieved, &chart.parameters];
        if provenance.iter().any(|field| field.trim().is_empty()) {
            return Err(ChartError::new("source, url, retrieved and parameters must be set"));
        }
        let mut seen = BTreeSet::new();
        for row in &chart.hands {
            let class: HandClass = row.hand.parse().map_err(|_| {
                ChartError::new(format!("{} is not a canonical hand class", row.hand))
            })?;
            if class.to_string() != row.hand || !seen.insert(class) {
                return Err(ChartError::new(format!("{} is listed twice or misspelled", row.hand)));
            }
            check_intervals(&row.hand, "push", &row.push)?;
            check_intervals(&row.hand, "call", &row.call)?;
        }
        Ok(chart)
    }

    /// Whether the chart pushes `hand` at `depth_bb`; `None` for an unknown hand.
    #[must_use]
    pub fn pushes(&self, hand: &str, depth_bb: f64) -> Option<bool> {
        self.row(hand).map(|row| contains(&row.push, depth_bb))
    }

    /// Whether the chart calls an all-in with `hand` at `depth_bb`; `None` for an
    /// unknown hand.
    #[must_use]
    pub fn calls(&self, hand: &str, depth_bb: f64) -> Option<bool> {
        self.row(hand).map(|row| contains(&row.call, depth_bb))
    }

    /// The row of `hand`.
    fn row(&self, hand: &str) -> Option<&ChartHand> {
        self.hands.iter().find(|row| row.hand == hand)
    }
}

/// Whether `depth_bb` lies inside one of `intervals`, bounds included.
fn contains(intervals: &[Interval], depth_bb: f64) -> bool {
    intervals.iter().any(|interval| (interval.from_bb..=interval.to_bb).contains(&depth_bb))
}

/// Every interval finite, at or above zero and ordered.
fn check_intervals(hand: &str, side: &str, intervals: &[Interval]) -> Result<(), ChartError> {
    let bad = intervals.iter().find(|interval| {
        let finite = interval.from_bb.is_finite() && interval.to_bb.is_finite();
        !finite || interval.from_bb < 0.0 || interval.from_bb > interval.to_bb
    });
    match bad {
        Some(interval) => Err(ChartError::new(format!(
            "{hand} {side} interval {} to {} is not ordered, finite and at or above zero",
            interval.from_bb, interval.to_bb
        ))),
        None => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::{Chart, Interval, contains};

    fn chart(hands: &str) -> String {
        format!(
            r#"{{"source": "s", "url": "u", "retrieved": "2026-10-27", "parameters": "p", "hands": [{hands}]}}"#
        )
    }

    #[test]
    fn r2_19_chart_refuses_duplicates_unknown_classes_and_empty_provenance() {
        let row = r#"{"hand": "AA", "push": [], "call": []}"#;
        assert!(Chart::from_json(&chart(&format!("{row}, {row}"))).is_err(), "AA twice");
        let unknown = r#"{"hand": "KAs", "push": [], "call": []}"#;
        assert!(Chart::from_json(&chart(unknown)).is_err(), "KAs is not canonical");
        let negative = r#"{"hand": "AA", "push": [{"from_bb": -1.0, "to_bb": 2.0}], "call": []}"#;
        assert!(Chart::from_json(&chart(negative)).is_err());
        let empty = chart(row).replace(r#""source": "s""#, r#""source": " ""#);
        assert!(Chart::from_json(&empty).is_err(), "an empty source");
        assert!(Chart::from_json(&chart(row)).is_ok());
    }

    #[test]
    fn r2_19_interval_bounds_are_inclusive() {
        let intervals = [Interval { from_bb: 0.0, to_bb: 2.0 }];
        assert!(contains(&intervals, 2.0));
        assert!(!contains(&intervals, 2.05));
    }

    #[test]
    fn r2_19_load_requires_every_class() {
        let dir = std::env::temp_dir().join(format!("g6a-chart-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("a scratch directory");
        let path = dir.join("partial.json");
        std::fs::write(&path, chart(r#"{"hand": "AA", "push": [], "call": []}"#)).expect("written");
        let error = Chart::load(&path).expect_err("one class is not a chart");
        assert!(error.to_string().contains("169"), "{error}");
        assert!(Chart::load(&dir.join("missing.json")).is_err());
        std::fs::remove_dir_all(&dir).expect("cleaned up");
    }
}
