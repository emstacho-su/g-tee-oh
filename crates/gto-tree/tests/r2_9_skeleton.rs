//! R2.9 betting skeleton shapes against the vendored engine's own tree tests. R2.9 is a
//! requirement identifier (R ID).
//!
//! Mechanism: each test rebuilds a spot from the engine's `tree.rs` tests in
//! centi-big-blinds (cbb) and sizes in basis points (bp) of the pot, and checks the same
//! actions and counts the engine's test checks: a 10 big blind (bb) pot is `Cbb(1_000)`
//! and a 50 percent bet is 5,000 bp. The skeleton follows one card per chance node, so a
//! count here is the engine's count divided by the runout cards of its street. The full
//! node-by-node comparison with the engine lives in gto-solve's parity test, because
//! gto-tree never links the engine (ADR 0018, architecture decision record).

use gto_model::{ActionToken, Bucket, Cbb, Street, parse_line};
use gto_tree::{
    ActionTree, DecisionNode, MAX_SKELETON_NODES, PlayerSizes, RootState, SizeTable, StreetCounts,
    StreetSizes, TreeConfig, TreeError,
};

fn table(sizes_bp: &[u32], allin: bool) -> SizeTable {
    SizeTable::new(sizes_bp, allin).expect("non-zero sizes")
}

fn on_street(street: Street, sizes: StreetSizes) -> PlayerSizes {
    match street {
        Street::Flop => PlayerSizes { flop: sizes, ..PlayerSizes::default() },
        Street::Turn => PlayerSizes { turn: sizes, ..PlayerSizes::default() },
        _ => PlayerSizes { river: sizes, ..PlayerSizes::default() },
    }
}

/// Both players bet 50 percent on the river, as the engine's `river_cfg`.
fn river_bets() -> PlayerSizes {
    on_street(Street::River, StreetSizes { bet: table(&[5_000], false), ..StreetSizes::default() })
}

fn root(street: Street, pot: u32, stack: u32) -> RootState {
    RootState { street, pot: Cbb(pot), stack: Cbb(stack) }
}

fn build(oop: PlayerSizes, ip: PlayerSizes, cap: u8, threshold: u32, at: RootState) -> ActionTree {
    let cfg = TreeConfig::new(oop, ip, cap, threshold).expect("a valid configuration");
    ActionTree::build(&cfg, at).expect("the skeleton builds")
}

/// The node reached by a dotted line.
fn node<'a>(tree: &'a ActionTree, line: &str) -> &'a DecisionNode {
    let tokens = parse_line(line).expect("a valid line");
    tree.decision_nodes()
        .iter()
        .find(|node| node.line == tokens)
        .unwrap_or_else(|| panic!("no node after {line:?}"))
}

fn actions(tree: &ActionTree, line: &str) -> Vec<ActionToken> {
    node(tree, line).actions.clone()
}

fn tokens(line: &str) -> Vec<ActionToken> {
    parse_line(line).expect("a valid line")
}

/// R2.9: one river bet and no raises gives the engine's nine nodes.
#[test]
fn r2_9_skeleton_river_one_bet_has_nine_nodes() {
    let tree = build(river_bets(), river_bets(), 0, 6_700, root(Street::River, 1_000, 10_000));
    let river = StreetCounts { decision: 4, chance: 0, fold: 2, showdown: 3, actions: 8 };
    assert_eq!(tree.counts().river, river);
    assert_eq!(tree.counts().total().nodes(), 9);
    assert_eq!(tree.counts().street(Street::Preflop), None);
    assert_eq!(tree.root(), root(Street::River, 1_000, 10_000));
    assert_eq!(actions(&tree, ""), tokens("x.b500"));
    assert_eq!(actions(&tree, "x"), tokens("x.b500"));
    let facing = node(&tree, "x.b500");
    assert_eq!((facing.pot, facing.stacks), (Cbb(1_500), [Cbb(10_000), Cbb(9_500)]));
}

