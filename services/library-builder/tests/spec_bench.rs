//! Job specs, ranges fixtures and the flop-line benchmark report (R2.18, O-50, O-190,
//! O-194, O-200, O-201, O-205). The bench convention is pinned to the S02 seed, the
//! fixtures load and cover their lines, the O-50 verdict holds or misses on the numbers,
//! and the report validates against `validation/reports/report.schema.json`.

mod common;

use std::path::Path;

use common::fixture;
use gto_tree::{SizingConventionSpec, TreeConfig, tree_hash};
use library_builder::bench::{
    O50_PEAK_RSS_BYTES, R_IDS, Verdict, machine, o50_verdict, render_markdown, report_json,
    write_report,
};
use library_builder::error::BuilderError;
use library_builder::job::{LineSummary, RunSummary};
use library_builder::ranges::{FixtureRanges, RangeSource};
use library_builder::settings::BuilderSettings;
use library_builder::spec::{Sweep, SweepLine, inputs, load};
use serde_json::Value;

/// The specs in `validation/fixtures/builder/`.
const SPECS: [&str; 3] =
    ["tiny-bb-btn-srp.spec.json", "bench-bb-btn-srp.json", "bench-bb-btn-srp.16bit.json"];

/// The seed's online base row and its postflop sizes, as the migration writes them.
const SEED_ONLINE_ROW: &str = "('online'::game_format, 2.5, '{\"base_bb\": 3.0, \"per_limper_bb\": 1.0}'::jsonb, 3.0, 4.0, 2.2,";
const SEED_ONLINE_POSTFLOP: &str =
    "'{\"flop\": [0.33, 0.75], \"turn\": [0.75], \"river\": [0.75]}'::jsonb),";

fn repo(relative: &str) -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..").join(relative)
}

#[test]
fn r2_18_every_spec_carries_the_seed_placeholder_convention() {
    let seed = std::fs::read_to_string(repo("db/migrations/20261020001100_seed_catalog.sql"))
        .expect("the seed migration");
    let row = seed.lines().map(str::trim).position(|line| line == SEED_ONLINE_ROW);
    let row = row.expect("the seed's online base row is unchanged");
    assert_eq!(seed.lines().map(str::trim).nth(row + 1), Some(SEED_ONLINE_POSTFLOP));
    let expected = common::placeholder_convention();
    for name in SPECS {
        let loaded = load(&fixture(name)).expect("the spec loads");
        assert_eq!(loaded.spec.convention, expected, "{name}");
        assert_eq!(loaded.spec.config_id, common::CONFIG_ID);
        let spec = SizingConventionSpec::from_json(&loaded.spec.convention.to_string())
            .expect("the convention parses");
        let hash = tree_hash(&TreeConfig::from_spec(&spec).expect("a tree"));
        assert_eq!(hash, common::placeholder_tree_hash());
        let (_, errors) = BuilderSettings::from_rows(
            &loaded.spec.settings.iter().map(|(k, v)| (k.clone(), v.clone())).collect::<Vec<_>>(),
        );
        assert!(errors.is_empty(), "{name}: {errors:?}");
    }
}

#[test]
fn r2_18_the_bench_specs_follow_o50_and_o194() {
    let judged = load(&fixture("bench-bb-btn-srp.json")).expect("loads").spec;
    assert_eq!(judged.k_runouts, 20);
    assert_eq!(judged.settings["target_pct_pot"], 0.3);
    assert_eq!(judged.settings["storage_bits"], 32, "O-200: the judged run is 32-bit");
    assert_eq!(judged.settings["max_seconds_per_line"], 1_800);
    let informational = load(&fixture("bench-bb-btn-srp.16bit.json")).expect("loads").spec;
    assert_eq!(informational.settings["storage_bits"], 16);
    assert_eq!(informational.settings["target_pct_pot"], 0.5, "the O-194 floor");
}

