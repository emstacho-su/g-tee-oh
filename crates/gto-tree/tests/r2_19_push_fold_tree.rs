//! R2.19 push/fold tree tests (04 section 4, O-220). R2.19 is a requirement identifier.
//!
//! Mechanism: heads-up at a rake-free stake, the button (who posts the small blind) folds
//! or moves all-in, and the big blind facing the all-in folds or calls. The tree has two
//! decision nodes and no flop line; amounts are centi-big-blinds (cbb).

use gto_model::{
    ActionToken, Cbb, GameConfig, GameFormat, Position, PositionPair, RakeModel, Stake, TableSize,
};
use gto_tree::PreflopTree;

/// The rake-free heads-up configuration of gate G6a at `depth_bb` (O-220).
fn config(depth_bb: u32) -> GameConfig {
    let rake = RakeModel { percent_bp: 0, cap_cents: 0, no_flop_no_drop: true };
    let stake = Stake::new("norake", 50, 100, rake).expect("a valid rake-free stake");
    GameConfig::new(GameFormat::Online, TableSize::HEADS_UP, stake, Cbb::from_bb(depth_bb))
}

#[test]
fn r2_19_push_fold_tree_has_two_nodes_and_no_flop_line() {
    let tree = PreflopTree::push_fold(&config(10)).expect("a heads-up push/fold tree");
    assert_eq!(tree.pair(), PositionPair::new(Position::Bb, Position::Btn).expect("BB-BTN"));
    assert!(tree.flop_lines().is_empty(), "every non-fold line is all-in");
    let nodes = tree.nodes();
    assert_eq!(nodes.len(), 2);

    let root = &nodes[0];
    assert_eq!(root.actor, Position::Btn, "the button posts the small blind and acts first");
    assert_eq!(root.line, Vec::<ActionToken>::new());
    assert_eq!(root.actions, vec![ActionToken::Fold, ActionToken::AllIn]);
    assert_eq!(root.pot, Cbb::new(150), "the two blinds");

    let facing = &nodes[1];
    assert_eq!(facing.actor, Position::Bb);
    assert_eq!(facing.line, vec![ActionToken::AllIn]);
    assert_eq!(facing.actions, vec![ActionToken::Fold, ActionToken::Call]);
    assert_eq!(facing.pot, Cbb::new(1_000 + 100), "the shove of 10 bb plus the big blind");
}

#[test]
fn r2_19_push_fold_tree_scales_with_depth() {
    for depth_bb in [1, 5, 15] {
        let tree = PreflopTree::push_fold(&config(depth_bb)).expect("a push/fold tree");
        let facing = &tree.nodes()[1];
        assert_eq!(facing.pot, Cbb::new(depth_bb * 100 + 100), "depth {depth_bb}");
    }
}

#[test]
fn r2_19_push_fold_tree_refuses_a_table_that_is_not_heads_up() {
    let rake = RakeModel { percent_bp: 0, cap_cents: 0, no_flop_no_drop: true };
    let stake = Stake::new("norake", 50, 100, rake).expect("a valid stake");
    let six_max = GameConfig::new(GameFormat::Online, TableSize::SIX_MAX, stake, Cbb::from_bb(10));
    assert!(PreflopTree::push_fold(&six_max).is_err());
}

#[test]
fn r2_19_push_fold_tree_refuses_an_ante() {
    let with_ante = GameConfig { ante_cbb: Cbb::new(10), ..config(10) };
    assert!(PreflopTree::push_fold(&with_ante).is_err());
}
