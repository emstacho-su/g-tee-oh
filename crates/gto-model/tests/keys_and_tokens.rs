//! R2.1 vectors for the keys-and-tokens module: action tokens and lines, node keys parsed
//! and displayed against the A3 section 1 grammar, and spot-class keys (06 section 2).

use gto_model::cards::{Card, Flop};
use gto_model::keys::{NodeKey, StreetSection};
use gto_model::spot_class::{ActionFamily, DepthBand, SpotClass, SpotClassKey};
use gto_model::tokens::{ActionToken, format_line, parse_line};
use gto_model::types::{
    Cbb, ConfigId, GameConfig, GameFormat, ModelError, Position, PositionPair, Stake, Street,
    TableSize,
};

const A3_EXAMPLE: &str = "cfg_9_live_13_150/BB-BTN/r300.c|Ah7d2c|x.b250.c|Kh|x";

fn card(text: &str) -> Card {
    text.parse().expect("test card parses")
}

fn flop(text: &str) -> Flop {
    text.parse().expect("test flop parses")
}

fn pair(a: Position, b: Position) -> PositionPair {
    PositionPair::new(a, b).expect("two different seats")
}

fn cfg(text: &str) -> ConfigId {
    ConfigId::new(text).expect("test config id is valid")
}

fn key(text: &str) -> NodeKey {
    text.parse().expect("test key parses")
}

fn line(text: &str) -> Vec<ActionToken> {
    parse_line(text).expect("test line parses")
}

fn live_150() -> GameConfig {
    GameConfig::new(GameFormat::Live, TableSize::NINE_HANDED, Stake::live_1_3(), Cbb::from_bb(150))
}

fn online_100() -> GameConfig {
    GameConfig::new(GameFormat::Online, TableSize::SIX_MAX, Stake::online(), Cbb::from_bb(100))
}

#[test]
fn r2_1_action_token_round_trip() {
    use ActionToken as T;
    let vectors = [
        ("f", T::Fold),
        ("x", T::Check),
        ("c", T::Call),
        ("l", T::Limp),
        ("s200", T::Straddle(Cbb(200))),
        ("b250", T::Bet(Cbb(250))),
        ("r300", T::Raise(Cbb(300))),
        ("a", T::AllIn),
        ("b1", T::Bet(Cbb(1))),
        ("r100000", T::Raise(Cbb(100_000))),
    ];
    for (text, token) in vectors {
        assert_eq!(text.parse::<T>().unwrap(), token, "{text}");
        assert_eq!(token.to_string(), text);
    }
    assert_eq!(T::Bet(Cbb(250)).size(), Some(Cbb(250)));
    assert_eq!(T::Call.size(), None);
    assert!(T::Bet(Cbb(1)).is_aggressive() && T::Raise(Cbb(1)).is_aggressive());
    assert!(T::AllIn.is_aggressive());
    assert!(!T::Call.is_aggressive() && !T::Straddle(Cbb(200)).is_aggressive());
    assert!(!T::Limp.is_aggressive() && !T::Check.is_aggressive() && !T::Fold.is_aggressive());
    assert!(T::Fold.is_fold() && !T::Check.is_fold());
}

#[test]
fn r2_1_action_token_rejects() {
    let bad = [
        "", "b", "r", "s", "b0", "r0", "b-1", "b+5", "b0250", "B250", "F", "fold", "k", "a1", "c2",
        "x0", "b250x", "b 250", " f", "b2.5",
    ];
    for text in bad {
        let parsed = text.parse::<ActionToken>();
        assert!(matches!(parsed, Err(ModelError::InvalidToken(_))), "{text:?}");
    }
}

