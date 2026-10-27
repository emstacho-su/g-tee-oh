//! Runout extraction E6b (R2.12, O-173): walked nodes in the solved flop's labels become
//! library nodes in the job's raw labels. The proptest is the A2 section 3 property:
//! permuting suits and then extracting equals extracting and then permuting.

use gto_library::{
    ChunkOptions, FlopBuildMeta, HandSpace, ManifestConfig, MemStore, Reader, ReaderOptions,
    RunoutSpec, builds_prefix, permute_node, write_flop_build,
};
use gto_model::{
    ActionToken, Card, Cbb, ComboId, ConfigId, Flop, GameFormat, NodeKey, Position, PositionPair,
    SuitPermutation, TableSize,
};
use gto_solve::postflop::{HandStrategy, NodeStrategy, SolveReport, StopReason, StorageBits};
use gto_tree::Player;
use library_builder::error::BuilderError;
use library_builder::extract::{
    ExtractContext, extract_line, extract_nodes, permute_runout, permute_strategies, to_solved_node,
};
use library_builder::solve::SolvedLine;
use proptest::prelude::*;

const X: ActionToken = ActionToken::Check;
const F: ActionToken = ActionToken::Fold;
const C: ActionToken = ActionToken::Call;

fn bet(cbb: u32) -> ActionToken {
    ActionToken::Bet(Cbb(cbb))
}

fn raise(cbb: u32) -> ActionToken {
    ActionToken::Raise(Cbb(cbb))
}

fn pair() -> PositionPair {
    PositionPair::new(Position::Bb, Position::Btn).expect("two seats")
}

fn config_id() -> ConfigId {
    ConfigId::new("cfg_6_online_100").expect("an id")
}

fn ctx(solved_flop: Flop, to_raw: SuitPermutation) -> ExtractContext {
    ExtractContext {
        config_id: config_id(),
        pair: pair(),
        preflop: vec![raise(250), C],
        solved_flop,
        to_raw,
        accuracy_pct_pot: Some(0.2),
    }
}

/// Hands live on `board`: every `step`th combo, with values that differ per combo.
fn hands(board: &[Card], step: usize, actions: usize) -> Vec<HandStrategy> {
    ComboId::all()
        .filter(|combo| !combo.conflicts_with(board))
        .step_by(step)
        .map(|combo| {
            let share = f64::from(u16::from(combo) % 89) / 89.0;
            #[allow(clippy::cast_possible_truncation, reason = "a test value in 0 to 1")]
            let first = (share / 2.0) as f32;
            let mut frequencies = vec![first];
            let rest = f32::from(u8::try_from(actions - 1).expect("a few actions"));
            frequencies.resize(actions, (1.0 - first) / rest);
            HandStrategy {
                combo,
                reach: [share, 1.0 - share],
                frequencies,
                ev_bb: (0..actions)
                    .map(|a| share + f64::from(u8::try_from(a).expect("a few actions")))
                    .collect(),
            }
        })
        .collect()
}

#[allow(clippy::too_many_arguments, reason = "one argument per node field")]
fn strategy(
    flop: Flop,
    dealt: &[Card],
    street_lines: &[&[ActionToken]],
    player: Player,
    pot: u32,
    actions: &[ActionToken],
    step: usize,
) -> NodeStrategy {
    let mut board = flop.cards().to_vec();
    board.extend(dealt);
    NodeStrategy {
        line: street_lines.concat(),
        street_lines: street_lines.iter().map(|line| line.to_vec()).collect(),
        dealt: dealt.to_vec(),
        player,
        pot: Cbb(pot),
        stacks: [Cbb(9_000), Cbb(9_000)],
        actions: actions.to_vec(),
        hands: hands(&board, step, actions.len()),
    }
}

