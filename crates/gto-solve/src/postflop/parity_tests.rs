//! Parity between the `gto-tree` betting skeleton and the engine's own tree (R2.10, R2.9,
//! ADR 0020). A unit test module, because the mapping onto the engine's configuration is
//! crate-private.
//!
//! Mechanism: random size tables, raise caps, thresholds and roots go through
//! `TreeConfig::new`, `ActionTree::build` and, mapped by `engine_map::sizings`, through the
//! engine's `GameTree::build` on a fixed board of the root street. The engine tree is
//! walked depth first; every decision node becomes a `gto_tree::DecisionNode` with its line
//! of actions (no card tokens), and every node is counted on its street, a chance node on
//! the street it closes. The skeleton must give every count times the runout multiplier,
//! and the same decision nodes in the same order, every runout agreeing. A configuration
//! the skeleton rejects with `BucketCollision` must have a collision in the engine tree
//! too. The size counts and raise caps shrink as the root moves earlier so each engine
//! tree stays small, and failure persistence is off so a red run writes no file.

use std::collections::HashMap;

use gto_model::{ActionToken, Board, Bucket, Cbb, Street};
use gto_tree::{
    ActionTree, DecisionNode, Player, PlayerSizes, RootState, SizeTable, SkeletonCounts,
    StreetCounts, StreetSizes, TreeConfig, TreeError,
};
use postflop_engine::config::{SolveConfig, Street as EngineStreet};
use postflop_engine::tree::{ActionLabel, GameTree, NodeKind, Terminal};
use proptest::prelude::*;

use super::engine_map::{board_text, cbb_of_chips, chips, sizings};
use super::runouts::Runouts;

/// The boards the trees are built on, one per root street.
const FLOP: &str = "Ks7d2c";
const TURN_CARD: &str = "9h";
const RIVER_CARD: &str = "4s";

fn board_for(street: Street) -> Board {
    let flop = Board::flop(FLOP.parse().expect("a valid flop"));
    let turn = flop.with_turn(TURN_CARD.parse().expect("a card")).expect("a turn");
    match street {
        Street::Turn => turn,
        Street::River => turn.with_river(RIVER_CARD.parse().expect("a card")).expect("a river"),
        Street::Preflop | Street::Flop => flop,
    }
}

/// A raw size table: sizes in bp and the all-in flag.
fn raw_table(max_sizes: usize) -> impl Strategy<Value = (Vec<u32>, bool)> {
    (prop::collection::vec(500..=30_000_u32, 0..=max_sizes), any::<bool>())
}

fn raw_street(max_sizes: usize) -> impl Strategy<Value = [(Vec<u32>, bool); 3]> {
    [raw_table(max_sizes), raw_table(max_sizes), raw_table(max_sizes)]
}

fn raw_player(max_sizes: usize) -> impl Strategy<Value = [[(Vec<u32>, bool); 3]; 3]> {
    [raw_street(max_sizes), raw_street(max_sizes), raw_street(max_sizes)]
}

fn table((sizes, allin): &(Vec<u32>, bool)) -> SizeTable {
    SizeTable::new(sizes, *allin).expect("generated sizes are positive")
}

fn player_sizes(raw: &[[(Vec<u32>, bool); 3]; 3]) -> PlayerSizes {
    let street = |s: &[(Vec<u32>, bool); 3]| StreetSizes {
        bet: table(&s[0]),
        raise: table(&s[1]),
        donk: table(&s[2]),
    };
    PlayerSizes { flop: street(&raw[0]), turn: street(&raw[1]), river: street(&raw[2]) }
}

/// One generated case: a configuration (when the tables pass) and a root.
#[derive(Clone, Debug)]
struct Case {
    config: Result<TreeConfig, TreeError>,
    root: RootState,
}

