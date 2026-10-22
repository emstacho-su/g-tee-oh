//! Registry tests (R2.13, O-144) over a synthetic preflop solution packed through
//! library-pack into a temporary directory, the way the integration fixture does (plan
//! C.9), plus hand-written manifests for the walk's edge cases.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use gto_library::{
    FORMAT_VERSION, HandSpace, LineEntry, MANIFEST_FILE, Manifest, ManifestConfig, ManifestKind,
    SolutionMeta, SolvedNode, Source, SyntheticParams, preflop_prefix, synthetic_tree,
};
use gto_model::{ConfigId, NodeKey, PositionPair, v1_configs};
use library_pack::{PackOptions, export_dump, pack};
use tempfile::TempDir;

use super::Library;
use crate::error::ApiError;

const SOLUTION_ID: &str = "5e7a1c2b-3d4f-8a6b-9c0d-1e2f3a4b5c6d";
const BUILD_ID: &str = "0f0f0f0f-1111-4222-8333-444444444444";
const CREATED_AT: &str = "2026-10-21T12:00:00Z";
const CACHE_BYTES: u64 = 8 * 1024 * 1024;
/// A sha256 of all zeros, where the scan never opens the file it names.
const ZERO_SHA256: &str = "0000000000000000000000000000000000000000000000000000000000000000";

/// A packed synthetic solution: its root, prefix and nodes.
struct Packed {
    _dir: TempDir,
    root: PathBuf,
    prefix: String,
    nodes: Vec<SolvedNode>,
}

fn manifest_config(config_id: &ConfigId) -> ManifestConfig {
    let config = v1_configs()
        .into_iter()
        .find(|config| &config.config_id() == config_id)
        .expect("a catalog configuration");
    ManifestConfig {
        format: config.format,
        table_size: config.table_size,
        stake: config.stake.label.clone(),
        depth_cbb: config.depth_cbb,
        straddle: config.straddle,
        ante_cbb: config.ante_cbb,
    }
}

fn packed() -> Packed {
    let params = SyntheticParams {
        seed: 7,
        nodes: 6,
        hand_space: HandSpace::Preflop169,
        ..Default::default()
    };
    let nodes = synthetic_tree(&params);
    let first = &nodes[0].key;
    let meta = SolutionMeta {
        id: SOLUTION_ID.to_owned(),
        source: Source::Reference,
        engine_version: "synthetic".to_owned(),
        config: manifest_config(&first.config_id),
        config_id: first.config_id.clone(),
        pair: first.pair,
        tree_hash: "00".repeat(32),
        seed: None,
        iterations: None,
        exploitability_pct_pot: Some([0.3, 0.45]),
        synthetic: true,
        created_at: CREATED_AT.to_owned(),
    };
    let dump = export_dump(&meta, &nodes);
    let dir = tempfile::tempdir().expect("a temporary directory");
    let dump_path = dir.path().join("dump.json");
    fs::write(&dump_path, serde_json::to_vec(&dump).expect("serializes")).expect("written");
    let root = dir.path().join("library");
    let options = PackOptions {
        solution_id: Some(SOLUTION_ID.to_owned()),
        created_at: Some(CREATED_AT.to_owned()),
        synthetic: true,
        ..PackOptions::default()
    };
    pack(&dump_path, &root, &options).expect("the synthetic dump packs");
    let prefix = preflop_prefix(&first.config_id, SOLUTION_ID);
    Packed { _dir: dir, root, prefix, nodes }
}

/// A valid flop build manifest under `builds/<config_id>/<pair>/<flop>/<id>/` (the scan
/// reads the manifest only; no tree file exists).
fn write_flop_build(root: &Path, config_id: &ConfigId, pair: PositionPair, id: &str) -> String {
    let manifest = Manifest {
        format_version: FORMAT_VERSION,
        kind: ManifestKind::FlopBuild,
        source: Source::Own,
        id: id.to_owned(),
        engine_version: "0.1.0".to_owned(),
        config: manifest_config(config_id),
        config_id: Some(config_id.clone()),
        pair: Some(pair),
        flop: Some("Ah7d2c".to_owned()),
        flop_weight: Some(1),
        lines: Some(vec![LineEntry {
            line: "r250.c".to_owned(),
            tree_hash: ZERO_SHA256.to_owned(),
            seed: 1,
            iterations: 1,
            exploitability_pct_pot: [0.1, 0.1],
            flop_file: "flop/r250.c.bin.zst".to_owned(),
            sha256: ZERO_SHA256.to_owned(),
        }]),
        runouts: Some(Vec::new()),
        turn_roots: None,
        chunks: None,
        tree_hash: None,
        seed: None,
        iterations: None,
        exploitability_pct_pot: None,
        synthetic: Some(false),
        created_at: CREATED_AT.to_owned(),
    };
    manifest.validate().expect("the hand-written flop build manifest is valid");
    let prefix = format!("builds/{config_id}/{pair}/Ah7d2c/{id}");
    let dir = root.join(&prefix);
    fs::create_dir_all(&dir).expect("the build directory is created");
    let json = manifest.to_json_pretty().expect("serializes");
    fs::write(dir.join(MANIFEST_FILE), json).expect("the manifest is written");
    prefix
}

