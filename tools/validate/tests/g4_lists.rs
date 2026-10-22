//! The two committed G4 spot lists and the loader's key rules (R2.11, O-87, O-161): the
//! gated list holds the eight rake-free spots and nothing else, the raked list holds the
//! two informational twins of two gated spots, each list carries every root key once, and
//! the loader refuses a key that repeats or extends another spot's key within its street
//! and a key whose last street section carries actions (not a root). The lists are split
//! because a node dump holds each key once, so a raked twin sharing a gated spot's key in
//! one list would make the compare read the rake-free nodes for both (review finding F1).

use std::path::{Path, PathBuf};

use gto_model::Street;
use serde_json::{Value, json};
use validate::fixtures::g4_spots::{G4Spots, RAKE_NONE, RAKE_ONLINE};
use validate::fixtures::{FIXTURES_RELATIVE_TO_REPO_ROOT, FixtureError, SCHEMA_VERSION};

/// The committed lists and the tiny list, relative to the fixture root.
const GATED_LIST: &str = "g4-spots.json";
const RAKED_LIST: &str = "g4-spots-raked.json";
const TINY_SPOTS: &str = "g4/tiny-spots.json";

/// The list ids.
const GATED_ID: &str = "g4-spots";
const RAKED_ID: &str = "g4-spots-raked";

/// The gated list holds four spots a street and the raked list one twin a street.
const GATED_PER_STREET: usize = 4;
const RAKED_PER_STREET: usize = 1;

/// The tiny river root, the turn root one street earlier, and a key below the river root.
const TINY_RIVER_KEY: &str = "cfg_6_online_100/BB-BTN/r250.c|Ah7d2c|x.b275.c|Ks|x.b700.c|9h|";
const TINY_TURN_KEY: &str = "cfg_6_online_100/BB-BTN/r250.c|Ah7d2c|x.b275.c|Ks|";
const TINY_RIVER_CHECKED_KEY: &str =
    "cfg_6_online_100/BB-BTN/r250.c|Ah7d2c|x.b275.c|Ks|x.b700.c|9h|x";
const TINY_TURN_BOARD: &str = "Ah7d2cKs";
const TURN_POT_CBB: u32 = 1_100;
const TURN_STACK_CBB: u32 = 9_475;

fn fixtures_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..").join(FIXTURES_RELATIVE_TO_REPO_ROOT)
}

fn load(relative: &str) -> G4Spots {
    let path = fixtures_dir().join(relative);
    G4Spots::load(&path).unwrap_or_else(|error| panic!("{error}"))
}

/// The tiny list as JSON, to edit.
fn tiny_json() -> Value {
    let path = fixtures_dir().join(TINY_SPOTS);
    let text = std::fs::read_to_string(&path).unwrap_or_else(|error| panic!("{error}"));
    serde_json::from_str(&text).unwrap_or_else(|error| panic!("{error}"))
}

/// A scratch file under cargo's test temp directory.
fn scratch(name: &str) -> PathBuf {
    let dir = Path::new(env!("CARGO_TARGET_TMPDIR")).join("g4-lists");
    std::fs::create_dir_all(&dir).unwrap_or_else(|error| panic!("{}: {error}", dir.display()));
    dir.join(name)
}

/// Write `list` to a scratch file and load it.
fn load_edited(name: &str, list: &Value) -> Result<G4Spots, FixtureError> {
    let path = scratch(name);
    let text = serde_json::to_string_pretty(list).unwrap_or_else(|error| panic!("{error}"));
    std::fs::write(&path, text).unwrap_or_else(|error| panic!("{error}"));
    G4Spots::load(&path)
}

/// The reason of an `Invalid` error, or a panic naming any other outcome.
fn invalid_reason(result: Result<G4Spots, FixtureError>) -> String {
    match result {
        Err(FixtureError::Invalid { reason, .. }) => reason,
        Err(other) => panic!("expected an invalid list, got {other}"),
        Ok(spots) => panic!("expected an invalid list, got {} spots", spots.spots.len()),
    }
}

/// The tiny river spot with `id` and `key`, the other fields unchanged.
fn river_spot(id: &str, key: &str) -> Value {
    let mut spot = tiny_json()["spots"][0].clone();
    spot["id"] = json!(id);
    spot["node_key"] = json!(key);
    spot
}

