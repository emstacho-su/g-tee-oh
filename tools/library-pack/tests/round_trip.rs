//! R2.8 round trip (O-133): a synthetic dump packs and reads back within the R2.7
//! tolerances, packing the read-back again gives byte-identical files, one dump always
//! packs to the same bytes, and the contract example dump packs.
//!
//! Lane P (pack) owns this file; it goes green once lanes W, R and M have landed too.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use gto_library::{
    FsStore, HandSpace, Manifest, ManifestConfig, ManifestKind, Reader, ReaderOptions,
    SolutionMeta, SolvedNode, Source, SyntheticParams, preflop_prefix, synthetic_tree,
};
use gto_model::v1_configs;
use library_pack::{NodeDump, PackOptions, compare_dumps, export_dump, pack, verify};

const SOLUTION_ID: &str = "5e7a1c2b-3d4f-8a6b-9c0d-1e2f3a4b5c6d";
const CREATED_AT: &str = "2026-10-20T12:00:00Z";
const EXAMPLE_DUMP: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../packages/contracts/schemas/examples/node-dump.json"
);

/// The configuration of the v1 catalog that the nodes' config id names.
fn manifest_config(nodes: &[SolvedNode]) -> ManifestConfig {
    let config_id = &nodes[0].key.config_id;
    let config = v1_configs()
        .into_iter()
        .find(|config| &config.config_id() == config_id)
        .expect("the synthetic tree uses a v1 configuration");
    ManifestConfig {
        format: config.format,
        table_size: config.table_size,
        stake: config.stake.label.clone(),
        depth_cbb: config.depth_cbb,
        straddle: config.straddle,
        ante_cbb: config.ante_cbb,
    }
}

fn synthetic() -> (SolutionMeta, Vec<SolvedNode>) {
    let params = SyntheticParams {
        seed: 7,
        nodes: 40,
        hand_space: HandSpace::Preflop169,
        ..SyntheticParams::default()
    };
    let nodes = synthetic_tree(&params);
    let meta = SolutionMeta {
        id: SOLUTION_ID.to_owned(),
        source: Source::Reference,
        engine_version: "synthetic".to_owned(),
        config: manifest_config(&nodes),
        config_id: nodes[0].key.config_id.clone(),
        pair: nodes[0].key.pair,
        tree_hash: "00".repeat(32),
        seed: None,
        iterations: None,
        exploitability_pct_pot: None,
        synthetic: true,
        created_at: CREATED_AT.to_owned(),
    };
    (meta, nodes)
}

fn options() -> PackOptions {
    PackOptions {
        solution_id: Some(SOLUTION_ID.to_owned()),
        created_at: Some(CREATED_AT.to_owned()),
        synthetic: true,
        ..PackOptions::default()
    }
}

fn write_dump(dir: &Path, name: &str, dump: &NodeDump) -> PathBuf {
    let path = dir.join(name);
    fs::write(&path, serde_json::to_vec_pretty(dump).expect("the dump serializes")).expect("write");
    path
}

/// Every file under `root`, keyed by its path relative to `root`.
fn files_under(root: &Path) -> BTreeMap<PathBuf, Vec<u8>> {
    let mut found = BTreeMap::new();
    let mut pending = vec![root.to_path_buf()];
    while let Some(dir) = pending.pop() {
        for entry in fs::read_dir(&dir).expect("a readable directory") {
            let path = entry.expect("a directory entry").path();
            if path.is_dir() {
                pending.push(path);
            } else {
                let relative = path.strip_prefix(root).expect("under the root").to_path_buf();
                found.insert(relative, fs::read(&path).expect("a readable file"));
            }
        }
    }
    found
}

/// Reads every node of `dump` back from the solution at `prefix` under `root`.
fn read_back(root: &Path, prefix: &str, meta: &SolutionMeta, nodes: &[SolvedNode]) -> NodeDump {
    let reader =
        Reader::new(FsStore::new(root).expect("the root exists"), ReaderOptions::default());
    let handle = reader.open(prefix).expect("the packed solution opens");
    let back: Vec<SolvedNode> = nodes
        .iter()
        .map(|node| {
            let view = reader.node(handle, &node.key).expect("every node reads back");
            view.to_solved(&node.key).expect("the record matches its key")
        })
        .collect();
    export_dump(meta, &back)
}

#[test]
fn r2_8_synthetic_dump_packs_and_reads_back_identically() {
    let (meta, nodes) = synthetic();
    let dump = export_dump(&meta, &nodes);
    let scratch = tempfile::tempdir().expect("a scratch directory");
    let dump_path = write_dump(scratch.path(), "dump.json", &dump);
    let first_root = scratch.path().join("first");
    fs::create_dir(&first_root).expect("mkdir");
    let manifest = pack(&dump_path, &first_root, &options()).expect("the synthetic dump packs");
    let prefix = preflop_prefix(&meta.config_id, SOLUTION_ID);
    verify(&first_root, &prefix, &dump_path).expect("verify agrees with the dump");

    let back = read_back(&first_root, &prefix, &meta, &nodes);
    assert_eq!(compare_dumps(&dump, &back), Vec::<String>::new());

    let back_path = write_dump(scratch.path(), "back.json", &back);
    let second_root = scratch.path().join("second");
    fs::create_dir(&second_root).expect("mkdir");
    let repacked = pack(&back_path, &second_root, &options()).expect("the read-back packs");
    assert_eq!(repacked.chunks, manifest.chunks, "same files and sha256 after a round trip");
    assert_eq!(files_under(&first_root), files_under(&second_root));
}

#[test]
fn r2_8_pack_is_byte_deterministic() {
    let (meta, nodes) = synthetic();
    let scratch = tempfile::tempdir().expect("a scratch directory");
    let dump_path = write_dump(scratch.path(), "dump.json", &export_dump(&meta, &nodes));
    let roots = ["a", "b"].map(|name| scratch.path().join(name));
    let manifests: Vec<Manifest> = roots
        .iter()
        .map(|root| {
            fs::create_dir(root).expect("mkdir");
            pack(&dump_path, root, &PackOptions { synthetic: true, ..PackOptions::default() })
                .expect("the dump packs")
        })
        .collect();
    assert_eq!(manifests[0], manifests[1], "the default id and timestamp follow the dump");
    assert_eq!(files_under(&roots[0]), files_under(&roots[1]));
}

#[test]
fn r2_8_example_dump_packs() {
    let scratch = tempfile::tempdir().expect("a scratch directory");
    let own = PackOptions {
        engine_version: Some("0.1.0".to_owned()),
        seed: Some(1),
        iterations: Some(100),
        ..PackOptions::default()
    };
    let manifest = pack(Path::new(EXAMPLE_DUMP), scratch.path(), &own).expect("the example packs");
    assert_eq!(manifest.kind, ManifestKind::Preflop);
    assert_eq!(manifest.source, Source::Own);
    assert_eq!(
        manifest.config_id.as_ref().map(ToString::to_string).as_deref(),
        Some("cfg_6_online_100")
    );
    assert_eq!(manifest.config.stake, "0.5/1", "the stake label is copied verbatim");
    let chunks = manifest.chunks.expect("a preflop manifest lists chunks");
    assert_eq!(chunks.iter().map(|chunk| chunk.node_count).sum::<u32>(), 1);
}
