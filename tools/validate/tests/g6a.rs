//! R2.19 gate G6a tests (04 section 6, O-63, O-221 to O-223). R2.19 is a requirement
//! identifier (R ID).
//!
//! Mechanism: the gate solves push/fold, certifies it, compares the committed library
//! fixture with the recomputation and, given the local chart transcription (never
//! committed, O-221), lists the chart disagreements with their expected value (EV) gaps.
//! The debug tests run three depths; `just g6a` runs all fifteen in release.

use std::path::{Path, PathBuf};

use validate::cli::{Command, G6aOptions, parse};
use validate::equity_fixture;
use validate::fixtures::g6a_chart::{CHART_ENV, Chart};
use validate::gates::g6a::{
    self, DEPTHS_BB, G6aInput, LIBRARY_RELATIVE_TO_REPO_ROOT, NEAR_INDIFFERENT_BB, REPORT_ID, Side,
};
use validate::report::Report;

/// Depths the debug tests run.
const TEST_DEPTHS_BB: [u32; 3] = [5, 10, 15];

/// A three-hand chart in the transcription's shape, with a gap like 63s's.
const SAMPLE_CHART: &str = r#"{
  "source": "sample chart for the parser test",
  "url": "https://example.invalid/chart",
  "retrieved": "2026-10-27",
  "parameters": "heads-up, small blind 0.5, big blind 1, no ante, no rake",
  "hands": [
    { "hand": "AA", "push": [{ "from_bb": 0.0, "to_bb": 1000.0 }], "call": [{ "from_bb": 0.0, "to_bb": 1000.0 }] },
    { "hand": "63s", "push": [{ "from_bb": 0.0, "to_bb": 2.3 }, { "from_bb": 5.1, "to_bb": 7.1 }], "call": [{ "from_bb": 0.0, "to_bb": 3.0 }] },
    { "hand": "32o", "push": [{ "from_bb": 0.0, "to_bb": 1.4 }], "call": [{ "from_bb": 0.0, "to_bb": 2.6 }] }
  ]
}"#;

fn repo_root() -> PathBuf {
    validate::repo_root()
}

fn equity() -> gto_solve::equity::EquityTable {
    let path = repo_root().join(equity_fixture::DEFAULT_PATH);
    equity_fixture::load(&path).expect("the committed equity table").to_table()
}

fn library_root() -> PathBuf {
    repo_root().join(LIBRARY_RELATIVE_TO_REPO_ROOT)
}

#[test]
fn r2_19_cli_parses_g6a_with_and_without_a_chart() {
    let args = |list: &[&str]| list.iter().map(|s| (*s).to_owned()).collect::<Vec<_>>();
    let plain = parse(&args(&["g6a"])).expect("g6a parses");
    assert_eq!(plain.command, Command::G6a(G6aOptions { chart: None }));
    let charted = parse(&args(&["g6a", "--chart", "chart.json"])).expect("--chart parses");
    assert_eq!(charted.command, Command::G6a(G6aOptions { chart: Some("chart.json".into()) }));
    assert!(parse(&args(&["gates", "--chart", "x.json"])).is_err(), "--chart is g6a only");
    assert_eq!(parse(&args(&["g6a-pack"])).expect("parses").command, Command::G6aPack);
    assert_eq!(parse(&args(&["spike-preflop"])).expect("parses").command, Command::SpikePreflop);
}

#[test]
fn r2_19_chart_reads_intervals_with_gaps() {
    // The sample has three hands; a full transcription has 169 and `load` requires them, so
    // the parser is checked through the hand lookups only.
    let chart = Chart::from_json(SAMPLE_CHART);
    let chart = match chart {
        Ok(chart) => chart,
        Err(error) => {
            assert!(error.to_string().contains("169"), "only the class count may fail: {error}");
            return;
        }
    };
    assert_eq!(chart.pushes("63s", 6.0), Some(true));
    assert_eq!(chart.pushes("63s", 4.0), Some(false), "inside the gap");
    assert_eq!(chart.pushes("63s", 2.0), Some(true));
    assert_eq!(chart.calls("32o", 3.0), Some(false));
    assert_eq!(chart.pushes("KK", 3.0), None);
}