/// The flop nodes and one runout's turn and river nodes of a small walked line.
fn walked(flop: Flop, runout: RunoutSpec) -> (Vec<NodeStrategy>, Vec<NodeStrategy>) {
    let (t, r) = (runout.turn, runout.river);
    let root = vec![
        strategy(flop, &[], &[&[]], Player::Oop, 550, &[X, bet(275)], 7),
        strategy(flop, &[], &[&[X]], Player::Ip, 550, &[X, bet(275)], 9),
        strategy(flop, &[], &[&[bet(275)]], Player::Ip, 825, &[F, C], 11),
    ];
    let runout_nodes = vec![
        strategy(flop, &[t], &[&[X, X], &[]], Player::Oop, 550, &[X, bet(400)], 7),
        strategy(flop, &[t], &[&[X, X], &[bet(400)]], Player::Ip, 950, &[F, C, raise(1_200)], 13),
        strategy(flop, &[t, r], &[&[X, X], &[X, X], &[]], Player::Oop, 550, &[X, bet(400)], 5),
    ];
    (root, runout_nodes)
}

fn card(text: &str) -> Card {
    text.parse().expect("a card")
}

#[test]
fn r2_12_a_walked_node_becomes_a_library_node() {
    let flop: Flop = "Ah7d2c".parse().expect("a flop");
    let runout = RunoutSpec { turn: card("Ks"), river: card("9h") };
    let (_, runout_nodes) = walked(flop, runout);
    let facing = &runout_nodes[1];
    let node = to_solved_node(&ctx(flop, SuitPermutation::IDENTITY), facing).expect("converts");
    let expected_key = NodeKey::preflop(config_id(), pair(), vec![raise(250), C])
        .with_flop(flop, vec![X, X])
        .and_then(|key| key.with_turn(runout.turn, vec![bet(400)]))
        .expect("a key");
    assert_eq!(node.key, expected_key);
    assert_eq!(node.to_act, Position::Btn, "in position is the button");
    assert_eq!(node.pot, Cbb(950));
    assert_eq!(node.stacks, [Cbb(9_000), Cbb(9_000)]);
    assert_eq!(
        node.actions,
        vec![(F, Cbb(0)), (C, Cbb(400)), (raise(1_200), Cbb(1_200))],
        "a call's wager is the bet it faces on its street"
    );
    assert_eq!(node.hand_space, HandSpace::Postflop1326);
    assert_eq!(node.accuracy_pct_pot, Some(0.2));
    assert_eq!(node.hands.len(), facing.hands.len());
    for (library, walked) in node.hands.iter().zip(&facing.hands) {
        assert_eq!(library.hand, u16::from(walked.combo));
        assert_eq!(library.reach, Some(walked.reach));
        let widened: Vec<f64> = walked.frequencies.iter().map(|f| f64::from(*f)).collect();
        assert_eq!(library.frequencies, widened);
        assert_eq!(library.ev_bb, walked.ev_bb);
    }
    let root = to_solved_node(&ctx(flop, SuitPermutation::IDENTITY), &walked(flop, runout).0[0])
        .expect("the root converts");
    assert_eq!(root.to_act, Position::Bb);
    assert_eq!(root.actions, vec![(X, Cbb(0)), (bet(275), Cbb(275))]);
}

#[test]
fn r2_12_a_node_whose_lines_and_cards_disagree_is_refused() {
    let flop: Flop = "Ah7d2c".parse().expect("a flop");
    let mut node = walked(flop, RunoutSpec { turn: card("Ks"), river: card("9h") }).1[0].clone();
    node.dealt.clear();
    let result = to_solved_node(&ctx(flop, SuitPermutation::IDENTITY), &node);
    assert!(matches!(result, Err(BuilderError::Malformed { .. })), "{result:?}");
}

