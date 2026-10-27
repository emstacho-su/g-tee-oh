//! R2.19 unit tests of the G6a comparison, the report and the library round trip. R2.19
//! is a requirement identifier (R ID).

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use gto_solve::equity::EquityTable;
use gto_solve::preflop::SolvedPreflop;

use super::library::{self, depth_cbb};
use super::{G6aInput, LIBRARY_RELATIVE_TO_REPO_ROOT, NEAR_INDIFFERENT_BB, Side, compare, run};
use crate::equity_fixture;
use crate::fixtures::g6a_chart::Chart;

/// A partial chart: AA never pushed, 72o always called, KK always played (agreeing).
const PARTIAL_CHART: &str = r#"{
  "source": "partial test chart",
  "url": "https://example.invalid/chart",
  "retrieved": "2026-10-27",
  "parameters": "heads-up, no ante, no rake",
  "hands": [
    { "hand": "AA", "push": [], "call": [{ "from_bb": 0.0, "to_bb": 1000.0 }] },
    { "hand": "KK", "push": [{ "from_bb": 0.0, "to_bb": 1000.0 }], "call": [{ "from_bb": 0.0, "to_bb": 1000.0 }] },
    { "hand": "72o", "push": [], "call": [{ "from_bb": 0.0, "to_bb": 1000.0 }] }
  ]
}"#;

fn equity() -> &'static EquityTable {
    static TABLE: OnceLock<EquityTable> = OnceLock::new();
    TABLE.get_or_init(|| {
        let path = crate::repo_root().join(equity_fixture::DEFAULT_PATH);
        equity_fixture::load(&path).expect("the committed equity table").to_table()
    })
}

fn ten_bb() -> &'static [SolvedPreflop] {
    static SOLVED: OnceLock<Vec<SolvedPreflop>> = OnceLock::new();
    SOLVED.get_or_init(|| super::solve_depths(equity(), &[10]).expect("a solve"))
}

fn library_root() -> PathBuf {
    crate::repo_root().join(LIBRARY_RELATIVE_TO_REPO_ROOT)
}

#[test]
fn r2_19_compare_lists_each_disagreement_with_its_ev_gap() {
    let chart = Chart::from_json(PARTIAL_CHART).expect("a partial chart");
    let rows = compare(&chart, ten_bb());
    let found: Vec<(&str, Side)> = rows.iter().map(|row| (row.hand.as_str(), row.side)).collect();
    assert_eq!(found, vec![("AA", Side::Push), ("72o", Side::Call)]);
    for row in &rows {
        assert_eq!(row.depth_bb, 10);
        assert!(row.ev_gap_bb < -NEAR_INDIFFERENT_BB, "{row:?} is a clear mistake");
    }
    assert!((rows[0].frequency - 1.0).abs() < 1e-12, "AA always pushes");
}

#[test]
fn r2_19_report_judges_the_chart_and_lists_disagreements() {
    let chart = Chart::from_json(PARTIAL_CHART).expect("a partial chart");
    let root = library_root();
    let input =
        G6aInput { equity: equity(), library_root: &root, chart: Some(&chart), depths_bb: &[10] };
    let report = run(&input).expect("the gate runs");
    assert!(!report.pass, "a chart this wrong fails the near-indifferent rule");
    assert!(report.thresholds.contains_key("chart/max-ev-gap"));
    assert!(
        report
            .measurements
            .iter()
            .any(|m| m.id == "chart/disagreements" && (m.value - 2.0).abs() < 1e-12)
    );
    assert!(report.notes.contains("Disagreement: depth 10 bb, AA push"), "{}", report.notes);
    assert!(report.notes.contains("holdemresources.net"), "the chart is always named");
    assert!(!report.notes.contains("chart comparison run locally"));
}

#[test]
fn r2_19_pack_then_check_round_trips_and_replaces_stale_solutions() {
    let out = tempfile::tempdir().expect("a directory");
    let solutions = ten_bb();
    let stale =
        out.path().join("preflop/cfg_2_online_norake_10/00000000-0000-8000-8000-000000000000");
    std::fs::create_dir_all(&stale).expect("a stale solution directory");
    let prefixes = library::pack(solutions, out.path(), "test").expect("a pack");
    assert!(!stale.exists(), "the stale solution is removed");
    assert!(prefixes[0].join("manifest.json").is_file());
    let check = library::check(out.path(), &solutions[0]).expect("a check");
    assert!(check.differences.is_empty(), "{:?}", check.differences);
    assert!(check.max_frequency_diff <= 1.0 / 255.0);
    std::fs::create_dir_all(out.path().join("preflop/cfg_2_online_norake_10/extra"))
        .expect("a dir");
    let error = library::check(out.path(), &solutions[0]).expect_err("two solutions");
    assert!(error.to_string().contains("2 solutions"), "{error}");
}