#[test]
fn r2_1_action_line_round_trip() {
    use ActionToken as T;
    assert_eq!(line("r300.c"), vec![T::Raise(Cbb(300)), T::Call]);
    assert_eq!(line("x.b250.c"), vec![T::Check, T::Bet(Cbb(250)), T::Call]);
    assert_eq!(line("f"), vec![T::Fold]);
    assert_eq!(line(""), Vec::<T>::new());
    assert_eq!(format_line(&[T::Raise(Cbb(300)), T::Call]), "r300.c");
    assert_eq!(format_line(&[]), "");
    for text in ["r300.c", "x.b250.c", "s200.l.r600.a", ""] {
        assert_eq!(format_line(&line(text)), text);
    }
}

#[test]
fn r2_1_action_line_rejects() {
    for text in ["r300..c", ".r300", "r300.", ".", "r300,c", "r300 c", "r300.k"] {
        let err = parse_line(text).unwrap_err();
        let expected = matches!(err, ModelError::InvalidLine(..) | ModelError::InvalidToken(_));
        assert!(expected, "{text:?} gave {err}");
    }
}

#[test]
fn r2_1_node_key_parse_a3_example() {
    use ActionToken as T;
    let parsed = key(A3_EXAMPLE);
    assert_eq!(parsed.config_id, cfg("cfg_9_live_13_150"));
    assert_eq!(parsed.pair, pair(Position::Bb, Position::Btn));
    assert_eq!(parsed.preflop, vec![T::Raise(Cbb(300)), T::Call]);
    let flop_section =
        StreetSection { cards: flop("Ah7d2c"), actions: vec![T::Check, T::Bet(Cbb(250)), T::Call] };
    assert_eq!(parsed.flop, Some(flop_section));
    assert_eq!(parsed.turn, Some(StreetSection { cards: card("Kh"), actions: vec![T::Check] }));
    assert_eq!(parsed.river, None);
    assert_eq!(parsed.street(), Street::Turn);
    assert_eq!(parsed.line(), "r300.c");
    assert_eq!(parsed.actions_on(Street::Preflop), &[T::Raise(Cbb(300)), T::Call]);
    assert_eq!(parsed.actions_on(Street::Flop), &[T::Check, T::Bet(Cbb(250)), T::Call]);
    assert_eq!(parsed.actions_on(Street::Turn), &[T::Check]);
    assert_eq!(parsed.actions_on(Street::River), Vec::<T>::new());
    let board = parsed.board().unwrap();
    assert_eq!(board.cards(), vec![card("Ah"), card("7d"), card("2c"), card("Kh")]);
    assert_eq!(parsed.validate(), Ok(()));
}

#[test]
fn r2_1_node_key_display_a3_example() {
    use ActionToken as T;
    let preflop = vec![T::Raise(Cbb(300)), T::Call];
    let built =
        NodeKey::preflop(cfg("cfg_9_live_13_150"), pair(Position::Btn, Position::Bb), preflop)
            .with_flop(flop("2c7dAh"), vec![T::Check, T::Bet(Cbb(250)), T::Call])
            .unwrap()
            .with_turn(card("Kh"), vec![T::Check])
            .unwrap();
    assert_eq!(built.to_string(), A3_EXAMPLE);
    assert_eq!(built, key(A3_EXAMPLE));
}

#[test]
fn r2_1_node_key_root_preflop_and_first_flop_decision() {
    let root = key("cfg_6_online_100/BB-BTN/");
    assert_eq!(root.preflop, Vec::<ActionToken>::new());
    assert_eq!(root.flop, None);
    assert_eq!(root.street(), Street::Preflop);
    assert_eq!(root.board(), None);
    assert_eq!(root.line(), "");
    assert_eq!(root.to_string(), "cfg_6_online_100/BB-BTN/");
    let by_hand =
        NodeKey::preflop(cfg("cfg_6_online_100"), pair(Position::Bb, Position::Btn), vec![]);
    assert_eq!(by_hand, root);
    let open = key("cfg_6_online_100/BB-BTN/r250");
    assert_eq!(open.preflop, vec![ActionToken::Raise(Cbb(250))]);
    assert_eq!(open.street(), Street::Preflop);
    assert_eq!(open.to_string(), "cfg_6_online_100/BB-BTN/r250");
    let first = key("cfg_6_online_100/BB-BTN/r250.c|Ah7d2c|");
    assert_eq!(first.street(), Street::Flop);
    assert_eq!(first.flop.as_ref().map(|section| section.actions.len()), Some(0));
    assert_eq!(first.to_string(), "cfg_6_online_100/BB-BTN/r250.c|Ah7d2c|");
}

