//! Runout arithmetic for the memory estimate (R2.10, O-139). Crate-private.
//!
//! Mechanism: with `n` unseen cards at the root, the engine's tree holds `n` copies of the
//! betting after one dealt card and `n (n - 1)` after two, because it deals every card in
//! order (`Runouts::copies`). A combo whose two cards are both unseen is live on the
//! runouts that miss them, `n - 2` of the `n` single cards and `(n - 2) (n - 3)` of the
//! ordered pairs (`Runouts::live_copies`). The distinct boards are the root, every unseen
//! card and every unordered pair of them; on each, a player's live combos are the root's
//! live combos less those holding a dealt card, counted from per-card tallies with no
//! allocation (`LiveCounts`).

use gto_model::{Card, ComboId, Street};
use gto_tree::SkeletonCounts;

use super::layout::{DECK, DECK_CARDS, WORD, vec_capacity};
use super::problem::COMBO_COUNT;

/// Cards in the deck, as an array length.
const CARDS: usize = DECK_CARDS;
/// Cards on a complete board, where hands are ranked for showdown.
const COMPLETE_BOARD: usize = 5;

/// The runout multipliers of one root.
#[derive(Clone, Copy, Debug)]
pub(crate) struct Runouts {
    root_cards: u8,
    unseen: u64,
}

impl Runouts {
    /// The multipliers for a root on `street` with `board_len` cards dealt.
    pub(crate) fn new(street: Street, board_len: usize) -> Self {
        Runouts { root_cards: street.board_cards(), unseen: DECK - board_len as u64 }
    }

    /// Unseen cards at the root.
    pub(crate) fn unseen(self) -> u64 {
        self.unseen
    }

    /// Cards dealt between the root and `street`, or `None` before the root.
    fn dealt(self, street: Street) -> Option<u64> {
        street.board_cards().checked_sub(self.root_cards).map(u64::from)
    }

    /// Engine copies of the betting on `street`: one per ordered runout to it.
    pub(crate) fn copies(self, street: Street) -> u64 {
        self.dealt(street).map_or(0, |dealt| falling(self.unseen, dealt))
    }

    /// Runouts to `street` on which one combo of two unseen cards is live.
    pub(crate) fn live_copies(self, street: Street) -> u64 {
        self.dealt(street).map_or(0, |dealt| falling(self.unseen.saturating_sub(2), dealt))
    }

    /// Cards a chance node closing `street` deals: the unseen cards less those dealt.
    pub(crate) fn outcomes_after(self, street: Street) -> u64 {
        self.dealt(street).map_or(0, |dealt| self.unseen.saturating_sub(dealt))
    }

    /// Cards the tree deals somewhere below the root: one more for each street, from the
    /// root on, whose betting can close with a chance node.
    pub(crate) fn reached_deals(self, counts: &SkeletonCounts) -> u8 {
        let mut deals = 0;
        let mut street = Street::ALL.into_iter().find(|s| s.board_cards() == self.root_cards);
        while let Some(current) = street {
            let closes = counts.street(current).is_some_and(|c| c.chance > 0);
            if !closes {
                break;
            }
            deals += 1;
            street = current.next();
        }
        deals
    }
}

/// `n (n - 1) ...` over `factors` factors.
fn falling(n: u64, factors: u64) -> u64 {
    (0..factors).map(|i| n.saturating_sub(i)).product()
}

/// One distinct board below the root: the dealt cards and each player's live combos.
#[derive(Clone, Copy, Debug)]
pub(crate) struct BoardLive {
    dealt: [u8; 2],
    dealt_len: usize,
    /// Live combos, `[oop, ip]`.
    pub(crate) live: [u64; 2],
    /// True on a five-card board, where the engine ranks hands for showdown.
    pub(crate) complete: bool,
}

/// Per-card tallies of the root's live combos.
pub(crate) struct LiveCounts {
    root_len: usize,
    on_board: [bool; CARDS],
    root_live: [u64; 2],
    holding: [[u64; CARDS]; 2],
    live: [[bool; COMBO_COUNT]; 2],
}

impl LiveCounts {
    /// Tallies for both players' live combos on the root board.
    pub(crate) fn new(board: &[Card], live: &[Vec<ComboId>; 2]) -> Self {
        let mut counts = LiveCounts {
            root_len: board.len(),
            on_board: [false; CARDS],
            root_live: [0; 2],
            holding: [[0; CARDS]; 2],
            live: [[false; COMBO_COUNT]; 2],
        };
        for card in board {
            counts.on_board[usize::from(card.index())] = true;
        }
        for (player, combos) in live.iter().enumerate() {
            counts.root_live[player] = combos.len() as u64;
            for combo in combos {
                let (low, high) = combo.cards();
                counts.holding[player][usize::from(low.index())] += 1;
                counts.holding[player][usize::from(high.index())] += 1;
                counts.live[player][usize::from(combo.index())] = true;
            }
        }
        counts
    }

    /// Bytes of the engine's two root weight lists.
    pub(crate) fn root_weight_bytes(&self) -> u64 {
        self.root_live.iter().map(|&combos| vec_capacity(combos) * WORD).sum()
    }

    /// Calls `visit` on the root and on every board with up to `deals` more cards.
    pub(crate) fn for_each_board(&self, deals: u8, visit: &mut impl FnMut(&BoardLive)) {
        let root = self.board(&[]);
        visit(&root);
        if deals > 0 {
            self.for_each_child(&root, &mut |child| {
                visit(child);
                if deals > 1 {
                    self.for_each_child(child, &mut |grandchild| {
                        if grandchild.dealt[0] < grandchild.dealt[1] {
                            visit(grandchild);
                        }
                    });
                }
            });
        }
    }

    /// Calls `visit` on every board one dealt card below `parent`, in card order.
    pub(crate) fn for_each_child(&self, parent: &BoardLive, visit: &mut impl FnMut(&BoardLive)) {
        let dealt = &parent.dealt[..parent.dealt_len];
        for card in Card::all().map(Card::index) {
            if self.on_board[usize::from(card)] || dealt.contains(&card) {
                continue;
            }
            match dealt {
                [] => visit(&self.board(&[card])),
                [first] => visit(&self.board(&[*first, card])),
                _ => {}
            }
        }
    }

    /// The board with `dealt` cards dealt below the root.
    fn board(&self, dealt: &[u8]) -> BoardLive {
        let mut cards = [0; 2];
        cards[..dealt.len()].copy_from_slice(dealt);
        let live = [0, 1].map(|player| self.live_on(player, dealt));
        BoardLive {
            dealt: cards,
            dealt_len: dealt.len(),
            live,
            complete: self.root_len + dealt.len() == COMPLETE_BOARD,
        }
    }

    /// One player's live combos once `dealt` (at most two cards) are dealt.
    fn live_on(&self, player: usize, dealt: &[u8]) -> u64 {
        let removed: u64 = dealt.iter().map(|&card| self.holding[player][usize::from(card)]).sum();
        let both = match dealt {
            [a, b] => self.pair_is_live(player, *a, *b),
            _ => false,
        };
        self.root_live[player] - removed + u64::from(both)
    }

    /// True when the combo of the two cards is live for the player.
    fn pair_is_live(&self, player: usize, a: u8, b: u8) -> bool {
        let (Ok(a), Ok(b)) = (Card::from_index(a), Card::from_index(b)) else { return false };
        ComboId::from_cards(a, b).is_ok_and(|combo| self.live[player][usize::from(combo.index())])
    }
}
