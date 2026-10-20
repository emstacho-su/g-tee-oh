//! R2.1 vectors for the cards-and-indexes module: card characters and integers, the written
//! flop order, boards, the 169-class order and the 1,326-combo order (A3 section 1).

use std::collections::BTreeSet;

use gto_model::cards::{Board, Card, Flop, Rank, Suit, format_cards, parse_cards};
use gto_model::index::{ComboId, HandClass, HandClassKind};
use gto_model::types::{ModelError, Street};

fn card(text: &str) -> Card {
    text.parse().expect("test card parses")
}

fn class(text: &str) -> HandClass {
    text.parse().expect("test class parses")
}

fn combo(text: &str) -> ComboId {
    text.parse().expect("test combo parses")
}

#[test]
fn r2_1_rank_and_suit_characters() {
    assert_eq!(Rank::CHARS.iter().collect::<String>(), "23456789TJQKA");
    assert_eq!(Suit::CHARS.iter().collect::<String>(), "cdhs");
    assert_eq!(Rank::Two.index(), 0);
    assert_eq!(Rank::Ace.index(), 12);
    assert_eq!(Rank::Ten.to_char(), 'T');
    assert_eq!(Rank::from_char('K').unwrap(), Rank::King);
    assert!(Rank::from_char('k').is_err());
    assert!(Rank::from_char('1').is_err());
    assert_eq!(Suit::Spades.index(), 3);
    assert_eq!(Suit::from_char('d').unwrap(), Suit::Diamonds);
    assert!(Suit::from_char('D').is_err());
    assert!(Rank::from_index(13).is_err());
    assert!(Suit::from_index(4).is_err());
    assert!(Rank::Ten.is_broadway() && Rank::Ace.is_broadway() && !Rank::Nine.is_broadway());
    assert_eq!(Rank::Queen.to_string(), "Q");
    assert_eq!(Suit::Hearts.to_string(), "h");
}

#[test]
fn r2_1_card_integer_vectors() {
    // rank * 4 + suit, deuce 0 and clubs 0 (A2 section 2).
    let vectors = [
        ("2c", 0),
        ("2d", 1),
        ("2s", 3),
        ("3c", 4),
        ("7d", 21),
        ("Th", 34),
        ("Kc", 44),
        ("Ah", 50),
        ("As", 51),
    ];
    for (text, index) in vectors {
        let c = card(text);
        assert_eq!(c.index(), index, "{text}");
        assert_eq!(Card::from_index(index).unwrap(), c);
        assert_eq!(c.to_string(), text);
    }
    assert_eq!(card("Th").rank(), Rank::Ten);
    assert_eq!(card("Th").suit(), Suit::Hearts);
    assert_eq!(Card::new(Rank::Ace, Suit::Hearts), card("Ah"));
    assert!(Card::from_index(52).is_err());
    assert_eq!(Card::all().count(), 52);
    assert_eq!(Card::all().next(), Some(card("2c")));
    assert_eq!(Card::all().last(), Some(card("As")));
}

#[test]
fn r2_1_card_round_trip_all_52() {
    for index in 0..52u8 {
        let c = Card::from_index(index).unwrap();
        let text = c.to_string();
        assert_eq!(text.len(), 2);
        assert_eq!(text.parse::<Card>().unwrap(), c);
    }
}

#[test]
fn r2_1_card_rejects_bad_input() {
    for text in ["", "A", "Ahh", "Xx", "ah", "AH", "aH", "10h", "A h", "1c"] {
        assert!(matches!(text.parse::<Card>(), Err(ModelError::InvalidCard(_))), "{text:?}");
    }
}

#[test]
fn r2_1_parse_cards_back_to_back() {
    let cards = parse_cards("Ah7d2c").unwrap();
    assert_eq!(cards, vec![card("Ah"), card("7d"), card("2c")]);
    assert_eq!(format_cards(&cards), "Ah7d2c");
    assert_eq!(parse_cards("").unwrap(), Vec::<Card>::new());
    assert!(matches!(parse_cards("AhAh"), Err(ModelError::DuplicateCard(_))));
    assert!(matches!(parse_cards("Ah7"), Err(ModelError::InvalidCard(_))));
    assert!(matches!(parse_cards("Ah 7d"), Err(ModelError::InvalidCard(_))));
}

