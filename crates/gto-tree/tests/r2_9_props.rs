//! R2.9 property tests for the one-size-per-bucket rule of architecture decision records
//! (ADR) 0020 and 0008. R2.9 is a requirement identifier (R ID).
//!
//! Mechanism: random size tables in basis points (bp) of the pot, random raise caps and
//! all-in thresholds, and random roots in centi-big-blinds (cbb) go through
//! `TreeConfig::new` and `ActionTree::build`. Whenever both succeed, the sized actions at
//! every decision node must fall in distinct buckets, each bucketed against the pot at the
//! node (O-137); whenever the build fails on a valid configuration it must fail with
//! `BucketCollision`, never with anything else. The skeleton grows with the sizes per table
//! and the raise cap on every street it spans, so a flop root draws at most one size per
//! table and a raise cap of 1, a turn root two and 2, a river root three and 3. A second
//! property draws tables that can never collide and requires every build to succeed, so the
//! first property cannot pass by rejecting everything. Failure persistence is off so a red
//! run writes no regressions file.

#[allow(dead_code, reason = "each test binary uses a subset of the shared fixtures")]
mod support;

use gto_model::{Bucket, Cbb, Street};
use gto_tree::{
    ActionTree, DecisionNode, PlayerSizes, RootState, SizeKind, SizeTable, StreetSizes, TreeConfig,
    TreeError,
};
use proptest::prelude::*;
use support::{RawPlayer, bucket_safe_table, free_table, raw_player};

/// The root street with the most sizes per table and the highest raise cap it draws.
fn root_shape() -> impl Strategy<Value = (Street, usize, u8)> {
    prop_oneof![
        Just((Street::Flop, 1_usize, 1_u8)),
        Just((Street::Turn, 2, 2)),
        Just((Street::River, 3, 3)),
    ]
}

/// One generated case: both players' raw tables, the raise cap, the threshold and the root.
#[derive(Clone, Debug)]
struct Case {
    oop: RawPlayer,
    ip: RawPlayer,
    raise_cap: u8,
    allin_threshold_bp: u32,
    root: RootState,
}

impl Case {
    fn config(&self) -> Result<TreeConfig, TreeError> {
        TreeConfig::new(
            self.oop.build()?,
            self.ip.build()?,
            self.raise_cap,
            self.allin_threshold_bp,
        )
    }
}

/// A root on `street` with a pot of 100 to 20,000 cbb and a stack of 100 to 60,000 cbb.
fn root_on(street: Street) -> impl Strategy<Value = RootState> {
    (100..=20_000_u32, 100..=60_000_u32).prop_map(move |(pot, stack)| RootState {
        street,
        pot: Cbb(pot),
        stack: Cbb(stack),
    })
}

/// Cases with free tables: sizes anywhere in 500 to 30,000 bp, so collisions happen.
fn free_case() -> impl Strategy<Value = Case> {
    root_shape().prop_flat_map(|(street, max_sizes, max_cap)| {
        let player = || raw_player(free_table(max_sizes), free_table(max_sizes));
        (player(), player(), 0..=max_cap, 5_000..=10_000_u32, root_on(street)).prop_map(
            |(oop, ip, raise_cap, allin_threshold_bp, root)| Case {
                oop,
                ip,
                raise_cap,
                allin_threshold_bp,
                root,
            },
        )
    })
}

/// Cases that can never collide: bet and donk sizes one per bucket away from the edges,
/// and at most one raise size, which cannot share a bucket with the all-in.
fn safe_case() -> impl Strategy<Value = Case> {
    root_shape().prop_flat_map(|(street, max_sizes, max_cap)| {
        let player = || raw_player(bucket_safe_table(max_sizes), free_table(1));
        (player(), player(), 0..=max_cap, 5_000..=10_000_u32, root_on(street)).prop_map(
            |(oop, ip, raise_cap, allin_threshold_bp, root)| Case {
                oop,
                ip,
                raise_cap,
                allin_threshold_bp,
                root,
            },
        )
    })
}

/// The buckets of the sized actions at a node, in action order.
fn sized_buckets(node: &DecisionNode) -> Vec<Bucket> {
    node.actions
        .iter()
        .filter_map(|action| {
            Bucket::of_action(*action, node.pot).expect("a decision node has a non-empty pot")
        })
        .collect()
}

/// True when no two entries are equal.
fn all_distinct(buckets: &[Bucket]) -> bool {
    let mut sorted = buckets.to_vec();
    sorted.sort_unstable();
    sorted.windows(2).all(|pair| pair[0] != pair[1])
}

