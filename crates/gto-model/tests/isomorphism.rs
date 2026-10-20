//! R2.1 vectors for the isomorphism module: suit permutations, the canonical flop and board,
//! the 1,755 canonical flops with weights summing to 22,100, and the texture family.

use std::collections::BTreeSet;

use gto_model::cards::{Board, Card, Flop, Suit};
use gto_model::iso::{
    SuitPermutation, TextureFamily, canonical_board, canonical_flop, is_canonical_flop,
};
use gto_model::iso_table::{
    CANONICAL_FLOP_COUNT, RAW_FLOP_COUNT, canonical_flops, canonical_index, flop_weight,
    total_weight,
};
use gto_model::types::ModelError;

fn card(text: &str) -> Card {
    text.parse().expect("test card parses")
}

fn flop(text: &str) -> Flop {
    text.parse().expect("test flop parses")
}

#[test]
fn r2_1_suit_permutation_apply_and_inverse() {
    let swap =
        SuitPermutation::new([Suit::Diamonds, Suit::Clubs, Suit::Spades, Suit::Hearts]).unwrap();
    assert_eq!(swap.apply(card("Ah")), card("As"));
    assert_eq!(swap.apply(card("2c")), card("2d"));
    assert_eq!(swap.apply_suit(Suit::Spades), Suit::Hearts);
    assert_eq!(swap.inverse().apply(card("As")), card("Ah"));
    assert_eq!(swap.after(swap.inverse()), SuitPermutation::IDENTITY);
    assert_eq!(swap.inverse().after(swap), SuitPermutation::IDENTITY);
    assert_eq!(SuitPermutation::IDENTITY.apply(card("Kd")), card("Kd"));
    let identity = [Suit::Clubs, Suit::Diamonds, Suit::Hearts, Suit::Spades];
    assert_eq!(SuitPermutation::IDENTITY.mapping(), identity);
    assert_eq!(swap.apply_flop(flop("Ah7d2c")), flop("As7c2d"));
    let bad = SuitPermutation::new([Suit::Clubs, Suit::Clubs, Suit::Hearts, Suit::Spades]);
    assert!(matches!(bad, Err(ModelError::InvalidSuitPermutation(_))));
}

