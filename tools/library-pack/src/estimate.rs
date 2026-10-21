//! The synthetic library size estimate (R2.7, R-19, O-134). It packs seeded synthetic trees
//! (`gto_library::synthetic_tree`) with the real writer and measures the bytes, per runout
//! and per flop tree, in pessimistic, central and optimistic rows, at the writer's settings
//! (zstd level 19, 64 KiB frames) and at level 3 and 256 KiB (O-129). The report states its
//! method, parameters and seed, and is labeled synthetic so nobody reads it as measured
//! solver output; S20 measures real bytes (O-51).
//!
//! The command-line seam is `estimate(seed)` plus `SizeEstimate::to_markdown`; lane M may
//! reshape the row types, which only this file and its test read.
//!
//! Lane M (manifest, schema, bench) owns this file.

#![allow(unused_variables, reason = "S14 red skeleton: lane M replaces the todo!() bodies")]

use crate::error::PackError;

/// Where `just library-size-estimate` writes the report.
pub const ESTIMATE_REPORT_PATH: &str = "validation/reports/library-size-estimate.md";

/// Which end of the input ranges a row takes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Scenario {
    /// Dense ranges, mixed strategies, more actions.
    Pessimistic,
    /// The planning assumptions of 02 section 5.2.
    Central,
    /// Narrow ranges, mostly pure strategies, fewer actions.
    Optimistic,
}

/// One measured configuration.
#[derive(Clone, Debug, PartialEq)]
pub struct EstimateRow {
    /// The scenario.
    pub scenario: Scenario,
    /// The zstd level.
    pub zstd_level: i32,
    /// Uncompressed bytes per data frame.
    pub target_bytes: usize,
    /// Nodes in the measured tree.
    pub nodes: usize,
    /// Encoded record bytes before compression.
    pub raw_bytes: u64,
    /// File bytes after compression, directory included.
    pub compressed_bytes: u64,
}

/// The estimate: runout rows and flop-tree rows under one seed.
#[derive(Clone, Debug, PartialEq)]
pub struct SizeEstimate {
    /// The generator seed.
    pub seed: u64,
    /// One turn and river runout (about 1,000 nodes, 1,326 hands).
    pub runout: Vec<EstimateRow>,
    /// One flop tree (flop-street nodes only).
    pub flop_tree: Vec<EstimateRow>,
}

/// Measures the estimate for `seed`.
///
/// # Errors
///
/// `PackError::Library` when the writer fails.
pub fn estimate(seed: u64) -> Result<SizeEstimate, PackError> {
    todo!("lane M: pack synthetic trees and measure")
}

impl SizeEstimate {
    /// The report in Markdown, with method, parameters, seed and both tables.
    #[must_use]
    pub fn to_markdown(&self) -> String {
        todo!("lane M: Markdown report")
    }
}
