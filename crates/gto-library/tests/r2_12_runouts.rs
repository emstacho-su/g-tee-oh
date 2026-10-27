//! R2.12 tests of the flop-build half of `gto-library` (S18, O-173, O-192): runouts drawn
//! uniformly by seed, the canonical-to-raw suit permutation applied to the key's cards and
//! to every per-combo array, and the flop-build writer whose files the reader routes.

use std::collections::BTreeSet;

use gto_library::{
    ChunkOptions, FlopBuildMeta, HandSpace, LibraryError, LineBuild, MANIFEST_FILE, ManifestConfig,
    ManifestKind, MemStore, ORDERED_RUNOUTS, ObjectSink, Reader, ReaderOptions, RunoutSpec,
    SolvedHand, SolvedNode, Source, builds_prefix, draw_runouts, flop_file_path, permute_combo,
    permute_key, permute_node, runout_file_path, write_flop_build,
};
use gto_model::{
    ActionToken, Card, Cbb, ComboId, ConfigId, Flop, GameFormat, NodeKey, Position, PositionPair,
    SuitPermutation, TableSize,
};
use proptest::prelude::*;

const SMALL_FRAMES: ChunkOptions = ChunkOptions { target_bytes: 2_048, zstd_level: 3 };
const BUILD_ID: &str = "0192f000-0000-7000-8000-000000000018";

fn config_id() -> ConfigId {
    ConfigId::new("cfg_6_online_100").expect("a valid config id")
}

fn pair() -> PositionPair {
    PositionPair::new(Position::Bb, Position::Btn).expect("two different seats")
}

fn flop(text: &str) -> Flop {
    text.parse().expect("a flop")
}

fn card(text: &str) -> Card {
    text.parse().expect("a card")
}

fn srp() -> Vec<ActionToken> {
    vec![ActionToken::Raise(Cbb(250)), ActionToken::Call]
}

/// A node keyed on `flop` (and the runout when given) holding `hands` with per-hand values
/// that differ, so a misplaced array shows.
fn node(flop: Flop, runout: Option<RunoutSpec>, hands: &[u16]) -> SolvedNode {
    let mut key =
        NodeKey::preflop(config_id(), pair(), srp()).with_flop(flop, vec![]).expect("flop");
    if let Some(runout) = runout {
        key = key
            .with_turn(runout.turn, vec![ActionToken::Check, ActionToken::Check])
            .and_then(|key| key.with_river(runout.river, vec![ActionToken::Check]))
            .expect("the runout is dealt in order");
    }
    SolvedNode {
        key,
        to_act: Position::Bb,
        pot: Cbb(550),
        stacks: [Cbb(9_750), Cbb(9_750)],
        actions: vec![(ActionToken::Check, Cbb(0)), (ActionToken::Bet(Cbb(250)), Cbb(250))],
        hand_space: HandSpace::Postflop1326,
        hands: hands
            .iter()
            .map(|&hand| {
                let share = f64::from(hand % 97) / 97.0;
                SolvedHand {
                    hand,
                    reach: Some([share, 1.0 - share]),
                    frequencies: vec![share, 1.0 - share],
                    ev_bb: vec![f64::from(hand) / 100.0, f64::from(hand) / 50.0],
                }
            })
            .collect(),
        accuracy_pct_pot: Some(0.25),
    }
}

/// Every combo index that holds no card of `board`, ascending.
fn live_hands(board: &[Card]) -> Vec<u16> {
    ComboId::all().filter(|combo| !combo.conflicts_with(board)).map(u16::from).collect()
}

fn permutation() -> impl Strategy<Value = SuitPermutation> {
    (0..SuitPermutation::COUNT).prop_map(|index| SuitPermutation::all()[index])
}

fn flops() -> impl Strategy<Value = Flop> {
    (0..52_u8, 0..52_u8, 0..52_u8)
        .prop_filter("three distinct cards", |(a, b, c)| a != b && b != c && a != c)
        .prop_map(|(a, b, c)| {
            Flop::new([
                Card::from_index(a).expect("a card"),
                Card::from_index(b).expect("a card"),
                Card::from_index(c).expect("a card"),
            ])
            .expect("three distinct cards")
        })
}