fn case() -> impl Strategy<Value = Case> {
    prop_oneof![
        Just((Street::Flop, 1_usize, 1_u8)),
        Just((Street::Turn, 2, 2)),
        Just((Street::River, 3, 3)),
    ]
    .prop_flat_map(|(street, max_sizes, max_cap)| {
        let shape = (raw_player(max_sizes), raw_player(max_sizes), 0..=max_cap);
        let rest = (5_000..=10_000_u32, 100..=20_000_u32, 100..=60_000_u32);
        (shape, rest).prop_map(move |((oop, ip, cap), (threshold, pot, stack))| Case {
            config: TreeConfig::new(player_sizes(&oop), player_sizes(&ip), cap, threshold),
            root: RootState { street, pot: Cbb(pot), stack: Cbb(stack) },
        })
    })
}

/// The engine tree for a configuration and root on the fixed board.
fn engine_tree(config: &TreeConfig, root: RootState) -> GameTree {
    let board = board_for(root.street);
    let cfg = SolveConfig {
        board: board_text(board),
        starting_pot: chips(root.pot),
        effective_stack: chips(root.stack),
        allin_threshold: f64::from(config.allin_threshold_bp()) / 100.0,
        raise_cap: u32::from(config.raise_cap()),
        sizings: sizings(config),
        ..SolveConfig::default()
    };
    let cards = cfg.board_cards().expect("the fixed board parses");
    GameTree::build(&cfg, &cards).expect("the engine builds the tree")
}

/// The engine tree in skeleton terms.
#[derive(Default)]
struct EngineWalk {
    counts: SkeletonCounts,
    order: Vec<Vec<ActionToken>>,
    nodes: HashMap<Vec<ActionToken>, DecisionNode>,
    disagreements: Vec<String>,
    collisions: Vec<String>,
}

fn model_street(street: EngineStreet) -> Street {
    match street {
        EngineStreet::Flop => Street::Flop,
        EngineStreet::Turn => Street::Turn,
        EngineStreet::River => Street::River,
    }
}

fn counts_on(counts: &mut SkeletonCounts, street: Street) -> &mut StreetCounts {
    match street {
        Street::Turn => &mut counts.turn,
        Street::River => &mut counts.river,
        Street::Preflop | Street::Flop => &mut counts.flop,
    }
}

fn token(label: ActionLabel) -> ActionToken {
    let cbb = |chips: f64| cbb_of_chips(chips).expect("engine amounts sit on the grid");
    match label {
        ActionLabel::Fold => ActionToken::Fold,
        ActionLabel::Check => ActionToken::Check,
        ActionLabel::Call => ActionToken::Call,
        ActionLabel::Bet(to) => ActionToken::Bet(cbb(to)),
        ActionLabel::Raise(to) => ActionToken::Raise(cbb(to)),
        ActionLabel::AllIn => ActionToken::AllIn,
    }
}

impl EngineWalk {
    fn visit(&mut self, tree: &GameTree, index: u32, line: &mut Vec<ActionToken>) {
        let node = tree.node(index);
        let street = model_street(node.street);
        match &node.kind {
            NodeKind::Decision { player, actions } => {
                self.decision(tree, index, *player, line);
                for action in actions {
                    line.push(token(action.label));
                    self.visit(tree, action.child, line);
                    line.pop();
                }
            }
            NodeKind::Chance { .. } => {
                let closes = Street::ALL.into_iter().find(|s| s.next() == Some(street));
                counts_on(&mut self.counts, closes.expect("a chance node deals a street"))
                    .chance += 1;
                for child in tree.children(index) {
                    self.visit(tree, child, line);
                }
            }
            NodeKind::Terminal(Terminal::Fold { .. }) => {
                counts_on(&mut self.counts, street).fold += 1;
            }
            NodeKind::Terminal(Terminal::Showdown { .. }) => {
                counts_on(&mut self.counts, street).showdown += 1;
            }
        }
    }

