//! The action-family vector set (R3.6, ADR 0004, PR #25 re-review): preflop lines and the
//! family `ActionFamily::classify` gives each, committed as JSON so the api's drill-family
//! table is tested against Rust's own output and never against a second classifier (the S21
//! seat-list pattern). `UPDATE_VECTORS=1 cargo test -p gto-model --test action_family_vectors`
//! rewrites the file from `classify`; without it the test fails when the file drifts.

use std::fs;
use std::path::PathBuf;

use gto_model::spot_class::ActionFamily;
use gto_model::tokens::parse_line;
use gto_model::types::PositionPair;
use serde_json::{Value, json};

/// Lines chosen to reach every family and the cases the api's old token parser got wrong:
/// a limp then a raise (Rust: facing-open), a blind-versus-blind pair (Rust: blind-vs-blind
/// whatever the line), and a call after the open (Rust: squeeze).
const CASES: [(&str, &str); 16] = [
    ("BB-BTN", ""),
    ("BB-BTN", "r250"),
    ("BB-BTN", "r250.r900"),
    ("BB-BTN", "r250.r900.r2200"),
    ("BB-BTN", "r250.r900.a"),
    ("BB-BTN", "r250.c"),
    ("BB-BTN", "l"),
    ("BB-BTN", "l.r400"),
    ("BB-BTN", "l.r400.c"),
    ("BB-BTN", "s200"),
    ("BB-BTN", "s200.r600"),
    ("SB-BB", ""),
    ("SB-BB", "r300"),
    ("SB-BB", "l"),
    ("BB-UTG", "r250.r800"),
    ("CO-BTN", "r250"),
];

fn vectors_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../validation/fixtures/action-family-vectors.json")
}

fn generated() -> Value {
    let vectors: Vec<Value> = CASES
        .iter()
        .map(|(pair, line)| {
            let pair: PositionPair = pair.parse().expect("a pair");
            let tokens = parse_line(line).expect("a line");
            let family = ActionFamily::classify(pair, &tokens);
            json!({ "pair": pair.to_string(), "line": line, "family": family.as_str() })
        })
        .collect();
    json!({
        "source": "gto_model::spot_class::ActionFamily::classify",
        "regenerate": "UPDATE_VECTORS=1 cargo test -p gto-model --test action_family_vectors",
        "vectors": vectors,
    })
}

#[test]
fn r3_6_committed_action_family_vectors_equal_classify() {
    let expected = generated();
    let path = vectors_path();
    if std::env::var_os("UPDATE_VECTORS").is_some() {
        let text = serde_json::to_string_pretty(&expected).expect("serializes") + "\n";
        fs::write(&path, text).expect("the vector file is written");
    }
    let committed: Value =
        serde_json::from_str(&fs::read_to_string(&path).expect("the vector file exists"))
            .expect("the vector file is JSON");
    assert_eq!(committed, expected, "{} drifted from classify; regenerate it", path.display());
}

#[test]
fn r3_6_the_vectors_reach_every_family() {
    let families: Vec<String> = generated()["vectors"]
        .as_array()
        .expect("vectors")
        .iter()
        .map(|vector| vector["family"].as_str().expect("a family").to_owned())
        .collect();
    for family in ActionFamily::ALL {
        assert!(families.iter().any(|name| name == family.as_str()), "{family} is reached");
    }
}