proptest! {
    #![proptest_config(ProptestConfig {
        cases: 128,
        failure_persistence: None,
        ..ProptestConfig::default()
    })]

    /// R2.9: whenever a valid configuration builds, no node holds two sizes in one bucket.
    #[test]
    fn r2_9_no_two_sizes_share_a_bucket_at_any_node(case in free_case()) {
        let Ok(cfg) = case.config() else { return Ok(()) };
        match ActionTree::build(&cfg, case.root) {
            Ok(tree) => {
                for node in tree.decision_nodes() {
                    let buckets = sized_buckets(node);
                    prop_assert!(all_distinct(&buckets), "line {:?}: {buckets:?}", node.line);
                }
            }
            Err(err) => {
                let is_collision = matches!(err, TreeError::BucketCollision { .. });
                prop_assert!(is_collision, "unexpected error {err:?}");
            }
        }
    }

    /// R2.9: tables away from the bucket edges always build, so the property above is
    /// exercised on real trees and cannot pass on rejected inputs alone.
    #[test]
    fn r2_9_tables_away_from_edges_always_build(case in safe_case()) {
        let cfg = case.config().expect("bucket-safe tables form a valid configuration");
        let tree = ActionTree::build(&cfg, case.root).expect("bucket-safe tables always build");
        let root = tree.decision_nodes().first().expect("a skeleton has a root decision");
        prop_assert!(!root.actions.is_empty());
        prop_assert!(tree.counts().total().decision >= 1);
    }
}

/// R2.9: two flop bet sizes in the small bucket (30 and 45 percent of the pot) are rejected
/// when the configuration is made, naming the table and the bucket.
#[test]
fn r2_9_same_pct_bucket_is_rejected() {
    let flop = StreetSizes {
        bet: SizeTable::new(&[3_000, 4_500], false).expect("non-zero sizes"),
        ..StreetSizes::default()
    };
    let player = PlayerSizes { flop, ..PlayerSizes::default() };
    let err = TreeConfig::new(player.clone(), PlayerSizes::default(), 3, 6_700)
        .expect_err("two small flop bets share a bucket");
    assert!(
        matches!(
            err,
            TreeError::SameBucket {
                street: Street::Flop,
                kind: SizeKind::Bet,
                bucket: Bucket::Small,
                ..
            }
        ),
        "{err:?}"
    );

    let json = support::ONLINE_PLACEHOLDER_JSON.replace("[0.33, 0.75]", "[0.30, 0.45]");
    let err = TreeConfig::from_spec(&support::spec(&json)).expect_err("the spec repeats small");
    assert!(matches!(err, TreeError::SameBucket { bucket: Bucket::Small, .. }), "{err:?}");
}

/// Tables for one street with the donk table set and the bet table empty, the rest default.
fn donk_only(street: Street, donk: SizeTable) -> PlayerSizes {
    let tables = StreetSizes { donk, ..StreetSizes::default() };
    match street {
        Street::Flop => PlayerSizes { flop: tables, ..PlayerSizes::default() },
        Street::Turn => PlayerSizes { turn: tables, ..PlayerSizes::default() },
        _ => PlayerSizes { river: tables, ..PlayerSizes::default() },
    }
}

/// R2.9: an OOP donk table set beside an empty OOP bet table is rejected on any street,
/// naming the street, whether the table holds sizes or only an all-in, while the same
/// shape for IP passes because IP never leads from a donk table (O-137).
#[test]
fn r2_9_oop_donk_without_bet_is_rejected() {
    let sized = SizeTable::new(&[2_500], false).expect("a non-zero size");
    let jam_only = SizeTable::new(&[], true).expect("an all-in alone");
    for street in [Street::Flop, Street::Turn, Street::River] {
        for donk in [sized.clone(), jam_only.clone()] {
            let oop = donk_only(street, donk.clone());
            let err = TreeConfig::new(oop, PlayerSizes::default(), 3, 6_700)
                .expect_err("OOP could not lead on the root street");
            assert_eq!(err, TreeError::DonkWithoutBet { street }, "{street} {donk:?}");
            let ip = donk_only(street, donk);
            assert!(TreeConfig::new(PlayerSizes::default(), ip, 3, 6_700).is_ok(), "{street}");
        }
    }
    let with_bet = StreetSizes { bet: sized.clone(), donk: sized, ..StreetSizes::default() };
    let oop = PlayerSizes { flop: with_bet, ..PlayerSizes::default() };
    assert!(TreeConfig::new(oop, PlayerSizes::default(), 3, 6_700).is_ok());
}