/// R2.9: a raise cap of one stops the raises after one, and a raise is a raise-to total
/// of the bet plus the fraction of the pot after the call.
#[test]
fn r2_9_skeleton_raise_cap_is_honored() {
    let raise = StreetSizes { raise: table(&[10_000], false), ..river_bets().river };
    let both = on_street(Street::River, raise);
    let tree = build(both.clone(), both, 1, 6_700, root(Street::River, 1_000, 10_000));
    assert_eq!(actions(&tree, "x.b500"), tokens("f.c.r2500"));
    assert_eq!(actions(&tree, "x.b500.r2500"), tokens("f.c"));
}

/// R2.9: a size past the all-in threshold becomes the all-in, and stays a bet above it.
#[test]
fn r2_9_skeleton_allin_threshold_collapses_a_large_bet() {
    let oop = on_street(
        Street::River,
        StreetSizes { bet: table(&[9_000], false), ..StreetSizes::default() },
    );
    let at = root(Street::River, 10_000, 10_000);
    let tree = build(oop.clone(), PlayerSizes::default(), 0, 6_700, at);
    assert_eq!(actions(&tree, ""), tokens("x.a"));
    let shoved = node(&tree, "a");
    assert_eq!((shoved.pot, shoved.stacks), (Cbb(20_000), [Cbb(0), Cbb(10_000)]));
    let tree = build(oop, PlayerSizes::default(), 0, 9_500, at);
    assert_eq!(actions(&tree, ""), tokens("x.b9000"));
}

/// R2.9: out of position (OOP) leads from the donk table into the previous street's
/// aggressor, and from the bet table after a checked-through street.
#[test]
fn r2_9_skeleton_donk_table_applies_after_the_aggressor() {
    let ip = on_street(
        Street::Flop,
        StreetSizes { bet: table(&[5_000], false), ..StreetSizes::default() },
    );
    let turn = StreetSizes {
        bet: table(&[7_500], false),
        donk: table(&[2_500], false),
        ..StreetSizes::default()
    };
    let tree =
        build(on_street(Street::Turn, turn), ip, 0, 6_700, root(Street::Flop, 1_000, 10_000));
    assert_eq!(node(&tree, "x.b500.c").pot, Cbb(2_000));
    assert_eq!(actions(&tree, "x.b500.c"), tokens("x.b500"));
    assert_eq!(actions(&tree, "x.x"), tokens("x.b750"));
}

/// R2.9: a check-down tree counts one runout per street, with each chance node on the
/// street it closes, so the engine's 7,206 nodes are the counts times 1, 49 and 49 x 48.
#[test]
fn r2_9_skeleton_check_down_counts_per_runout() {
    let none = PlayerSizes::default();
    let tree = build(none.clone(), none, 3, 6_700, root(Street::Flop, 1_000, 10_000));
    let counts = tree.counts();
    let per_street = StreetCounts { decision: 2, chance: 1, fold: 0, showdown: 0, actions: 2 };
    assert_eq!((counts.flop, counts.turn), (per_street, per_street));
    let river = StreetCounts { chance: 0, showdown: 1, ..per_street };
    assert_eq!(counts.river, river);
    let engine_total =
        counts.flop.nodes() + 49 * counts.turn.nodes() + 49 * 48 * counts.river.nodes();
    assert_eq!(engine_total, 7_206);
}

/// R2.9: a called all-in on the flop runs out with no betting on the turn or river.
#[test]
fn r2_9_skeleton_allin_runs_out_with_no_betting() {
    let oop =
        on_street(Street::Flop, StreetSizes { bet: table(&[], true), ..StreetSizes::default() });
    let tree = build(oop, PlayerSizes::default(), 3, 6_700, root(Street::Flop, 1_000, 10_000));
    assert_eq!(actions(&tree, "a"), tokens("f.c"));
    let after_call = tokens("a.c");
    assert!(tree.decision_nodes().iter().all(|node| !node.line.starts_with(&after_call)));
    let counts = tree.counts();
    assert_eq!((counts.flop.chance, counts.turn.chance), (2, 2));
    assert_eq!(counts.river.showdown, 2);
}

