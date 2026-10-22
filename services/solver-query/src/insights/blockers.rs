//! What the queried hand's cards remove from the villain's range (plan C.3): the villain
//! combos removed, the removed reach as a share of the villain's reach-weighted combos,
//! and the most blocked classes. At a `preflop_169` node the villain range is reach per
//! class and a class's removed reach is its reach times the combos of it that share a card
//! with the hand (`ComboId::conflicts_with` over `HandClass::combos`); at a
//! `postflop_1326` node it is the reach of each held villain combo that shares a card. A
//! hand given as a class is the mean over its combos.

use gto_library::{HandSpace, NodeView, narrow_f32};
use gto_model::{Card, ComboId, HandClass};

use super::{TOP_BLOCKED, reach_of};
use crate::api::insights::{BlockedClass, Blockers};
use crate::equity::CLASSES;
use crate::hand::HandRef;

/// The removal of one hero combo, or the mean over a class's combos.
#[derive(Clone, Debug, PartialEq)]
struct Removal {
    /// Villain reach removed per villain class.
    by_class: Vec<f64>,
    /// Villain combos removed, before any mean is taken.
    combos: f64,
    /// The villain's reach-weighted combos, removed or not.
    total_reach: f64,
}

impl Removal {
    fn empty() -> Removal {
        Removal { by_class: vec![0.0; CLASSES], combos: 0.0, total_reach: 0.0 }
    }

    /// The mean over `count` hero combos accumulated into this removal.
    fn mean_over(mut self, count: usize) -> Removal {
        let count = u32::try_from(count).map_or(1.0, f64::from).max(1.0);
        for removed in &mut self.by_class {
            *removed /= count;
        }
        self.combos /= count;
        self
    }
}

/// The blockers block of `hand` (written as `text`) at the node, `villain` being the other
/// seat's index in the pair (`grade::other_seat` of the acting seat).
#[must_use]
pub fn blockers(view: &NodeView, villain: usize, hand: HandRef, text: &str) -> Blockers {
    let hero: Vec<ComboId> = hand.combo.map_or_else(|| hand.class.combos(), |combo| vec![combo]);
    let removal = match view.record().hand_space {
        HandSpace::Preflop169 => class_removal(view, villain, &hero),
        HandSpace::Postflop1326 => combo_removal(view, villain, &hero),
    };
    let share = if removal.total_reach > 0.0 {
        removal.by_class.iter().sum::<f64>() / removal.total_reach
    } else {
        0.0
    };
    Blockers {
        hand: text.to_owned(),
        villain_combos_removed: round_count(removal.combos),
        villain_reach_removed_share: narrow_f32(share),
        top_blocked: top_blocked(&removal.by_class),
    }
}

/// The removal at a `preflop_169` node: the villain holds classes.
fn class_removal(view: &NodeView, villain: usize, hero: &[ComboId]) -> Removal {
    let mut removal = Removal::empty();
    for (class, index) in held_classes(view, villain) {
        let reach = reach_of(view, index, villain).unwrap_or(0.0);
        if reach <= 0.0 {
            continue;
        }
        let combos = class.combos();
        removal.total_reach += reach * f64::from(class.combo_count());
        for cards in hero.iter().copied().map(cards_of) {
            let conflicting = combos.iter().filter(|combo| combo.conflicts_with(&cards)).count();
            let conflicting = u32::try_from(conflicting).map_or(0.0, f64::from);
            removal.by_class[usize::from(class.index())] += reach * conflicting;
            removal.combos += conflicting;
        }
    }
    removal.mean_over(hero.len())
}

/// The removal at a `postflop_1326` node: the villain holds combos.
fn combo_removal(view: &NodeView, villain: usize, hero: &[ComboId]) -> Removal {
    let mut removal = Removal::empty();
    let hero_cards: Vec<[Card; 2]> = hero.iter().copied().map(cards_of).collect();
    for index in view.hands() {
        let Ok(combo) = ComboId::from_index(index) else {
            continue;
        };
        let reach = reach_of(view, index, villain).unwrap_or(0.0);
        if reach <= 0.0 {
            continue;
        }
        removal.total_reach += reach;
        for cards in &hero_cards {
            if combo.conflicts_with(cards) {
                removal.by_class[usize::from(combo.class().index())] += reach;
                removal.combos += 1.0;
            }
        }
    }
    removal.mean_over(hero.len())
}

/// The classes a `preflop_169` node holds, with their record index.
fn held_classes(view: &NodeView, villain: usize) -> Vec<(HandClass, u16)> {
    view.hands()
        .into_iter()
        .filter(|index| reach_of(view, *index, villain).is_some())
        .filter_map(|index| {
            let class = HandClass::from_index(u8::try_from(index).ok()?).ok()?;
            Some((class, index))
        })
        .collect()
}

/// The two cards of a combo.
fn cards_of(combo: ComboId) -> [Card; 2] {
    let (a, b) = combo.cards();
    [a, b]
}

/// The `TOP_BLOCKED` classes with the most reach removed, most first, ties by class index;
/// a class with nothing removed is not listed.
fn top_blocked(by_class: &[f64]) -> Vec<BlockedClass> {
    let mut blocked: Vec<(usize, f64)> =
        by_class.iter().copied().enumerate().filter(|(_, removed)| *removed > 0.0).collect();
    blocked.sort_by(|a, b| b.1.total_cmp(&a.1).then(a.0.cmp(&b.0)));
    blocked
        .into_iter()
        .take(TOP_BLOCKED)
        .filter_map(|(class, removed)| {
            let class = HandClass::from_index(u8::try_from(class).ok()?).ok()?;
            Some(BlockedClass { hand: class.to_string(), reach_removed: narrow_f32(removed) })
        })
        .collect()
}

/// A mean combo count rounded to the nearest whole combo (a class's combos remove the
/// same count against a suit-symmetric range, so the mean is whole at preflop).
#[expect(clippy::cast_possible_truncation, clippy::cast_sign_loss, reason = "a count")]
fn round_count(combos: f64) -> u32 {
    combos.round().clamp(0.0, f64::from(u32::MAX)) as u32
}