#[test]
fn r2_18_a_spec_resolves_to_build_inputs() {
    let loaded = load(&fixture("tiny-bb-btn-srp.spec.json")).expect("loads");
    let built = inputs(&loaded, 2).expect("the inputs");
    assert_eq!(built.raw_flop.to_string(), common::FLOP);
    assert_eq!(built.pair.to_string(), common::PAIR);
    assert_eq!(built.lines.len(), 1);
    assert_eq!(built.lines[0].0.text(), common::LINE);
    assert_eq!(built.k_runouts, 2);
    assert_eq!(built.seed, 7);
    assert_eq!(built.threads, 2);
    assert_eq!(built.attempt, 1);
    assert!(built.synthetic);
    assert_eq!(built.settings.target_pct_pot, 0.3);
    assert_eq!(built.settings.max_seconds_per_line, 600);
    let weights = built.lines[0].1[0].weights();
    assert_eq!(weights.iter().filter(|w| **w > 0.0).count(), 5, "five combos out of position");
}

#[test]
fn r2_18_a_spec_naming_a_line_the_tree_lacks_is_refused() {
    let dir = tempfile::tempdir().expect("a scratch directory");
    let mut text: Value = serde_json::from_str(
        &std::fs::read_to_string(fixture("tiny-bb-btn-srp.spec.json")).expect("the spec"),
    )
    .expect("JSON");
    text["lines"] = serde_json::json!(["r300.c"]);
    text["ranges_fixture"] = Value::String(fixture("tiny-bb-btn-srp.json").display().to_string());
    let path = dir.path().join("bad.spec.json");
    std::fs::write(&path, text.to_string()).expect("writes");
    let loaded = load(&path).expect("the file itself is well formed");
    let result = inputs(&loaded, 1);
    assert!(matches!(result, Err(BuilderError::UnknownLine { .. })), "{result:?}");
}

#[test]
fn r2_18_ranges_fixtures_load_and_cover_their_lines() {
    for name in ["tiny-bb-btn-srp.json", "bench-bb-btn-srp.ranges.json"] {
        let ranges = FixtureRanges::load(&fixture(name)).expect("the fixture loads");
        let [oop, ip] = ranges
            .ranges(common::CONFIG_ID, common::PAIR, common::LINE)
            .expect("the line is covered");
        assert!(oop.weights().iter().any(|w| *w > 0.0), "{name}");
        assert!(ip.weights().iter().any(|w| *w > 0.0), "{name}");
        let missing = ranges.ranges(common::CONFIG_ID, common::PAIR, "r250.r1000.c");
        assert!(matches!(missing, Err(BuilderError::MissingRanges { .. })), "{name}");
    }
}

#[test]
fn r2_18_a_malformed_ranges_fixture_is_named() {
    let dir = tempfile::tempdir().expect("a scratch directory");
    let mut text: Value = serde_json::from_str(
        &std::fs::read_to_string(fixture("tiny-bb-btn-srp.json")).expect("the fixture"),
    )
    .expect("JSON");
    text["surprise"] = Value::Bool(true);
    let path = dir.path().join("bad.json");
    std::fs::write(&path, text.to_string()).expect("writes");
    let result = FixtureRanges::load(&path);
    assert!(
        matches!(&result, Err(BuilderError::Malformed { path: named, .. }) if named.contains("bad.json")),
        "{:?}",
        result.err()
    );
    let mut duplicated: Value = serde_json::from_str(
        &std::fs::read_to_string(fixture("tiny-bb-btn-srp.json")).expect("the fixture"),
    )
    .expect("JSON");
    let line = duplicated["lines"][0].clone();
    duplicated["lines"].as_array_mut().expect("lines").push(line);
    std::fs::write(&path, duplicated.to_string()).expect("writes");
    assert!(matches!(FixtureRanges::load(&path), Err(BuilderError::Malformed { .. })));
}

fn summary(peak: u64, seconds: f64, gains: [f64; 2]) -> RunSummary {
    RunSummary {
        job_id: "spec".to_owned(),
        build_id: Some("0192f000-0000-7000-8000-000000000020".to_owned()),
        outcome: "staged".to_owned(),
        error: None,
        lines: vec![LineSummary {
            line: "r250.c".to_owned(),
            seconds,
            iterations: 1_200,
            gains_pct_pot: gains,
            stop_reason: "target".to_owned(),
            estimate_bytes: 900_000_000,
            flop_bytes: 700_000,
            runout_bytes: vec![2_000_000; 20],
        }],
        bytes_written: 40_700_000,
        peak_rss_bytes: peak,
        seconds: seconds + 20.0,
    }
}

