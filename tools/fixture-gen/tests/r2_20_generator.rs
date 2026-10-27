//! R2.20 synthetic fixture generator tests (O-30, O-57, O-225, O-226). R2.20 is a requirement
//! identifier (R ID).
//!
//! Mechanism: the generator reads `validation/fixtures/synthetic/sets.json`, builds the real
//! gto-tree pair trees and packs seeded synthetic strategies through library-pack, which
//! applies the criterion 2 invariants. Two runs from one seed must be byte-identical and
//! equal to the committed library; every manifest carries `synthetic: true` and its set's
//! seed; and the live sets key the same line to different solutions at 1/3 and 2/5 (R3.21).

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use fixture_gen::{
    LIBRARY_RELATIVE_TO_REPO_ROOT, SETS_RELATIVE_TO_REPO_ROOT, Sets, Stale, Summary, generate,
    load_sets,
};
use gto_model::{Cbb, Position, PositionPair, v1_configs};

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("..")
}

fn sets() -> Sets {
    load_sets(&repo_root().join(SETS_RELATIVE_TO_REPO_ROOT)).expect("the committed sets file")
}

fn run_into(out: &Path) -> Summary {
    generate(&sets(), &repo_root(), out, Stale::Keep).expect("the generator runs")
}

/// Every file under `root`, relative path to bytes.
fn tree_bytes(root: &Path) -> BTreeMap<PathBuf, Vec<u8>> {
    fn walk(root: &Path, dir: &Path, files: &mut BTreeMap<PathBuf, Vec<u8>>) {
        for entry in std::fs::read_dir(dir).expect("a readable directory") {
            let path = entry.expect("an entry").path();
            if path.is_dir() {
                walk(root, &path, files);
            } else {
                let rel = path.strip_prefix(root).expect("under root").to_path_buf();
                files.insert(rel, std::fs::read(&path).expect("a readable file"));
            }
        }
    }
    let mut files = BTreeMap::new();
    walk(root, root, &mut files);
    files
}

fn manifest(prefix: &Path) -> serde_json::Value {
    let text = std::fs::read_to_string(prefix.join("manifest.json")).expect("a manifest");
    serde_json::from_str(&text).expect("manifest JSON")
}

#[test]
fn r2_20_sets_cover_6max_and_both_live_stakes() {
    let sets = sets();
    let ids: Vec<&str> =
        sets.sets.iter().flat_map(|set| set.config_ids.iter().map(String::as_str)).collect();
    for id in [
        "cfg_6_online_100",
        "cfg_6_online_150",
        "cfg_6_online_200",
        "cfg_9_live_13_100",
        "cfg_9_live_25_100",
    ] {
        assert!(ids.contains(&id), "{id} is generated");
    }
    let catalog: Vec<String> =
        v1_configs().iter().map(|c| c.config_id().as_str().to_owned()).collect();
    for id in &ids {
        assert!(catalog.iter().any(|c| c == id), "{id} is a v1 configuration");
    }
}

#[test]
fn r2_20_two_runs_from_one_seed_are_byte_identical() {
    let first = tempfile::tempdir().expect("a directory");
    let second = tempfile::tempdir().expect("a directory");
    let a = run_into(first.path());
    let b = run_into(second.path());
    assert_eq!(a.solutions.len(), b.solutions.len());
    assert_eq!(a.bytes, b.bytes);
    assert_eq!(tree_bytes(first.path()), tree_bytes(second.path()));
}

#[test]
fn r2_20_committed_library_equals_a_fresh_run() {
    let fresh = tempfile::tempdir().expect("a directory");
    let summary = run_into(fresh.path());
    let committed = repo_root().join(LIBRARY_RELATIVE_TO_REPO_ROOT);
    for solution in &summary.solutions {
        let rel = solution.prefix.strip_prefix(fresh.path()).expect("under the output root");
        assert_eq!(
            tree_bytes(&solution.prefix),
            tree_bytes(&committed.join(rel)),
            "{} {} differs from the committed fixture; rerun just fixtures",
            solution.config_id,
            solution.pair
        );
    }
}

#[test]
fn r2_20_every_manifest_is_labeled_synthetic_with_its_seed() {
    let out = tempfile::tempdir().expect("a directory");
    let summary = run_into(out.path());
    assert_ne!(summary.solutions.len(), 0);
    let sets = sets();
    for solution in &summary.solutions {
        let value = manifest(&solution.prefix);
        assert_eq!(value["synthetic"], serde_json::Value::Bool(true), "{}", solution.config_id);
        assert_eq!(value["kind"], "preflop");
        assert_eq!(value["config_id"], solution.config_id.as_str());
        assert_eq!(value["pair"], solution.pair.as_str());
        let seed = sets.sets.iter().find(|s| s.name == solution.set).expect("the set").seed;
        assert_eq!(value["seed"].as_u64(), Some(seed), "{} records its seed", solution.config_id);
    }
}

#[test]
fn r2_20_six_max_set_has_every_pair_and_the_o52_line() {
    let out = tempfile::tempdir().expect("a directory");
    let summary = run_into(out.path());
    let pairs_at = |config: &str| {
        summary
            .solutions
            .iter()
            .filter(|s| s.config_id == config)
            .map(|s| s.pair.clone())
            .collect::<Vec<_>>()
    };
    assert_eq!(pairs_at("cfg_6_online_100").len(), 15);
    assert!(
        pairs_at("cfg_6_online_100").iter().any(|p| p == "BB-BTN"),
        "S20's smoke line (O-52, O-61)"
    );
    assert_eq!(pairs_at("cfg_9_live_13_100").len(), 36);
    assert_eq!(pairs_at("cfg_9_live_25_100").len(), 36);
}

#[test]
fn r2_20_live_sets_key_the_same_line_by_stake() {
    // R3.21 and criterion 11: a 1/3 spot and a 2/5 spot with the same action resolve to
    // different solutions with different caps in big blinds (1.67 versus 1.0).
    let out = tempfile::tempdir().expect("a directory");
    let summary = run_into(out.path());
    let pair = PositionPair::new(Position::Bb, Position::Btn).expect("BB-BTN").to_string();
    let find = |config: &str| {
        summary
            .solutions
            .iter()
            .find(|s| s.config_id == config && s.pair == pair)
            .unwrap_or_else(|| panic!("{config} {pair}"))
    };
    let low = find("cfg_9_live_13_100");
    let high = find("cfg_9_live_25_100");
    assert_ne!(low.solution_id, high.solution_id);
    let cap = |id: &str| {
        v1_configs()
            .into_iter()
            .find(|c| c.config_id().as_str() == id)
            .expect("a catalog row")
            .stake
            .rake_cap_cbb()
    };
    assert_eq!(cap("cfg_9_live_13_100"), Cbb::new(167));
    assert_eq!(cap("cfg_9_live_25_100"), Cbb::new(100));
    let low_manifest = manifest(&low.prefix);
    let high_manifest = manifest(&high.prefix);
    assert_ne!(low_manifest["config"]["stake"], high_manifest["config"]["stake"]);
    assert_eq!(low_manifest["config"]["depth_cbb"], high_manifest["config"]["depth_cbb"]);
    assert_eq!(
        low_manifest["chunks"].as_array().map(Vec::len),
        high_manifest["chunks"].as_array().map(Vec::len)
    );
}
