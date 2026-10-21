//! R2.7 reader concurrency (A3 section 5): opens of one prefix that race each other end with
//! one handle, so one solution never has two `Solution` entries and two cache keyspaces,
//! and a later open returns that same handle ("opening a prefix again returns the handle
//! it already has").
//!
//! The racing threads fetch through a store whose `get` is a barrier, so every racer has
//! passed the reader's first "already open" check before any of them reaches the
//! registration, which is where a check-then-push outside one lock would let two through.
//!
//! Lane R (reader) owns this file.

use std::sync::Barrier;
use std::thread;

use gto_library::{
    ChunkOptions, HandSpace, LibraryError, ManifestConfig, MemStore, ObjectStore, Reader,
    ReaderOptions, SolutionHandle, SolutionMeta, SolvedHand, SolvedNode, Source, preflop_prefix,
    write_preflop,
};
use gto_model::{
    ActionToken, Cbb, ConfigId, GameFormat, NodeKey, Position, PositionPair, TableSize,
};

const SOLUTION_ID: &str = "11111111-2222-4333-8444-555555555555";
/// Threads opening the one prefix at once.
const RACERS: usize = 8;
/// Fresh readers raced in turn; a race that is only likely needs more than one roll.
const ATTEMPTS: usize = 50;
/// Small frames, so the solution has several chunk files to fetch in lockstep.
const SMALL_FRAMES: ChunkOptions = ChunkOptions { target_bytes: 2_048, zstd_level: 3 };
const ROOMY: ReaderOptions = ReaderOptions { cache_bytes: 1 << 30 };
const NODE_COUNT: u32 = 40;

fn config_id() -> ConfigId {
    ConfigId::new("cfg_6_online_100").expect("a valid config id")
}

fn pair() -> PositionPair {
    PositionPair::new(Position::Bb, Position::Btn).expect("two different seats")
}

/// A two-action node under `key` holding sixty hand classes.
fn node(key: NodeKey) -> SolvedNode {
    SolvedNode {
        key,
        to_act: Position::Bb,
        pot: Cbb(550),
        stacks: [Cbb(9_750), Cbb(9_750)],
        actions: vec![(ActionToken::Check, Cbb(0)), (ActionToken::Bet(Cbb(250)), Cbb(250))],
        hand_space: HandSpace::Preflop169,
        hands: (0..60)
            .map(|hand| SolvedHand {
                hand,
                reach: None,
                frequencies: vec![0.4, 0.6],
                ev_bb: vec![0.2, f64::from(hand) / 100.0],
            })
            .collect(),
        accuracy_pct_pot: None,
    }
}

/// A preflop solution of `NODE_COUNT` nodes in small frames, with its prefix.
fn preflop_library() -> (MemStore, String) {
    let nodes: Vec<SolvedNode> = (0..NODE_COUNT)
        .map(|i| {
            node(NodeKey::preflop(config_id(), pair(), vec![ActionToken::Raise(Cbb(200 + i))]))
        })
        .collect();
    let meta = SolutionMeta {
        id: SOLUTION_ID.to_owned(),
        source: Source::Reference,
        engine_version: "reference-test".to_owned(),
        config: ManifestConfig {
            format: GameFormat::Online,
            table_size: TableSize::new(6).expect("six seats"),
            stake: "0.5/1".to_owned(),
            depth_cbb: Cbb(10_000),
            straddle: false,
            ante_cbb: Cbb(0),
        },
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
    write_preflop(&mut store, &meta, &nodes, &SMALL_FRAMES).expect("the solution writes");
    (store, preflop_prefix(&config_id(), SOLUTION_ID))
}

/// A store whose `get` waits for every racing thread, so concurrent opens of one prefix run
/// their fetches in lockstep and reach the reader's registration together.
struct LockstepStore {
    inner: MemStore,
    barrier: Barrier,
}

impl ObjectStore for LockstepStore {
    fn get(&self, path: &str) -> Result<Vec<u8>, LibraryError> {
        self.barrier.wait();
        self.inner.get(path)
    }

    fn get_range(&self, path: &str, offset: u64, len: u32) -> Result<Vec<u8>, LibraryError> {
        self.inner.get_range(path, offset, len)
    }
}

#[test]
fn r2_7_concurrent_opens_of_one_prefix_share_a_handle() {
    let (store, prefix) = preflop_library();
    for attempt in 0..ATTEMPTS {
        let store = LockstepStore { inner: store.clone(), barrier: Barrier::new(RACERS) };
        let reader = Reader::new(store, ROOMY);
        let handles: Vec<SolutionHandle> = thread::scope(|scope| {
            let racers: Vec<_> = (0..RACERS)
                .map(|_| scope.spawn(|| reader.open(&prefix).expect("the solution opens")))
                .collect();
            racers.into_iter().map(|racer| racer.join().expect("the racer finishes")).collect()
        });
        assert!(
            handles.iter().all(|handle| *handle == handles[0]),
            "attempt {attempt}: one prefix, one handle, got {handles:?}"
        );
        let again = reader.open(&prefix).expect("opens again");
        assert_eq!(again, handles[0], "attempt {attempt}: a later open returns the same handle");
    }
}
