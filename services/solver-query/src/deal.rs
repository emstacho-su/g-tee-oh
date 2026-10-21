//! Seeded server-side deals, the reveal of one street at a time and the bounded deal
//! store (R2.13, plan C.4, A5 rule two, O-16, O-152).
//!
//! Mechanism: `deal_cards` is a pure function of the seed. `SplitMix64::new(seed)` drives a
//! Fisher-Yates shuffle of `Card::all`; hero and villain take two cards each, the flop the
//! next three, the turn and the river one each. The start node comes from the filter
//! (`filter::resolve_start`, O-145): the pair's root key, the api-supplied line, or the
//! first candidate line of a spot class that a solution of the pair holds. The deal id is
//! the first 16 bytes of the sha256 over the seed and the canonical filter text (the start
//! street and the resolved node key) in UUID groups, so one seed and filter always name one
//! deal and a deal lost to eviction or a restart is recreated by posting it again (R3.6).
//!
//! The store is an `lru::LruCache` of `DEAL_STORE_CAPACITY` deals behind a mutex. Each
//! entry carries how much of the board is revealed, as a count of board cards (0, 3, 4 or
//! 5): the flop first, then the turn, then the river, or 409; a repeat answers the same
//! cards. No card of the board is in any response before its street is revealed (A5 rule
//! two); the `Deal` keeps the board private and hands out one street at a time.

mod filter;

use std::fmt;
use std::num::NonZeroUsize;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use gto_library::sha256_hex;
use gto_model::{Card, ComboId, ModelError, NodeKey, Position, Street, format_cards};
use lru::LruCache;

use crate::api::deal::{Hex64, Revealed};
use crate::error::ApiError;
use crate::rng::SplitMix64;

pub use filter::{CANDIDATE_LINES, Start, candidate_lines, resolve_start};

/// How many deals the store keeps before evicting the least recently used (O-152); a deal
/// evicted or lost to a restart is recreated by posting the same seed and filter (R3.6).
pub const DEAL_STORE_CAPACITY: usize = 4096;

/// Hole cards per seat.
pub const HOLE_CARDS: usize = 2;

/// Board cards a deal holds back until revealed: `Street::River.board_cards()`.
pub const BOARD_CARDS: usize = 5;

/// The deal id takes the first 16 bytes of the sha256, 32 hexadecimal digits.
const DEAL_ID_HEX_DIGITS: usize = 32;

/// The digit groups of a UUID string.
const UUID_GROUPS: [usize; 5] = [8, 4, 4, 4, 12];

/// The deck in the seeded order: a Fisher-Yates shuffle of `Card::all` driven by
/// `SplitMix64::new(seed)`, so the same seed always gives the same order.
#[must_use]
pub fn shuffle(seed: u64) -> Vec<Card> {
    let mut deck: Vec<Card> = Card::all().collect();
    let mut generator = SplitMix64::new(seed);
    for last in (1..Card::COUNT).rev() {
        let chosen = generator.below(last + 1);
        deck.swap(usize::from(last), usize::from(chosen));
    }
    deck
}

/// The cards of a deal: hero's and villain's combos and the five board cards in order.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DealtCards {
    /// The hero's two cards.
    pub hero: ComboId,
    /// The villain's two cards.
    pub villain: ComboId,
    /// The flop, then the turn, then the river.
    pub board: [Card; BOARD_CARDS],
}

/// Deals from the shuffled deck: hero's two cards, villain's two, then the board.
///
/// # Errors
///
/// `ModelError::DuplicateCard` only if a combo repeats a card, which a shuffle of the deck
/// never does; the caller reports it as an internal failure.
pub fn deal_cards(seed: Hex64) -> Result<DealtCards, ModelError> {
    let deck = shuffle(seed.get());
    let hero = ComboId::from_cards(deck[0], deck[1])?;
    let villain = ComboId::from_cards(deck[HOLE_CARDS], deck[HOLE_CARDS + 1])?;
    let first_board = 2 * HOLE_CARDS;
    let mut board = [deck[first_board]; BOARD_CARDS];
    board.copy_from_slice(&deck[first_board..first_board + BOARD_CARDS]);
    Ok(DealtCards { hero, villain, board })
}

