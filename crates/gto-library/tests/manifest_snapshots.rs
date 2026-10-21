//! R2.7 manifests (A3 section 3, R0.7): snapshots of a preflop manifest and a flop-build
//! manifest as the writer produces them, validation of both, and of the contract examples,
//! against the committed JSON (JavaScript Object Notation) Schema, and the rejection of any
//! format version but 1.
//!
//! The sha256 fields are redacted in the snapshots, so a zstd upgrade that changes the
//! compressed bytes does not churn them; determinism has its own test in library-pack.
//!
//! Lane M (manifest, schema, bench) owns this file and its `.snap` files.

use std::collections::BTreeMap;

use gto_library::{
    ChunkOptions, FORMAT_VERSION, FileRef, HandSpace, LibraryError, LineEntry, MANIFEST_SCHEMA,
    Manifest, ManifestConfig, ManifestKind, ObjectSink, Runout, SolutionMeta, SolvedHand,
    SolvedNode, Source, TurnRoot, write_preflop, write_tree_file,
};
use gto_model::{
    ActionToken, Card, Cbb, ComboId, ConfigId, GameFormat, NodeKey, Position, PositionPair,
    TableSize,
};
use serde_json::Value;

const EXAMPLE_PREFLOP: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../packages/contracts/schemas/examples/manifest.preflop.json"
));
const EXAMPLE_FLOP_BUILD: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../packages/contracts/schemas/examples/manifest.flop-build.json"
));
const BUILD_PREFIX: &str =
    "builds/cfg_6_online_100/BB-BTN/Ah7d2c/6f1d2c3a-4b5e-4f70-8a9b-0c1d2e3f4a5b";
const CREATED_AT: &str = "2026-10-20T12:00:00Z";

/// A sink that keeps every object, so the stored manifest bytes can be compared.
#[derive(Default)]
struct MapSink {
    objects: BTreeMap<String, Vec<u8>>,
}

impl ObjectSink for MapSink {
    fn put(&mut self, path: &str, bytes: &[u8]) -> Result<(), LibraryError> {
        self.objects.insert(path.to_owned(), bytes.to_vec());
        Ok(())
    }
}

fn config_id() -> ConfigId {
    ConfigId::new("cfg_6_online_100").expect("a valid config id")
}

fn pair() -> PositionPair {
    PositionPair::new(Position::Bb, Position::Btn).expect("two different seats")
}

fn config() -> ManifestConfig {
    ManifestConfig {
        format: GameFormat::Online,
        table_size: TableSize::new(6).expect("six seats"),
        stake: "0.5/1".to_owned(),
        depth_cbb: Cbb(10_000),
        straddle: false,
        ante_cbb: Cbb(0),
    }
}

/// Three hand indexes of the space that hold no card of the Ah7d2c Kh 9s board.
fn hand_ids(hand_space: HandSpace) -> Vec<u16> {
    match hand_space {
        HandSpace::Preflop169 => vec![3, 40, 120],
        HandSpace::Postflop1326 => ["KsQs", "JcJd", "9h8h"]
            .iter()
            .map(|label| u16::from(label.parse::<ComboId>().expect("a valid combo")))
            .collect(),
    }
}

/// A two-action node under `key` with three hands.
fn node(key: NodeKey, to_act: Position, pot: Cbb, hand_space: HandSpace) -> SolvedNode {
    let hands = hand_ids(hand_space)
        .into_iter()
        .map(|hand| SolvedHand {
            hand,
            reach: Some([1.0, 0.5]),
            frequencies: vec![0.25, 0.75],
            ev_bb: vec![0.1, 0.4],
        })
        .collect();
    SolvedNode {
        key,
        to_act,
        pot,
        stacks: [Cbb(9_750), Cbb(9_750)],
        actions: vec![(ActionToken::Check, Cbb(0)), (ActionToken::Bet(Cbb(250)), Cbb(250))],
        hand_space,
        hands,
        accuracy_pct_pot: Some(0.3),
    }
}

fn preflop_manifest() -> (Manifest, MapSink) {
    let meta = SolutionMeta {
        id: "a3c9e1f2-7b4d-4e6f-9a0b-2c3d4e5f6a7b".to_owned(),
        source: Source::Reference,
        engine_version: "reference-2026-10".to_owned(),
        config: config(),
        config_id: config_id(),
        pair: pair(),
        tree_hash: "cd".repeat(32),
        seed: None,
        iterations: None,
        exploitability_pct_pot: None,
        synthetic: false,
        created_at: CREATED_AT.to_owned(),
    };
    let nodes: Vec<SolvedNode> = [vec![], vec![ActionToken::Raise(Cbb(250))]]
        .into_iter()
        .map(|line| {
            let key = NodeKey::preflop(config_id(), pair(), line);
            SolvedNode {
                actions: vec![(ActionToken::Fold, Cbb(0)), (ActionToken::Call, Cbb(100))],
                ..node(key, Position::Btn, Cbb(150), HandSpace::Preflop169)
            }
        })
        .collect();
    let mut sink = MapSink::default();
    let manifest = write_preflop(&mut sink, &meta, &nodes, &ChunkOptions::default())
        .expect("the preflop solution writes");
    (manifest, sink)
}

