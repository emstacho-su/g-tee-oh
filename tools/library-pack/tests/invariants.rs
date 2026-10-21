//! R2.8 criterion 2 rejection (01 section 6): frequency sums at the 0.001 tolerance, a
//! missing expected value (EV), incomplete configuration metadata, a non-canonical hand
//! label, a duplicate hand or token, structural mismatches, a rejected dump that writes
//! nothing, and agreement with the TypeScript checker over `validation/fixtures/node-dump/`.
//!
//! Every case starts from the contract example dump and changes one field.
//!
//! Lane P (pack) owns this file.

use std::collections::BTreeSet;
use std::fs;
use std::path::Path;

use library_pack::{
    PackError, PackOptions, Rule, Violation, check_invariants, check_structure, pack, parse_dump,
};
use serde::Deserialize;
use serde_json::{Value, json};

const EXAMPLE_DUMP: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../packages/contracts/schemas/examples/node-dump.json"
));
const CORPUS: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../validation/fixtures/node-dump");

fn example() -> Value {
    serde_json::from_str(EXAMPLE_DUMP).expect("the example is JSON (JavaScript Object Notation)")
}

/// Every violation the tool finds in a dump: parse errors, invariants and structure.
fn violations(dump: &Value) -> Vec<Violation> {
    let bytes = serde_json::to_vec(dump).expect("the value serializes");
    match parse_dump(&bytes) {
        Ok(parsed) => [check_invariants(&parsed), check_structure(&parsed)].concat(),
        Err(found) => found,
    }
}

fn rules(found: &[Violation]) -> BTreeSet<Rule> {
    found.iter().map(|violation| violation.rule).collect()
}

/// The example with `edit` applied.
fn edited(edit: impl FnOnce(&mut Value)) -> Value {
    let mut dump = example();
    edit(&mut dump);
    dump
}

#[test]
fn r2_8_rejects_frequency_sum_off_by_0_0011_accepts_0_0009() {
    let off = edited(|d| d["nodes"][0]["hands"][1]["frequencies"] = json!([0.85, 0.05, 0.1011]));
    let found = violations(&off);
    assert!(rules(&found).contains(&Rule::FrequencySum), "found {found:?}");
    assert!(found.iter().any(|v| v.message.contains("72o")), "the sentence names the hand");
    let within = edited(|d| d["nodes"][0]["hands"][1]["frequencies"] = json!([0.85, 0.05, 0.1009]));
    assert_eq!(violations(&within), Vec::<Violation>::new());
}

#[test]
fn r2_8_rejects_missing_ev_for_an_action() {
    let dump = edited(|d| d["nodes"][0]["hands"][0]["ev_bb"] = json!([0, 0.62]));
    let found = violations(&dump);
    assert!(rules(&found).contains(&Rule::Counts), "found {found:?}");
}

#[test]
fn r2_8_rejects_incomplete_config_metadata() {
    for field in ["stake_label", "depth_cbb", "straddle"] {
        let dump = edited(|d| {
            d["config"].as_object_mut().expect("an object").remove(field);
        });
        let found = violations(&dump);
        assert!(rules(&found).contains(&Rule::Metadata), "{field}: found {found:?}");
        assert!(found.iter().any(|v| v.message.contains(field)), "the sentence names {field}");
    }
    let no_time = edited(|d| {
        d.as_object_mut().expect("an object").remove("exported_at");
    });
    assert!(rules(&violations(&no_time)).contains(&Rule::Metadata));
}

#[test]
fn r2_8_rejects_noncanonical_hand_label() {
    for label in ["KAs", "AAs", "AKx", "AsKs"] {
        let dump = edited(|d| d["nodes"][0]["hands"][0]["hand"] = json!(label));
        let found = violations(&dump);
        assert!(rules(&found).contains(&Rule::HandLabel), "{label}: found {found:?}");
    }
}