/// The deal id: the first 16 bytes of `sha256(seed || start street || start node key)` in
/// UUID groups, lowercase, so the same seed and filter always name the same deal.
#[must_use]
pub fn deal_id(seed: Hex64, street: Street, key: &NodeKey) -> String {
    let digest = sha256_hex(format!("{seed}\n{street}\n{key}").as_bytes());
    let digits = &digest[..DEAL_ID_HEX_DIGITS];
    let mut id = String::with_capacity(DEAL_ID_HEX_DIGITS + UUID_GROUPS.len() - 1);
    let mut from = 0;
    for (position, width) in UUID_GROUPS.iter().enumerate() {
        if position > 0 {
            id.push('-');
        }
        id.push_str(&digits[from..from + width]);
        from += width;
    }
    id
}

/// One deal: the start, both hands and the board, which stays private until revealed.
#[derive(Clone, PartialEq)]
pub struct Deal {
    /// The deal id (see `deal_id`).
    pub id: String,
    /// The seed the deal was made from.
    pub seed: Hex64,
    /// The street the deal starts on, `preflop` in v1.
    pub start_street: Street,
    /// The node key the deal starts at.
    pub start_key: NodeKey,
    /// The solutions the registry holds for the configuration and pair.
    pub solution_ids: Vec<String>,
    /// The seat to act at the start node.
    pub hero: Position,
    /// The other seat.
    pub villain: Position,
    /// The hero's combo.
    pub hero_hand: ComboId,
    /// The villain's combo.
    pub villain_hand: ComboId,
    /// The board, flop first; never serialized whole.
    board: [Card; BOARD_CARDS],
}

impl Deal {
    /// The deal for `seed` at a resolved start.
    ///
    /// # Errors
    ///
    /// As `deal_cards`.
    pub fn make(seed: Hex64, start: Start) -> Result<Deal, ModelError> {
        let cards = deal_cards(seed)?;
        Ok(Deal {
            id: deal_id(seed, start.street, &start.key),
            seed,
            start_street: start.street,
            start_key: start.key,
            solution_ids: start.solution_ids,
            hero: start.hero,
            villain: start.villain,
            hero_hand: cards.hero,
            villain_hand: cards.villain,
            board: cards.board,
        })
    }

    /// The cards `street` adds to the board: three on the flop, one after, none preflop.
    #[must_use]
    pub fn street_cards(&self, street: Street) -> &[Card] {
        let from = before(street).map_or(0, |previous| usize::from(previous.board_cards()));
        &self.board[from..usize::from(street.board_cards())]
    }

    /// The board through `street` as text, `Ah7d2cKh` on the turn.
    #[must_use]
    pub fn board_text(&self, street: Street) -> String {
        format_cards(&self.board[..usize::from(street.board_cards())])
    }
}

impl fmt::Debug for Deal {
    /// Everything but the board, so a log line never carries a card before its reveal.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Deal")
            .field("id", &self.id)
            .field("seed", &self.seed)
            .field("start_street", &self.start_street)
            .field("start_key", &self.start_key)
            .field("solution_ids", &self.solution_ids)
            .field("hero", &self.hero)
            .field("villain", &self.villain)
            .field("hero_hand", &self.hero_hand)
            .field("villain_hand", &self.villain_hand)
            .finish_non_exhaustive()
    }
}

/// What a reveal answers.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Reveal {
    /// The street's cards.
    pub cards: Vec<Card>,
    /// The board through the street as text.
    pub board: String,
}

/// A held deal and how much of its board is revealed, as a count of board cards.
struct Entry {
    deal: Arc<Deal>,
    revealed_cards: u8,
}