#[test]
fn r2_1_flop_written_order() {
    // Rank descending, then suit ascending (A3 section 1).
    let vectors = [
        ("2c7dAh", "Ah7d2c"),
        ("Ah7d2c", "Ah7d2c"),
        ("KhKc2d", "KcKh2d"),
        ("2s2h2d", "2d2h2s"),
        ("AsKsQs", "AsKsQs"),
    ];
    for (given, written) in vectors {
        let flop: Flop = given.parse().unwrap();
        assert_eq!(flop.to_string(), written, "{given}");
        assert_eq!(written.parse::<Flop>().unwrap(), flop);
    }
    let flop = Flop::new([card("2c"), card("Ah"), card("7d")]).unwrap();
    assert_eq!(flop.cards(), [card("Ah"), card("7d"), card("2c")]);
    assert_eq!(flop.ranks(), [Rank::Ace, Rank::Seven, Rank::Two]);
    assert_eq!(flop.suits(), [Suit::Hearts, Suit::Diamonds, Suit::Clubs]);
    assert!(flop.contains(card("7d")) && !flop.contains(card("7c")));
    let dup = Flop::new([card("Ah"), card("Ah"), card("2c")]);
    assert!(matches!(dup, Err(ModelError::DuplicateCard(_))));
    assert!("Ah7d".parse::<Flop>().is_err());
    assert!("Ah7d2cKs".parse::<Flop>().is_err());
    assert!("Ah7dAh".parse::<Flop>().is_err());
}

#[test]
fn r2_1_board_streets_and_distinct_cards() {
    let flop: Flop = "Ah7d2c".parse().unwrap();
    let board = Board::flop(flop);
    assert_eq!(board.street(), Street::Flop);
    assert_eq!(board.turn(), None);
    let turn = board.with_turn(card("Kh")).unwrap();
    assert_eq!(turn.street(), Street::Turn);
    assert_eq!(turn.turn(), Some(card("Kh")));
    let river = turn.with_river(card("3s")).unwrap();
    assert_eq!(river.street(), Street::River);
    assert_eq!(river.river(), Some(card("3s")));
    assert_eq!(river.cards(), vec![card("Ah"), card("7d"), card("2c"), card("Kh"), card("3s")]);
    assert_eq!(river.flop_cards(), flop);
    assert!(river.contains(card("3s")) && !river.contains(card("3c")));
    assert_eq!(Board::new(flop, Some(card("Kh")), Some(card("3s"))).unwrap(), river);
    assert!(matches!(board.with_turn(card("Ah")), Err(ModelError::DuplicateCard(_))));
    assert!(matches!(board.with_river(card("3s")), Err(ModelError::InvalidBoard(_))));
    assert!(matches!(turn.with_turn(card("3s")), Err(ModelError::InvalidBoard(_))));
    assert!(matches!(turn.with_river(card("Kh")), Err(ModelError::DuplicateCard(_))));
    let no_turn = Board::new(flop, None, Some(card("3s")));
    assert!(matches!(no_turn, Err(ModelError::InvalidBoard(_))));
}

#[test]
fn r2_1_class_index_order() {
    // Pairs AA to 22, then suited by high card then kicker, then offsuit (A3 section 1).
    let vectors = [
        (0, "AA"),
        (1, "KK"),
        (12, "22"),
        (13, "AKs"),
        (14, "AQs"),
        (24, "A2s"),
        (25, "KQs"),
        (36, "QJs"),
        (55, "T9s"),
        (80, "72s"),
        (90, "32s"),
        (91, "AKo"),
        (102, "A2o"),
        (158, "72o"),
        (168, "32o"),
    ];
    for (index, name) in vectors {
        let class = HandClass::from_index(index).unwrap();
        assert_eq!(class.to_string(), name, "index {index}");
        assert_eq!(name.parse::<HandClass>().unwrap().index(), index, "{name}");
    }
    assert!(HandClass::from_index(169).is_err());
    assert_eq!(HandClass::all().count(), 169);
}

#[test]
fn r2_1_class_features_and_round_trip() {
    let names: Vec<String> = HandClass::all().map(|class| class.to_string()).collect();
    let unique: BTreeSet<&String> = names.iter().collect();
    assert_eq!(unique.len(), 169);
    for class in HandClass::all() {
        assert_eq!(class.to_string().parse::<HandClass>().unwrap(), class);
        assert_eq!(HandClass::new(class.high(), class.low(), class.kind()).unwrap(), class);
    }
    assert_eq!(class("AA").kind(), HandClassKind::Pair);
    assert_eq!(class("AKs").kind(), HandClassKind::Suited);
    assert_eq!(class("AKo").kind(), HandClassKind::Offsuit);
    assert_eq!((class("T9s").high(), class("T9s").low()), (Rank::Ten, Rank::Nine));
    assert_eq!((class("55").high(), class("55").low()), (Rank::Five, Rank::Five));
    let reversed = HandClass::new(Rank::Nine, Rank::Ten, HandClassKind::Suited).unwrap();
    assert_eq!(reversed, class("T9s"));
    assert!(HandClass::new(Rank::Ace, Rank::Ace, HandClassKind::Suited).is_err());
    assert!(HandClass::new(Rank::Ace, Rank::King, HandClassKind::Pair).is_err());
}