fn flops() -> impl Strategy<Value = (Flop, RunoutSpec)> {
    (0..52_u8, 0..52_u8, 0..52_u8, 0..52_u8, 0..52_u8)
        .prop_filter("five distinct cards", |(a, b, c, d, e)| {
            let cards = [a, b, c, d, e];
            cards.iter().enumerate().all(|(i, x)| cards[i + 1..].iter().all(|y| x != y))
        })
        .prop_map(|(a, b, c, d, e)| {
            let card = |i| Card::from_index(i).expect("a card");
            (
                Flop::new([card(a), card(b), card(c)]).expect("a flop"),
                RunoutSpec { turn: card(d), river: card(e) },
            )
        })
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(48))]

    /// R2.12: permute then extract equals extract then permute.
    #[test]
    fn r2_12_permute_then_extract_equals_extract_then_permute(
        (flop, runout) in flops(),
        index in 0..SuitPermutation::COUNT,
    ) {
        let perm = SuitPermutation::all()[index];
        let (root, runout_nodes) = walked(flop, runout);
        for nodes in [root, runout_nodes] {
            let extracted_then_permuted = extract_nodes(&ctx(flop, perm), &nodes).expect("extract");
            let identity = extract_nodes(&ctx(flop, SuitPermutation::IDENTITY), &nodes).expect("id");
            let one_by_one: Vec<_> =
                identity.iter().map(|node| permute_node(node, perm).expect("permute")).collect();
            prop_assert_eq!(&extracted_then_permuted, &one_by_one);

            let permuted = permute_strategies(&nodes, perm).expect("permute the walk");
            let permuted_then_extracted = extract_nodes(
                &ctx(perm.apply_flop(flop), SuitPermutation::IDENTITY),
                &permuted,
            )
            .expect("extract");
            prop_assert_eq!(permuted_then_extracted, extracted_then_permuted);
        }
        prop_assert_eq!(
            permute_runout(runout, perm),
            RunoutSpec { turn: perm.apply(runout.turn), river: perm.apply(runout.river) }
        );
    }
}

fn report() -> SolveReport {
    SolveReport {
        iterations: 340,
        exploitability_pct_pot: [0.21, 0.27],
        peak_bytes: 1 << 20,
        estimate_bytes: 1 << 21,
        seconds: 1.5,
        stop_reason: StopReason::Target,
        storage: StorageBits::ThirtyTwo,
        tree_hash: [9; 32],
    }
}

#[test]
fn r2_12_an_extracted_line_writes_a_build_the_reader_routes() {
    let canonical: Flop = "Ah7d2c".parse().expect("a flop");
    let perm = SuitPermutation::all()[13];
    let raw = perm.apply_flop(canonical);
    let runouts = [
        RunoutSpec { turn: card("Ks"), river: card("9h") },
        RunoutSpec { turn: card("3d"), river: card("Qc") },
    ];
    let solved = SolvedLine {
        report: report(),
        gains_pct_pot: [0.21, 0.27],
        root_nodes: walked(canonical, runouts[0]).0,
        runout_nodes: runouts.iter().map(|r| (*r, walked(canonical, *r).1)).collect(),
    };
    let line = extract_line(&ctx(canonical, perm), "r250.c", &"ab".repeat(32), 7, &solved)
        .expect("extracts");
    assert_eq!(line.line, "r250.c");
    assert_eq!(line.iterations, 340);
    assert_eq!(line.exploitability_pct_pot, [0.21, 0.27]);
    assert_eq!(line.seed, 7);
    assert_eq!(line.flop_nodes.len(), 3);
    let relabelled: Vec<RunoutSpec> = line.runouts.iter().map(|(r, _)| *r).collect();
    assert_eq!(relabelled, runouts.map(|r| permute_runout(r, perm)).to_vec());
    for node in line.flop_nodes.iter().chain(line.runouts.iter().flat_map(|(_, n)| n)) {
        let board = node.key.board().expect("a board");
        assert_eq!(&board.cards()[..3], &raw.cards()[..], "every key carries the raw flop");
    }

    let meta = FlopBuildMeta {
        id: "0192f000-0000-7000-8000-000000000019".to_owned(),
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
    };
    let mut store = MemStore::new();
    write_flop_build(&mut store, &meta, std::slice::from_ref(&line), &ChunkOptions::default())
        .expect("writes");
    let reader = Reader::new(store, ReaderOptions { cache_bytes: 1 << 26 });
    let handle =
        reader.open(&builds_prefix(&config_id(), pair(), raw, &meta.id)).expect("the build opens");
    for node in line.flop_nodes.iter().chain(line.runouts.iter().flat_map(|(_, n)| n)) {
        reader.node(handle, &node.key).unwrap_or_else(|err| panic!("{}: {err}", node.key));
    }
}
