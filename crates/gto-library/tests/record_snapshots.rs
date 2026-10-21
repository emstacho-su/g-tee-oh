//! R2.7 node records and chunk files (A3 section 4, O-129, O-130): snapshots of the exact
//! record bytes (uncompressed, so a zstd upgrade cannot churn them), the encode and decode
//! round trip, a decoder that never panics, frames that respect the target size, and the
//! writer's duplicate-key rejection. The key-hash collision test sits in `src/writer.rs`
//! because it injects a hasher.
//!
//! Lane W (writer) owns this file and its `.snap` files.

use std::fmt::Write as _;
use std::sync::LazyLock;

use gto_library::chunk::SKIPPABLE_FRAME_MAGIC;
use gto_library::{
    ChunkOptions, FORMAT_VERSION, HandSpace, LibraryError, ManifestConfig, NodeRecord, ObjectSink,
    SolutionMeta, SolvedHand, SolvedNode, Source, decode_frame, encode_file, read_directory,
    write_preflop,
};
use gto_model::{
    ActionToken, Cbb, ComboId, ConfigId, Flop, GameFormat, NodeKey, Position, PositionPair,
    TableSize,
};
use proptest::prelude::*;

/// Bytes per line of a hexdump.
const HEX_LINE: usize = 16;
/// The low nibble of a skippable frame's magic is free (sixteen magics).
const SKIPPABLE_MASK: u32 = 0xFFFF_FFF0;

fn config_id() -> ConfigId {
    ConfigId::new("cfg_6_online_100").expect("a valid config id")
}

fn pair() -> PositionPair {
    PositionPair::new(Position::Bb, Position::Btn).expect("two different seats")
}

/// A hand whose numbers follow from its index, so snapshots stay readable and stable.
fn formula_hand(hand: u16, actions: usize, with_reach: bool) -> SolvedHand {
    let count = u16::try_from(actions).expect("a handful of actions");
    let weights: Vec<f64> = (0..count).map(|a| f64::from((hand + 1) % (a + 3) + 1)).collect();
    let total: f64 = weights.iter().sum();
    SolvedHand {
        hand,
        reach: with_reach.then(|| [1.0, f64::from(hand % 10) / 10.0]),
        frequencies: weights.iter().map(|w| w / total).collect(),
        ev_bb: (0..count).map(|a| (f64::from(hand) - 84.0) / 100.0 + f64::from(a) * 0.1).collect(),
    }
}

/// A preflop node facing a raise to `raise_to`, with every one of the 169 hands (dense).
fn preflop_node(raise_to: u32) -> SolvedNode {
    let actions = vec![
        (ActionToken::Fold, Cbb(0)),
        (ActionToken::Call, Cbb(raise_to)),
        (ActionToken::Raise(Cbb(raise_to * 3)), Cbb(raise_to * 3)),
    ];
    SolvedNode {
        key: NodeKey::preflop(config_id(), pair(), vec![ActionToken::Raise(Cbb(raise_to))]),
        to_act: Position::Bb,
        pot: Cbb(raise_to + 150),
        stacks: [Cbb(10_000 - 100), Cbb(10_000 - raise_to)],
        hands: (0..169).map(|h| formula_hand(h, actions.len(), true)).collect(),
        actions,
        hand_space: HandSpace::Preflop169,
        accuracy_pct_pot: None,
    }
}

/// A sparse preflop node: twenty hands, two actions, no reach.
fn small_node(raise_to: u32) -> SolvedNode {
    let actions = vec![(ActionToken::Fold, Cbb(0)), (ActionToken::Call, Cbb(raise_to))];
    SolvedNode {
        hands: (0..20).map(|h| formula_hand(h * 8, actions.len(), false)).collect(),
        actions,
        ..preflop_node(raise_to)
    }
}

/// A flop node with three listed combos, reach and an accuracy: the sparse 1,326 layout.
fn sparse_postflop_node() -> SolvedNode {
    let flop: Flop = "Ah7d2c".parse().expect("a valid flop");
    let preflop = vec![ActionToken::Raise(Cbb(250)), ActionToken::Call];
    let key = NodeKey::preflop(config_id(), pair(), preflop)
        .with_flop(flop, vec![])
        .expect("the flop is dealt once");
    let actions = vec![
        (ActionToken::Check, Cbb(0)),
        (ActionToken::Bet(Cbb(250)), Cbb(250)),
        (ActionToken::Bet(Cbb(600)), Cbb(600)),
        (ActionToken::AllIn, Cbb(9_750)),
    ];
    let combos = ["AsKs", "KcKd", "7h7s"];
    let hands = combos
        .iter()
        .map(|label| {
            let combo: ComboId = label.parse().expect("a valid combo");
            formula_hand(u16::from(combo), actions.len(), true)
        })
        .collect();
    SolvedNode {
        key,
        to_act: Position::Bb,
        pot: Cbb(550),
        stacks: [Cbb(9_750), Cbb(9_750)],
        actions,
        hand_space: HandSpace::Postflop1326,
        hands,
        accuracy_pct_pot: Some(0.25),
    }
}

