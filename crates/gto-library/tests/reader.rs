//! R2.7 reader (A3 section 5): a corrupted checksum marks the build unavailable and stays
//! so across a restart until the file is restored, an unavailable build refuses node reads,
//! `open` decodes no frame, the frame cache never exceeds `QUERY_CACHE_BYTES` and evicts the
//! least recently used frame, and only format version 1 opens. Two more tests cover the
//! refusals (unknown handle, absent key) and `FsStore` serving the reader and rejecting
//! paths that could leave its root.
//!
//! Every library here is written in memory with the real writer, so these tests go green
//! once lane W's writer and lane M's `Manifest::from_json` land beside lane R's reader.
//!
//! Lane R (reader) owns this file.

use std::collections::BTreeMap;
use std::sync::{Arc, LazyLock};

use gto_library::{
    Availability, ByteLru, ChunkOptions, FORMAT_VERSION, FileRef, FsStore, HandSpace, LibraryError,
    LineEntry, MANIFEST_FILE, Manifest, ManifestConfig, ManifestKind, MemStore, ObjectSink,
    ObjectStore, Reader, ReaderOptions, Runout, SolutionMeta, SolvedHand, SolvedNode, Source,
    sha256_hex, write_preflop, write_tree_file,
};
use gto_model::{
    ActionToken, Cbb, ComboId, ConfigId, GameFormat, NodeKey, Position, PositionPair, TableSize,
};
use proptest::prelude::*;
use serde_json::Value;

const SOLUTION_ID: &str = "11111111-2222-4333-8444-555555555555";
const BUILD_PREFIX: &str =
    "builds/cfg_6_online_100/BB-BTN/Ah7d2c/11111111-2222-4333-8444-666666666666";
const NODE_COUNT: u32 = 40;
/// Small frames, so the solution spans several and the cache has something to evict.
const SMALL_FRAMES: ChunkOptions = ChunkOptions { target_bytes: 2_048, zstd_level: 3 };
/// A cache large enough for everything.
const ROOMY: ReaderOptions = ReaderOptions { cache_bytes: 1 << 30 };

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

/// A two-action node under `key` holding `hands`.
fn node(key: NodeKey, hand_space: HandSpace, hands: &[u16]) -> SolvedNode {
    SolvedNode {
        key,
        to_act: Position::Bb,
        pot: Cbb(550),
        stacks: [Cbb(9_750), Cbb(9_750)],
        actions: vec![(ActionToken::Check, Cbb(0)), (ActionToken::Bet(Cbb(250)), Cbb(250))],
        hand_space,
        hands: hands
            .iter()
            .map(|&hand| SolvedHand {
                hand,
                reach: None,
                frequencies: vec![0.4, 0.6],
                ev_bb: vec![0.2, f64::from(hand) / 100.0],
            })
            .collect(),
        accuracy_pct_pot: None,
    }
}

/// A preflop solution of `NODE_COUNT` nodes in small frames, with its prefix and keys.
struct Library {
    store: MemStore,
    prefix: String,
    manifest: Manifest,
    keys: Vec<NodeKey>,
}

fn preflop_library() -> Library {
    let hands: Vec<u16> = (0..60).collect();
    let nodes: Vec<SolvedNode> = (0..NODE_COUNT)
        .map(|i| {
            let key = NodeKey::preflop(config_id(), pair(), vec![ActionToken::Raise(Cbb(200 + i))]);
            node(key, HandSpace::Preflop169, &hands)
        })
        .collect();
    let meta = SolutionMeta {
        id: SOLUTION_ID.to_owned(),
        source: Source::Reference,
        engine_version: "reference-test".to_owned(),
        config: config(),
        config_id: config_id(),
        pair: pair(),
        tree_hash: "aa".repeat(32),
        seed: None,
        iterations: None,
        exploitability_pct_pot: None,
        synthetic: true,
        created_at: "2026-10-20T12:00:00Z".to_owned(),
    };
    let mut store = MemStore::new();
    let manifest =
        write_preflop(&mut store, &meta, &nodes, &SMALL_FRAMES).expect("the solution writes");
    let prefix = gto_library::preflop_prefix(&config_id(), SOLUTION_ID);
    Library { store, prefix, manifest, keys: nodes.into_iter().map(|n| n.key).collect() }
}

static LIBRARY: LazyLock<Library> = LazyLock::new(preflop_library);

/// `store` with the object at `path` replaced by `bytes`.
fn with_object(store: &MemStore, path: &str, bytes: &[u8]) -> MemStore {
    let mut copy = store.clone();
    copy.put(path, bytes).expect("the path is valid");
    copy
}