/// The tiny spot one street earlier: a turn root with the turn pot and stack.
fn turn_spot(id: &str) -> Value {
    let mut spot = river_spot(id, TINY_TURN_KEY);
    spot["street"] = json!("turn");
    spot["board"] = json!(TINY_TURN_BOARD);
    spot["pot_cbb"] = json!(TURN_POT_CBB);
    spot["stack_cbb"] = json!(TURN_STACK_CBB);
    spot
}

/// The tiny list with `spots` in place of its one spot.
fn list_with(spots: Vec<Value>) -> Value {
    let mut list = tiny_json();
    list["spots"] = Value::Array(spots);
    list
}

fn count_on(spots: &G4Spots, street: Street) -> usize {
    spots.spots.iter().filter(|spot| spot.street == street.as_str()).count()
}

/// R2.11 (O-161, review finding F1): the gated list holds the eight rake-free gated
/// spots, four a street, and no informational spot; every root key appears once.
#[test]
fn r2_11_g4_gated_list_holds_only_the_eight_rake_free_spots() {
    let gated = load(GATED_LIST);
    assert_eq!((gated.schema_version, gated.id.as_str()), (SCHEMA_VERSION, GATED_ID));
    assert_eq!(gated.spots.len(), 2 * GATED_PER_STREET);
    assert_eq!(count_on(&gated, Street::Turn), GATED_PER_STREET);
    assert_eq!(count_on(&gated, Street::River), GATED_PER_STREET);
    for spot in &gated.spots {
        assert!(spot.gated, "{} is not gated", spot.id);
        assert_eq!(spot.rake, RAKE_NONE, "{} carries rake", spot.id);
        let same_key = gated.spots.iter().filter(|other| other.node_key == spot.node_key).count();
        assert_eq!(same_key, 1, "{} shares its key with another spot", spot.id);
    }
}

/// R2.11 (O-161, review finding F1): the raked list carries the two informational twins,
/// one a street, at the online rake, each with the root key, board, pot, stack and ranges
/// of a gated spot of the gated list; it shares the gated list's configuration, pair,
/// tree, stop rule and rules.
#[test]
fn r2_11_g4_raked_list_twins_two_gated_spots_in_a_list_of_its_own() {
    let gated = load(GATED_LIST);
    let raked = load(RAKED_LIST);
    assert_eq!((raked.schema_version, raked.id.as_str()), (SCHEMA_VERSION, RAKED_ID));
    assert_eq!(
        (raked.gate.as_str(), raked.r_id.as_str()),
        (gated.gate.as_str(), gated.r_id.as_str())
    );
    assert_eq!(raked.spots.len(), 2 * RAKED_PER_STREET);
    assert_eq!(count_on(&raked, Street::Turn), RAKED_PER_STREET);
    assert_eq!(count_on(&raked, Street::River), RAKED_PER_STREET);
    assert_eq!(
        (raked.config_id.as_str(), raked.position_pair.as_str()),
        (gated.config_id.as_str(), gated.position_pair.as_str())
    );
    assert_eq!((&raked.tree, &raked.stop, &raked.rules), (&gated.tree, &gated.stop, &gated.rules));
    for spot in &raked.spots {
        assert!(!spot.gated, "{} is gated", spot.id);
        assert_eq!(spot.rake, RAKE_ONLINE, "{} is not raked", spot.id);
        let twin = gated.spots.iter().find(|other| other.node_key == spot.node_key);
        let twin = twin.unwrap_or_else(|| panic!("{} twins no gated spot", spot.id));
        assert_eq!(spot.id, format!("{}-raked", twin.id));
        assert_eq!(
            (&spot.board, spot.pot_cbb, spot.stack_cbb, &spot.ranges, &spot.preflop),
            (&twin.board, twin.pot_cbb, twin.stack_cbb, &twin.ranges, &twin.preflop)
        );
    }
}

/// R2.11 (review finding F5): the loader refuses a list in which two spots carry the same
/// root key, or one spot's key extends another's within the same street, naming both
/// spots; a turn root and the river root that extends it on the next street are two
/// different spots and are accepted.
#[test]
fn r2_11_g4_loader_refuses_a_repeated_or_nested_key_within_a_street() {
    let twin = list_with(vec![
        river_spot("tiny-river", TINY_RIVER_KEY),
        river_spot("twin", TINY_RIVER_KEY),
    ]);
    let reason = invalid_reason(load_edited("twin-key.json", &twin));
    assert!(reason.contains("tiny-river") && reason.contains("twin"), "{reason}");
    assert!(reason.contains("key"), "{reason}");

    let nested = list_with(vec![
        river_spot("tiny-river", TINY_RIVER_KEY),
        river_spot("deeper", TINY_RIVER_CHECKED_KEY),
    ]);
    let reason = invalid_reason(load_edited("nested-key.json", &nested));
    assert!(reason.contains("tiny-river") && reason.contains("deeper"), "{reason}");

    let streets = list_with(vec![turn_spot("tiny-turn"), river_spot("tiny-river", TINY_RIVER_KEY)]);
    let loaded =
        load_edited("two-streets.json", &streets).unwrap_or_else(|error| panic!("{error}"));
    assert_eq!(loaded.spots.len(), 2);
}