/// R2.9: a raise below the min-raise comes up to it, and a size above the stack is the
/// all-in, after which the other player can only fold or call.
#[test]
fn r2_9_skeleton_min_raise_floor_and_stack_cap() {
    let raise = StreetSizes { raise: table(&[100], false), ..river_bets().river };
    let tree = build(
        on_street(Street::River, raise),
        river_bets(),
        2,
        6_700,
        root(Street::River, 1_000, 10_000),
    );
    assert_eq!(actions(&tree, "x.b500"), tokens("f.c.r1000"));

    let huge = on_street(
        Street::River,
        StreetSizes { bet: table(&[1_000_000], false), ..StreetSizes::default() },
    );
    let tree = build(river_bets(), huge, 0, 6_700, root(Street::River, 1_000, 10_000));
    assert_eq!(actions(&tree, "x"), tokens("x.a"));
    assert_eq!(node(&tree, "x.a").pot, Cbb(11_000));
    assert_eq!(actions(&tree, "x.a"), tokens("f.c"));
}

/// R2.9: two raises in one bucket at a node reject the tree and name the line (O-137).
#[test]
fn r2_9_skeleton_raise_collision_names_the_line() {
    let oop = on_street(
        Street::Flop,
        StreetSizes { bet: table(&[5_000], false), ..StreetSizes::default() },
    );
    let ip = on_street(
        Street::Flop,
        StreetSizes { raise: table(&[5_000, 5_500], false), ..StreetSizes::default() },
    );
    let cfg = TreeConfig::new(oop, ip, 3, 6_700).expect("bet tables are fine");
    let err = ActionTree::build(&cfg, root(Street::Flop, 1_000, 10_000)).expect_err("a collision");
    let expected = TreeError::BucketCollision { line: "b500".to_owned(), bucket: Bucket::Pot };
    assert_eq!(err, expected);
}

/// R2.9: a root on preflop, with an empty pot or an empty stack, or too large for the cbb
/// range is refused.
#[test]
fn r2_9_skeleton_rejects_bad_roots() {
    let cfg = TreeConfig::new(PlayerSizes::default(), PlayerSizes::default(), 3, 6_700)
        .expect("empty tables");
    let bad = [
        root(Street::Preflop, 1_000, 10_000),
        root(Street::Flop, 0, 10_000),
        root(Street::Flop, 1_000, 0),
        root(Street::Flop, u32::MAX, u32::MAX),
    ];
    for at in bad {
        let result = ActionTree::build(&cfg, at);
        assert!(matches!(result, Err(TreeError::Root(_))), "{at:?}: {result:?}");
    }
}

/// R2.9: a skeleton that grows past `MAX_SKELETON_NODES` stops with `TooLarge`. A 10
/// percent raise rides the min-raise ladder, so with no raise cap each raise chain runs
/// about thirty deep and every call on it opens the next street; six bet sizes per table
/// then put the flop tree far past the limit, while one raise size per node can never
/// collide with the all-in, so the only error the build can reach is the limit.
#[test]
fn r2_9_skeleton_stops_past_the_node_limit() {
    let street = StreetSizes {
        bet: table(&[1_500, 3_700, 6_200, 9_200, 13_000, 20_000], true),
        raise: table(&[1_000], true),
        donk: table(&[1_500, 3_700, 6_200, 9_200, 13_000, 20_000], true),
    };
    let sizes = PlayerSizes { flop: street.clone(), turn: street.clone(), river: street };
    let cfg = TreeConfig::new(sizes.clone(), sizes, u8::MAX, 10_000).expect("valid tables");
    let result = ActionTree::build(&cfg, root(Street::Flop, 100, 60_000));
    assert_eq!(result, Err(TreeError::TooLarge { limit: MAX_SKELETON_NODES }));
}