/// The flop tree and the Kh 9s runout tree of r250.c on Ah7d2c, written to a sink.
fn flop_build_files() -> (FileRef, FileRef) {
    let line = vec![ActionToken::Raise(Cbb(250)), ActionToken::Call];
    let flop_key = NodeKey::preflop(config_id(), pair(), line)
        .with_flop("Ah7d2c".parse().expect("a flop"), vec![])
        .expect("the flop is dealt once");
    let card = |text: &str| -> Card { text.parse().expect("a card") };
    let river_key = flop_key
        .clone()
        .with_turn(card("Kh"), vec![ActionToken::Check, ActionToken::Check])
        .and_then(|key| key.with_river(card("9s"), vec![]))
        .expect("the runout is dealt in order");
    let mut sink = MapSink::default();
    let opts = ChunkOptions::default();
    let space = HandSpace::Postflop1326;
    let flop = node(flop_key, Position::Bb, Cbb(550), space);
    let river = node(river_key, Position::Bb, Cbb(550), space);
    let flop_file =
        write_tree_file(&mut sink, BUILD_PREFIX, "flop/r250.c.bin.zst", pair(), &[flop], &opts)
            .expect("the flop tree writes");
    let runout_file = write_tree_file(
        &mut sink,
        BUILD_PREFIX,
        "runouts/Kh9s/r250.c.bin.zst",
        pair(),
        &[river],
        &opts,
    )
    .expect("the runout tree writes");
    (flop_file, runout_file)
}

fn flop_build_manifest() -> Manifest {
    let (flop_file, runout_file) = flop_build_files();
    Manifest {
        format_version: FORMAT_VERSION,
        kind: ManifestKind::FlopBuild,
        source: Source::Own,
        id: "6f1d2c3a-4b5e-4f70-8a9b-0c1d2e3f4a5b".to_owned(),
        engine_version: "0.1.0".to_owned(),
        config: config(),
        config_id: Some(config_id()),
        pair: Some(pair()),
        flop: Some("Ah7d2c".to_owned()),
        flop_weight: Some(12),
        lines: Some(vec![LineEntry {
            line: "r250.c".to_owned(),
            tree_hash: "ef".repeat(32),
            seed: 42,
            iterations: 2_000,
            exploitability_pct_pot: [0.31, 0.28],
            flop_file: flop_file.path,
            sha256: flop_file.sha256,
        }]),
        runouts: Some(vec![Runout {
            turn: "Kh".to_owned(),
            river: "9s".to_owned(),
            files: BTreeMap::from([("r250.c".to_owned(), runout_file)]),
        }]),
        turn_roots: None,
        chunks: None,
        tree_hash: None,
        seed: None,
        iterations: None,
        exploitability_pct_pot: None,
        synthetic: Some(true),
        created_at: CREATED_AT.to_owned(),
    }
}

/// Every schema error for `instance`, empty when it validates.
fn schema_errors(instance: &Value) -> Vec<String> {
    let schema: Value = serde_json::from_str(MANIFEST_SCHEMA).expect("the schema is JSON");
    let validator = jsonschema::validator_for(&schema).expect("the schema compiles");
    validator
        .iter_errors(instance)
        .map(|error| format!("{error} at {}", error.instance_path()))
        .collect()
}

#[test]
fn r2_7_snapshot_preflop_manifest() {
    let (manifest, sink) = preflop_manifest();
    let stored = sink
        .objects
        .get("preflop/cfg_6_online_100/a3c9e1f2-7b4d-4e6f-9a0b-2c3d4e5f6a7b/manifest.json")
        .expect("the writer stores manifest.json");
    let pretty = manifest.to_json_pretty().expect("the manifest serializes");
    assert_eq!(stored.as_slice(), pretty.as_bytes(), "the stored bytes are to_json_pretty");
    insta::assert_json_snapshot!(manifest, { ".chunks[].sha256" => "[sha256]" });
}

#[test]
fn r2_7_snapshot_flop_build_manifest() {
    let manifest = flop_build_manifest();
    manifest.validate().expect("the flop-build manifest validates");
    insta::assert_json_snapshot!(manifest, {
        ".lines[].sha256" => "[sha256]",
        ".runouts[].files.*.sha256" => "[sha256]",
    });
}

#[test]
fn r2_7_manifest_validates_against_schema() {
    let written = [preflop_manifest().0, flop_build_manifest()];
    for manifest in &written {
        let value = serde_json::to_value(manifest).expect("the manifest serializes");
        assert_eq!(
            schema_errors(&value),
            Vec::<String>::new(),
            "{:?} breaks the schema",
            manifest.kind
        );
    }
    for example in [EXAMPLE_PREFLOP, EXAMPLE_FLOP_BUILD] {
        let value: Value = serde_json::from_str(example).expect("the example is JSON");
        assert_eq!(schema_errors(&value), Vec::<String>::new(), "an example breaks the schema");
        Manifest::from_json(example.as_bytes()).expect("the example parses in Rust");
    }
}