/// A flop key on Ah7d2c after r250.c and a river key on the Kh 9s runout of it.
fn flop_keys() -> (NodeKey, NodeKey) {
    let line = vec![ActionToken::Raise(Cbb(250)), ActionToken::Call];
    let flop_key = NodeKey::preflop(config_id(), pair(), line)
        .with_flop("Ah7d2c".parse().expect("a flop"), vec![])
        .expect("the flop is dealt once");
    let river_key = flop_key
        .clone()
        .with_turn("Kh".parse().expect("a card"), vec![ActionToken::Check, ActionToken::Check])
        .and_then(|key| key.with_river("9s".parse().expect("a card"), vec![]))
        .expect("the runout is dealt in order");
    (flop_key, river_key)
}

/// The manifest of a flop build made of the two given files.
fn flop_build_manifest(flop_ref: FileRef, runout_ref: FileRef) -> Manifest {
    Manifest {
        format_version: FORMAT_VERSION,
        kind: ManifestKind::FlopBuild,
        source: Source::Own,
        id: "11111111-2222-4333-8444-666666666666".to_owned(),
        engine_version: "0.1.0".to_owned(),
        config: config(),
        config_id: Some(config_id()),
        pair: Some(pair()),
        flop: Some("Ah7d2c".to_owned()),
        flop_weight: Some(12),
        lines: Some(vec![LineEntry {
            line: "r250.c".to_owned(),
            tree_hash: "bb".repeat(32),
            seed: 1,
            iterations: 10,
            exploitability_pct_pot: [0.3, 0.3],
            flop_file: flop_ref.path,
            sha256: flop_ref.sha256,
        }]),
        runouts: Some(vec![Runout {
            turn: "Kh".to_owned(),
            river: "9s".to_owned(),
            files: BTreeMap::from([("r250.c".to_owned(), runout_ref)]),
        }]),
        turn_roots: None,
        chunks: None,
        tree_hash: None,
        seed: None,
        iterations: None,
        exploitability_pct_pot: None,
        synthetic: Some(true),
        created_at: "2026-10-20T12:00:00Z".to_owned(),
    }
}

/// A flop build with one flop file and one runout file, and the keys each holds.
fn flop_build() -> (MemStore, NodeKey, NodeKey) {
    let combos: Vec<u16> = ["KsQs", "JcJd", "9h8h"]
        .iter()
        .map(|label| u16::from(label.parse::<ComboId>().expect("a combo")))
        .collect();
    let (flop_key, river_key) = flop_keys();
    let mut store = MemStore::new();
    let space = HandSpace::Postflop1326;
    let flop_ref = write_tree_file(
        &mut store,
        BUILD_PREFIX,
        "flop/r250.c.bin.zst",
        pair(),
        &[node(flop_key.clone(), space, &combos)],
        &SMALL_FRAMES,
    )
    .expect("the flop tree writes");
    let runout_ref = write_tree_file(
        &mut store,
        BUILD_PREFIX,
        "runouts/Kh9s/r250.c.bin.zst",
        pair(),
        &[node(river_key.clone(), space, &combos)],
        &SMALL_FRAMES,
    )
    .expect("the runout tree writes");
    let manifest = flop_build_manifest(flop_ref, runout_ref);
    let json = serde_json::to_vec_pretty(&manifest).expect("the manifest serializes");
    store.put(&format!("{BUILD_PREFIX}/{MANIFEST_FILE}"), &json).expect("valid path");
    (store, flop_key, river_key)
}

#[test]
fn r2_7_corrupted_checksum_marks_build_unavailable() {
    let library = &*LIBRARY;
    let path = format!("{}/chunks/0000.bin.zst", library.prefix);
    let original = library.store.bytes(&path).expect("the first chunk exists").to_vec();
    let mut flipped = original.clone();
    let middle = flipped.len() / 2;
    flipped[middle] ^= 0x01;
    let corrupt = with_object(&library.store, &path, &flipped);
    let expected = library.manifest.chunks.as_ref().expect("a preflop manifest")[0].sha256.clone();
    let actual = sha256_hex(&flipped);

    let reader = Reader::new(corrupt.clone(), ROOMY);
    match reader.open(&library.prefix) {
        Err(LibraryError::Unavailable { prefix, reason }) => {
            assert_eq!(prefix, library.prefix);
            assert!(reason.contains(&expected) && reason.contains(&actual), "reason: {reason}");
        }
        other => panic!("expected Unavailable, got {other:?}"),
    }
    let listed: Vec<String> = reader.unavailable().into_iter().map(|(prefix, _)| prefix).collect();
    assert_eq!(listed, vec![library.prefix.clone()]);

    let restarted = Reader::new(corrupt.clone(), ROOMY);
    assert!(matches!(restarted.open(&library.prefix), Err(LibraryError::Unavailable { .. })));

    let restored = Reader::new(with_object(&corrupt, &path, &original), ROOMY);
    let handle = restored.open(&library.prefix).expect("the restored build opens");
    assert_eq!(restored.availability(handle), Availability::Available);
    assert_eq!(restored.unavailable(), Vec::<(String, String)>::new());
    restored.node(handle, &library.keys[0]).expect("the restored build serves reads");
}

