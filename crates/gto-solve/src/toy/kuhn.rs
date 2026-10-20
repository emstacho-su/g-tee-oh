//! Kuhn poker: the engine's own model and the fixture vocabulary of
//! `validation/fixtures/toy-games/kuhn.json`. Owner: the G1 agent (R2.4).
//!
//! Engine layout (`crates/vendor/postflop-engine/src/games/kuhn.rs`): cards J 0, Q 1, K 2
//! with root weight 1 each for both players; node 0 is player 0 at the root (check 0,
//! bet 1); node 1 is player 1 after a check (check 0, bet 1); node 2 is player 1 facing a
//! bet (fold 0, call 1); node 4 is player 0 facing a bet after its own check (fold 0,
//! call 1). The fixture names those nodes `open`, `after_check`, `facing_bet` and
//! `facing_bet_after_check`, and its 12 strategy facts are the bet and call frequencies
//! per card. `names` lists both actions of every node for every card, 24 facts, so the
//! complement of each fixture fact (`check` where the fixture says `bet`, `fold` where
//! it says `call`) resolves too, and 6 holdings. One entry, written out: `FactName {
//! player: 0, node: "open", holding: "J", action: "bet", slot: Slot { node: 0, action: 1,
//! combo: 0 } }`.

use postflop_engine::game::Game;
use postflop_engine::games::kuhn::Kuhn;

use super::{FactName, HoldingName, Names, Slot};

/// The three cards in engine combo order, with the fixture's rank names.
const CARDS: [&str; 3] = ["J", "Q", "K"];

/// One decision node of the engine model under its fixture name, with the fixture's
/// action words in engine action order.
struct NodeName {
    /// The acting player.
    player: u8,
    /// The fixture's node name.
    node: &'static str,
    /// The engine's node index.
    engine_node: u32,
    /// The fixture's words for engine actions 0 and 1.
    actions: [&'static str; 2],
}

/// The four decision nodes in engine order.
const NODES: [NodeName; 4] = [
    NodeName { player: 0, node: "open", engine_node: 0, actions: ["check", "bet"] },
    NodeName { player: 1, node: "after_check", engine_node: 1, actions: ["check", "bet"] },
    NodeName { player: 1, node: "facing_bet", engine_node: 2, actions: ["fold", "call"] },
    NodeName {
        player: 0,
        node: "facing_bet_after_check",
        engine_node: 4,
        actions: ["fold", "call"],
    },
];

/// The engine's Kuhn poker.
pub(crate) fn build() -> impl Game + Sync {
    Kuhn::new()
}

/// The fixture vocabulary mapped onto the engine layout above.
pub(crate) fn names() -> Names {
    let facts = NODES
        .iter()
        .flat_map(|node| {
            node.actions.iter().enumerate().flat_map(move |(action, word)| {
                CARDS.iter().enumerate().map(move |(combo, holding)| FactName {
                    player: node.player,
                    node: node.node,
                    holding,
                    action: word,
                    slot: Slot { node: node.engine_node, action, combo },
                })
            })
        })
        .collect();
    let holdings = [0u8, 1]
        .into_iter()
        .flat_map(|player| {
            CARDS.iter().enumerate().map(move |(combo, holding)| HoldingName {
                player,
                holding,
                combo,
            })
        })
        .collect();
    Names { facts, holdings }
}

#[cfg(test)]
mod tests {
    use super::super::Slot;
    use super::names;

    /// R2.4: the vocabulary has one fact per node, action and card (24) and one holding
    /// per player and card (6); the fixture's 12 bet and call facts land on the engine's
    /// `average_strategy(n)[a * 3 + card]` slots with action 1 and node ids 0, 1, 2, 4.
    #[test]
    fn r2_4_kuhn_names_round_trip_to_the_engine_layout() {
        let names = names();
        assert_eq!(names.facts.len(), 24);
        assert_eq!(names.holdings.len(), 6);
        let slot = |player: u8, node: &str, holding: &str, action: &str| {
            names
                .facts
                .iter()
                .find(|fact| {
                    fact.player == player
                        && fact.node == node
                        && fact.holding == holding
                        && fact.action == action
                })
                .map(|fact| fact.slot)
        };
        assert_eq!(slot(0, "open", "J", "bet"), Some(Slot { node: 0, action: 1, combo: 0 }));
        assert_eq!(slot(0, "open", "K", "check"), Some(Slot { node: 0, action: 0, combo: 2 }));
        assert_eq!(slot(1, "after_check", "Q", "bet"), Some(Slot { node: 1, action: 1, combo: 1 }));
        assert_eq!(slot(1, "facing_bet", "K", "call"), Some(Slot { node: 2, action: 1, combo: 2 }));
        assert_eq!(slot(1, "facing_bet", "J", "fold"), Some(Slot { node: 2, action: 0, combo: 0 }));
        let after_check = slot(0, "facing_bet_after_check", "Q", "call");
        assert_eq!(after_check, Some(Slot { node: 4, action: 1, combo: 1 }));
        assert_eq!(slot(1, "open", "J", "bet"), None, "player 1 never acts at open");
        assert_eq!(slot(0, "open", "A", "bet"), None, "no ace in Kuhn");
        assert_eq!(slot(0, "open", "J", "raise"), None, "no raise in Kuhn");
        let holding = |player: u8, holding: &str| {
            names
                .holdings
                .iter()
                .find(|name| name.player == player && name.holding == holding)
                .map(|name| name.combo)
        };
        assert_eq!(holding(0, "J"), Some(0));
        assert_eq!(holding(1, "K"), Some(2));
        assert_eq!(holding(1, "A"), None);
    }
}