#[test]
fn r2_13_library_scan_indexes_a_packed_preflop_solution_and_reads_its_nodes() {
    let fixture = packed();
    let first = &fixture.nodes[0].key;

    let library = Library::scan(&fixture.root, CACHE_BYTES).expect("the root scans");

    let stats = library.stats();
    assert_eq!((stats.indexed, stats.unavailable), (1, 0), "{stats:?}");
    assert_eq!((stats.cache_used_bytes, stats.cache_bytes), (0, CACHE_BYTES), "{stats:?}");
    let listed = library.solutions_for(&first.config_id, first.pair);
    assert_eq!(listed.len(), 1, "{listed:?}");
    let info = &listed[0];
    assert_eq!((info.id.as_str(), info.prefix.as_str()), (SOLUTION_ID, fixture.prefix.as_str()));
    assert_eq!(
        (info.kind, info.source, info.synthetic),
        (ManifestKind::Preflop, Source::Reference, true)
    );
    assert_eq!(info.exploitability_pct_pot, Some([0.3, 0.45]));
    assert_eq!(library.info(SOLUTION_ID), Some(info));
    let manifest = library.manifest(SOLUTION_ID).expect("the manifest is kept");
    assert_eq!(manifest.id, SOLUTION_ID);
    assert!(library.manifest(BUILD_ID).is_none());

    for node in &fixture.nodes {
        let view = library.node(SOLUTION_ID, &node.key).expect("every packed node reads");
        assert_eq!(view.actions().len(), node.actions.len());
    }
    assert!(library.stats().cache_used_bytes > 0, "a read caches a frame");
    assert!(format!("{library:?}").contains("indexed: 1"), "{library:?}");
}

#[test]
fn r2_13_library_answers_400_404_and_503() {
    let fixture = packed();
    let first = &fixture.nodes[0].key;
    let library = Library::scan(&fixture.root, CACHE_BYTES).expect("the root scans");

    let bad = library.node("nope", first).expect_err("not a UUID");
    assert!(matches!(bad, ApiError::BadRequest(ref m) if m.contains("nope")), "{bad}");
    let unknown = library.node(BUILD_ID, first).expect_err("not indexed");
    assert!(matches!(unknown, ApiError::NotFound(_)), "{unknown}");
    let absent = NodeKey::preflop(first.config_id.clone(), first.pair, vec![]);
    let missing = library.node(SOLUTION_ID, &absent).expect_err("the root key is not held");
    assert!(matches!(missing, ApiError::NotFound(_)), "{missing}");
    assert_eq!(library.solutions_for(&ConfigId::new("cfg_none").expect("an id"), first.pair), []);

    let chunk = fixture.root.join(&fixture.prefix).join("chunks").join("0000.bin.zst");
    let mut bytes = fs::read(&chunk).expect("the first chunk exists");
    let middle = bytes.len() / 2;
    bytes[middle] ^= 0x01;
    fs::write(&chunk, bytes).expect("the chunk is rewritten");
    let fresh = Library::scan(&fixture.root, CACHE_BYTES).expect("the scan reads manifests only");
    let refused = fresh.node(SOLUTION_ID, first).expect_err("the checksum fails at open");
    assert!(
        matches!(refused, ApiError::Unavailable { ref prefix, .. } if *prefix == fixture.prefix)
    );
    let again = fresh.node(SOLUTION_ID, first).expect_err("every later read is refused");
    assert_eq!(again.status().as_u16(), 503);
    assert_eq!(fresh.stats().unavailable, 1);
    let marked = fresh.unavailable();
    assert_eq!(marked.len(), 1);
    assert_eq!(marked[0].0, fixture.prefix);
}