#[test]
fn r2_1_node_key_river() {
    let text = "cfg_9_live_13_150/BB-BTN/r300.c|Ah7d2c|x.b250.c|Kh|x.x|3s|b1000";
    let river = key(text);
    assert_eq!(river.street(), Street::River);
    let section = StreetSection { cards: card("3s"), actions: vec![ActionToken::Bet(Cbb(1_000))] };
    assert_eq!(river.river, Some(section));
    assert_eq!(river.board().unwrap().cards().len(), 5);
    assert_eq!(river.to_string(), text);
    let built = key("cfg_9_live_13_150/BB-BTN/r300.c|Ah7d2c|x.b250.c|Kh|x.x")
        .with_river(card("3s"), vec![ActionToken::Bet(Cbb(1_000))])
        .unwrap();
    assert_eq!(built, river);
}

#[test]
fn r2_1_node_key_rejects_malformed_text() {
    let bad = [
        "",
        "cfg_9_live_13_150",
        "cfg_9_live_13_150/BB-BTN",
        "cfg_9_live_13_150/r300.c",
        "/BB-BTN/",
        "CFG_9/BB-BTN/",
        "cfg_9_live_13_150/BB-XX/",
        "cfg_9_live_13_150/BTN-BB/",
        "cfg_9_live_13_150/BB-BB/",
        "cfg_9_live_13_150/BB-BTN/r300.k",
        "cfg_9_live_13_150/BB-BTN/r300.c|Ah7d2c",
        "cfg_9_live_13_150/BB-BTN/r300.c|Ah7d|x",
        "cfg_9_live_13_150/BB-BTN/r300.c|Ah7d2c|x|KhQh|x",
        "cfg_9_live_13_150/BB-BTN/r300.c|Ah7d2c|x|Ah|x",
        "cfg_9_live_13_150/BB-BTN/r300.c|Ah7d2c|x|Kh|x|Kh|x",
        "cfg_9_live_13_150/BB-BTN/r300.c|Ah7d2c|x|Kh|x|3s|x|2d|x",
        "cfg_9_live_13_150/BB-BTN/r300.c|ah7d2c|x",
        "cfg_9_live_13_150/BB-BTN/r300.c|2c7dAh|x",
        "cfg_9_live_13_150/BB-BTN/r300.c|7dAh2c|x|Kh|x",
        "cfg_9_live_13_150/BB-BTN/r300.c/x|Ah7d2c|x",
    ];
    for text in bad {
        assert!(text.parse::<NodeKey>().is_err(), "{text:?} should not parse");
    }
}

