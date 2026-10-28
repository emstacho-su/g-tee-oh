//! Unit tests of the spot-class catalog walk (R4.10, O-270) over the committed fixture
//! library (`validation/fixtures/library`): the classes agree with what `/v1/nodes` says of
//! each start node, the reaches are probabilities, every spot's history replays to its
//! start node, and a configuration outside the catalog or a pair with no solution lists
//! nothing.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use gto_library::ManifestKind;
use gto_model::{ActionToken, ConfigId, NodeKey, Position, PositionPair, format_line};

use super::{MAX_SPOTS_PER_CLASS, spot_classes};
use crate::api::coverage::SpotClassEntry;
use crate::library::Library;
use crate::routes::nodes::{action_family, spot_class_key};

/// The cache budget of the scan in these tests.
const CACHE_BYTES: u64 = 64 * 1024 * 1024;
/// A catalog configuration the fixture library covers (O-225).
const SIX_MAX: &str = "cfg_6_online_100";
/// A push/fold configuration outside the v1 catalog (G6a, O-220).
const OFF_CATALOG: &str = "cfg_2_online_norake_10";
/// A catalog configuration the fixture library holds nothing for.
const UNCOVERED: &str = "cfg_9_live_25_300";

fn library() -> &'static Library {
    static LIBRARY: OnceLock<Library> = OnceLock::new();
    LIBRARY.get_or_init(|| {
        let root: PathBuf =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../../validation/fixtures/library");
        Library::scan(&root, CACHE_BYTES).expect("the committed library scans")
    })
}

fn config(id: &str) -> ConfigId {
    ConfigId::new(id).expect("a configuration id")
}

fn bb_btn() -> PositionPair {
    PositionPair::new(Position::Bb, Position::Btn).expect("BB-BTN")
}

fn six_max_classes() -> Vec<SpotClassEntry> {
    spot_classes(library(), &config(SIX_MAX), bb_btn()).expect("the walk reads the fixture")
}

fn tokens_of(entry: &super::ClassSpot) -> Vec<ActionToken> {
    entry.history.iter().map(|step| step.token.parse::<ActionToken>().expect("a token")).collect()
}

#[test]
fn r4_10_six_max_pair_classes_agree_with_the_nodes_route() {
    let classes = six_max_classes();
    assert!(classes.len() >= 2, "the 6-max BB-BTN tree holds several classes: {classes:?}");
    let first_preflop = library()
        .solutions_for(&config(SIX_MAX), bb_btn())
        .into_iter()
        .find(|info| info.kind == ManifestKind::Preflop)
        .expect("a preflop solution");
    let keys: Vec<&str> = classes.iter().map(|c| c.spot_class_key.as_str()).collect();
    let mut sorted = keys.clone();
    sorted.sort_unstable();
    assert_eq!(keys, sorted, "entries are sorted by key");
    for class in &classes {
        assert_eq!((class.format.as_str(), class.depth_band.as_str()), ("online", "100"));
        assert_eq!(class.table_size, 6);
        assert_eq!(class.solution_id, first_preflop.id);
        assert!(!class.spots.is_empty() && class.spots.len() <= MAX_SPOTS_PER_CLASS);
        for spot in &class.spots {
            let key: NodeKey = spot.start_node_key.parse().expect("a node key");
            assert_eq!(action_family(&key).as_deref(), Some(class.family.as_str()), "{key}");
            assert_eq!(spot_class_key(&key).as_deref(), Some(class.spot_class_key.as_str()));
        }
    }
}

#[test]
fn r4_10_line_reaches_are_probabilities_and_spots_are_ordered_by_reach() {
    let classes = six_max_classes();
    for class in &classes {
        assert!(class.line_reach > 0.0 && class.line_reach <= 1.0, "{class:?}");
        for spot in &class.spots {
            assert!(spot.line_reach > 0.0 && spot.line_reach <= 1.0, "{spot:?}");
            assert!(spot.line_reach <= class.line_reach + f32::EPSILON, "{class:?}");
        }
        let ordered = class.spots.windows(2).all(|pair| {
            pair[0].line_reach > pair[1].line_reach
                || (pair[0].line_reach.total_cmp(&pair[1].line_reach).is_eq()
                    && pair[0].line <= pair[1].line)
        });
        assert!(ordered, "spots by reach descending then line: {class:?}");
    }
    let root = classes
        .iter()
        .flat_map(|class| class.spots.iter())
        .find(|spot| spot.line.is_none())
        .expect("the root is a spot of its class");
    assert!((root.line_reach - 1.0).abs() < f32::EPSILON, "the root's reach is 1: {root:?}");
    assert_eq!(root.history.len(), 0, "the root has no history: {root:?}");
}

#[test]
fn r4_10_every_spot_history_replays_to_its_start_node() {
    let root = NodeKey::preflop(config(SIX_MAX), bb_btn(), Vec::new());
    for class in six_max_classes() {
        for spot in &class.spots {
            let tokens = tokens_of(spot);
            let replayed = tokens.iter().fold(root.clone(), |key, token| key.with_action(*token));
            assert_eq!(replayed.to_string(), spot.start_node_key, "{spot:?}");
            let line = (!tokens.is_empty()).then(|| format_line(&tokens));
            assert_eq!(spot.line, line, "{spot:?}");
            assert!(spot.history.iter().all(|step| !step.label.is_empty()));
            assert!(bb_btn().contains(spot.hero_position.parse().expect("a seat")));
            assert!(spot.pot_cbb > 0);
        }
    }
}

#[test]
fn r4_10_off_catalog_configurations_and_uncovered_pairs_list_nothing() {
    let off = spot_classes(library(), &config(OFF_CATALOG), bb_btn()).expect("no walk");
    assert!(off.is_empty(), "{off:?}");
    let none = spot_classes(library(), &config(UNCOVERED), bb_btn()).expect("no solution");
    assert!(none.is_empty(), "{none:?}");
}
