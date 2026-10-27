//! R2.20: every committed synthetic solution is a real gto-tree pair tree (O-225, O-226).
//! R2.20 is a requirement identifier (R ID).
//!
//! Mechanism: for every solution directory under the configurations of the sets file, the
//! test rebuilds the pair tree with `gto_tree::PreflopTree::build` from the seed sizing
//! convention of the configuration's format, then reads every node key of that tree back
//! through `gto_library::Reader` from the committed library. A node must hold at least one
//! hand, and the manifest must list exactly the tree's node count, so the library holds the
//! tree, the whole tree and nothing else, and the trainer can navigate it by key.

use std::path::{Path, PathBuf};

use fixture_gen::{
    LIBRARY_RELATIVE_TO_REPO_ROOT, SETS_RELATIVE_TO_REPO_ROOT, SIZING_LIVE_RELATIVE_TO_REPO_ROOT,
    SIZING_ONLINE_RELATIVE_TO_REPO_ROOT, load_sets,
};
use gto_library::{FsStore, MANIFEST_FILE, Manifest, Reader, ReaderOptions};
use gto_model::{GameFormat, NodeKey, v1_configs};
use gto_tree::{PreflopTree, SizingConventionSpec};

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("..")
}

fn spec(format: GameFormat) -> SizingConventionSpec {
    let relative = match format {
        GameFormat::Online => SIZING_ONLINE_RELATIVE_TO_REPO_ROOT,
        GameFormat::Live => SIZING_LIVE_RELATIVE_TO_REPO_ROOT,
    };
    let text = std::fs::read_to_string(repo_root().join(relative)).expect("a sizing spec");
    SizingConventionSpec::from_json(&text).expect("a valid sizing spec")
}

/// The solution ids under one configuration of the committed library, in name order.
fn solution_ids(library: &Path, config_id: &str) -> Vec<String> {
    let dir = library.join("preflop").join(config_id);
    let mut ids: Vec<String> = std::fs::read_dir(&dir)
        .expect("a configuration directory")
        .map(|entry| entry.expect("an entry").file_name().to_string_lossy().into_owned())
        .collect();
    ids.sort();
    ids
}

#[test]
fn r2_20_every_committed_tree_node_reads_back_by_its_gto_tree_key() {
    let library = repo_root().join(LIBRARY_RELATIVE_TO_REPO_ROOT);
    let sets = load_sets(&repo_root().join(SETS_RELATIVE_TO_REPO_ROOT)).expect("the sets file");
    let reader = Reader::new(FsStore::new(&library).expect("a store"), ReaderOptions::default());
    let mut checked = 0;
    for config_id in sets.sets.iter().flat_map(|set| set.config_ids.iter()) {
        let config = v1_configs()
            .into_iter()
            .find(|c| c.config_id().as_str() == config_id)
            .expect("a catalog row");
        for id in solution_ids(&library, config_id) {
            let prefix = format!("preflop/{config_id}/{id}");
            let bytes = std::fs::read(library.join(&prefix).join(MANIFEST_FILE)).expect("bytes");
            let manifest = Manifest::from_json(&bytes).expect("a manifest");
            assert_eq!(manifest.synthetic, Some(true), "{prefix}");
            let pair = manifest.pair.expect("a pair");
            let tree = PreflopTree::build(&spec(config.format), &config, pair).expect("a tree");
            let handle = reader.open(&prefix).expect("the solution opens");
            for node in tree.nodes() {
                let key = NodeKey::preflop(config.config_id(), pair, node.line.clone());
                let view = reader.node(handle, &key).unwrap_or_else(|e| panic!("{key}: {e}"));
                assert_ne!(view.hands().len(), 0, "{key} holds a hand");
            }
            let stored: u64 =
                manifest.chunks.iter().flatten().map(|chunk| u64::from(chunk.node_count)).sum();
            assert_eq!(stored, u64::try_from(tree.nodes().len()).expect("a count"), "{prefix}");
            checked += 1;
        }
    }
    assert_eq!(checked, 45 + 72, "every committed synthetic solution was checked");
}
