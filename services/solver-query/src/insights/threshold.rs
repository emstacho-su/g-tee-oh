//! The threshold card, the hand's rank in the acting seat's range and its role (plan C.3,
//! O-153). For each aggressive action the card names the weakest held class playing it at
//! or above `THRESHOLD_FREQUENCY` and the share of the range taking it; it names the
//! strongest class folding at that frequency; and it places the queried hand against
//! each threshold by strength.

use std::cmp::Ordering;

use gto_library::{NodeView, RecordAction, narrow_f32};
use gto_model::{ActionToken, HandClass};

use super::ranges::SeatRange;
use super::{BLUFF_RANK, EVEN_EQUITY, THRESHOLD_FREQUENCY, VALUE_RANK, frequencies_of};
use crate::api::insights::{
    HandPosition, HandRole, Relative, RelativePosition, ThresholdAction, ThresholdCard,
};

/// A held class with its frequencies in record order.
struct Row {
    class: usize,
    frequencies: Vec<f64>,
}

/// Every class the acting seat holds that the node has a strategy for.
fn rows(view: &NodeView, acting: &SeatRange) -> Vec<Row> {
    acting
        .held()
        .filter_map(|class| {
            let hand = u16::try_from(class).ok()?;
            frequencies_of(view, hand).map(|frequencies| Row { class, frequencies })
        })
        .collect()
}

/// The class name at a range index.
fn class_name(class: usize) -> Option<String> {
    let index = u8::try_from(class).ok()?;
    HandClass::from_index(index).ok().map(|class| class.to_string())
}

/// The threshold card of `class` (written as `text`) at the node, `rank` being its
/// `rank_in_range`.
#[must_use]
pub fn threshold_card(
    view: &NodeView,
    acting: &SeatRange,
    class: usize,
    text: &str,
    rank: f64,
) -> ThresholdCard {
    let rows = rows(view, acting);
    let aggressive: Vec<(usize, &RecordAction)> =
        view.actions().iter().enumerate().filter(|(_, a)| a.token.is_aggressive()).collect();
    let weakest: Vec<Option<usize>> =
        aggressive.iter().map(|(index, _)| weakest_taking(&rows, acting, *index)).collect();
    let actions = aggressive
        .iter()
        .zip(&weakest)
        .map(|((index, action), weakest)| ThresholdAction {
            index: action_index(*index),
            token: action.token.to_string(),
            weakest_hand_taking_half: weakest.and_then(class_name),
            share_taking: narrow_f32(share_taking(&rows, acting, *index)),
        })
        .collect();
    let fold = view.actions().iter().position(|a| a.token.is_fold());
    let strongest_folding_hand =
        fold.and_then(|index| strongest_taking(&rows, acting, index)).and_then(class_name);
    let strength = acting.strength.get(class).copied().flatten();
    let relative = aggressive
        .iter()
        .zip(&weakest)
        .map(|((index, _), weakest)| RelativePosition {
            index: action_index(*index),
            position: relative(strength, weakest.and_then(|w| acting.strength[w])),
        })
        .collect();
    let hand_position = HandPosition {
        hand: text.to_owned(),
        equity_vs_villain: narrow_f32(strength.unwrap_or(EVEN_EQUITY)),
        rank_in_range: narrow_f32(rank),
        relative,
    };
    ThresholdCard { actions, strongest_folding_hand, hand_position }
}

/// A record action index as the contract's u8 (a record holds at most 255 actions).
fn action_index(index: usize) -> u8 {
    u8::try_from(index).unwrap_or(u8::MAX)
}

/// The weakest class (lowest strength) taking `action` at or above the threshold.
fn weakest_taking(rows: &[Row], acting: &SeatRange, action: usize) -> Option<usize> {
    taking(rows, action)
        .filter_map(|class| acting.strength[class].map(|strength| (class, strength)))
        .fold(None, |weakest: Option<(usize, f64)>, (class, strength)| match weakest {
            Some((_, held)) if held <= strength => weakest,
            _ => Some((class, strength)),
        })
        .map(|(class, _)| class)
}

