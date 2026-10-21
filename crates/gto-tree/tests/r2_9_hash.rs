//! R2.9 canonical tree hash tests (O-135). R2.9 is a requirement identifier (R ID).
//!
//! Mechanism: the hash is the Secure Hash Algorithm 256 (SHA-256) digest of integer-only
//! canonical bytes, so the golden snapshot written on one machine must match on every
//! other, and the continuous integration (CI) arm64 job reruns this file (O-140). The
//! golden pins both the readable description and the hexadecimal digest of the online
//! placeholder spec's postflop tables. A property test changes one field at a time and
//! requires the hash to change, and a unit test requires order and repeats inside a size
//! table not to matter. Sizes are basis points (bp) of the pot. Failure persistence is off
//! so a red run writes no regressions file.

#[allow(dead_code, reason = "each test binary uses a subset of the shared fixtures")]
mod support;

use std::fmt::Write as _;

use gto_model::Street;
use gto_tree::{
    Player, PlayerSizes, SizeKind, SizeTable, StreetSizes, TREE_HASH_TAG, TreeConfig,
    canonical_bytes, tree_hash, tree_hash_hex,
};
use proptest::prelude::*;
use sha2::{Digest, Sha256};
use support::{RawPlayer, bucket_safe_table, free_table, raw_player};

/// One change to a configuration that must change its hash.
#[derive(Clone, Debug)]
enum Mutation {
    RaiseCap,
    Threshold,
    ToggleAllin { player: Player, street: Street, kind: SizeKind },
    AddRaiseSize { player: Player, street: Street, size_bp: u32 },
    SwapPlayers,
}

fn postflop_street() -> impl Strategy<Value = Street> {
    prop::sample::select(vec![Street::Flop, Street::Turn, Street::River])
}

fn mutation() -> impl Strategy<Value = Mutation> {
    let player = || prop::sample::select(Player::ALL.to_vec());
    prop_oneof![
        Just(Mutation::RaiseCap),
        Just(Mutation::Threshold),
        (player(), postflop_street(), prop::sample::select(SizeKind::ALL.to_vec()))
            .prop_map(|(player, street, kind)| Mutation::ToggleAllin { player, street, kind }),
        (player(), postflop_street(), support::SIZE_RANGE_BP).prop_map(
            |(player, street, size_bp)| Mutation::AddRaiseSize { player, street, size_bp }
        ),
        Just(Mutation::SwapPlayers),
    ]
}

/// A copy of `sizes` with the table of `street` and `kind` replaced.
fn with_table(
    sizes: &PlayerSizes,
    street: Street,
    kind: SizeKind,
    table: SizeTable,
) -> PlayerSizes {
    let old = sizes.street(street).expect("a postflop street");
    let new_street = match kind {
        SizeKind::Bet => StreetSizes { bet: table, ..old.clone() },
        SizeKind::Raise => StreetSizes { raise: table, ..old.clone() },
        SizeKind::Donk => StreetSizes { donk: table, ..old.clone() },
    };
    match street {
        Street::Flop => PlayerSizes { flop: new_street, ..sizes.clone() },
        Street::Turn => PlayerSizes { turn: new_street, ..sizes.clone() },
        _ => PlayerSizes { river: new_street, ..sizes.clone() },
    }
}

/// The configuration with `player`'s tables replaced.
fn with_player(cfg: &TreeConfig, player: Player, sizes: PlayerSizes) -> TreeConfig {
    let (oop, ip) = match player {
        Player::Oop => (sizes, cfg.player(Player::Ip).clone()),
        Player::Ip => (cfg.player(Player::Oop).clone(), sizes),
    };
    TreeConfig::new(oop, ip, cfg.raise_cap(), cfg.allin_threshold_bp()).expect("still valid")
}