#[test]
fn r2_18_the_o50_verdict_holds_or_misses_on_the_numbers() {
    let pass = o50_verdict(&summary(4_000_000_000, 1_000.0, [0.25, 0.3]));
    assert!(pass.pass, "{pass:?}");
    assert_eq!(pass.reasons.len(), 3, "one sentence per rule");
    let slow: Verdict = o50_verdict(&summary(4_000_000_000, 1_800.5, [0.25, 0.25]));
    assert!(!slow.pass);
    assert!(slow.reasons.iter().any(|r| r.contains("1800")), "{slow:?}");
    let heavy = o50_verdict(&summary(O50_PEAK_RSS_BYTES, 10.0, [0.1, 0.1]));
    assert!(!heavy.pass, "under 5 GB is strict");
    let loose = o50_verdict(&summary(1_000, 10.0, [0.1, 0.31]));
    assert!(!loose.pass);
    let failed = RunSummary {
        outcome: "failed".to_owned(),
        error: Some("x".to_owned()),
        ..summary(1, 1.0, [0.1, 0.1])
    };
    assert!(!o50_verdict(&failed).pass, "a run that did not stage is a miss");
}

#[test]
fn r2_18_the_bench_report_validates_against_the_report_schema() {
    let schema: Value = serde_json::from_str(
        &std::fs::read_to_string(repo("validation/reports/report.schema.json")).expect("schema"),
    )
    .expect("JSON");
    let validator = jsonschema::validator_for(&schema).expect("the schema compiles");
    let sweep = Sweep {
        flops: 1_755,
        storage_bits: 32,
        cap_bytes: 5_368_709_120,
        lines: vec![SweepLine {
            line: "r250.c".to_owned(),
            flop: "2c2d2h".to_owned(),
            estimate_bytes: 1_500_000_000,
            min_bytes: 900_000_000,
        }],
    };
    let judged = summary(3_000_000_000, 900.0, [0.2, 0.29]);
    let informational = summary(2_000_000_000, 700.0, [0.45, 0.48]);
    let machine = machine("zenbook");
    assert_eq!(machine.name, "zenbook");
    assert!(machine.cores >= 1 && machine.memory_gb >= 1 && !machine.cpu.is_empty());
    let report = report_json(
        &judged,
        Some(&informational),
        Some(&sweep),
        &machine,
        &"a".repeat(40),
        "2026-10-27T12:00:00Z",
    );
    let errors: Vec<String> = validator.iter_errors(&report).map(|e| e.to_string()).collect();
    assert!(errors.is_empty(), "{errors:?}");
    assert_eq!(report["report"], "bench-flop-line");
    assert_eq!(report["pass"], true);
    let ids: Vec<&str> = R_IDS.to_vec();
    assert_eq!(report["r_ids"], serde_json::json!(ids));
    let measurements = report["measurements"].as_array().expect("measurements");
    let judged_rows = measurements.iter().filter(|m| m.get("pass").is_some()).count();
    assert!(judged_rows >= 3, "peak RSS, seconds per line and both gains are judged");
    assert!(
        measurements.iter().any(|m| m["id"].as_str().is_some_and(|id| id.contains("16bit"))),
        "the informational run is listed"
    );
    let failing = report_json(
        &summary(6_000_000_000, 900.0, [0.2, 0.2]),
        None,
        None,
        &machine,
        &"b".repeat(40),
        "2026-10-27T12:00:00Z",
    );
    assert_eq!(failing["pass"], false, "a miss is reported as a miss");
    assert!(validator.iter_errors(&failing).next().is_none());

    let markdown = render_markdown(&report);
    assert!(markdown.contains("O-50"), "{markdown}");
    assert!(markdown.contains("pass"), "{markdown}");
    assert!(!markdown.contains('\u{2014}') && !markdown.contains('\u{2013}'), "no em or en dashes");

    let dir = tempfile::tempdir().expect("a scratch directory");
    write_report(dir.path(), "bench-flop-line-zenbook", &report).expect("writes");
    let written: Value = serde_json::from_str(
        &std::fs::read_to_string(dir.path().join("bench-flop-line-zenbook.json")).expect("json"),
    )
    .expect("JSON");
    assert_eq!(written, report);
    assert_eq!(
        std::fs::read_to_string(dir.path().join("bench-flop-line-zenbook.md")).expect("md"),
        markdown
    );
}
