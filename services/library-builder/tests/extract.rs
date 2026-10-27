//! Runout extraction E6b (R2.12, O-173): walked nodes in the solved flop's labels become
//! library nodes in the job's raw labels. The proptest is the A2 section 3 property:
//! permuting suits and then extracting equals extracting and then permuting.

mod common;

use std::path::Path;

use gto_library::{
    ChunkOptions, FlopBuildMeta, FsStore, HandSpace, LineBuild, ManifestConfig, MemStore, Reader,
    ReaderOptions, RunoutSpec, SolutionHandle, builds_prefix, draw_runouts, permute_key,
    permute_node, write_flop_build,
};
use gto_model::{
    ActionToken, Card, Cbb, ComboId, ConfigId, Flop, GameFormat, NodeKey, Position, PositionPair,
    SuitPermutation, TableSize, canonical_flop, is_canonical_flop,
};
use gto_planner::{ConfigScope, PlannerSettings, PriorReach, enumerate};
use gto_solve::postflop::{HandStrategy, NodeStrategy, SolveReport, StopReason, StorageBits};
use gto_tree::{Player, SizingConventionSpec};
use library_builder::error::BuilderError;
use library_builder::extract::{
    ExtractContext, extract_line, extract_nodes, extract_runout, permute_range, permute_runout,
    permute_strategies, to_solved_node,
};
use library_builder::job::{BuildInputs, stage_build};
use library_builder::solve::{FakeSolver, SolvedLine};
use library_builder::spec::{inputs, load};
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
    };
    let head = extract_line(&ctx(canonical, perm), "r250.c", &"ab".repeat(32), 7, &solved)
        .expect("extracts");
    assert!(head.runouts.is_empty(), "the head carries no runouts; each is written as walked");
    let line = LineBuild {
        runouts: runouts
            .iter()
            .map(|r| extract_runout(&ctx(canonical, perm), *r, &walked(canonical, *r).1))
            .collect::<Result<_, _>>()
            .expect("extracts the runouts"),
        ..head
    };
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

/// The tiny spec's inputs moved onto `flop`, with each line's ranges relabelled by `perm`.
fn moved_inputs(base: &BuildInputs, flop: Flop, perm: SuitPermutation) -> BuildInputs {
    let lines = base
        .lines
        .iter()
        .map(|(line, ranges)| {
            (line.clone(), ranges.clone().map(|r| permute_range(&r, perm).expect("a range")))
        })
        .collect();
    BuildInputs { raw_flop: flop, lines, ..base.clone() }
}

/// Stages `inputs` with the fake solver under `root` and opens the staged build.
fn stage_with_fake(inputs: &BuildInputs, root: &Path) -> (Reader<FsStore>, SolutionHandle) {
    let staged = stage_build(inputs, &FakeSolver::converging([0.1, 0.2]), root, &|_| {})
        .expect("the build stages");
    let reader =
        Reader::new(FsStore::new(root).expect("a store"), ReaderOptions { cache_bytes: 1 << 26 });
    let handle = reader.open(&staged.prefix).expect("the staged build opens");
    (reader, handle)
}

/// The keys of the fake's nodes on `flop` after `preflop`, for `runouts`.
fn fake_keys(flop: Flop, preflop: &[ActionToken], runouts: &[RunoutSpec]) -> Vec<NodeKey> {
    let start = || NodeKey::preflop(config_id(), pair(), preflop.to_vec());
    let mut keys = vec![start().with_flop(flop, Vec::new()).expect("the root key")];
    for runout in runouts {
        let turn = start().with_flop(flop, vec![X, X]).expect("a flop key");
        keys.push(turn.clone().with_turn(runout.turn, Vec::new()).expect("a turn key"));
        let river = turn.with_turn(runout.turn, vec![X, X]).expect("a turn key");
        keys.push(river.with_river(runout.river, Vec::new()).expect("a river key"));
    }
    keys
}

/// R2.12: a job on a non-canonical raw flop with suit-specific ranges stages the build of
/// the same spot on the canonical flop, relabelled to the raw suits. The fake's hands are
/// the live combos of the ranges it is handed, so ranges left in the raw labels while the
/// solve runs on the canonical flop show as other hands.
#[test]
fn r2_12_suit_specific_ranges_on_a_raw_flop_stage_the_relabelled_canonical_build() {
    let base = inputs(&load(&common::fixture("tiny-bb-btn-srp.spec.json")).expect("spec"), 1)
        .expect("inputs");
    let (canonical, to_canonical) = canonical_flop(base.raw_flop);
    let perm = SuitPermutation::all()
        .into_iter()
        .find(|perm| !is_canonical_flop(perm.apply_flop(canonical)))
        .expect("a permutation that leaves the canonical flop");
    let canonical_job = moved_inputs(&base, canonical, to_canonical);
    let raw_job = moved_inputs(&canonical_job, perm.apply_flop(canonical), perm);
    let dir = tempfile::tempdir().expect("a scratch directory");
    let (canonical_reader, canonical_handle) =
        stage_with_fake(&canonical_job, &dir.path().join("canonical"));
    let (raw_reader, raw_handle) = stage_with_fake(&raw_job, &dir.path().join("raw"));
    let runouts = draw_runouts(canonical, base.k_runouts, base.seed).expect("the runouts");
    let preflop = &base.lines[0].0.actions;
    for key in fake_keys(canonical, preflop, &runouts) {
        let expected = canonical_reader
            .node(canonical_handle, &key)
            .and_then(|view| view.to_solved(&key))
            .and_then(|node| permute_node(&node, perm))
            .unwrap_or_else(|err| panic!("{key}: {err}"));
        let raw_key = permute_key(&key, perm).expect("a raw key");
        let got = raw_reader
            .node(raw_handle, &raw_key)
            .and_then(|view| view.to_solved(&raw_key))
            .unwrap_or_else(|err| panic!("{raw_key}: {err}"));
        assert_eq!(got, expected, "{raw_key}");
    }
}

/// R2.12: every job the planner lists names a canonical flop, the flop the builder solves.
#[test]
fn r2_12_every_planner_job_flop_is_canonical() {
    let config = gto_model::v1_configs()
        .into_iter()
        .find(|config| config.config_id().as_str() == common::CONFIG_ID)
        .expect("the configuration");
    let convention = SizingConventionSpec::from_json(&common::placeholder_convention().to_string())
        .expect("the convention");
    let jobs =
        enumerate(&[ConfigScope { config, convention }], &PriorReach, &PlannerSettings::default())
            .expect("the jobs");
    assert!(jobs.len() > 1, "the scope lists jobs");
    assert!(jobs.iter().all(|job| is_canonical_flop(job.flop)), "a job names a raw flop");
}
