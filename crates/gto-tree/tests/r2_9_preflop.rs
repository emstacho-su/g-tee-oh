//! R2.9 preflop pair-tree shapes against the seed placeholder conventions (O-136, O-22).
//! R2.9 is a requirement identifier (R ID).
//!
//! Mechanism: each test builds the two-seat tree of one position pair at one v1
//! configuration and compares its flop lines with pots and stacks worked out by hand in
//! centi-big-blinds (cbb). Online blinds are 50 and 100 cbb; the live 1/3 small blind (SB)
//! of $1 at a $3 big blind (BB) is 33.33 cbb and rounds half up to 33 cbb. A folded blind
//! stays in the pot as dead money. Online 100 big blinds (bb) at the button (BTN) against
//! the BB:
//!
//! - `r250.c`: 250 + 250 + 50 dead = 550, stack 10,000 - 250 = 9,750.
//! - `r250.r1000.c`: the BB 3-bets out of position, 4.0 x 250 = 1,000; 2,050 and 9,000.
//! - `r250.r1000.r2200.c`: the 4-bet is 2.2 x 1,000 = 2,200; 4,450 and 7,800.
//! - The 5-bet `r250.r1000.r2200.a` is all-in, so its call never reaches a flop.

#[allow(dead_code, reason = "each test binary uses a subset of the shared fixtures")]
mod support;

use gto_model::{ActionToken, Cbb, Position};
use gto_tree::{LineKind, PreflopLine, PreflopTree};

/// The flop lines of `pair` at configuration `config_id` under `spec_json`.
fn flop_lines(spec_json: &str, config_id: &str, pair: &str) -> Vec<PreflopLine> {
    let spec = support::spec(spec_json);
    let config = support::config(config_id);
    PreflopTree::build(&spec, &config, support::pair(pair))
        .unwrap_or_else(|err| panic!("{pair} at {config_id} builds: {err}"))
        .flop_lines()
}

/// The (line text, flop pot, flop stack) of each line.
fn shapes(lines: &[PreflopLine]) -> Vec<(String, u32, u32)> {
    lines.iter().map(|line| (line.text(), line.flop_pot.get(), line.flop_stack.get())).collect()
}

/// The line with this text, panicking when the tree has none.
fn line<'a>(lines: &'a [PreflopLine], text: &str) -> &'a PreflopLine {
    lines
        .iter()
        .find(|line| line.text() == text)
        .unwrap_or_else(|| panic!("no flop line {text} in {:?}", shapes(lines)))
}

/// R2.9: the online BB against BTN tree reaches the flop on exactly three lines.
#[test]
fn r2_9_preflop_shape_online_bb_btn() {
    let lines = flop_lines(support::ONLINE_PLACEHOLDER_JSON, "cfg_6_online_100", "BB-BTN");
    let expected = vec![
        ("r250.c".to_owned(), 550, 9_750),
        ("r250.r1000.c".to_owned(), 2_050, 9_000),
        ("r250.r1000.r2200.c".to_owned(), 4_450, 7_800),
    ];
    let mut actual = shapes(&lines);
    actual.sort();
    assert_eq!(actual, expected);

    let kinds_and_aggressors: Vec<(LineKind, Option<Position>)> =
        ["r250.c", "r250.r1000.c", "r250.r1000.r2200.c"]
            .iter()
            .map(|text| {
                let found = line(&lines, text);
                (found.kind, found.aggressor)
            })
            .collect();
    assert_eq!(
        kinds_and_aggressors,
        vec![
            (LineKind::SingleRaised, Some(Position::Btn)),
            (LineKind::ThreeBet, Some(Position::Bb)),
            (LineKind::FourBet, Some(Position::Btn)),
        ]
    );
    let root = line(&lines, "r250.c").flop_root();
    assert_eq!((root.pot, root.stack), (Cbb(550), Cbb(9_750)));
}

/// R2.9: the online SB against BB tree includes the limped and raised lines, with the SB
/// limp (O-136), the 4 bb isolation raise (3 bb plus 1 bb for one limper), the 3x 3-bet
/// in position and the 2.2x 4-bet.
#[test]
fn r2_9_preflop_shape_online_sb_bb() {
    let lines = flop_lines(support::ONLINE_PLACEHOLDER_JSON, "cfg_6_online_100", "SB-BB");
    let expected = [
        ("l.x", 200, LineKind::Limped),
        ("l.r400.c", 800, LineKind::SingleRaised),
        ("r250.c", 500, LineKind::SingleRaised),
        ("r250.r750.c", 1_500, LineKind::ThreeBet),
        ("r250.r750.r1650.c", 3_300, LineKind::FourBet),
    ];
    for (text, pot, kind) in expected {
        let found = line(&lines, text);
        assert_eq!((found.flop_pot, found.kind), (Cbb(pot), kind), "{text}");
    }
    assert_eq!(line(&lines, "l.x").aggressor, None);
}

/// R2.9: at live 1/3 the folded SB leaves 33 cbb of dead money, so BTN's 4 bb open called
/// by the BB reaches the flop with 833 cbb.
#[test]
fn r2_9_preflop_live_1_3_small_blind_rounds() {
    let lines = flop_lines(support::LIVE_PLACEHOLDER_JSON, "cfg_9_live_13_100", "BB-BTN");
    let found = line(&lines, "r400.c");
    assert_eq!((found.flop_pot, found.flop_stack), (Cbb(833), Cbb(9_600)));
}

/// R2.9: every node of every online pair tree offers at most one raise size, so Grouped
/// mode can show the exact size (O-22), and every flop line names its pair.
#[test]
fn r2_9_preflop_nodes_hold_one_raise_size() {
    let spec = support::spec(support::ONLINE_PLACEHOLDER_JSON);
    let config = support::config("cfg_6_online_100");
    for pair in support::seated_pairs(&config) {
        let tree = PreflopTree::build(&spec, &config, pair).expect("every seated pair builds");
        assert_eq!(tree.pair(), pair);
        for node in tree.nodes() {
            let raises = node
                .actions
                .iter()
                .filter(|action| matches!(action, ActionToken::Raise(_)))
                .count();
            assert!(raises <= 1, "{pair} at {:?}: {:?}", node.line, node.actions);
        }
        assert!(tree.flop_lines().iter().all(|line| line.pair == pair), "{pair}");
    }
}
