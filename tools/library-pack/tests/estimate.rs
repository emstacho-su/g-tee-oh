//! R2.7 size estimate (R-19, O-134): the synthetic estimate reports bytes per runout and per
//! flop tree in three scenarios, compressed below raw, the same for one seed every time, and
//! its report states the seed and that it is synthetic.
//!
//! The scenarios here are the planning scenarios scaled down to a few nodes each, because a
//! debug build compresses the planning sizes (about 1,000 nodes of about 1,000 combos per
//! runout) in minutes; `estimate(seed)`, which the command line runs for the committed
//! report, is the same code over `SCENARIOS`.
//!
//! Lane M (manifest, schema, bench) owns this file.

use library_pack::estimate::{SCENARIOS, SETTINGS, Scenario, ScenarioInputs, estimate_with};

const SEED: u64 = 7;
/// The planning scenarios at one hundredth of their node counts, at least two nodes each.
const SCALE_DOWN: usize = 100;
const MIN_NODES: usize = 2;
/// The house limit on report line width.
const MAX_COLUMNS: usize = 100;

fn scaled() -> Vec<ScenarioInputs> {
    SCENARIOS
        .iter()
        .map(|s| ScenarioInputs {
            runout_nodes: (s.runout_nodes / SCALE_DOWN).max(MIN_NODES),
            flop_tree_nodes: (s.flop_tree_nodes / SCALE_DOWN).max(MIN_NODES),
            ..*s
        })
        .collect()
}

#[test]
fn r2_7_size_estimate_reports_runout_and_flop_tree_bytes() {
    let scenarios = scaled();
    let first = estimate_with(SEED, &scenarios).expect("the estimate runs");
    let again = estimate_with(SEED, &scenarios).expect("the estimate runs again");
    assert_eq!(first, again, "one seed, one result");
    for rows in [&first.runout, &first.flop_tree] {
        assert_eq!(rows.len(), scenarios.len() * SETTINGS.len(), "a row per scenario and setting");
        for scenario in [Scenario::Pessimistic, Scenario::Central, Scenario::Optimistic] {
            assert!(rows.iter().any(|row| row.scenario == scenario), "{scenario:?} is reported");
        }
        for row in rows {
            assert!(row.compressed_bytes > 0, "{row:?} measured something");
            assert!(row.compressed_bytes <= row.raw_bytes, "{row:?} compressed below raw");
            assert!(row.hands >= row.nodes, "{row:?} holds at least one hand per node");
        }
    }
    let report = first.to_markdown();
    for needle in ["runout", "flop tree", "synthetic", &format!("seed {SEED}"), "O-51"] {
        assert!(report.to_lowercase().contains(&needle.to_lowercase()), "the report says {needle}");
    }
    let widest = report.lines().map(str::len).max().unwrap_or(0);
    assert!(widest <= MAX_COLUMNS, "the widest report line is {widest} columns");
}

#[test]
fn r2_7_size_estimate_planning_scenarios_follow_02_section_5_2() {
    let central = SCENARIOS.iter().find(|s| s.scenario == Scenario::Central);
    assert_eq!(central.map(|s| s.runout_nodes), Some(1_000), "about 1,000 nodes per runout");
    assert!(SCENARIOS.iter().all(|s| s.runout_nodes > 0 && s.flop_tree_nodes > 0));
    let writer_setting = SETTINGS.iter().any(|o| {
        o.zstd_level == gto_library::ZSTD_LEVEL && o.target_bytes == gto_library::CHUNK_TARGET_BYTES
    });
    assert!(writer_setting, "the writer's own setting is measured");
}