#[test]
fn r2_1_node_key_builders_uphold_the_invariants() {
    let preflop = NodeKey::preflop(
        cfg("cfg_9_live_13_150"),
        pair(Position::Bb, Position::Btn),
        line("r300.c"),
    );
    let early_turn = preflop.clone().with_turn(card("Kh"), vec![]);
    assert!(matches!(early_turn, Err(ModelError::InvalidNodeKey(..))));
    let early_river = preflop.clone().with_river(card("Kh"), vec![]);
    assert!(matches!(early_river, Err(ModelError::InvalidNodeKey(..))));
    let on_flop = preflop.with_flop(flop("Ah7d2c"), line("x")).unwrap();
    let twice = on_flop.clone().with_flop(flop("Ah7d2c"), vec![]);
    assert!(matches!(twice, Err(ModelError::InvalidNodeKey(..))));
    let dup_turn = on_flop.clone().with_turn(card("Ah"), vec![]);
    assert!(matches!(dup_turn, Err(ModelError::DuplicateCard(_))));
    let on_turn = on_flop.clone().with_turn(card("Kh"), line("x")).unwrap();
    let dup_river = on_turn.with_river(card("7d"), vec![]);
    assert!(matches!(dup_river, Err(ModelError::DuplicateCard(_))));
    let river_section = Some(StreetSection { cards: card("3s"), actions: vec![] });
    let skipped_turn = NodeKey { river: river_section, ..on_flop.clone() };
    assert!(matches!(skipped_turn.validate(), Err(ModelError::InvalidNodeKey(..))));
    let turn_section = Some(StreetSection { cards: card("2c"), actions: vec![] });
    let repeated = NodeKey { turn: turn_section, ..on_flop };
    assert!(matches!(repeated.validate(), Err(ModelError::DuplicateCard(_))));
}

#[test]
fn r2_1_spot_class_key_vectors() {
    let facing_open =
        SpotClass::classify(&live_150(), &key("cfg_9_live_13_150/BB-BTN/r300")).unwrap();
    let expected = SpotClass {
        street: Street::Preflop,
        format: GameFormat::Live,
        depth_band: DepthBand::OneFifty,
        family: ActionFamily::FacingOpen,
        pair: pair(Position::Bb, Position::Btn),
    };
    assert_eq!(facing_open, expected);
    assert_eq!(facing_open.key().unwrap().as_str(), "preflop/live/150/facing-open/BB-BTN");
    let rfi = SpotClass::classify(&online_100(), &key("cfg_6_online_100/BB-BTN/")).unwrap();
    assert_eq!(rfi.key().unwrap().to_string(), "preflop/online/100/rfi/BB-BTN");
    let three_bet =
        SpotClass::classify(&online_100(), &key("cfg_6_online_100/SB-CO/r250.r800")).unwrap();
    assert_eq!(three_bet.key().unwrap().as_str(), "preflop/online/100/facing-3bet/SB-CO");
}

#[test]
fn r2_1_spot_class_key_rejects_a_postflop_class() {
    // A key is validated text, so a class on a street that has no classes in v1 gets an
    // error from key() rather than text that from_key would then reject.
    let preflop = SpotClass {
        street: Street::Preflop,
        format: GameFormat::Live,
        depth_band: DepthBand::OneFifty,
        family: ActionFamily::FacingOpen,
        pair: pair(Position::Bb, Position::Btn),
    };
    assert_eq!(preflop.key().unwrap().as_str(), "preflop/live/150/facing-open/BB-BTN");
    let postflop = SpotClass { street: Street::Flop, ..preflop };
    assert!(matches!(postflop.key(), Err(ModelError::InvalidSpotClassKey(..))));
}

#[test]
fn r2_1_spot_class_classify_rejects_a_key_from_another_config() {
    // The key names its configuration, so classifying it under a different one is a
    // mismatch that names both identifiers.
    let live_key = key("cfg_9_live_13_150/BB-BTN/r300");
    let expected = ModelError::ConfigMismatch {
        config: cfg("cfg_6_online_100"),
        key: cfg("cfg_9_live_13_150"),
    };
    assert_eq!(SpotClass::classify(&online_100(), &live_key), Err(expected));
}