/// The mutated configuration, or `None` when the mutation would change nothing.
fn apply(cfg: &TreeConfig, mutation: &Mutation) -> Option<TreeConfig> {
    let oop = cfg.player(Player::Oop).clone();
    let ip = cfg.player(Player::Ip).clone();
    let (cap, threshold) = (cfg.raise_cap(), cfg.allin_threshold_bp());
    match *mutation {
        Mutation::RaiseCap => TreeConfig::new(oop, ip, cap + 1, threshold).ok(),
        Mutation::Threshold => TreeConfig::new(oop, ip, cap, threshold + 1).ok(),
        Mutation::ToggleAllin { player, street, kind } => {
            let sizes = cfg.player(player);
            let table = sizes.street(street).expect("a postflop street").kind(kind);
            let toggled = SizeTable::new(table.sizes_bp(), !table.allin()).expect("same sizes");
            Some(with_player(cfg, player, with_table(sizes, street, kind, toggled)))
        }
        Mutation::AddRaiseSize { player, street, size_bp } => {
            let sizes = cfg.player(player);
            let table = sizes.street(street).expect("a postflop street").kind(SizeKind::Raise);
            if table.sizes_bp().contains(&size_bp) {
                return None;
            }
            let grown = [table.sizes_bp(), &[size_bp]].concat();
            let added = SizeTable::new(&grown, table.allin()).expect("non-zero sizes");
            Some(with_player(cfg, player, with_table(sizes, street, SizeKind::Raise, added)))
        }
        Mutation::SwapPlayers => {
            (oop != ip).then(|| TreeConfig::new(ip, oop, cap, threshold).expect("still valid"))
        }
    }
}

fn base_config(oop: &RawPlayer, ip: &RawPlayer, cap: u8, threshold: u32) -> TreeConfig {
    let oop = oop.build().expect("bucket-safe tables");
    let ip = ip.build().expect("bucket-safe tables");
    TreeConfig::new(oop, ip, cap, threshold).expect("bucket-safe tables form a configuration")
}

proptest! {
    #![proptest_config(ProptestConfig { failure_persistence: None, ..ProptestConfig::default() })]

    /// R2.9: changing any one field of a configuration changes its canonical bytes and hash.
    #[test]
    fn r2_9_hash_changes_with_any_field(
        oop in raw_player(bucket_safe_table(3), free_table(3)),
        ip in raw_player(bucket_safe_table(3), free_table(3)),
        cap in 0..=3_u8,
        threshold in 5_000..10_000_u32,
        change in mutation(),
    ) {
        let base = base_config(&oop, &ip, cap, threshold);
        let Some(changed) = apply(&base, &change) else { return Ok(()) };
        prop_assert_ne!(canonical_bytes(&base), canonical_bytes(&changed));
        prop_assert_ne!(tree_hash(&base), tree_hash(&changed));
    }
}

fn online_config() -> TreeConfig {
    TreeConfig::from_spec(&support::spec(support::ONLINE_PLACEHOLDER_JSON))
        .expect("the online placeholder spec builds a configuration")
}

/// R2.9: the golden. The description and the digest of the online placeholder tables are
/// pinned in `snapshots/r2_9_hash__r2_9_tree_hash_golden.snap`.
#[test]
fn r2_9_tree_hash_golden() {
    let cfg = online_config();
    let report =
        format!("{}\ntree_hash_hex {}\n", cfg.canonical_description(), tree_hash_hex(&cfg));
    insta::assert_snapshot!(report);
}

/// R2.9: the hash is SHA-256 over bytes that open with the tag and a NUL, and the hex form
/// is that digest in 64 lowercase digits.
#[test]
fn r2_9_hash_is_sha256_of_the_canonical_bytes() {
    let cfg = online_config();
    let bytes = canonical_bytes(&cfg);
    let tag = [TREE_HASH_TAG.as_bytes(), &[0]].concat();
    assert!(bytes.starts_with(&tag), "the bytes open with the tag and a NUL");
    let digest: [u8; 32] = Sha256::digest(&bytes).into();
    assert_eq!(tree_hash(&cfg), digest);
    let hex = digest.iter().fold(String::new(), |mut text, byte| {
        write!(text, "{byte:02x}").expect("writing to a String cannot fail");
        text
    });
    assert_eq!(tree_hash_hex(&cfg), hex);
}

/// R2.9: sizes in another order, or repeated, give the same table and the same hash.
#[test]
fn r2_9_hash_ignores_order_and_duplicates() {
    let shuffled = SizeTable::new(&[7_500, 3_300, 7_500], true).expect("non-zero sizes");
    let sorted = SizeTable::new(&[3_300, 7_500], true).expect("non-zero sizes");
    assert_eq!(shuffled, sorted);
    assert_eq!(shuffled.sizes_bp(), &[3_300, 7_500]);

    let json = support::ONLINE_PLACEHOLDER_JSON.replace("[0.33, 0.75]", "[0.75, 0.33, 0.75]");
    let reordered = TreeConfig::from_spec(&support::spec(&json)).expect("same sizes");
    assert_eq!(tree_hash(&reordered), tree_hash(&online_config()));
}