/// The bounded store of deals made since startup.
pub struct DealStore {
    capacity: NonZeroUsize,
    deals: Mutex<LruCache<String, Entry>>,
}

impl DealStore {
    /// A store holding at most `capacity` deals; a capacity of 0 holds one.
    #[must_use]
    pub fn new(capacity: usize) -> DealStore {
        let capacity = NonZeroUsize::new(capacity.max(1)).unwrap_or(NonZeroUsize::MIN);
        DealStore { capacity, deals: Mutex::new(LruCache::new(capacity)) }
    }

    /// The most deals the store keeps.
    #[must_use]
    pub fn capacity(&self) -> usize {
        self.capacity.get()
    }

    /// How many deals the store holds now.
    #[must_use]
    pub fn held(&self) -> usize {
        self.lock().len()
    }

    /// Holds `deal` unless its id is already held, evicting the least recently used deal
    /// when full, and answers the held deal with the streets revealed so far.
    pub fn hold(&self, deal: Deal) -> (Arc<Deal>, Revealed) {
        let mut deals = self.lock();
        if let Some(entry) = deals.get(&deal.id) {
            return (Arc::clone(&entry.deal), revealed_block(&entry.deal, entry.revealed_cards));
        }
        let held = Arc::new(deal);
        deals.put(held.id.clone(), Entry { deal: Arc::clone(&held), revealed_cards: 0 });
        (held, Revealed::default())
    }

    /// Reveals `street` of the deal `id`: the flop first, then the turn, then the river; a
    /// repeat answers the same cards.
    ///
    /// # Errors
    ///
    /// `ApiError::BadRequest` for the preflop street, `ApiError::NotFound` for an id the
    /// store does not hold, `ApiError::Conflict` for a street revealed before the one that
    /// precedes it.
    pub fn reveal(&self, id: &str, street: Street) -> Result<Reveal, ApiError> {
        let Some(previous) = before(street) else {
            let streets = BOARD_STREETS.map(Street::as_str).join(", ");
            return Err(ApiError::BadRequest(format!("street must be one of {streets}")));
        };
        let mut deals = self.lock();
        let entry = deals.get_mut(id).ok_or_else(|| not_held(id))?;
        if entry.revealed_cards < previous.board_cards() {
            return Err(ApiError::Conflict(format!(
                "the {street} cannot be revealed before the {previous}"
            )));
        }
        entry.revealed_cards = entry.revealed_cards.max(street.board_cards());
        let deal = Arc::clone(&entry.deal);
        drop(deals);
        Ok(Reveal { cards: deal.street_cards(street).to_vec(), board: deal.board_text(street) })
    }

    /// The deals; an update is a few words, so a poisoned lock is reused.
    fn lock(&self) -> MutexGuard<'_, LruCache<String, Entry>> {
        self.deals.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

impl fmt::Debug for DealStore {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("DealStore")
            .field("capacity", &self.capacity())
            .field("held", &self.held())
            .finish()
    }
}

/// The streets a reveal can name, in order.
pub const BOARD_STREETS: [Street; 3] = [Street::Flop, Street::Turn, Street::River];

/// The 404 for a deal the store does not hold.
fn not_held(id: &str) -> ApiError {
    ApiError::NotFound(format!("deal {id} is not held; post its seed and filter again"))
}

/// The street before `street`, `None` preflop.
const fn before(street: Street) -> Option<Street> {
    match street {
        Street::Preflop => None,
        Street::Flop => Some(Street::Preflop),
        Street::Turn => Some(Street::Flop),
        Street::River => Some(Street::Turn),
    }
}

/// The revealed block of a deal response: each board street's text once revealed.
fn revealed_block(deal: &Deal, revealed_cards: u8) -> Revealed {
    let text = |street: Street| {
        (revealed_cards >= street.board_cards()).then(|| format_cards(deal.street_cards(street)))
    };
    Revealed { flop: text(Street::Flop), turn: text(Street::Turn), river: text(Street::River) }
}

#[cfg(test)]
mod tests;