#[test]
fn r2_1_class_rejects_non_canonical_names() {
    for text in ["", "AK", "KAs", "AAs", "AAo", "aks", "AKS", "A1s", "AKx", "A", "AKss"] {
        let parsed = text.parse::<HandClass>();
        assert!(matches!(parsed, Err(ModelError::InvalidHandClass(_))), "{text:?}");
    }
}

#[test]
fn r2_1_class_combo_counts() {
    assert_eq!(class("AA").combo_count(), 6);
    assert_eq!(class("AKs").combo_count(), 4);
    assert_eq!(class("AKo").combo_count(), 12);
    let total: u32 = HandClass::all().map(|class| u32::from(class.combo_count())).sum();
    assert_eq!(total, 1326);
    for class in HandClass::all() {
        let combos = class.combos();
        assert_eq!(combos.len(), usize::from(class.combo_count()), "{class}");
        assert!(combos.iter().all(|combo| combo.class() == class), "{class}");
        assert!(combos.windows(2).all(|pair| pair[0] < pair[1]), "{class}");
    }
}

#[test]
fn r2_1_combo_index_order() {
    // (first card, second card) with first below second in card-integer order (A3 section 1),
    // written rank descending then suit ascending.
    let vectors = [
        (0, "2c2d"),
        (1, "2c2h"),
        (2, "2c2s"),
        (3, "3c2c"),
        (50, "As2c"),
        (51, "2d2h"),
        (1319, "AsKs"),
        (1320, "AcAd"),
        (1325, "AhAs"),
    ];
    for (index, text) in vectors {
        let combo = ComboId::from_index(index).unwrap();
        assert_eq!(combo.to_string(), text, "index {index}");
        assert_eq!(text.parse::<ComboId>().unwrap().index(), index, "{text}");
    }
    assert_eq!(ComboId::from_index(0).unwrap().cards(), (card("2c"), card("2d")));
    assert_eq!(ComboId::from_index(1325).unwrap().cards(), (card("Ah"), card("As")));
    assert!(ComboId::from_index(1326).is_err());
    assert_eq!(ComboId::all().count(), 1326);
}

#[test]
fn r2_1_combo_from_cards_and_class() {
    let aks = ComboId::from_cards(card("As"), card("Ks")).unwrap();
    assert_eq!(ComboId::from_cards(card("Ks"), card("As")).unwrap(), aks);
    assert_eq!(aks.index(), 1319);
    let dup = ComboId::from_cards(card("As"), card("As"));
    assert!(matches!(dup, Err(ModelError::DuplicateCard(_))));
    let vectors = [
        ("2c2d", "22"),
        ("3c2c", "32s"),
        ("As2c", "A2o"),
        ("AsKs", "AKs"),
        ("AcAd", "AA"),
        ("KcAs", "AKo"),
        ("Th9h", "T9s"),
    ];
    for (text, name) in vectors {
        assert_eq!(combo(text).class(), class(name), "{text}");
    }
    assert_eq!(combo("KcAs").to_string(), "AsKc");
    assert!(combo("AsKs").conflicts_with(&[card("Ks"), card("7d")]));
    assert!(!combo("AsKs").conflicts_with(&[card("Kc"), card("7d")]));
    for text in ["", "As", "AsAs", "AsKsQs", "asks"] {
        assert!(text.parse::<ComboId>().is_err(), "{text:?}");
    }
}

#[test]
fn r2_1_combo_round_trip_all_1326() {
    let mut per_class = [0u8; 169];
    for combo in ComboId::all() {
        let (low, high) = combo.cards();
        assert!(low < high);
        assert_eq!(ComboId::from_cards(low, high).unwrap(), combo);
        assert_eq!(combo.to_string().parse::<ComboId>().unwrap(), combo);
        per_class[usize::from(combo.class().index())] += 1;
    }
    for class in HandClass::all() {
        assert_eq!(per_class[usize::from(class.index())], class.combo_count(), "{class}");
    }
}