#[test]
fn r2_1_spot_class_key_round_trip_and_rejects() {
    let text = "preflop/live/150/facing-open/BB-BTN";
    let parsed = SpotClassKey::new(text).unwrap();
    assert_eq!(parsed.as_str(), text);
    assert_eq!(parsed.to_string(), text);
    let class = SpotClass::from_key(&parsed).unwrap();
    assert_eq!(class.key().unwrap(), parsed);
    assert_eq!(text.parse::<SpotClassKey>().unwrap(), parsed);
    let bad = [
        "",
        "preflop/live/150/facing-open",
        "flop/live/150/facing-open/BB-BTN",
        "preflop/casino/150/facing-open/BB-BTN",
        "preflop/live/175/facing-open/BB-BTN",
        "preflop/live/150/open/BB-BTN",
        "preflop/live/150/facing-open/BTN-BB",
        "preflop/live/150/facing-open/BB-BTN/x",
    ];
    for text in bad {
        let parsed = SpotClassKey::new(text);
        assert!(matches!(parsed, Err(ModelError::InvalidSpotClassKey(..))), "{text:?}");
    }
    let postflop = SpotClass::classify(&live_150(), &key(A3_EXAMPLE));
    assert_eq!(postflop, Err(ModelError::PostflopSpotClass(Street::Turn)));
}

#[test]
fn r2_1_action_family_classification() {
    use ActionFamily as F;
    let bb_btn = pair(Position::Bb, Position::Btn);
    let sb_bb = pair(Position::Sb, Position::Bb);
    let utg_co = pair(Position::Utg, Position::Co);
    let vectors = [
        (bb_btn, "", F::Rfi),
        (bb_btn, "f.f", F::Rfi),
        (bb_btn, "r300", F::FacingOpen),
        (bb_btn, "f.r300.f", F::FacingOpen),
        (bb_btn, "r300.r900", F::Facing3Bet),
        (bb_btn, "r300.r900.r2000", F::Facing4Bet),
        (bb_btn, "r300.r900.r2000.r5000", F::Facing4Bet),
        (utg_co, "r250.c", F::Squeeze),
        (utg_co, "r250.c.c", F::Squeeze),
        (bb_btn, "l", F::LimpedIsolation),
        (bb_btn, "l.l", F::LimpedIsolation),
        (bb_btn, "s200", F::StraddledPot),
        (bb_btn, "s200.r600.r1800", F::StraddledPot),
        (sb_bb, "", F::BlindVsBlind),
        (sb_bb, "r300", F::BlindVsBlind),
        (sb_bb, "l", F::BlindVsBlind),
    ];
    for (seats, text, family) in vectors {
        assert_eq!(F::classify(seats, &line(text)), family, "{seats} {text:?}");
    }
    for family in F::ALL {
        assert_eq!(family.as_str().parse::<F>().unwrap(), family);
        assert_eq!(family.to_string(), family.as_str());
    }
    assert_eq!(F::Facing3Bet.as_str(), "facing-3bet");
    assert_eq!(F::BlindVsBlind.as_str(), "blind-vs-blind");
    assert!("3bet".parse::<F>().is_err());
}

#[test]
fn r2_1_depth_band_edges() {
    use DepthBand as D;
    let vectors = [
        (0, D::Short),
        (1_500, D::Short),
        (4_999, D::Short),
        (5_000, D::Hundred),
        (10_000, D::Hundred),
        (12_499, D::Hundred),
        (12_500, D::OneFifty),
        (15_000, D::OneFifty),
        (17_499, D::OneFifty),
        (17_500, D::TwoHundred),
        (20_000, D::TwoHundred),
        (24_999, D::TwoHundred),
        (25_000, D::Deep),
        (30_000, D::Deep),
    ];
    for (cbb, band) in vectors {
        assert_eq!(D::from_cbb(Cbb(cbb)), band, "{cbb}");
    }
    assert_eq!(D::EDGES_CBB, [5_000, 12_500, 17_500, 25_000]);
    let names = [
        (D::Short, "short"),
        (D::Hundred, "100"),
        (D::OneFifty, "150"),
        (D::TwoHundred, "200"),
        (D::Deep, "deep"),
    ];
    for (band, text) in names {
        assert_eq!(band.as_str(), text);
        assert_eq!(band.to_string(), text);
        assert_eq!(text.parse::<D>().unwrap(), band);
    }
    assert!("175".parse::<D>().is_err());
}
