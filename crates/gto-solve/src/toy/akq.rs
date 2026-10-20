//! The AKQ (ace, king, queen) half-street game: the engine's own model and the fixture
//! vocabulary of `validation/fixtures/toy-games/akq.json`. Owner: the G2 agent (R2.5).
//! The name map is a stub until then.
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

use super::Names;

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

/// The fixture vocabulary mapped onto the engine layout above.
pub(crate) fn names() -> Names {
    todo!("G2: the AKQ name map")
}
