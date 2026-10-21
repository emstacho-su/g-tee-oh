//! R2.10 mapping tests: the card and combo encodings the adapter relies on, the range text
//! it hands the engine, and the problem it builds from a preflop line. The rake, chip and
//! tree configuration mappings are crate-private and tested beside them in
//! `src/postflop/engine_map.rs`.

#[path = "r2_10_support/mod.rs"]
mod common;

use common::{FLOP_POT, FLOP_STACK, IP_RANGE, OOP_RANGE, flop_board, online_config, opened_line};
use gto_model::{Card, Cbb, ComboId};
use gto_solve::postflop::{COMBO_COUNT, PostflopProblem, Range, SolveError};
use postflop_engine::cards::{card_to_string, parse_card};
use postflop_engine::range::{Range as EngineRange, combo_cards, combo_index};

/// R2.10: all 52 cards have the same integer in both crates, and all 1,326 combos the
/// same index, so boards and ranges cross the boundary unchanged.
#[test]
fn r2_10_cards_and_combos_map_identically() {
    for card in Card::all() {
        let text = card.to_string();
        assert_eq!(parse_card(&text), Ok(card.index()), "{text}");
        assert_eq!(card_to_string(card.index()), text);
    }
    for combo in ComboId::all() {
        let (low, high) = combo.cards();
        let index = usize::from(combo.index());
        assert_eq!(combo_index(low.index(), high.index()), index, "{combo}");
        assert_eq!(combo_cards(index), (low.index(), high.index()), "{combo}");
    }
}

/// Weights with no short decimal form, so the round trip tests `f32` display.
fn awkward_weights() -> Vec<f32> {
    (0..COMBO_COUNT)
        .map(|index| match index % 7 {
            0 => 0.0,
            1 => 1.0,
            2 => 1.0 / 3.0,
            3 => 0.1,
            4 => 1e-7,
            5 => f32::from(u16::try_from(index).expect("small")) / 1_326.0,
            _ => 0.999_999_9,
        })
        .collect()
}

/// R2.10: the engine reads back exactly the weights the adapter writes, combo for combo,
/// and the adapter's own parser agrees.
#[test]
fn r2_10_range_string_round_trips() {
    let weights = awkward_weights();
    let range = Range::from_weights(&weights).expect("valid weights");
    let notation = range.to_engine_notation();
    let engine = EngineRange::parse(&notation).expect("the engine reads the notation");
    for (index, weight) in weights.iter().enumerate() {
        assert_eq!(engine.weight(index).to_bits(), weight.to_bits(), "combo {index}");
    }
    assert_eq!(Range::parse(&notation).expect("the adapter reads it too"), range);
}

/// R2.10: a range is 1,326 weights from 0 to 1, nothing else.
#[test]
fn r2_10_range_rejects_bad_weights() {
    assert!(matches!(Range::from_weights(&[1.0; 3]), Err(SolveError::Problem(_))));
    for bad in [1.5, -0.1, f32::NAN, f32::INFINITY] {
        let mut weights = vec![0.5; COMBO_COUNT];
        weights[17] = bad;
        assert!(matches!(Range::from_weights(&weights), Err(SolveError::Problem(_))), "{bad}");
    }
    assert!(matches!(Range::parse("AKx"), Err(SolveError::Problem(_))));
}

/// R2.10: a range keeps its weights by combo and drops board-blocked combos from the live
/// set.
#[test]
fn r2_10_range_weights_and_live_combos() {
    let range = Range::parse("AhKh:0.5,KsKd").expect("valid notation");
    let ace_king =
        ComboId::from_cards("Ah".parse().expect("a card"), "Kh".parse().expect("a card"))
            .expect("a combo");
    assert!((range.weight(ace_king) - 0.5).abs() < f32::EPSILON);
    let board = flop_board("Ks7d2c").cards();
    assert_eq!(range.live_combos(&board), vec![ace_king]);
}

/// R2.10: a problem from a preflop line starts from its flop pot and stack, and an empty
/// range or a zero stack is refused.
#[test]
fn r2_10_problem_from_line_takes_flop_pot_and_stack() {
    let ranges = || [common::range(OOP_RANGE), common::range(IP_RANGE)];
    let problem = PostflopProblem::from_line(
        online_config(),
        opened_line(FLOP_POT, FLOP_STACK),
        flop_board("Ks7d2c"),
        ranges(),
        common::small_tree(),
    )
    .expect("a valid problem");
    assert_eq!((problem.pot, problem.stacks), (FLOP_POT, [FLOP_STACK; 2]));
    assert_eq!(problem.effective_stack(), FLOP_STACK);
    assert_eq!(problem.root().pot, FLOP_POT);

    let blocked = Range::parse("KsKd").expect("valid notation");
    let empty = PostflopProblem::from_line(
        online_config(),
        opened_line(FLOP_POT, FLOP_STACK),
        flop_board("Ks7d2c"),
        [blocked, common::range(IP_RANGE)],
        common::small_tree(),
    );
    assert!(matches!(empty, Err(SolveError::Problem(_))), "{empty:?}");

    let broke = PostflopProblem::from_line(
        online_config(),
        opened_line(FLOP_POT, Cbb::ZERO),
        flop_board("Ks7d2c"),
        ranges(),
        common::small_tree(),
    );
    assert!(matches!(broke, Err(SolveError::Problem(_))), "{broke:?}");
}
