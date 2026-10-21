//! Unit tests of the deck, the deal id and the deal store (R2.13, plan C.4, O-152).

use std::collections::HashSet;

use gto_library::is_uuid;
use gto_model::{Card, ConfigId, NodeKey, Position, PositionPair, Street};

use super::{BOARD_CARDS, Deal, DealStore, HOLE_CARDS, Start, deal_cards, deal_id, shuffle};
use crate::api::deal::{Hex64, Revealed};
use crate::error::ApiError;

const SEED: Hex64 = Hex64(7);
const OTHER_SEED: Hex64 = Hex64(8);

fn start(line: Vec<gto_model::ActionToken>) -> Start {
    let config_id = ConfigId::new("cfg_6_online_100").expect("a configuration");
    let pair = PositionPair::new(Position::Bb, Position::Btn).expect("two seats");
    Start {
        street: Street::Preflop,
        key: NodeKey::preflop(config_id, pair, line),
        solution_ids: vec!["0f0f0f0f-1111-4222-8333-444444444444".to_owned()],
        hero: Position::Btn,
        villain: Position::Bb,
    }
}

fn deal(seed: Hex64) -> Deal {
    Deal::make(seed, start(Vec::new())).expect("a shuffled deck never repeats a card")
}

#[test]
fn r2_13_shuffle_permutes_the_deck_and_depends_on_the_seed_only() {
    let deck = shuffle(SEED.get());
    assert_eq!(deck.len(), usize::from(Card::COUNT));
    let distinct: HashSet<Card> = deck.iter().copied().collect();
    assert_eq!(distinct.len(), usize::from(Card::COUNT), "every card once");
    assert_eq!(shuffle(SEED.get()), deck, "one seed, one order");
    assert_ne!(shuffle(OTHER_SEED.get()), deck, "another seed, another order");
    assert_eq!(BOARD_CARDS, usize::from(Street::River.board_cards()));
}

#[test]
fn r2_13_deal_cards_takes_nine_distinct_cards_in_deck_order() {
    let deck = shuffle(SEED.get());
    let cards = deal_cards(SEED).expect("a deal");
    let (hero_a, hero_b) = cards.hero.cards();
    let (villain_a, villain_b) = cards.villain.cards();
    let mut held = vec![hero_a, hero_b, villain_a, villain_b];
    held.extend(cards.board);
    assert_eq!(held.iter().copied().collect::<HashSet<Card>>().len(), held.len());
    let first_board = 2 * HOLE_CARDS;
    let board = &deck[first_board..first_board + BOARD_CARDS];
    assert_eq!(cards.board.as_slice(), board, "the board follows the hole cards");
    assert_eq!(HashSet::from([hero_a, hero_b]), HashSet::from([deck[0], deck[1]]));
    assert_eq!(HashSet::from([villain_a, villain_b]), HashSet::from([deck[2], deck[3]]));
}

#[test]
fn r2_13_deal_id_is_a_uuid_of_the_seed_and_the_filter() {
    let root = start(Vec::new());
    let id = deal_id(SEED, Street::Preflop, &root.key);
    assert!(is_uuid(&id), "{id}");
    assert_eq!(deal_id(SEED, Street::Preflop, &root.key), id, "one seed and filter, one id");
    assert_ne!(deal_id(OTHER_SEED, Street::Preflop, &root.key), id, "another seed");
    let line = start(gto_model::parse_line("r250").expect("a line"));
    assert_ne!(deal_id(SEED, Street::Preflop, &line.key), id, "another filter");
    assert_eq!(deal(SEED).id, id);
}

#[test]
fn r2_13_deal_hands_out_one_street_at_a_time() {
    let made = deal(SEED);
    assert_eq!(made.street_cards(Street::Preflop), &[] as &[Card]);
    assert_eq!(made.street_cards(Street::Flop).len(), 3);
    assert_eq!(made.street_cards(Street::Turn).len(), 1);
    assert_eq!(made.street_cards(Street::River).len(), 1);
    assert_eq!(made.board_text(Street::Preflop), "");
    assert_eq!(made.board_text(Street::Flop).len(), 6);
    assert_eq!(made.board_text(Street::River).len(), 10);
    let shown = format!("{made:?}");
    assert!(shown.contains(&made.id), "{shown}");
    assert!(!shown.contains("board"), "the board is not in the debug form: {shown}");
    assert!(shown.ends_with(".. }"), "the debug form says a field is left out: {shown}");
}

#[test]
fn r2_13_deal_store_reveals_in_order_and_repeats_the_same_cards() {
    let store = DealStore::new(2);
    assert_eq!((store.capacity(), store.held()), (2, 0));
    let (held, revealed) = store.hold(deal(SEED));
    assert_eq!(revealed, Revealed::default());
    assert_eq!(store.held(), 1);
    let id = held.id.clone();

    let turn_first = store.reveal(&id, Street::Turn).expect_err("the flop comes first");
    assert!(matches!(turn_first, ApiError::Conflict(_)), "{turn_first}");
    let preflop = store.reveal(&id, Street::Preflop).expect_err("no preflop reveal");
    assert!(matches!(preflop, ApiError::BadRequest(_)), "{preflop}");
    let unknown = store.reveal("00000000-0000-4000-8000-000000000000", Street::Flop);
    assert!(matches!(unknown, Err(ApiError::NotFound(_))), "{unknown:?}");

    let flop = store.reveal(&id, Street::Flop).expect("the flop reveals");
    assert_eq!(flop.cards, held.street_cards(Street::Flop));
    assert_eq!(flop.board, held.board_text(Street::Flop));
    assert_eq!(store.reveal(&id, Street::Flop).expect("a repeat"), flop);
    let river_early = store.reveal(&id, Street::River).expect_err("the turn comes first");
    assert!(matches!(river_early, ApiError::Conflict(_)), "{river_early}");
    let turn = store.reveal(&id, Street::Turn).expect("the turn reveals");
    assert_eq!(turn.cards, held.street_cards(Street::Turn));
    let river = store.reveal(&id, Street::River).expect("the river reveals");
    assert_eq!(river.board.len(), 10);
    assert_eq!(store.reveal(&id, Street::Flop).expect("a repeat after the river"), flop);

    let (again, revealed) = store.hold(deal(SEED));
    assert_eq!(again.id, id, "the same deal is answered, not replaced");
    assert_eq!(revealed.flop.as_deref(), Some(flop.board.as_str()));
    assert_eq!(revealed.turn.as_deref(), Some(gto_model::format_cards(&turn.cards).as_str()));
    assert!(revealed.river.is_some());
    assert_eq!(store.held(), 1);
}

#[test]
fn r2_13_deal_store_evicts_the_least_recently_used_deal() {
    let store = DealStore::new(2);
    let (first, _) = store.hold(deal(SEED));
    let _ = store.hold(deal(OTHER_SEED));
    assert_eq!(store.held(), 2);
    let _ = store.hold(deal(Hex64(9)));
    assert_eq!(store.held(), 2, "bounded");
    let evicted = store.reveal(&first.id, Street::Flop);
    assert!(matches!(evicted, Err(ApiError::NotFound(_))), "{evicted:?}");
    let (replayed, revealed) = store.hold(deal(SEED));
    assert_eq!(replayed.as_ref(), first.as_ref(), "re-posting the seed recreates the deal");
    assert_eq!(revealed, Revealed::default(), "with nothing revealed");
    assert_eq!(DealStore::new(0).capacity(), 1, "a capacity of 0 holds one");
    assert_eq!(format!("{store:?}"), "DealStore { capacity: 2, held: 2 }");
}