fn encode(node: &SolvedNode) -> Vec<u8> {
    let record = NodeRecord::from_solved(node, pair()).expect("the node quantizes");
    let mut bytes = Vec::new();
    record.encode(&mut bytes).expect("the record encodes");
    bytes
}

/// Offset, sixteen hex bytes per line.
fn hexdump(bytes: &[u8]) -> String {
    bytes.chunks(HEX_LINE).enumerate().fold(String::new(), |mut text, (line, chunk)| {
        let hex: Vec<String> = chunk.iter().map(|b| format!("{b:02x}")).collect();
        writeln!(text, "{:06x}  {}", line * HEX_LINE, hex.join(" ")).expect("writing to a String");
        text
    })
}

/// A sink that records every put, to prove a rejected call wrote nothing.
#[derive(Default)]
struct RecordingSink {
    puts: Vec<String>,
}

impl ObjectSink for RecordingSink {
    fn put(&mut self, path: &str, _bytes: &[u8]) -> Result<(), LibraryError> {
        self.puts.push(path.to_owned());
        Ok(())
    }
}

fn meta() -> SolutionMeta {
    SolutionMeta {
        id: "0f0e0d0c-0b0a-4908-8706-050403020100".to_owned(),
        source: Source::Own,
        engine_version: "0.1.0".to_owned(),
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
        tree_hash: "ab".repeat(32),
        seed: Some(7),
        iterations: Some(1_000),
        exploitability_pct_pot: Some([0.2, 0.2]),
        synthetic: true,
        created_at: "2026-10-20T12:00:00Z".to_owned(),
    }
}

/// A solved preflop node with random actions, hands and numbers. Reach is present for every
/// hand or for none, because the record keeps one reach flag per node (O-130).
fn solved_node() -> impl Strategy<Value = SolvedNode> {
    let shape = (1_usize..=4, prop::collection::btree_set(0_u16..169, 1..=24), 100_u32..=5_000);
    shape
        .prop_flat_map(|(actions, hands, raise_to)| {
            let row = (
                prop::collection::vec(0.01_f64..=1.0, actions),
                prop::collection::vec(-10.0_f64..10.0, actions),
                (0.0_f64..=1.0, 0.0_f64..=1.0),
            );
            let rows = prop::collection::vec(row, hands.len());
            let extras = (prop::option::of(0.0_f32..5.0), any::<bool>());
            (Just((actions, hands, raise_to)), rows, extras)
        })
        .prop_map(|((actions, hands, raise_to), rows, (accuracy, with_reach))| {
            let base = preflop_node(raise_to);
            let menu = [
                (ActionToken::Fold, Cbb(0)),
                (ActionToken::Call, Cbb(raise_to)),
                (ActionToken::Raise(Cbb(raise_to * 3)), Cbb(raise_to * 3)),
                (ActionToken::AllIn, Cbb(9_900)),
            ];
            let hands = hands
                .into_iter()
                .zip(rows)
                .map(|(hand, (weights, ev_bb, reach))| {
                    let total: f64 = weights.iter().sum();
                    SolvedHand {
                        hand,
                        reach: with_reach.then_some([reach.0, reach.1]),
                        frequencies: weights.iter().map(|w| w / total).collect(),
                        ev_bb,
                    }
                })
                .collect();
            SolvedNode {
                actions: menu[..actions].to_vec(),
                hands,
                accuracy_pct_pot: accuracy,
                ..base
            }
        })
}

/// One valid encoded record, for the mutation property.
static VALID_RECORD: LazyLock<Vec<u8>> = LazyLock::new(|| encode(&sparse_postflop_node()));

#[test]
fn r2_7_snapshot_preflop_record() {
    insta::assert_snapshot!(hexdump(&encode(&preflop_node(250))));
}