#[test]
fn r2_12_draw_runouts_is_deterministic_legal_and_without_replacement() {
    let flop = flop("Ah7d2c");
    let first = draw_runouts(flop, 20, 7).expect("twenty runouts");
    assert_eq!(first, draw_runouts(flop, 20, 7).expect("again"), "the seed alone decides");
    assert_ne!(first, draw_runouts(flop, 20, 8).expect("another seed"));
    let distinct: BTreeSet<RunoutSpec> = first.iter().copied().collect();
    assert_eq!(distinct.len(), 20, "no runout twice");
    for runout in &first {
        assert_ne!(runout.turn, runout.river);
        assert!(!flop.contains(runout.turn) && !flop.contains(runout.river), "{runout}");
    }
    let all = draw_runouts(flop, ORDERED_RUNOUTS, 1).expect("every runout");
    assert_eq!(all.iter().copied().collect::<BTreeSet<_>>().len(), ORDERED_RUNOUTS);
    assert_eq!(draw_runouts(flop, 0, 1).expect("none"), Vec::new());
    assert!(matches!(
        draw_runouts(flop, ORDERED_RUNOUTS + 1, 1),
        Err(LibraryError::InvalidRequest(_))
    ));
    assert_eq!(RunoutSpec { turn: card("Kh"), river: card("9s") }.to_string(), "Kh9s");
}

#[test]
fn r2_12_draw_runouts_is_uniform_over_turns() {
    // 49 turns, 4,900 draws of one runout each: every turn is drawn, and no turn takes more
    // than three times its share (a loose bound that a biased shuffle still fails).
    let flop = flop("Ah7d2c");
    let mut counts = std::collections::BTreeMap::new();
    for seed in 0..4_900_u64 {
        let runout = draw_runouts(flop, 1, seed).expect("one runout")[0];
        *counts.entry(runout.turn).or_insert(0_u32) += 1;
    }
    assert_eq!(counts.len(), 49, "every turn appears");
    assert!(counts.values().all(|&count| count < 300), "{counts:?}");
}

#[test]
fn r2_12_permute_combo_relabels_both_cards() {
    let perm = SuitPermutation::all()[5];
    for combo in ComboId::all() {
        let (a, b) = combo.cards();
        let expected = u16::from(ComboId::from_cards(perm.apply(a), perm.apply(b)).expect("combo"));
        assert_eq!(permute_combo(u16::from(combo), perm).expect("a combo"), expected);
    }
    assert!(permute_combo(ComboId::COUNT, perm).is_err(), "1,326 is not a combo index");
}

#[test]
fn r2_12_preflop_nodes_are_unchanged() {
    let preflop = SolvedNode {
        key: NodeKey::preflop(config_id(), pair(), srp()),
        hand_space: HandSpace::Preflop169,
        hands: vec![SolvedHand {
            hand: 3,
            reach: None,
            frequencies: vec![1.0, 0.0],
            ev_bb: vec![0.0; 2],
        }],
        ..node(flop("Ah7d2c"), None, &[])
    };
    let perm = SuitPermutation::all()[11];
    assert_eq!(permute_node(&preflop, perm).expect("permutes"), preflop);
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(64))]

    /// R2.12: the key's cards and every per-combo array move together, the hands come back
    /// sorted, and the inverse undoes the permutation.
    #[test]
    fn r2_12_permute_node_moves_every_per_combo_array(
        flop in flops(),
        perm in permutation(),
        turn_index in 0..49_usize,
        river_index in 0..48_usize,
        take in 1..200_usize,
    ) {
        let off_flop: Vec<Card> = Card::all().filter(|c| !flop.contains(*c)).collect();
        let turn = off_flop[turn_index];
        let river = off_flop.iter().copied().filter(|c| *c != turn).nth(river_index).expect("a river");
        let board = [flop.cards().to_vec(), vec![turn, river]].concat();
        let hands: Vec<u16> = live_hands(&board).into_iter().step_by(7).take(take).collect();
        let original = node(flop, Some(RunoutSpec { turn, river }), &hands);

        let permuted = permute_node(&original, perm).expect("permutes");
        prop_assert_eq!(
            permuted.key.board().expect("a board"),
            perm.apply_board(original.key.board().expect("a board"))
        );
        prop_assert_eq!(&permuted.key, &permute_key(&original.key, perm).expect("key"));
        prop_assert!(permuted.hands.windows(2).all(|w| w[0].hand < w[1].hand), "sorted");
        prop_assert_eq!(permuted.hands.len(), original.hands.len());
        for hand in &original.hands {
            let moved = permute_combo(hand.hand, perm).expect("a combo");
            let found = permuted.hands.iter().find(|h| h.hand == moved).expect("the moved hand");
            prop_assert_eq!(found.reach, hand.reach);
            prop_assert_eq!(&found.frequencies, &hand.frequencies);
            prop_assert_eq!(&found.ev_bb, &hand.ev_bb);
        }
        prop_assert_eq!(&permuted.actions, &original.actions);
        prop_assert_eq!(permuted.accuracy_pct_pot, original.accuracy_pct_pot);
        let back = permute_node(&permuted, perm.inverse()).expect("inverse");
        prop_assert_eq!(back, original.clone());
        prop_assert_eq!(permute_node(&original, SuitPermutation::IDENTITY).expect("id"), original);
    }
}

/// A sink that records the order of its puts in front of a `MemStore`.
struct Recording {
    store: MemStore,
    order: Vec<String>,
}

