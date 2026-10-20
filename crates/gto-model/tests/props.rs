//! The three R2.1 property tests (09 section 6, A9 section 2): the node-key round trip,
//! suit-permutation invariance of the canonical flop, and the flop weights summing to
//! 22,100. Strategies build values from their parts, so every generated key is valid by
//! construction. Failure persistence is off so a red run never writes a regressions file
//! into the tree.

use gto_model::cards::{Card, Flop, Suit};
use gto_model::iso::{SuitPermutation, canonical_flop};
use gto_model::iso_table::{canonical_flops, canonical_index, flop_weight, total_weight};
use gto_model::keys::NodeKey;
use gto_model::tokens::ActionToken;
use gto_model::types::{Cbb, ConfigId, Position, PositionPair};
use proptest::prelude::*;

fn distinct_cards(count: usize) -> impl Strategy<Value = Vec<Card>> {
    proptest::sample::subsequence((0..Card::COUNT).collect::<Vec<u8>>(), count)
        .prop_shuffle()
        .prop_map(|indexes| {
            indexes
                .into_iter()
                .map(|index| Card::from_index(index).expect("index below 52"))
                .collect()
        })
}

fn flop() -> impl Strategy<Value = Flop> {
    distinct_cards(3)
        .prop_map(|cards| Flop::new([cards[0], cards[1], cards[2]]).expect("distinct cards"))
}

fn suit_permutation() -> impl Strategy<Value = SuitPermutation> {
    Just(Suit::ALL.to_vec()).prop_shuffle().prop_map(|suits| {
        SuitPermutation::new([suits[0], suits[1], suits[2], suits[3]])
            .expect("a shuffle is a permutation")
    })
}

fn size() -> impl Strategy<Value = Cbb> {
    (1..100_000u32).prop_map(Cbb)
}

fn action_token() -> impl Strategy<Value = ActionToken> {
    prop_oneof![
        Just(ActionToken::Fold),
        Just(ActionToken::Check),
        Just(ActionToken::Call),
        Just(ActionToken::Limp),
        size().prop_map(ActionToken::Straddle),
        size().prop_map(ActionToken::Bet),
        size().prop_map(ActionToken::Raise),
        Just(ActionToken::AllIn),
    ]
}

fn line() -> impl Strategy<Value = Vec<ActionToken>> {
    prop::collection::vec(action_token(), 0..6)
}

fn config_id() -> impl Strategy<Value = ConfigId> {
    "cfg_[2-9]_(live|online)_[a-z0-9]{1,6}_[0-9]{2,3}(_straddle)?".prop_map(|text| {
        ConfigId::new(text).expect("the pattern stays inside the config id charset")
    })
}

fn position_pair() -> impl Strategy<Value = PositionPair> {
    proptest::sample::subsequence(Position::ALL.to_vec(), 2)
        .prop_map(|seats| PositionPair::new(seats[0], seats[1]).expect("two distinct seats"))
}

fn node_key() -> impl Strategy<Value = NodeKey> {
    let parts = (
        config_id(),
        position_pair(),
        line(),
        distinct_cards(5),
        line(),
        line(),
        line(),
        0..4usize,
    );
    parts.prop_map(
        |(cfg, seats, preflop, cards, flop_actions, turn_actions, river_actions, streets)| {
            let key = NodeKey::preflop(cfg, seats, preflop);
            if streets == 0 {
                return key;
            }
            let flop_cards = Flop::new([cards[0], cards[1], cards[2]]).expect("distinct cards");
            let key = key.with_flop(flop_cards, flop_actions).expect("no flop yet");
            if streets == 1 {
                return key;
            }
            let key = key.with_turn(cards[3], turn_actions).expect("turn after flop");
            if streets == 2 {
                return key;
            }
            key.with_river(cards[4], river_actions).expect("river after turn")
        },
    )
}

proptest! {
    #![proptest_config(ProptestConfig { failure_persistence: None, ..ProptestConfig::default() })]

    /// R2.1: a node key displays and parses back to itself, and the text round-trips too.
    #[test]
    fn r2_1_prop_node_key_round_trip(key in node_key()) {
        let text = key.to_string();
        let parsed: NodeKey = text.parse().expect("a displayed key parses");
        prop_assert_eq!(&parsed, &key);
        prop_assert_eq!(parsed.to_string(), text);
    }

    /// R2.1: relabeling the suits of a flop never changes its canonical flop, and the
    /// returned permutation maps the raw flop onto it.
    #[test]
    fn r2_1_prop_canonical_flop_is_suit_permutation_invariant(raw in flop(), perm in suit_permutation()) {
        let (canonical, to_canonical) = canonical_flop(raw);
        let permuted = perm.apply_flop(raw);
        let (canonical_of_permuted, _) = canonical_flop(permuted);
        prop_assert_eq!(canonical_of_permuted, canonical);
        prop_assert_eq!(to_canonical.apply_flop(raw), canonical);
        prop_assert_eq!(to_canonical.inverse().apply_flop(canonical), raw);
        prop_assert_eq!(canonical_flop(canonical).0, canonical);
        prop_assert_eq!(flop_weight(permuted), flop_weight(raw));
    }

    /// R2.1: every flop's canonical form is in the table, carries its class weight, and the
    /// table's weights sum to 22,100 over 1,755 entries.
    #[test]
    fn r2_1_prop_flop_weights_sum_22100(raw in flop()) {
        let (canonical, _) = canonical_flop(raw);
        let index = canonical_index(canonical).expect("a canonical flop is in the table");
        let entry = canonical_flops()[usize::from(index)];
        prop_assert_eq!(entry.flop, canonical);
        prop_assert_eq!(entry.weight, flop_weight(raw));
        prop_assert!([4, 12, 24].contains(&entry.weight));
        prop_assert_eq!(canonical_flops().len(), 1_755);
        prop_assert_eq!(total_weight(), 22_100);
    }
}
