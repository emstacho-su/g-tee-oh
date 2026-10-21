//! The AKQ (ace, king, queen) half-street game: the engine's own model and the fixture
//! vocabulary of `validation/fixtures/toy-games/akq.json`. Owner: the G2 agent (R2.5).
//!
//! Engine layout (`crates/vendor/postflop-engine/src/games/akq.rs`): cards Q 0, K 1, A 2
//! with root weight 1 each for both players; node 0 is player 1 at the root (check 0,
//! bet 1); node 2 is player 0 facing the bet (fold 0, call 1). The fixture names those
//! nodes `open` and `facing_bet`, and each AKQ case states six strategy facts, the bet
//! frequency per card for player 1 and the call frequency per card for player 0, so
//! `names` lists 6 facts and 6 holdings and serves every AKQ case. The polar river case of
//! the same fixture is a different game, `polar_river`.

use postflop_engine::game::Game;
use postflop_engine::games::akq::Akq;

use super::{FactName, HoldingName, Names, Slot};

/// The fixture's cards in the engine's combo order: Q 0, K 1, A 2.
const CARDS: [&str; 3] = ["Q", "K", "A"];
/// Node 0, player 1 at the root; the fixture's `open`.
const OPEN: u32 = 0;
/// Node 2, player 0 facing the bet; the fixture's `facing_bet`.
const FACING_BET: u32 = 2;
/// Action 1 at `open` is the bet; action 0 is the check.
const BET: usize = 1;
/// Action 1 at `facing_bet` is the call; action 0 is the fold.
const CALL: usize = 1;

/// The engine's AKQ game with a dead pot of `pot` chips and one bet of `bet` chips, both
/// positive. The engine's constructor asserts that; the public callers are the gates,
/// which read both numbers from a validated fixture.
#[allow(
    clippy::cast_possible_truncation,
    reason = "the engine takes f32 chips; fixture pots and bets are small exact values"
)]
pub(crate) fn build(pot: f64, bet: f64) -> impl Game + Sync {
    Akq::new(pot as f32, bet as f32)
}

/// The fixture vocabulary mapped onto the engine layout above: per card, player 1's bet
/// at `open` and player 0's call at `facing_bet`, plus each player's holding of that card
/// at its root combo slot.
pub(crate) fn names() -> Names {
    let facts = CARDS
        .iter()
        .enumerate()
        .flat_map(|(combo, &card)| {
            [
                FactName {
                    player: 1,
                    node: "open",
                    holding: card,
                    action: "bet",
                    slot: Slot { node: OPEN, action: BET, combo },
                },
                FactName {
                    player: 0,
                    node: "facing_bet",
                    holding: card,
                    action: "call",
                    slot: Slot { node: FACING_BET, action: CALL, combo },
                },
            ]
        })
        .collect();
    let holdings = [0u8, 1]
        .into_iter()
        .flat_map(|player| {
            CARDS.iter().enumerate().map(move |(combo, &card)| HoldingName {
                player,
                holding: card,
                combo,
            })
        })
        .collect();
    Names { facts, holdings }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    use postflop_engine::cfr::{DcfrParams, Solver};
    use postflop_engine::games::akq::Akq;

    use super::names;

    /// Enough iterations of the engine's default schedule to land the half-pot case
    /// near its unique equilibrium (the engine's own test uses 20,000 for 1e-3).
    const ITERATIONS: u64 = 20_000;
    /// Looser than the gate's 0.005: this test checks the slot map, not convergence.
    const TOLERANCE: f32 = 0.02;

    #[test]
    fn r2_5_names_list_six_facts_and_six_holdings_without_duplicates() {
        let names = names();
        assert_eq!(names.facts.len(), 6);
        assert_eq!(names.holdings.len(), 6);
        let fact_keys: BTreeSet<_> =
            names.facts.iter().map(|f| (f.player, f.node, f.holding, f.action)).collect();
        assert_eq!(fact_keys.len(), 6, "every fact names a distinct word tuple");
        let holding_keys: BTreeSet<_> =
            names.holdings.iter().map(|h| (h.player, h.holding)).collect();
        assert_eq!(holding_keys.len(), 6, "every holding is distinct per player");
        for fact in &names.facts {
            assert!(fact.slot.combo < 3, "{fact:?} combo slot");
            assert!(fact.slot.action < 2, "{fact:?} action slot");
            let acting = u8::from(fact.slot.node == 0);
            assert_eq!(fact.player, acting, "{fact:?} player matches the engine node");
        }
    }

    /// The slots read the engine's own tables: at pot 1 and bet 1/2 the engine's AKQ
    /// bets A always, never bets K, calls A always, folds Q always, and mixes Q bets and
    /// K calls at one third each (`crates/vendor/postflop-engine/src/games/akq.rs`).
    #[test]
    fn r2_5_slots_read_the_engine_average_strategy_in_the_fixture_words() {
        let mut solver = Solver::new(Akq::new(1.0, 0.5));
        solver.run(ITERATIONS, &DcfrParams::default(), 0, |_, _, _| {});
        let read = |player: u8, node: &str, holding: &str, action: &str| -> f32 {
            let fact = names()
                .facts
                .into_iter()
                .find(|f| {
                    f.player == player
                        && f.node == node
                        && f.holding == holding
                        && f.action == action
                })
                .unwrap_or_else(|| {
                    panic!("{player} {node} {holding} {action} is in the vocabulary")
                });
            let strategy = solver.average_strategy(fact.slot.node);
            strategy[fact.slot.action * 3 + fact.slot.combo]
        };
        assert!(read(1, "open", "A", "bet") > 1.0 - TOLERANCE, "bet A");
        assert!(read(1, "open", "K", "bet") < TOLERANCE, "bet K");
        assert!((read(1, "open", "Q", "bet") - 1.0 / 3.0).abs() < TOLERANCE, "bet Q");
        assert!(read(0, "facing_bet", "A", "call") > 1.0 - TOLERANCE, "call A");
        assert!((read(0, "facing_bet", "K", "call") - 1.0 / 3.0).abs() < TOLERANCE, "call K");
        assert!(read(0, "facing_bet", "Q", "call") < TOLERANCE, "call Q");
    }
}