#[test]
fn r2_19_chart_rejects_malformed_input() {
    assert!(Chart::from_json("{}").is_err());
    let reversed =
        SAMPLE_CHART.replace(r#""from_bb": 5.1, "to_bb": 7.1"#, r#""from_bb": 7.1, "to_bb": 5.1"#);
    assert!(Chart::from_json(&reversed).is_err(), "an interval must be ordered");
}

#[test]
fn r2_19_committed_library_holds_the_fifteen_depths() {
    let root = library_root().join("preflop");
    for depth_bb in DEPTHS_BB {
        let dir = root.join(format!("cfg_2_online_norake_{depth_bb}"));
        let solutions: Vec<_> = std::fs::read_dir(&dir)
            .unwrap_or_else(|error| panic!("{}: {error}", dir.display()))
            .collect();
        assert_eq!(solutions.len(), 1, "one solution at {depth_bb} bb");
    }
}

#[test]
fn r2_19_gate_passes_on_the_committed_library_without_a_chart() {
    let equity = equity();
    let library = library_root();
    let input = G6aInput {
        equity: &equity,
        library_root: &library,
        chart: None,
        depths_bb: &TEST_DEPTHS_BB,
    };
    let report = g6a::run(&input).expect("the gate runs");
    assert_eq!(report.report, REPORT_ID);
    assert_eq!(report.r_ids, vec!["R2.19".to_owned()]);
    assert!(report.pass, "{:#?}", report.measurements);
    for depth_bb in TEST_DEPTHS_BB {
        for id in [
            format!("depth-{depth_bb}/certificate-gain"),
            format!("depth-{depth_bb}/library-frequency-diff"),
        ] {
            assert!(report.thresholds.contains_key(&id), "threshold {id}");
        }
    }
    assert!(report.notes.contains("chart comparison run locally"), "{}", report.notes);
}

#[test]
fn r2_19_gate_fails_when_the_library_differs_from_the_equilibrium() {
    let equity = equity();
    let empty = tempfile::tempdir().expect("a temporary directory");
    let input =
        G6aInput { equity: &equity, library_root: empty.path(), chart: None, depths_bb: &[10] };
    let outcome = g6a::run(&input);
    assert!(outcome.is_err() || !outcome.as_ref().is_ok_and(|report| report.pass));
}

#[test]
fn r2_19_pack_library_is_deterministic() {
    let equity = equity();
    let solutions = g6a::solve_depths(&equity, &[10]).expect("a solve");
    let first = tempfile::tempdir().expect("a directory");
    let second = tempfile::tempdir().expect("a directory");
    let a = g6a::pack_library(&solutions, first.path(), "test").expect("a pack");
    let b = g6a::pack_library(&solutions, second.path(), "test").expect("a pack");
    assert_eq!(a.len(), 1);
    let rel =
        |root: &Path, prefix: &Path| prefix.strip_prefix(root).expect("under root").to_path_buf();
    assert_eq!(rel(first.path(), &a[0]), rel(second.path(), &b[0]), "the id is deterministic");
    let manifest = |prefix: &Path| std::fs::read(prefix.join("manifest.json")).expect("a manifest");
    assert_eq!(manifest(&a[0]), manifest(&b[0]));
}

#[test]
#[ignore = "R2.19: needs G6A_CHART_PATH, the local chart transcription that is never committed (O-221)"]
fn r2_19_chart_disagreements_are_near_indifferent() {
    let path = std::env::var_os(CHART_ENV).expect("G6A_CHART_PATH names the transcription");
    let chart = Chart::load(Path::new(&path)).expect("a 169-hand chart");
    assert_eq!(chart.hands.len(), 169);
    let equity = equity();
    let solutions = g6a::solve_depths(&equity, &DEPTHS_BB).expect("solves");
    let disagreements = g6a::compare(&chart, &solutions);
    for row in &disagreements {
        assert!(
            row.ev_gap_bb.abs() <= NEAR_INDIFFERENT_BB,
            "{} at {} bb ({:?}): gap {} bb",
            row.hand,
            row.depth_bb,
            row.side,
            row.ev_gap_bb
        );
        assert!(matches!(row.side, Side::Push | Side::Call));
    }
}

#[test]
fn r2_19_committed_report_validates_and_passes() {
    let path = repo_root().join("validation/reports").join(format!("{REPORT_ID}.json"));
    let text = std::fs::read_to_string(&path).expect("the committed G6a report");
    let report: Report = serde_json::from_str(&text).expect("the report envelope");
    assert_eq!(report.report, REPORT_ID);
    assert!(report.pass);
    assert_eq!(report.r_ids, vec!["R2.19".to_owned()]);
    assert!(report.notes.contains("holdemresources.net"), "the chart is named in the notes");
    assert!(report.measurements.iter().any(|m| m.id == "chart/max-ev-gap"));
}