/// The `Manifest` error `validate` reports for `manifest`, or a panic naming `what`.
fn manifest_error(what: &str, manifest: &Manifest) -> String {
    match manifest.validate() {
        Err(LibraryError::Manifest(reason)) => reason,
        other => panic!("{what}: expected a Manifest error, got {other:?}"),
    }
}

#[test]
fn r2_7_manifest_rejects_a_flop_out_of_canonical_order() {
    let manifest = flop_build_manifest();
    let unroutable = Manifest { flop: Some("2c7dAh".to_owned()), ..manifest.clone() };
    let reason = manifest_error("a flop out of canonical order", &unroutable);
    assert!(reason.contains("2c7dAh"), "the reason names the flop: {reason}");
    let canonical = Manifest { flop: Some("Ah7d2c".to_owned()), ..manifest };
    canonical.validate().expect("the canonical spelling validates");
}

#[test]
fn r2_7_manifest_rejects_a_line_or_runout_listed_twice() {
    let manifest = flop_build_manifest();
    let lines = manifest.lines.clone().expect("a flop build lists lines");
    let line_twice = Manifest { lines: Some([lines.clone(), lines].concat()), ..manifest.clone() };
    let reason = manifest_error("a line listed twice", &line_twice);
    assert!(reason.contains("r250.c") && reason.contains("more than once"), "{reason}");
    let runouts = manifest.runouts.clone().expect("a flop build lists runouts");
    let runout_twice = Manifest { runouts: Some([runouts.clone(), runouts].concat()), ..manifest };
    let reason = manifest_error("a runout listed twice", &runout_twice);
    assert!(reason.contains("Kh9s") && reason.contains("more than once"), "{reason}");
}

#[test]
fn r2_7_manifest_rejects_format_version_2() {
    let mut value: Value = serde_json::from_str(EXAMPLE_PREFLOP).expect("the example is JSON");
    value["format_version"] = Value::from(2);
    let bytes = serde_json::to_vec(&value).expect("the value serializes");
    match Manifest::from_json(&bytes) {
        Err(LibraryError::UnsupportedFormat(2)) => {}
        other => panic!("expected UnsupportedFormat(2), got {other:?}"),
    }
    assert!(!schema_errors(&value).is_empty(), "the schema rejects format_version 2 too");
}

#[test]
fn r2_7_manifest_rejects_a_flop_file_off_the_writer_layout() {
    let manifest = flop_build_manifest();
    let entry = &manifest.lines.as_ref().expect("a flop build lists lines")[0];
    for bad in ["../x.bin.zst", "flop.bin.zst", "flop/r250.c.bin", "flop/r300.c.bin.zst"] {
        let off = LineEntry { flop_file: bad.to_owned(), ..entry.clone() };
        let moved = Manifest { lines: Some(vec![off]), ..manifest.clone() };
        let reason = manifest_error(bad, &moved);
        assert!(reason.contains("flop_file") && reason.contains(bad), "{reason}");
    }
    manifest.validate().expect("the writer's flop/<line>.bin.zst validates");
    Manifest::from_json(EXAMPLE_FLOP_BUILD.as_bytes()).expect("the committed example validates");
}

#[test]
fn r2_7_manifest_rejects_runout_and_turn_root_files_off_the_writer_layout() {
    let manifest = flop_build_manifest();
    let runout = &manifest.runouts.as_ref().expect("a flop build lists runouts")[0];
    let file = runout.files.get("r250.c").expect("the runout lists r250.c").clone();
    let moved = FileRef { path: "runouts/Kh9s/r300.c.bin.zst".to_owned(), ..file.clone() };
    let files = BTreeMap::from([("r250.c".to_owned(), moved)]);
    let runouts = Some(vec![Runout { files, ..runout.clone() }]);
    let reason =
        manifest_error("a runout file of another line", &Manifest { runouts, ..manifest.clone() });
    assert!(
        reason.contains("runout Kh9s line r250.c path") && reason.contains("r300.c"),
        "{reason}"
    );
    let root = |path: &str| TurnRoot {
        line: "r250.c".to_owned(),
        path: path.to_owned(),
        sha256: file.sha256.clone(),
    };
    let turn_roots = Some(vec![root("turn-roots/r250.c.bin.zst")]);
    Manifest { turn_roots, ..manifest.clone() }
        .validate()
        .expect("the A3 turn-roots path validates");
    let turn_roots = Some(vec![root("flop/r250.c.bin.zst")]);
    let reason = manifest_error("a turn root under flop/", &Manifest { turn_roots, ..manifest });
    assert!(reason.contains("turn_roots line r250.c path") && reason.contains("flop/"), "{reason}");
}
