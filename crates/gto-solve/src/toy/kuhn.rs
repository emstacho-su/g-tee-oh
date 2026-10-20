//! Kuhn poker: the engine's own model and the fixture vocabulary of
//! `validation/fixtures/toy-games/kuhn.json`. Owner: the G1 agent (R2.4). The name map
//! is a stub until then.
//!
//! Engine layout (`crates/vendor/postflop-engine/src/games/kuhn.rs`): cards J 0, Q 1, K 2
//! with root weight 1 each for both players; node 0 is player 0 at the root (check 0,
//! bet 1); node 1 is player 1 after a check (check 0, bet 1); node 2 is player 1 facing a
//! bet (fold 0, call 1); node 4 is player 0 facing a bet after its own check (fold 0,
//! call 1). The fixture names those nodes `open`, `after_check`, `facing_bet` and
//! `facing_bet_after_check`, and its 12 strategy facts are the bet and call frequencies
//! per card, so `names` lists 12 facts and 6 holdings. One entry, written out:
//! `FactName { player: 0, node: "open", holding: "J", action: "bet", slot: Slot { node:
//! 0, action: 1, combo: 0 } }`.

use postflop_engine::game::Game;
use postflop_engine::games::kuhn::Kuhn;

use super::Names;

/// The engine's Kuhn poker.
pub(crate) fn build() -> impl Game + Sync {
    Kuhn::new()
}

/// The fixture vocabulary mapped onto the engine layout above.
pub(crate) fn names() -> Names {
    todo!("G1: the Kuhn name map")
}