#[test]
fn r2_7_snapshot_sparse_postflop_record() {
    insta::assert_snapshot!(hexdump(&encode(&sparse_postflop_node())));
}

proptest! {
    #[test]
    fn r2_7_record_encode_decode_round_trip(
        node in solved_node(),
        junk in prop::collection::vec(any::<u8>(), 0..16),
    ) {
        let record = NodeRecord::from_solved(&node, pair()).expect("a valid node quantizes");
        let mut bytes = Vec::new();
        record.encode(&mut bytes).expect("the record encodes");
        prop_assert_eq!(bytes.len(), record.encoded_len());
        let used = bytes.len();
        bytes.extend_from_slice(&junk);
        let (decoded, consumed) = NodeRecord::decode(&bytes).expect("the record decodes");
        prop_assert_eq!(consumed, used);
        prop_assert_eq!(decoded, record);
    }

    #[test]
    fn r2_7_decode_never_panics_on_random_bytes(
        bytes in prop::collection::vec(any::<u8>(), 0..512),
        expected_len in any::<u32>(),
        flip_at in any::<prop::sample::Index>(),
        flip_with in 1_u8..=255,
    ) {
        // Random bytes: every decoder returns, Ok or Err, without panicking.
        let _ = NodeRecord::decode(&bytes);
        let _ = read_directory(&bytes);
        let _ = decode_frame(&bytes, expected_len);
        // One flipped byte in a valid record: still no panic.
        let mut mutated = VALID_RECORD.clone();
        let at = flip_at.index(mutated.len());
        mutated[at] ^= flip_with;
        let _ = NodeRecord::decode(&mutated);
        let _ = NodeRecord::decode(&mutated[..at]);
    }
}

#[test]
fn r2_7_chunk_frames_respect_target_size() {
    let records: Vec<NodeRecord> = (0..200)
        .map(|i| NodeRecord::from_solved(&small_node(200 + i), pair()).expect("quantizes"))
        .collect();
    let opts = ChunkOptions { target_bytes: 4_096, zstd_level: 3 };
    let file = encode_file(&records, &opts).expect("the records encode");
    let magic = u32::from_le_bytes(file[..4].try_into().expect("four bytes"));
    assert_eq!(magic & SKIPPABLE_MASK, SKIPPABLE_FRAME_MAGIC, "the directory frame is skippable");
    let directory = read_directory(&file).expect("the directory parses");
    assert_eq!(directory.format_version, FORMAT_VERSION);
    assert_eq!(directory.records.len(), records.len());
    assert!(directory.frames.len() > 1, "4 KiB frames split 200 records");
    assert!(directory.records.windows(2).all(|w| w[0].key_hash < w[1].key_hash), "sorted");
    let largest = records.iter().map(NodeRecord::encoded_len).max().expect("records");
    for frame in &directory.frames {
        let limit = opts.target_bytes.max(largest);
        assert!(usize::try_from(frame.decompressed_len).expect("fits") <= limit);
        let start = usize::try_from(frame.offset).expect("fits");
        let end = start + usize::try_from(frame.compressed_len).expect("fits");
        let bytes = decode_frame(&file[start..end], frame.decompressed_len).expect("decodes");
        assert_eq!(bytes.len(), usize::try_from(frame.decompressed_len).expect("fits"));
    }
    for record in &records {
        let entry = directory.find(record.key_hash).expect("every record is indexed");
        let frame = directory.frames[usize::try_from(entry.frame).expect("fits")];
        let start = usize::try_from(frame.offset).expect("fits");
        let end = start + usize::try_from(frame.compressed_len).expect("fits");
        let bytes = decode_frame(&file[start..end], frame.decompressed_len).expect("decodes");
        let offset = usize::try_from(entry.offset).expect("fits");
        let (decoded, _) = NodeRecord::decode(&bytes[offset..]).expect("the record decodes");
        assert_eq!(&decoded, record);
    }
}

#[test]
fn r2_7_writer_rejects_duplicate_key() {
    let node = small_node(250);
    let mut sink = RecordingSink::default();
    let result =
        write_preflop(&mut sink, &meta(), &[node.clone(), node.clone()], &ChunkOptions::default());
    match result {
        Err(LibraryError::DuplicateKey(key)) => assert_eq!(key, node.key.to_string()),
        other => panic!("expected a duplicate key error, got {other:?}"),
    }
    assert!(sink.puts.is_empty(), "a rejected call puts nothing, got {:?}", sink.puts);
}
