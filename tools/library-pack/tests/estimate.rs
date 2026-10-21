//! R2.7 size estimate (R-19, O-134): the synthetic estimate reports bytes per runout and per
//! flop tree in three scenarios, compressed below raw, the same for one seed every time,
//! and its report states the seed and that it is synthetic.
//!
//! Lane M (manifest, schema, bench) owns this file.

use library_pack::estimate;
use library_pack::estimate::Scenario;

const SEED: u64 = 7;

#[test]
fn r2_7_size_estimate_reports_runout_and_flop_tree_bytes() {
    let first = estimate(SEED).expect("the estimate runs");
    assert_eq!(first, estimate(SEED).expect("the estimate runs again"), "one seed, one result");
    for rows in [&first.runout, &first.flop_tree] {
        for scenario in [Scenario::Pessimistic, Scenario::Central, Scenario::Optimistic] {
            assert!(rows.iter().any(|row| row.scenario == scenario), "{scenario:?} is reported");
        }
        for row in rows {
            assert!(row.compressed_bytes > 0, "{row:?} measured something");
            assert!(row.compressed_bytes <= row.raw_bytes, "{row:?} compressed below raw");
        }
    }
    let report = first.to_markdown();
    for needle in ["runout", "flop tree", "synthetic", &format!("seed {SEED}")] {
        assert!(report.to_lowercase().contains(&needle.to_lowercase()), "the report says {needle}");
    }
}
