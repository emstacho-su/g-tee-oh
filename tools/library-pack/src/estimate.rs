//! The synthetic library size estimate (R2.7, R-19, O-134): bytes per turn and river runout
//! and per flop tree, measured on seeded synthetic trees in pessimistic, central and
//! optimistic scenarios, at the writer's settings (zstd level 19, 64 KiB frames), at level
//! 3 and at 256 KiB frames (O-129). The report states its method, inputs and seed, is
//! labeled synthetic so nobody reads it as measured solver output, and sets each scenario
//! against the planning figures of 02 section 5.2 and O-51; S20 measures real bytes (O-51).
//!
//! Mechanism: `gto_library::synthetic_tree` generates one runout tree and one flop tree per
//! scenario from the seed, `NodeRecord::from_solved` quantizes them into the records the
//! writer stores, and `encode_file`, the chunk encoder `write_tree_file` calls, turns the
//! records into a file at each setting. Raw bytes are the encoded records before
//! compression; compressed bytes are the whole file, directory frame included. Every data
//! frame is compressed on its own, so bytes grow linearly with nodes and a tree of the
//! planning size measures what a real file of that size would.
//!
//! The command-line seam is `estimate(seed)` plus `SizeEstimate::to_markdown`; `report`
//! renders the Markdown.
//!
//! Lane M (manifest, schema, bench) owns this file.

mod report;

use gto_library::synthetic::{SyntheticParams, TreeLayout, synthetic_tree};
use gto_library::{
    CHUNK_TARGET_BYTES, ChunkOptions, HandSpace, NodeRecord, SolvedNode, ZSTD_LEVEL, encode_file,
};

use crate::error::PackError;

/// Where `just library-size-estimate` writes the report.
pub const ESTIMATE_REPORT_PATH: &str = "validation/reports/library-size-estimate.md";

/// The faster zstd level O-129 asks the estimate to report beside the writer's level.
pub const FAST_ZSTD_LEVEL: i32 = 3;

/// The larger frame target O-129 asks the estimate to report, 256 KiB.
pub const LARGE_FRAME_BYTES: usize = 256 * 1024;

/// The settings every scenario is measured at: the writer's, then the faster level, then
/// the larger frames.
pub const SETTINGS: [ChunkOptions; 3] = [
    ChunkOptions { target_bytes: CHUNK_TARGET_BYTES, zstd_level: ZSTD_LEVEL },
    ChunkOptions { target_bytes: CHUNK_TARGET_BYTES, zstd_level: FAST_ZSTD_LEVEL },
    ChunkOptions { target_bytes: LARGE_FRAME_BYTES, zstd_level: ZSTD_LEVEL },
];

/// Which end of the input ranges a row takes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Scenario {
    /// Dense ranges, mostly mixed strategies, more actions, more nodes.
    Pessimistic,
    /// The planning assumptions of 02 section 5.2.
    Central,
    /// Narrow ranges, mostly pure strategies, fewer actions, fewer nodes.
    Optimistic,
}

impl Scenario {
    /// The scenario's name in the report.
    #[must_use]
    pub const fn label(self) -> &'static str {
        match self {
            Scenario::Pessimistic => "pessimistic",
            Scenario::Central => "central",
            Scenario::Optimistic => "optimistic",
        }
    }
}

/// The inputs of one scenario: how many nodes each tree holds and the shape of every node.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ScenarioInputs {
    /// The scenario.
    pub scenario: Scenario,
    /// Decision nodes along one turn and river; 02 section 5.2 plans about 1,000.
    pub runout_nodes: usize,
    /// Decision nodes of one flop tree, the flop street only.
    pub flop_tree_nodes: usize,
    /// The share of the live combos each node holds; 1 is every combo not on the board.
    pub range_fraction: f64,
    /// The share of hands that play one action at frequency 1.
    pub pure_share: f64,
    /// Actions per node, inclusive bounds.
    pub actions: (u8, u8),
}

/// The three scenarios around the planning figures of 02 section 5.2: about 1,000 decision
/// nodes along one turn and river, up to about 1,000 combos per node and 3 actions. The
/// flop tree node counts bracket the 40 KB to 342 KB per flop tree that 04 section 7
/// implies.
pub const SCENARIOS: [ScenarioInputs; 3] = [
    ScenarioInputs {
        scenario: Scenario::Pessimistic,
        runout_nodes: 1_200,
        flop_tree_nodes: 100,
        range_fraction: 1.0,
        pure_share: 0.25,
        actions: (3, 4),
    },
    ScenarioInputs {
        scenario: Scenario::Central,
        runout_nodes: 1_000,
        flop_tree_nodes: 50,
        range_fraction: 0.85,
        pure_share: 0.5,
        actions: (3, 3),
    },
    ScenarioInputs {
        scenario: Scenario::Optimistic,
        runout_nodes: 800,
        flop_tree_nodes: 20,
        range_fraction: 0.5,
        pure_share: 0.75,
        actions: (2, 3),
    },
];