impl ObjectSink for Recording {
    fn put(&mut self, path: &str, bytes: &[u8]) -> Result<(), LibraryError> {
        self.order.push(path.to_owned());
        self.store.put(path, bytes)
    }
}

fn meta(raw: Flop) -> FlopBuildMeta {
    FlopBuildMeta {
        id: BUILD_ID.to_owned(),
        engine_version: "test".to_owned(),
        config: ManifestConfig {
            format: GameFormat::Online,
            table_size: TableSize::new(6).expect("six seats"),
            stake: "online".to_owned(),
            depth_cbb: Cbb(10_000),
            straddle: false,
            ante_cbb: Cbb(0),
        },
        config_id: config_id(),
        pair: pair(),
        flop: raw,
        tree_hash: "ab".repeat(32),
        seed: 7,
        synthetic: true,
        created_at: "2026-10-27T00:00:00Z".to_owned(),
    }
}

#[test]
fn r2_12_flop_build_writes_every_file_and_the_manifest_last() {
    let raw = flop("Ah7d2c");
    let runouts = draw_runouts(raw, 3, 11).expect("three runouts");
    let line = LineBuild {
        line: "r250.c".to_owned(),
        tree_hash: "cd".repeat(32),
        seed: 7,
        iterations: 120,
        exploitability_pct_pot: [0.21, 0.27],
        flop_nodes: vec![node(raw, None, &live_hands(&raw.cards())[..40])],
        runouts: runouts
            .iter()
            .map(|runout| {
                let board = [raw.cards().to_vec(), vec![runout.turn, runout.river]].concat();
                (*runout, vec![node(raw, Some(*runout), &live_hands(&board)[..30])])
            })
            .collect(),
    };
    let mut sink = Recording { store: MemStore::new(), order: Vec::new() };
    let manifest =
        write_flop_build(&mut sink, &meta(raw), std::slice::from_ref(&line), &SMALL_FRAMES)
            .expect("writes");
    let prefix = builds_prefix(&config_id(), pair(), raw, BUILD_ID);
    assert_eq!(prefix, format!("builds/cfg_6_online_100/BB-BTN/Ah7d2c/{BUILD_ID}"));
    assert_eq!(sink.order.last(), Some(&format!("{prefix}/{MANIFEST_FILE}")), "manifest last");
    assert_eq!(sink.order.len(), 1 + 1 + runouts.len());

    manifest.validate().expect("a valid flop-build manifest");
    assert_eq!(manifest.kind, ManifestKind::FlopBuild);
    assert_eq!(manifest.source, Source::Own);
    assert_eq!(manifest.id, BUILD_ID);
    assert_eq!(manifest.flop.as_deref(), Some("Ah7d2c"));
    assert_eq!(manifest.flop_weight, Some(24));
    let lines = manifest.lines.as_ref().expect("lines");
    assert_eq!(lines[0].flop_file, flop_file_path("r250.c"));
    assert_eq!(lines[0].iterations, 120);
    let listed = manifest.runouts.as_ref().expect("runouts");
    assert_eq!(listed.len(), runouts.len());
    for (entry, runout) in listed.iter().zip(&runouts) {
        assert_eq!(entry.turn, runout.turn.to_string());
        assert_eq!(entry.files["r250.c"].path, runout_file_path(runout, "r250.c"));
    }

    let reader = Reader::new(sink.store, ReaderOptions { cache_bytes: 1 << 26 });
    let handle = reader.open(&prefix).expect("the build opens with every checksum");
    let flop_node = &line.flop_nodes[0];
    let view = reader.node(handle, &flop_node.key).expect("the flop node");
    assert_eq!(view.to_solved(&flop_node.key).expect("decodes").hands.len(), flop_node.hands.len());
    for (_, nodes) in &line.runouts {
        reader.node(handle, &nodes[0].key).expect("each runout's river node resolves");
    }
}

#[test]
fn r2_12_flop_build_rejects_lines_that_disagree_on_runouts() {
    let raw = flop("Ah7d2c");
    let runouts = draw_runouts(raw, 2, 3).expect("two runouts");
    let line = |name: &str, runouts: &[RunoutSpec]| LineBuild {
        line: name.to_owned(),
        tree_hash: "cd".repeat(32),
        seed: 3,
        iterations: 10,
        exploitability_pct_pot: [0.2, 0.2],
        flop_nodes: vec![node(raw, None, &[100, 200])],
        runouts: runouts.iter().map(|r| (*r, vec![node(raw, Some(*r), &[300])])).collect(),
    };
    let mut store = MemStore::new();
    let result = write_flop_build(
        &mut store,
        &meta(raw),
        &[line("r250.c", &runouts), line("r250.r1000.c", &runouts[..1])],
        &SMALL_FRAMES,
    );
    assert!(matches!(result, Err(LibraryError::Manifest(_))), "{result:?}");
}