#[test]
fn r2_8_rejects_duplicate_hand_or_token() {
    let hand = edited(|d| d["nodes"][0]["hands"][1]["hand"] = json!("AKs"));
    assert!(rules(&violations(&hand)).contains(&Rule::Duplicates));
    let token = edited(|d| d["nodes"][0]["actions"][0] = json!({ "token": "c", "size_cbb": 100 }));
    assert!(rules(&violations(&token)).contains(&Rule::Duplicates));
}

#[test]
fn r2_8_rejects_structural_mismatch() {
    let cases = [
        ("unparsable key", "/nodes/0/node_key", json!("cfg_6_online_100/BTN-BB/")),
        ("key of another config", "/nodes/0/node_key", json!("cfg_9_live_13_150/BB-BTN/")),
        ("street not the key's", "/nodes/0/street", json!("flop")),
        ("seat outside the pair", "/nodes/0/to_act", json!("CO")),
        ("one stack", "/nodes/0/stacks_cbb", json!([9900])),
        ("empty pot", "/nodes/0/pot_cbb", json!(0)),
        ("size differs from token", "/nodes/0/actions/2/size_cbb", json!(400)),
        ("reach above one", "/nodes/0/hands/0/reach", json!([1.5, 1])),
    ];
    for (name, pointer, value) in cases {
        let dump = edited(|d| *d.pointer_mut(pointer).expect("the field exists") = value);
        let found = violations(&dump);
        assert!(rules(&found).contains(&Rule::Structural), "{name}: found {found:?}");
    }
    let postflop = edited(|d| d["hand_space"] = json!("postflop_1326"));
    assert!(!violations(&postflop).is_empty(), "v1 packs preflop_169 dumps only (O-132)");
}

#[test]
fn r2_8_rejected_dump_writes_nothing() {
    let scratch = tempfile::tempdir().expect("a scratch directory");
    let bad = edited(|d| d["nodes"][0]["hands"][1]["frequencies"] = json!([0.85, 0.05, 0.2]));
    let dump_path = scratch.path().join("bad.json");
    fs::write(&dump_path, serde_json::to_vec(&bad).expect("serializes")).expect("write");
    let out = scratch.path().join("library");
    fs::create_dir(&out).expect("mkdir");
    let options = PackOptions {
        engine_version: Some("0.1.0".to_owned()),
        seed: Some(1),
        iterations: Some(1),
        ..PackOptions::default()
    };
    match pack(&dump_path, &out, &options) {
        Err(PackError::Rejected(found)) => assert_ne!(found, Vec::new()),
        other => panic!("expected a rejection, got {other:?}"),
    }
    assert_eq!(fs::read_dir(&out).expect("readable").count(), 0, "nothing was written");
}

/// One row of `validation/fixtures/node-dump/cases.json`.
#[derive(Deserialize)]
struct CorpusCase {
    file: String,
    accept: bool,
    rules: Vec<u8>,
}

#[derive(Deserialize)]
struct Corpus {
    cases: Vec<CorpusCase>,
}

#[test]
fn r2_8_rust_checker_agrees_with_corpus() {
    let index = fs::read(Path::new(CORPUS).join("cases.json")).expect("the corpus index exists");
    let corpus: Corpus = serde_json::from_slice(&index).expect("the index parses");
    assert!(!corpus.cases.is_empty(), "the corpus lists cases");
    for case in corpus.cases {
        let bytes = fs::read(Path::new(CORPUS).join(&case.file)).expect("the case file exists");
        let found = match parse_dump(&bytes) {
            Ok(parsed) => check_invariants(&parsed),
            Err(found) => found,
        };
        let numbered: BTreeSet<u8> = found.iter().filter_map(|v| v.rule.number()).collect();
        assert_eq!(numbered.is_empty(), case.accept, "{}: found {found:?}", case.file);
        assert_eq!(numbered, case.rules.iter().copied().collect(), "{}", case.file);
    }
}