/// One measured file: a scenario's tree encoded at one setting.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EstimateRow {
    /// The scenario.
    pub scenario: Scenario,
    /// The zstd level.
    pub zstd_level: i32,
    /// Uncompressed record bytes per data frame.
    pub target_bytes: usize,
    /// Nodes in the measured tree.
    pub nodes: usize,
    /// Hand rows over every node of the tree.
    pub hands: usize,
    /// Encoded record bytes before compression.
    pub raw_bytes: usize,
    /// File bytes after compression, directory frame included.
    pub compressed_bytes: usize,
}

/// The estimate: the scenarios measured, and runout rows and flop-tree rows under one seed,
/// one row per scenario and setting in scenario then `SETTINGS` order.
#[derive(Clone, Debug, PartialEq)]
pub struct SizeEstimate {
    /// The generator seed.
    pub seed: u64,
    /// The scenarios measured; `SCENARIOS` for the committed report.
    pub scenarios: Vec<ScenarioInputs>,
    /// One turn and river runout per scenario.
    pub runout: Vec<EstimateRow>,
    /// One flop tree per scenario.
    pub flop_tree: Vec<EstimateRow>,
}

/// Measures every scenario of `SCENARIOS`, the planning sizes, at every setting of
/// `SETTINGS` for `seed`; the command line runs this for the committed report.
///
/// # Errors
///
/// As `estimate_with`.
pub fn estimate(seed: u64) -> Result<SizeEstimate, PackError> {
    estimate_with(seed, &SCENARIOS)
}

/// Measures `scenarios` at every setting of `SETTINGS` for `seed`. Tests pass scaled-down
/// scenarios here, because a debug build compresses the planning sizes in minutes.
///
/// # Errors
///
/// `PackError::Library` when a synthetic node does not quantize or a file does not encode.
pub fn estimate_with(seed: u64, scenarios: &[ScenarioInputs]) -> Result<SizeEstimate, PackError> {
    let mut runout = Vec::with_capacity(scenarios.len() * SETTINGS.len());
    let mut flop_tree = Vec::with_capacity(scenarios.len() * SETTINGS.len());
    for inputs in scenarios {
        runout.extend(measure(seed, inputs, TreeLayout::Runout, inputs.runout_nodes)?);
        flop_tree.extend(measure(seed, inputs, TreeLayout::FlopTree, inputs.flop_tree_nodes)?);
    }
    Ok(SizeEstimate { seed, scenarios: scenarios.to_vec(), runout, flop_tree })
}

/// One tree of `nodes` nodes in `layout`, quantized once and encoded at every setting.
fn measure(
    seed: u64,
    inputs: &ScenarioInputs,
    layout: TreeLayout,
    nodes: usize,
) -> Result<Vec<EstimateRow>, PackError> {
    let tree = synthetic_tree(&SyntheticParams {
        seed,
        nodes,
        hand_space: HandSpace::Postflop1326,
        range_fraction: inputs.range_fraction,
        pure_share: inputs.pure_share,
        actions: inputs.actions,
        layout,
    });
    let records = quantize(&tree)?;
    let raw_bytes = records.iter().map(NodeRecord::encoded_len).sum();
    let hands = tree.iter().map(|node| node.hands.len()).sum();
    SETTINGS
        .iter()
        .map(|opts| {
            let file = encode_file(&records, opts)?;
            Ok(EstimateRow {
                scenario: inputs.scenario,
                zstd_level: opts.zstd_level,
                target_bytes: opts.target_bytes,
                nodes: tree.len(),
                hands,
                raw_bytes,
                compressed_bytes: file.len(),
            })
        })
        .collect()
}

/// The records the writer would store for `tree`, under the pair every key carries.
fn quantize(tree: &[SolvedNode]) -> Result<Vec<NodeRecord>, PackError> {
    let first = tree.first().ok_or_else(|| {
        PackError::Usage("the synthetic tree holds no node to measure".to_owned())
    })?;
    tree.iter()
        .map(|node| NodeRecord::from_solved(node, first.key.pair).map_err(PackError::from))
        .collect()
}

impl SizeEstimate {
    /// The report in Markdown: method, inputs, seed, one table per tree kind and the
    /// comparison with the planning figures.
    #[must_use]
    pub fn to_markdown(&self) -> String {
        report::markdown(self)
    }
}