#[test]
fn r2_1_suit_permutation_deserializes_through_new() {
    // A mapping read from JavaScript Object Notation (JSON) goes through
    // SuitPermutation::new, so four clubs fail at the read and never reach apply_flop.
    let four_clubs = r#"["Clubs","Clubs","Clubs","Clubs"]"#;
    let err = serde_json::from_str::<SuitPermutation>(four_clubs).expect_err("not a bijection");
    assert!(err.to_string().contains("appears twice"), "{err}");
    let swap =
        SuitPermutation::new([Suit::Diamonds, Suit::Clubs, Suit::Spades, Suit::Hearts]).unwrap();
    let text = serde_json::to_string(&swap).unwrap();
    assert_eq!(text, r#"["Diamonds","Clubs","Spades","Hearts"]"#);
    assert_eq!(serde_json::from_str::<SuitPermutation>(&text).unwrap(), swap);
}

#[test]
fn r2_1_suit_permutations_are_24() {
    let all = SuitPermutation::all();
    assert_eq!(all.len(), SuitPermutation::COUNT);
    assert_eq!(all[0], SuitPermutation::IDENTITY);
    let unique: BTreeSet<SuitPermutation> = all.iter().copied().collect();
    assert_eq!(unique.len(), 24);
    assert!(all.windows(2).all(|pair| pair[0].mapping() < pair[1].mapping()));
}

#[test]
fn r2_1_canonical_flop_rainbow_a72() {
    // The smallest written flop over the 24 permutations: the top card is always a club.
    let raw = flop("Ah7d2c");
    let (canonical, perm) = canonical_flop(raw);
    assert_eq!(canonical, flop("Ac7d2h"));
    assert_eq!(perm.apply_flop(raw), canonical);
    assert_eq!(perm.inverse().apply_flop(canonical), raw);
    assert_eq!(perm.mapping(), [Suit::Hearts, Suit::Diamonds, Suit::Clubs, Suit::Spades]);
    assert_eq!(flop_weight(raw), 24);
    assert!(is_canonical_flop(canonical));
    assert!(!is_canonical_flop(raw));
    assert_eq!(canonical_flop(canonical), (canonical, SuitPermutation::IDENTITY));
}

#[test]
fn r2_1_canonical_flop_monotone_two_tone_and_paired() {
    let vectors = [
        ("AsKsQs", "AcKcQc", 4),
        ("AhKh2c", "AcKc2d", 12),
        ("Ah7d2d", "Ac7d2d", 12),
        ("Ac7d2d", "Ac7d2d", 12),
        ("KcKd2h", "KcKd2h", 12),
        ("KhKs2h", "KcKd2c", 12),
        ("KsKh2d", "KcKd2h", 12),
        ("KcKdKh", "KcKdKh", 4),
        ("2s2h2d", "2c2d2h", 4),
        ("7h7c2h", "7c7d2c", 12),
    ];
    for (raw, canonical, weight) in vectors {
        let (got, perm) = canonical_flop(flop(raw));
        assert_eq!(got, flop(canonical), "{raw}");
        assert_eq!(perm.apply_flop(flop(raw)), got, "{raw}");
        assert_eq!(flop_weight(flop(raw)), weight, "{raw}");
        assert_eq!(flop_weight(got), weight, "{raw}");
        assert!(is_canonical_flop(got), "{raw}");
    }
}

#[test]
fn r2_1_canonical_flops_count_and_weight_sum() {
    let table = canonical_flops();
    assert_eq!(table.len(), CANONICAL_FLOP_COUNT);
    assert_eq!(table.len(), 1_755);
    let sum: u32 = table.iter().map(|entry| u32::from(entry.weight)).sum();
    assert_eq!(sum, 22_100);
    assert_eq!(total_weight(), RAW_FLOP_COUNT);
    assert_eq!(RAW_FLOP_COUNT, 22_100);
    let count = |weight: u16| table.iter().filter(|entry| entry.weight == weight).count();
    assert_eq!(count(24), 286);
    assert_eq!(count(12), 1_170);
    assert_eq!(count(4), 299);
    assert_eq!(count(24) + count(12) + count(4), 1_755);
}

#[test]
fn r2_1_canonical_flops_table_order_and_index() {
    let table = canonical_flops();
    assert_eq!(table[0].flop, flop("2c2d2h"));
    assert_eq!(table[0].weight, 4);
    assert_eq!(table[1].flop, flop("3c2c2d"));
    assert_eq!(table[2].flop, flop("3c2d2h"));
    assert_eq!(table[1_754].flop, flop("AcAdAh"));
    assert!(table.windows(2).all(|pair| pair[0].flop < pair[1].flop));
    for (index, entry) in table.iter().enumerate() {
        assert!(is_canonical_flop(entry.flop), "{}", entry.flop);
        assert_eq!(canonical_index(entry.flop), Some(u16::try_from(index).unwrap()));
    }
    assert_eq!(canonical_index(flop("Ah7d2c")), None);
    let a72 = canonical_index(flop("Ac7d2h")).map(|index| table[usize::from(index)].weight);
    assert_eq!(a72, Some(24));
}

#[test]
fn r2_1_canonical_board_follows_the_flop() {
    let raw =
        Board::flop(flop("Ah7d2c")).with_turn(card("Kh")).unwrap().with_river(card("3s")).unwrap();
    let (canonical, perm) = canonical_board(raw);
    let expected =
        Board::flop(flop("Ac7d2h")).with_turn(card("Kc")).unwrap().with_river(card("3s")).unwrap();
    assert_eq!(canonical, expected);
    assert_eq!(perm.apply_board(raw), canonical);
    assert_eq!(perm.inverse().apply_board(canonical), raw);
    // A monotone flop leaves three suits free, so the turn and river take the smallest.
    let monotone =
        Board::flop(flop("AsKsQs")).with_turn(card("2h")).unwrap().with_river(card("3c")).unwrap();
    let (canonical, _) = canonical_board(monotone);
    let expected =
        Board::flop(flop("AcKcQc")).with_turn(card("2d")).unwrap().with_river(card("3h")).unwrap();
    assert_eq!(canonical, expected);
    let flop_only = Board::flop(flop("Ah7d2c"));
    assert_eq!(canonical_board(flop_only).0, Board::flop(flop("Ac7d2h")));
}

#[test]
fn r2_1_texture_family_vectors() {
    let vectors = [
        ("Ah7d2c", TextureFamily::DryAceHigh),
        ("Ac9d4h", TextureFamily::DryAceHigh),
        ("8h7d6c", TextureFamily::LowConnected),
        ("9c7d5h", TextureFamily::LowConnected),
        ("KcKd2h", TextureFamily::Paired),
        ("AcKdKh", TextureFamily::Paired),
        ("AsKsQs", TextureFamily::Monotone),
        ("7h5h2h", TextureFamily::Monotone),
        ("AhKhQc", TextureFamily::TwoToneBroadway),
        ("QcJdTd", TextureFamily::TwoToneBroadway),
        ("AhKh2c", TextureFamily::Other),
        ("AcQd7h", TextureFamily::Other),
        ("9c5d2h", TextureFamily::Other),
        ("Th7d2c", TextureFamily::Other),
    ];
    for (text, family) in vectors {
        assert_eq!(TextureFamily::of(flop(text)), family, "{text}");
    }
    for family in TextureFamily::ALL {
        assert_eq!(family.as_str().parse::<TextureFamily>().unwrap(), family);
        assert_eq!(family.to_string(), family.as_str());
    }
    assert_eq!(TextureFamily::TwoToneBroadway.as_str(), "two-tone-broadway");
    assert_eq!(TextureFamily::DryAceHigh.as_str(), "dry-ace-high");
    assert!("dry".parse::<TextureFamily>().is_err());
}