/// The strongest class (highest strength) taking `action` at or above the threshold.
fn strongest_taking(rows: &[Row], acting: &SeatRange, action: usize) -> Option<usize> {
    taking(rows, action)
        .filter_map(|class| acting.strength[class].map(|strength| (class, strength)))
        .fold(None, |strongest: Option<(usize, f64)>, (class, strength)| match strongest {
            Some((_, held)) if held >= strength => strongest,
            _ => Some((class, strength)),
        })
        .map(|(class, _)| class)
}

/// The classes playing `action` at or above `THRESHOLD_FREQUENCY`, in index order.
fn taking(rows: &[Row], action: usize) -> impl Iterator<Item = usize> + '_ {
    rows.iter()
        .filter(move |row| row.frequencies.get(action).is_some_and(|f| *f >= THRESHOLD_FREQUENCY))
        .map(|row| row.class)
}

/// The share of the acting range taking `action`: each held class's reach times combos
/// times its frequency, over the range's reach times combos; 0 for an empty range.
fn share_taking(rows: &[Row], acting: &SeatRange, action: usize) -> f64 {
    let (mut taking, mut weight) = (0.0, 0.0);
    for row in rows {
        let w = acting.combo_weight(row.class);
        weight += w;
        taking += w * row.frequencies.get(action).copied().unwrap_or(0.0);
    }
    if weight > 0.0 { taking / weight } else { 0.0 }
}

/// Where `strength` sits against a threshold strength: above, at or below. Both come
/// from the same `SeatRange`, so the hand at the threshold compares exactly equal. A hand
/// or a threshold without a strength is below.
fn relative(strength: Option<f64>, threshold: Option<f64>) -> Relative {
    let (Some(strength), Some(threshold)) = (strength, threshold) else {
        return Relative::Below;
    };
    match strength.total_cmp(&threshold) {
        Ordering::Greater => Relative::Above,
        Ordering::Equal => Relative::At,
        Ordering::Less => Relative::Below,
    }
}

/// The reach-weighted percentile of `class` in the acting range by strength: the reach
/// times combos of the held classes at or below its strength over the whole, so the
/// strongest class is exactly 1. A class without a strength, or an empty range, ranks 0.
#[must_use]
pub fn rank_in_range(acting: &SeatRange, class: usize) -> f64 {
    let Some(own) = acting.strength.get(class).copied().flatten() else {
        return 0.0;
    };
    let (mut below, mut total) = (0.0, 0.0);
    for (held, strength) in acting.held_with_strength() {
        let w = acting.combo_weight(held);
        total += w;
        if strength <= own {
            below += w;
        }
    }
    if total > 0.0 { below / total } else { 0.0 }
}

/// The role of `hand` at the node (O-153, plan C.3): fold when it folds at or above the
/// threshold; else value when it ranks at or above `VALUE_RANK` and takes an aggressive
/// action; bluff when it ranks under `BLUFF_RANK` and takes an aggressive action; trap
/// when it ranks at or above `VALUE_RANK` and a passive action dominates; marginal
/// otherwise. A hand the node does not hold is marginal.
#[must_use]
pub fn hand_role(view: &NodeView, hand: u16, rank: f64) -> HandRole {
    let Some(frequencies) = frequencies_of(view, hand) else {
        return HandRole::Marginal;
    };
    let tokens: Vec<ActionToken> = view.actions().iter().map(|action| action.token).collect();
    let largest = |keep: &dyn Fn(ActionToken) -> bool| -> f64 {
        tokens
            .iter()
            .zip(&frequencies)
            .filter(|(token, _)| keep(**token))
            .map(|(_, f)| *f)
            .fold(0.0, f64::max)
    };
    let fold: f64 =
        tokens.iter().zip(&frequencies).filter(|(t, _)| t.is_fold()).map(|(_, f)| f).sum();
    let aggressive = largest(&ActionToken::is_aggressive);
    let passive = largest(&|token: ActionToken| !token.is_aggressive() && !token.is_fold());
    if fold >= THRESHOLD_FREQUENCY {
        HandRole::Fold
    } else if rank >= VALUE_RANK && aggressive >= THRESHOLD_FREQUENCY {
        HandRole::Value
    } else if rank < BLUFF_RANK && aggressive >= THRESHOLD_FREQUENCY {
        HandRole::Bluff
    } else if rank >= VALUE_RANK && passive >= THRESHOLD_FREQUENCY {
        HandRole::Trap
    } else {
        HandRole::Marginal
    }
}
