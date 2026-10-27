//! The published heads-up push/fold chart gate G6a compares against (R2.19, O-221).
//!
//! The transcription is never committed: the site's terms grant no right to redistribute
//! it (validation/fixtures/PROVENANCE-g6a.md), so the file lives outside the repository
//! and is named by `--chart` or `G6A_CHART_PATH`. Per hand class the chart gives the
//! effective stacks, in big blinds before the blinds, at which the small blind pushes and
//! the big blind calls, as closed intervals; most hands have one interval from the
//! smallest stack up to their threshold, a few have gaps.

use std::fmt;
use std::path::Path;

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

impl Chart {
    /// Reads and checks a chart file: 169 distinct canonical classes, every interval
    /// ordered and positive.
    ///
    /// # Errors
    ///
    /// `ChartError` naming the file and the first problem.
    pub fn load(path: &Path) -> Result<Chart, ChartError> {
        let _ = path;
        Err(ChartError::new("Chart::load is not implemented yet (S19 lane 1)"))
    }

    /// Parses and checks a chart from JSON text, as `load` does.
    ///
    /// # Errors
    ///
    /// `ChartError` naming the first problem.
    pub fn from_json(text: &str) -> Result<Chart, ChartError> {
        let _ = text;
        Err(ChartError::new("Chart::from_json is not implemented yet (S19 lane 1)"))
    }

    /// Whether the chart pushes `hand` at `depth_bb`; `None` for an unknown hand.
    #[must_use]
    pub fn pushes(&self, hand: &str, depth_bb: f64) -> Option<bool> {
        let _ = (hand, depth_bb);
        None
    }

    /// Whether the chart calls an all-in with `hand` at `depth_bb`; `None` for an
    /// unknown hand.
    #[must_use]
    pub fn calls(&self, hand: &str, depth_bb: f64) -> Option<bool> {
        let _ = (hand, depth_bb);
        None
    }
}
