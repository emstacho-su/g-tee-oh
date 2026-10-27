//! R2.19 and R2.20: solver-query loads the committed fixture library (O-30, O-53, O-62,
//! O-144). R2.20 is a requirement identifier (R ID).
//!
//! Mechanism: the startup scan of `FIXTURE_LIBRARY_PATH` indexes every manifest under
//! `validation/fixtures/library`, the root the compose dev profile and the CI e2e job mount.
//! The scan must find the fifteen G6a push/fold solutions and the three synthetic sets, flag
//! the synthetic ones, and read a node of each through the real reader.

use std::path::{Path, PathBuf};

use gto_model::{ActionToken, ConfigId, NodeKey, Position, PositionPair};
use solver_query::library::Library;

/// The cache budget of the scan in these tests.
const CACHE_BYTES: u64 = 64 * 1024 * 1024;

/// G6a depths (O-220).
const G6A_DEPTHS: std::ops::RangeInclusive<u32> = 1..=15;

/// Synthetic solutions committed (O-225): 45 online 6-max plus 72 live.
const SYNTHETIC_SOLUTIONS: usize = 45 + 72;

fn library_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../validation/fixtures/library")
}

fn bb_btn() -> PositionPair {
    PositionPair::new(Position::Bb, Position::Btn).expect("BB-BTN")
}

#[test]
fn r2_20_scan_indexes_g6a_and_every_synthetic_set() {
    let library = Library::scan(&library_root(), CACHE_BYTES).expect("the committed library scans");
    assert_eq!(library.unavailable(), Vec::new(), "every checksum verifies");
    let indexed = usize::try_from(library.stats().indexed).expect("a count");
    assert_eq!(indexed, G6A_DEPTHS.count() + SYNTHETIC_SOLUTIONS);
}

#[test]
fn r2_19_g6a_roots_read_through_the_reader() {
    let library = Library::scan(&library_root(), CACHE_BYTES).expect("the committed library scans");
    for depth in G6A_DEPTHS {
        let config_id = ConfigId::new(format!("cfg_2_online_norake_{depth}")).expect("an id");
        let solutions = library.solutions_for(&config_id, bb_btn());
        assert_eq!(solutions.len(), 1, "{config_id}");
        let info = &solutions[0];
        assert!(!info.synthetic, "G6a is the own engine's solve, not synthetic");
        let root = NodeKey::preflop(config_id.clone(), bb_btn(), Vec::new());
        let facing = NodeKey::preflop(config_id.clone(), bb_btn(), vec![ActionToken::AllIn]);
        assert!(library.node(&info.id, &root).is_ok(), "{config_id} root");
        assert!(library.node(&info.id, &facing).is_ok(), "{config_id} facing the all-in");
    }
}

#[test]
fn r2_20_synthetic_sets_are_flagged_and_readable() {
    let library = Library::scan(&library_root(), CACHE_BYTES).expect("the committed library scans");
    for id in ["cfg_6_online_100", "cfg_9_live_13_100", "cfg_9_live_25_100"] {
        let config_id = ConfigId::new(id).expect("an id");
        let solutions = library.solutions_for(&config_id, bb_btn());
        assert_eq!(solutions.len(), 1, "{id} BB-BTN");
        let info = &solutions[0];
        assert!(info.synthetic, "{id} carries synthetic: true (O-57)");
        let root = NodeKey::preflop(config_id.clone(), bb_btn(), Vec::new());
        assert!(library.node(&info.id, &root).is_ok(), "{id} root reads");
    }
}