    fn decision(&mut self, tree: &GameTree, index: u32, player: u8, line: &[ActionToken]) {
        let node = tree.node(index);
        let NodeKind::Decision { actions, .. } = &node.kind else { return };
        let street = model_street(node.street);
        let on_street = counts_on(&mut self.counts, street);
        on_street.decision += 1;
        on_street.actions += actions.len() as u64;
        let converted = DecisionNode {
            street,
            player: Player::from_u8(player).expect("the engine is two-player"),
            pot: cbb_of_chips(node.pot).expect("the pot sits on the grid"),
            stacks: node.stacks.map(|stack| cbb_of_chips(stack).expect("on the grid")),
            line: line.to_vec(),
            actions: actions.iter().map(|action| token(action.label)).collect(),
        };
        self.check_buckets(&converted);
        match self.nodes.get(line) {
            Some(seen) if *seen != converted => {
                self.disagreements.push(format!("{seen:?} against {converted:?}"));
            }
            Some(_) => {}
            None => {
                self.order.push(line.to_vec());
                self.nodes.insert(line.to_vec(), converted);
            }
        }
    }

    fn check_buckets(&mut self, node: &DecisionNode) {
        let mut seen: Vec<Bucket> = Vec::new();
        for &action in &node.actions {
            let bucket = Bucket::of_action(action, node.pot).expect("the pot is positive");
            if let Some(bucket) = bucket {
                if seen.contains(&bucket) {
                    self.collisions.push(format!("{:?} at line {:?}", node.actions, node.line));
                }
                seen.push(bucket);
            }
        }
    }
}

fn walk(tree: &GameTree) -> EngineWalk {
    let mut walk = EngineWalk::default();
    walk.visit(tree, tree.root(), &mut Vec::new());
    walk
}

fn scaled(counts: &StreetCounts, copies: u64) -> StreetCounts {
    StreetCounts {
        decision: counts.decision * copies,
        chance: counts.chance * copies,
        fold: counts.fold * copies,
        showdown: counts.showdown * copies,
        actions: counts.actions * copies,
    }
}

fn assert_parity(skeleton: &ActionTree, engine: &EngineWalk, root: RootState) {
    let runouts = Runouts::new(root.street, usize::from(root.street.board_cards()));
    let counts = skeleton.counts();
    for street in [Street::Flop, Street::Turn, Street::River] {
        let skeleton_street = counts.street(street).expect("a postflop street");
        let engine_street = engine.counts.street(street).expect("a postflop street");
        assert_eq!(scaled(skeleton_street, runouts.copies(street)), *engine_street, "{street}");
    }
    assert!(engine.disagreements.is_empty(), "runouts disagree: {:?}", engine.disagreements);
    let engine_nodes: Vec<&DecisionNode> =
        engine.order.iter().map(|line| &engine.nodes[line]).collect();
    let skeleton_nodes: Vec<&DecisionNode> = skeleton.decision_nodes().iter().collect();
    assert_eq!(skeleton_nodes, engine_nodes);
}

proptest! {
    #![proptest_config(ProptestConfig {
        cases: 64,
        failure_persistence: None,
        ..ProptestConfig::default()
    })]

    /// R2.10: the skeleton gives the engine's node counts by kind and street, after the
    /// runout multipliers, and the engine's decision nodes with the same pots, stacks and
    /// actions in cbb, in the engine's order.
    #[test]
    fn r2_10_skeleton_matches_engine_tree(case in case()) {
        let Ok(config) = case.config else { return Ok(()) };
        let engine = walk(&engine_tree(&config, case.root));
        match ActionTree::build(&config, case.root) {
            Ok(skeleton) => assert_parity(&skeleton, &engine, case.root),
            Err(TreeError::BucketCollision { .. }) => {
                prop_assert!(!engine.collisions.is_empty(), "the engine tree has no collision");
            }
            Err(other) => prop_assert!(false, "unexpected skeleton error {other}"),
        }
    }

    /// R2.9 (ADR 0020): whenever the skeleton builds, the engine tree it stands for has
    /// one size per bucket at every decision node, every runout included.
    #[test]
    fn r2_9_engine_tree_has_one_size_per_bucket(case in case()) {
        let Ok(config) = case.config else { return Ok(()) };
        if ActionTree::build(&config, case.root).is_ok() {
            let engine = walk(&engine_tree(&config, case.root));
            prop_assert!(engine.collisions.is_empty(), "{:?}", engine.collisions);
        }
    }
}