/// Four things under the packed root that are not solutions (plan C.7): a directory with
/// no manifest, a manifest that does not parse, the packed manifest under another id's
/// directory, and a preflop manifest under `builds/`.
fn plant_non_solutions(fixture: &Packed) {
    let first = &fixture.nodes[0].key;
    let preflop = fixture.root.join("preflop").join(first.config_id.as_str());
    fs::create_dir_all(preflop.join("no-manifest-here")).expect("an empty directory");
    let bogus = preflop.join("00000000-0000-4000-8000-000000000000");
    fs::create_dir_all(&bogus).expect("a directory");
    fs::write(bogus.join(MANIFEST_FILE), b"{ not json").expect("a bogus manifest");
    let original = fs::read(fixture.root.join(&fixture.prefix).join(MANIFEST_FILE)).expect("read");
    let renamed = preflop.join("11111111-0000-4000-8000-000000000000");
    fs::create_dir_all(&renamed).expect("a directory");
    fs::write(renamed.join(MANIFEST_FILE), &original).expect("a manifest under another name");
    let wrong_kind = fixture.root.join("builds").join("x").join("y").join("z").join(SOLUTION_ID);
    fs::create_dir_all(&wrong_kind).expect("a directory");
    fs::write(wrong_kind.join(MANIFEST_FILE), &original).expect("a preflop manifest under builds");
}

#[test]
fn r2_13_library_scan_skips_what_is_not_a_solution() {
    let fixture = packed();
    plant_non_solutions(&fixture);

    let library = Library::scan(&fixture.root, CACHE_BYTES).expect("the root scans");

    assert_eq!(library.stats().indexed, 1, "only the packed solution is indexed");
    assert!(library.info(SOLUTION_ID).is_some());
}

#[test]
fn r2_13_library_scan_of_a_missing_root_is_an_error() {
    let fixture = packed();
    let missing = fixture.root.join("no-such-root");
    let error = Library::scan(&missing, CACHE_BYTES).expect_err("a missing root is an error");
    assert!(error.to_string().contains("no-such-root"), "{error}");
}

#[test]
fn r2_13_library_scan_indexes_a_flop_build_manifest() {
    let fixture = packed();
    let first = &fixture.nodes[0].key;
    let prefix = write_flop_build(&fixture.root, &first.config_id, first.pair, BUILD_ID);

    let library = Library::scan(&fixture.root, CACHE_BYTES).expect("the root scans");

    assert_eq!(library.stats().indexed, 2);
    let build = library.info(BUILD_ID).expect("the build is indexed");
    assert_eq!((build.kind, build.prefix.as_str()), (ManifestKind::FlopBuild, prefix.as_str()));
    assert_eq!((build.source, build.synthetic), (Source::Own, false));
    let listed = library.solutions_for(&first.config_id, first.pair);
    let ids: Vec<&str> = listed.iter().map(|info| info.id.as_str()).collect();
    assert_eq!(ids, vec![BUILD_ID, SOLUTION_ID], "sorted by id");
}

#[test]
fn r2_13_empty_library_holds_nothing_and_never_panics() {
    let library = Library::empty(CACHE_BYTES);
    let stats = library.stats();
    assert_eq!((stats.indexed, stats.unavailable, stats.cache_used_bytes), (0, 0, 0));
    assert_eq!(stats.cache_bytes, CACHE_BYTES);
    let config_id = ConfigId::new("cfg_6_online_100").expect("an id");
    let pair: PositionPair = "BB-BTN".parse().expect("a pair");
    assert_eq!(library.solutions_for(&config_id, pair), Vec::new());
    let key = NodeKey::preflop(config_id, pair, vec![]);
    let error = library.node(SOLUTION_ID, &key).expect_err("nothing is indexed");
    assert!(matches!(error, ApiError::NotFound(_)), "{error}");
    assert_eq!(library.unavailable(), Vec::<(String, String)>::new());
}

#[tokio::test]
async fn r2_13_node_blocking_reads_on_the_blocking_pool() {
    let fixture = packed();
    let key = fixture.nodes[1].key.clone();
    let library = Arc::new(Library::scan(&fixture.root, CACHE_BYTES).expect("scans"));

    let view = Arc::clone(&library)
        .node_blocking(SOLUTION_ID.to_owned(), key.clone())
        .await
        .expect("the node reads");

    assert_eq!(view.actions().len(), fixture.nodes[1].actions.len());
    let direct = library.node(SOLUTION_ID, &key).expect("the same node");
    assert_eq!(view, direct);
}