/// One edit of the tiny list as JSON.
type EditList = fn(&mut Value);

/// Lists broken in one field each, with the word the loader's reason must carry.
fn broken_lists() -> Vec<(&'static str, EditList, &'static str)> {
    vec![
        ("gate", |l| l["gate"] = json!("G5"), "gate"),
        ("source twice", |l| l["sources"][1]["id"] = json!("hand-made"), "duplicate source"),
        ("tree source", |l| l["tree"]["source"] = json!("nowhere"), "tree"),
        ("config", |l| l["config_id"] = json!("cfg_6_online_999"), "config_id"),
        ("pair", |l| l["position_pair"] = json!("BB-CO-BTN"), "position_pair"),
        ("tree", |l| l["tree"]["bet_sizes_bp"] = json!([]), "tree"),
        ("engine target", |l| l["stop"]["engine_target_pct_pot"] = json!(-1.0), "engine_target"),
        ("oracle target", |l| l["stop"]["oracle_target_pct_pot"] = json!(-1.0), "oracle_target"),
        ("caps", |l| l["stop"]["max_seconds"] = json!(0), "max_seconds"),
        ("rule value", |l| l["rules"]["root_ev_max"]["value"] = json!(0.5), "root_ev_max"),
        ("rule source", |l| l["rules"]["root_ev_max"]["source"] = json!("x"), "root_ev_max"),
        ("no spots", |l| l["spots"] = json!([]), "no spots"),
        ("spot source", |l| l["spots"][0]["source"] = json!("x"), "source"),
        ("street", |l| l["spots"][0]["street"] = json!("flop"), "turn or river"),
        ("board", |l| l["spots"][0]["board"] = json!("Ah7d2cKs"), "board"),
        ("pot", |l| l["spots"][0]["pot_cbb"] = json!(0), "pot_cbb"),
        ("rake", |l| l["spots"][0]["rake"] = json!("live"), "rake"),
        ("preflop line", |l| l["spots"][0]["preflop"]["actions"] = json!("r300.c"), "preflop"),
        ("preflop kind", |l| l["spots"][0]["preflop"]["kind"] = json!("odd"), "kind"),
        ("aggressor", |l| l["spots"][0]["preflop"]["aggressor"] = json!("CO"), "aggressor"),
        ("range", |l| l["spots"][0]["ranges"]["ip"] = json!(["ZZ"]), "ip range"),
        ("dead range", |l| l["spots"][0]["ranges"]["oop"] = json!(["AhAs"]), "live combo"),
    ]
}

/// R2.11: every structural rule of the loader refuses a list broken in that one field,
/// naming the field in its reason, so a hand-edited list fails loudly.
#[test]
fn r2_11_g4_loader_names_the_broken_field_of_a_list() {
    for (name, edit, needle) in broken_lists() {
        let mut list = tiny_json();
        edit(&mut list);
        let Err(error) = load_edited(&format!("broken-{name}.json"), &list) else {
            panic!("{name}: the loader accepted the list");
        };
        let FixtureError::Invalid { reason, .. } = error else {
            panic!("{name}: expected an invalid list, got {error}");
        };
        assert!(reason.contains(needle), "{name}: {reason:?} does not name {needle:?}");
    }
}

/// R2.11 (review finding F5): a spot's key must be a root, its last street section
/// carrying no action; a key with actions after the river card is refused naming the
/// spot.
#[test]
fn r2_11_g4_loader_refuses_a_key_that_is_not_a_root() {
    let below = list_with(vec![river_spot("checked-river", TINY_RIVER_CHECKED_KEY)]);
    let reason = invalid_reason(load_edited("below-root.json", &below));
    assert!(reason.contains("checked-river"), "{reason}");
    assert!(reason.contains("not a root"), "{reason}");
}