#[test]
fn r2_7_unavailable_build_refuses_node_reads() {
    let (store, flop_key, river_key) = flop_build();
    let runout = format!("{BUILD_PREFIX}/runouts/Kh9s/r250.c.bin.zst");
    let mut flipped = store.bytes(&runout).expect("the runout exists").to_vec();
    let last = flipped.len() - 1;
    flipped[last] ^= 0x80;
    let reader = Reader::new(with_object(&store, &runout, &flipped), ROOMY);
    let handle = reader.open(BUILD_PREFIX).expect("a flop build opens on its manifest");
    reader.node(handle, &flop_key).expect("the flop file is intact");
    assert!(matches!(reader.node(handle, &river_key), Err(LibraryError::Unavailable { .. })));
    match reader.availability(handle) {
        Availability::Unavailable { path, .. } => assert_eq!(path, runout),
        Availability::Available => panic!("the build must be unavailable"),
    }
    assert!(matches!(reader.node(handle, &flop_key), Err(LibraryError::Unavailable { .. })));
    let listed: Vec<String> = reader.unavailable().into_iter().map(|(prefix, _)| prefix).collect();
    assert_eq!(listed, vec![BUILD_PREFIX.to_owned()]);
}

#[test]
fn r2_7_open_decodes_no_frame() {
    let library = &*LIBRARY;
    let reader = Reader::new(library.store.clone(), ROOMY);
    let handle = reader.open(&library.prefix).expect("the solution opens");
    assert_eq!(reader.cache_used_bytes(), 0, "open parses directories only");
    reader.node(handle, &library.keys[0]).expect("the node reads");
    assert!(reader.cache_used_bytes() > 0, "a read caches its frame");
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(48))]

    #[test]
    fn r2_7_cache_never_exceeds_query_cache_bytes(
        cap in 0_u64..16_384,
        reads in prop::collection::vec(0..NODE_COUNT, 1..64),
    ) {
        let library = &*LIBRARY;
        let reader = Reader::new(library.store.clone(), ReaderOptions { cache_bytes: cap });
        let handle = reader.open(&library.prefix).expect("the solution opens");
        for index in reads {
            let key = &library.keys[usize::try_from(index).expect("fits")];
            reader.node(handle, key).expect("every written node reads, cached or not");
            prop_assert!(reader.cache_used_bytes() <= cap);
        }
    }
}

#[test]
fn r2_7_cache_evicts_least_recently_used() {
    let frame = |byte: u8, len: usize| -> Arc<[u8]> { Arc::from(vec![byte; len]) };
    let mut cache = ByteLru::new(30);
    cache.insert(1_u32, frame(1, 10));
    cache.insert(2, frame(2, 10));
    cache.insert(3, frame(3, 10));
    assert!(cache.get(&1).is_some(), "touching 1 makes 2 the least recently used");
    cache.insert(4, frame(4, 10));
    assert!(cache.get(&2).is_none(), "2 was evicted");
    assert!(cache.get(&1).is_some() && cache.get(&3).is_some() && cache.get(&4).is_some());
    assert_eq!(cache.used_bytes(), 30);
    cache.insert(5, frame(5, 31));
    assert!(cache.get(&5).is_none(), "a value above the cap is not cached");
    assert_eq!(cache.used_bytes(), 30);
    assert_eq!(cache.len(), 3);
}

#[test]
fn r3_3_contains_answers_from_the_directory_without_decoding_a_frame() {
    // O-245, PR #25 M6: solver-query tests each action's child with this, so a node read stays
    // one record decode.
    let library = &*LIBRARY;
    let reader = Reader::new(library.store.clone(), ROOMY);
    let handle = reader.open(&library.prefix).expect("the solution opens");
    for key in &library.keys {
        assert!(reader.contains(handle, key).expect("a directory lookup"), "{key}");
    }
    let absent = NodeKey::preflop(config_id(), pair(), vec![ActionToken::Fold]);
    assert!(!reader.contains(handle, &absent).expect("a directory lookup"));
    assert_eq!(reader.cache_used_bytes(), 0, "no frame was decoded");
    let fresh = Reader::new(MemStore::new(), ROOMY);
    assert!(matches!(fresh.contains(handle, &absent), Err(LibraryError::UnknownHandle(0))));
}

