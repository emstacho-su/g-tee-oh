//! Vectors for the shared plain types in `types.rs`, which every module group builds on:
//! cbb arithmetic, streets, seats and their orders, canonical position pairs, table sizes,
//! formats and configuration identifiers. These pass from the first commit because the
//! shared types are plain data and ship implemented.

use gto_model::types::{
    Cbb, ConfigId, GameFormat, ModelError, NOISE_FLOOR_PCT_POT_X100, PREFLOP_FLOOR_FALLBACK,
    Position, PositionPair, Street, TableSize,
};

#[test]
fn r2_1_cbb_is_integer_centi_big_blinds() {
    assert_eq!(Cbb::from_bb(100), Cbb(10_000));
    assert_eq!(Cbb::new(250).get(), 250);
    assert_eq!(Cbb(250).whole_bb(), 2);
    assert!(!Cbb(250).is_whole_bb() && Cbb(300).is_whole_bb());
    assert_eq!(Cbb(250) + Cbb(50), Cbb(300));
    assert_eq!(Cbb(300) - Cbb(50), Cbb(250));
    assert_eq!(Cbb(250).to_string(), "250");
    assert_eq!(Cbb::PER_BB, 100);
    assert_eq!(Cbb::ZERO, Cbb::default());
    assert_eq!(NOISE_FLOOR_PCT_POT_X100, 20);
    assert_eq!(PREFLOP_FLOOR_FALLBACK, Cbb(2));
}

#[test]
fn r2_1_streets_in_order() {
    assert_eq!(Street::ALL, [Street::Preflop, Street::Flop, Street::Turn, Street::River]);
    assert!(Street::Preflop < Street::Flop && Street::Turn < Street::River);
    assert_eq!(Street::Preflop.next(), Some(Street::Flop));
    assert_eq!(Street::River.next(), None);
    assert_eq!(Street::Preflop.board_cards(), 0);
    assert_eq!(Street::Turn.board_cards(), 4);
    for street in Street::ALL {
        assert_eq!(street.as_str().parse::<Street>().unwrap(), street);
        assert_eq!(street.to_string(), street.as_str());
    }
    assert!(matches!("Flop".parse::<Street>(), Err(ModelError::InvalidStreet(_))));
}

#[test]
fn r2_1_positions_orders_and_seats() {
    let names = ["UTG", "UTG1", "UTG2", "LJ", "HJ", "CO", "BTN", "SB", "BB"];
    assert_eq!(Position::ALL.map(Position::as_str), names);
    for (i, position) in Position::ALL.iter().enumerate() {
        assert_eq!(usize::from(position.preflop_order()), i);
        assert_eq!(position.as_str().parse::<Position>().unwrap(), *position);
    }
    assert_eq!(Position::Sb.postflop_order(), 0);
    assert_eq!(Position::Bb.postflop_order(), 1);
    assert_eq!(Position::Utg.postflop_order(), 2);
    assert_eq!(Position::Btn.postflop_order(), 8);
    assert!(Position::Sb.is_blind() && Position::Bb.is_blind() && !Position::Btn.is_blind());
    assert_eq!(Position::seated(TableSize::HEADS_UP), &[Position::Btn, Position::Bb]);
    let six_max =
        [Position::Utg, Position::Hj, Position::Co, Position::Btn, Position::Sb, Position::Bb];
    assert_eq!(Position::seated(TableSize::SIX_MAX), &six_max);
    assert_eq!(Position::seated(TableSize::NINE_HANDED), &Position::ALL);
    for seats in 2..=9u8 {
        assert_eq!(Position::seated(TableSize::new(seats).unwrap()).len(), usize::from(seats));
    }
    assert!(matches!("UTG+1".parse::<Position>(), Err(ModelError::InvalidPosition(_))));
    assert!("btn".parse::<Position>().is_err());
}

#[test]
fn r2_1_position_pair_is_out_of_position_first() {
    let pair = PositionPair::new(Position::Btn, Position::Bb).unwrap();
    assert_eq!((pair.oop(), pair.ip()), (Position::Bb, Position::Btn));
    assert_eq!(pair.to_string(), "BB-BTN");
    assert_eq!(PositionPair::new(Position::Bb, Position::Btn).unwrap(), pair);
    assert_eq!("BB-BTN".parse::<PositionPair>().unwrap(), pair);
    assert_eq!(PositionPair::new(Position::Utg, Position::Sb).unwrap().to_string(), "SB-UTG");
    assert_eq!(PositionPair::new(Position::Co, Position::Btn).unwrap().to_string(), "CO-BTN");
    assert_eq!(PositionPair::new(Position::Sb, Position::Bb).unwrap().to_string(), "SB-BB");
    assert!(pair.contains(Position::Bb) && !pair.contains(Position::Co));
    assert_eq!(pair.other(Position::Bb), Some(Position::Btn));
    assert_eq!(pair.other(Position::Co), None);
    let same = PositionPair::new(Position::Bb, Position::Bb);
    assert_eq!(same, Err(ModelError::SamePosition(Position::Bb)));
    let reversed = "BTN-BB".parse::<PositionPair>();
    let expected =
        ModelError::PairOrder { given: "BTN-BB".to_owned(), canonical: "BB-BTN".to_owned() };
    assert_eq!(reversed, Err(expected));
    assert!("BB".parse::<PositionPair>().is_err());
    assert!("BB-BB".parse::<PositionPair>().is_err());
    assert!("BB-BTN-CO".parse::<PositionPair>().is_err());
}

#[test]
fn r2_1_table_size_format_and_config_id() {
    assert_eq!(TableSize::new(9).unwrap(), TableSize::NINE_HANDED);
    assert_eq!(TableSize::SIX_MAX.get(), 6);
    assert_eq!(TableSize::HEADS_UP.to_string(), "2");
    assert_eq!(TableSize::new(1), Err(ModelError::InvalidTableSize(1)));
    assert_eq!(TableSize::new(10), Err(ModelError::InvalidTableSize(10)));
    assert_eq!(GameFormat::Live.as_str(), "live");
    assert_eq!("online".parse::<GameFormat>().unwrap(), GameFormat::Online);
    assert!(matches!("Live".parse::<GameFormat>(), Err(ModelError::InvalidFormat(_))));
    let id = ConfigId::new("cfg_9_live_13_150").unwrap();
    assert_eq!(id.as_str(), "cfg_9_live_13_150");
    assert_eq!(id.to_string(), "cfg_9_live_13_150");
    assert_eq!("cfg_9_live_13_150".parse::<ConfigId>().unwrap(), id);
    for bad in ["", "CFG_9", "cfg-9", "cfg 9", "cfg/9", "cfg|9", "cfg.9"] {
        assert!(matches!(ConfigId::new(bad), Err(ModelError::InvalidConfigId(_))), "{bad:?}");
    }
}