#[test]
fn r2_19_dump_reads_the_depth_and_sizes_the_actions() {
    let solution = &ten_bb()[0];
    assert_eq!(depth_cbb(&solution.nodes[0]), 1_000);
    assert_eq!(depth_cbb(&solution.nodes[1]), 1_000);
    let dump = library::dump(solution).expect("a dump");
    let sizes: Vec<u32> = dump.nodes[0].actions.iter().map(|action| action.size_cbb).collect();
    assert_eq!(sizes, vec![0, 1_000]);
    assert_eq!(dump.config.depth_cbb, 1_000);
    assert!(dump.exploitability_pct_pot.iter().flatten().all(|value| *value >= 0.0));
    let empty = SolvedPreflop { nodes: Vec::new(), ..solution.clone() };
    assert!(library::dump(&empty).is_err());
}

#[test]
fn r2_19_a_nan_gain_fails_the_certificate_and_the_report() {
    let clean = library::LibraryCheck {
        prefix: "preflop/cfg_2_online_norake_10/test".to_owned(),
        max_frequency_diff: 0.0,
        differences: Vec::new(),
    };
    for gains_bb in [[f64::NAN, 0.0], [0.0, f64::NAN]] {
        let solution = SolvedPreflop { gains_bb, ..ten_bb()[0].clone() };
        let report = super::gate_report(super::depth_measurements(10, &solution, &clean), "");
        let certificate = report.measurements.iter().find(|m| m.id == "depth-10/certificate-gain");
        assert_eq!(certificate.and_then(|m| m.pass), Some(false), "{gains_bb:?}");
        assert!(certificate.is_some_and(|m| m.value.is_nan()), "the NaN is reported, not hidden");
        assert!(!report.pass, "{gains_bb:?} must fail the report");
    }
}

/// Copies every file under `from` into `to`, keeping the relative paths.
fn copy_tree(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).expect("a directory");
    for entry in std::fs::read_dir(from).expect("a readable directory") {
        let entry = entry.expect("an entry");
        let target = to.join(entry.file_name());
        if entry.path().is_dir() {
            copy_tree(&entry.path(), &target);
        } else {
            std::fs::copy(entry.path(), &target).expect("a copy");
        }
    }
}

#[test]
fn r2_19_a_stale_manifest_tree_hash_fails_the_library_check() {
    let config = "preflop/cfg_2_online_norake_10";
    let scratch = tempfile::tempdir().expect("a directory");
    copy_tree(&library_root().join(config), &scratch.path().join(config));
    let solution_dir = std::fs::read_dir(scratch.path().join(config))
        .expect("the copied configuration")
        .map(|entry| entry.expect("an entry").path())
        .next()
        .expect("one solution");
    let manifest = solution_dir.join("manifest.json");
    let text = std::fs::read_to_string(&manifest).expect("a manifest");
    let stale_hash = "0".repeat(64);
    let start = text.find("\"tree_hash\": \"").expect("a tree_hash") + "\"tree_hash\": \"".len();
    let stale = format!("{}{stale_hash}{}", &text[..start], &text[start + 64..]);
    assert_ne!(stale, text, "the hash was replaced");
    std::fs::write(&manifest, stale).expect("the stale manifest");

    let check = library::check(scratch.path(), &ten_bb()[0]).expect("the stale copy still reads");
    assert!(
        check.differences.iter().any(|line| line.contains("tree_hash")),
        "a stale tree_hash is a difference: {:?}",
        check.differences
    );
    let input =
        G6aInput { equity: equity(), library_root: scratch.path(), chart: None, depths_bb: &[10] };
    let report = run(&input).expect("the gate runs");
    let differences = report.measurements.iter().find(|m| m.id == "depth-10/library-differences");
    assert_eq!(differences.and_then(|m| m.pass), Some(false));
    assert!(!report.pass, "a stale manifest fails the gate at that depth");
}

#[test]
fn r2_19_check_of_a_missing_library_is_an_error() {
    let error =
        library::check(Path::new("no-such-library-root"), &ten_bb()[0]).expect_err("missing");
    assert!(error.to_string().contains("no committed G6a solution"), "{error}");
}