#[test]
fn r2_7_reader_refuses_unknown_handles_and_keys() {
    let library = &*LIBRARY;
    let reader = Reader::new(library.store.clone(), ROOMY);
    let handle = reader.open(&library.prefix).expect("the solution opens");
    assert_eq!(reader.open(&library.prefix).expect("opens again"), handle, "one handle per prefix");
    let absent = NodeKey::preflop(config_id(), pair(), vec![ActionToken::Fold]);
    assert!(matches!(reader.node(handle, &absent), Err(LibraryError::NodeNotFound(_))));
    let (store, flop_key, _) = flop_build();
    let builds = Reader::new(store, ROOMY);
    let build = builds.open(BUILD_PREFIX).expect("the build opens");
    let turn_key = flop_key.clone().with_turn("Kh".parse().expect("a card"), vec![]);
    let turn_key = turn_key.expect("the turn is dealt");
    for key in [&library.keys[0], &turn_key] {
        assert!(matches!(builds.node(build, key), Err(LibraryError::NodeNotFound(_))));
    }
    builds.node(build, &flop_key).expect("the flop node reads");
    let fresh = Reader::new(MemStore::new(), ROOMY);
    assert!(matches!(fresh.node(handle, &flop_key), Err(LibraryError::UnknownHandle(0))));
    assert!(matches!(fresh.availability(handle), Availability::Unavailable { .. }));
    assert!(matches!(fresh.open(&library.prefix), Err(LibraryError::Io { .. })));
}

#[test]
fn r2_7_fs_store_serves_the_reader_and_rejects_bad_paths() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let mut store = FsStore::new(dir.path()).expect("the directory is a root");
    for path in LIBRARY.store.paths() {
        store.put(&path, LIBRARY.store.bytes(&path).expect("listed")).expect("the put works");
    }
    let manifest = format!("{}/{MANIFEST_FILE}", LIBRARY.prefix);
    let size =
        u64::try_from(store.get(&manifest).expect("the manifest reads").len()).expect("fits");
    assert_eq!(store.get_range(&manifest, 1, 2).expect("a range reads").len(), 2);
    assert!(matches!(store.get_range(&manifest, size, 1), Err(LibraryError::Io { .. })));
    assert!(matches!(LIBRARY.store.get_range(&manifest, size, 1), Err(LibraryError::Io { .. })));
    let reader = Reader::new(store.clone(), ROOMY);
    let handle = reader.open(&LIBRARY.prefix).expect("the solution opens from files");
    reader.node(handle, &LIBRARY.keys[NODE_COUNT as usize - 1]).expect("the last node reads");
    for bad in ["", "/abs", "../up", "a/../b", "a//b", "a\\b", "C:/x", "./a", "a/"] {
        assert!(matches!(store.get(bad), Err(LibraryError::InvalidPath(_))), "{bad:?}");
        assert!(matches!(store.put(bad, b"x"), Err(LibraryError::InvalidPath(_))), "{bad:?}");
        assert!(matches!(MemStore::new().get(bad), Err(LibraryError::InvalidPath(_))));
    }
    assert!(matches!(FsStore::new(dir.path().join(&manifest)), Err(LibraryError::Io { .. })));
    assert!(matches!(FsStore::new(dir.path().join("absent")), Err(LibraryError::Io { .. })));
}

#[test]
fn r2_7_reader_accepts_n_and_rejects_other_versions() {
    let library = &*LIBRARY;
    let path = format!("{}/{MANIFEST_FILE}", library.prefix);
    let original = library.store.bytes(&path).expect("the manifest exists");
    let mut value: Value = serde_json::from_slice(original).expect("the manifest is JSON");
    for (version, accepted) in [(FORMAT_VERSION, true), (0, false), (2, false)] {
        value["format_version"] = Value::from(version);
        let bytes = serde_json::to_vec(&value).expect("the value serializes");
        let reader = Reader::new(with_object(&library.store, &path, &bytes), ROOMY);
        match (reader.open(&library.prefix), accepted) {
            (Ok(_), true) => {}
            (Err(LibraryError::UnsupportedFormat(found)), false) => assert_eq!(found, version),
            (other, _) => panic!("version {version}: unexpected {other:?}"),
        }
    }
}
