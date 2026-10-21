//! The grade math (R2.13, ADR 0004, ADR 0020, O-22, plan C.2) over a `gto_library::NodeView`:
//! each action's expected value (EV) and the loss in big blinds (bb) and in percent of the
//! pot, the floor through `gto_model::grading::floor_pct_pot` (O-150) with its source, the
//! bucket read off the record (`Bucket::of_action` ran at pack time; nothing here recomputes
//! it), the noise flags of 05 section 9 and the difficulty features of R4.4. The nodes and
//! grade handlers assemble their bodies from these functions, and the insights handler
//! (lane B) takes `noise_flags`.
//!
//! Numbers: a stored loss is a `u16` in units of 0.01 percent of the pot (A3 section 4), so
//! the loss in percent is `units / 100`, exact in f32; the loss in bb is
//! `gto_library::loss_bb`; EVs and frequencies are the view's own f32 values. Nothing is
//! clamped: the loss is raw and the TypeScript policy applies `max(0, loss - floor)` (A6
//! section 4, R3.8).
//!
//! Weights: a hand of a `preflop_169` node stands for its class's combos
//! (`HandClass::combo_count`), a hand of a `postflop_1326` node for one combo, so range
//! shares are reach-weighted combo counts. A record without reach (a cleared flag, never
//! an invented 1.0) weighs every held hand once.

use gto_library::{HandSpace, NodeView};
use gto_model::grading::{self, Floor};
use gto_model::{ComboId, HandClass};

use crate::api::{DifficultyFeatures, FloorSource, NoiseFlag};

/// An action counts as played when its frequency is at or above this: the mixing epsilon
/// of O-153 (05 section 9), shared by `close_ev_mix` and `DifficultyFeatures::mixed`.
pub const MIX_EPSILON: f32 = 0.05;

/// A line is rare when the acting seat reaches the node with the hand under this often
/// (O-153, 05 section 9).
pub const RARE_LINE_REACH: f32 = 0.005;

/// Loss units per percent of the pot (A3 section 4: a unit is 0.01 percent).
pub const UNITS_PER_PCT: f32 = 100.0;

/// The seats of a pair, out of position first (A3 section 1).
const SEATS: usize = 2;

/// One hand's numbers at a node, read once from the view.
#[derive(Clone, Debug, PartialEq)]
pub struct HandNumbers {
    /// The frequency of each action in record order, summing to 1.
    pub frequencies: Vec<f32>,
    /// The EV of each action in bb, in record order.
    pub ev_bb: Vec<f32>,
    /// The stored loss of each action in units of 0.01 percent of the pot.
    pub loss_units: Vec<u16>,
    /// Reach per seat in pair order, when the record carries it.
    pub reach: Option<[f32; 2]>,
}

impl HandNumbers {
    /// The loss of each action in percent of the pot.
    #[must_use]
    pub fn loss_pct_pot(&self) -> Vec<f32> {
        self.loss_units.iter().map(|units| loss_pct_pot(*units)).collect()
    }

    /// The best action: the first with zero loss, the highest EV and the first on ties
    /// (O-130). A record always holds one; should none, the first smallest loss.
    #[must_use]
    pub fn best_action(&self) -> usize {
        best_action(&self.loss_units)
    }

    /// The best action's EV in bb, the record's `ev_best` read back exactly.
    #[must_use]
    pub fn ev_best_bb(&self) -> f32 {
        self.ev_bb.get(self.best_action()).copied().unwrap_or_default()
    }
}

/// The numbers of `hand` at the node; `None` when the node does not hold it.
#[must_use]
pub fn hand_numbers(view: &NodeView, hand: u16) -> Option<HandNumbers> {
    let frequencies = view.frequencies(hand)?;
    let actions = 0..view.actions().len();
    let ev_bb = actions.clone().map(|a| view.ev_bb(hand, a)).collect::<Option<Vec<f32>>>()?;
    let loss_units = actions.map(|a| view.loss_units(hand, a)).collect::<Option<Vec<u16>>>()?;
    Some(HandNumbers { frequencies, ev_bb, loss_units, reach: view.reach(hand) })
}

/// A stored loss in percent of the pot: the units over 100, exact in f32.
#[must_use]
pub fn loss_pct_pot(units: u16) -> f32 {
    f32::from(units) / UNITS_PER_PCT
}

/// The first action with zero loss, else the first with the smallest loss (O-130).
#[must_use]
pub fn best_action(loss_units: &[u16]) -> usize {
    let smallest = loss_units.iter().copied().min().unwrap_or_default();
    loss_units.iter().position(|units| *units == smallest).unwrap_or_default()
}

/// The floor at the node (O-22, O-150): the record's accuracy, else the manifest's
/// exploitability, else 0.02 bb over the pot, never below the noise floor. The precedence
/// lives in `gto_model::grading` and nowhere else (ADR 0004).
#[must_use]
pub fn floor(view: &NodeView, exploitability_pct_pot: Option<[f64; 2]>) -> Floor {
    let record = view.record();
    grading::floor_pct_pot(record.pot, record.accuracy_pct_pot, exploitability_pct_pot)
}

/// The contract's name of a floor source.
#[must_use]
pub const fn floor_source(source: grading::FloorSource) -> FloorSource {
    match source {
        grading::FloorSource::NoiseFloor => FloorSource::NoiseFloor,
        grading::FloorSource::NodeAccuracy => FloorSource::NodeAccuracy,
        grading::FloorSource::Exploitability => FloorSource::Exploitability,
        grading::FloorSource::FallbackBb => FloorSource::FallbackBb,
    }
}

/// The acting seat's index in the pair: 0 out of position, 1 in position; `None` for a
/// record whose seat byte is neither.
#[must_use]
pub fn acting_seat(view: &NodeView) -> Option<usize> {
    let seat = usize::from(view.record().to_act);
    (seat < SEATS).then_some(seat)
}

/// How many combos `hand` stands for: its class's combos at a `preflop_169` node, one at a
/// `postflop_1326` node; 0 for an index outside the space.
#[must_use]
pub fn hand_weight(space: HandSpace, hand: u16) -> u32 {
    match space {
        HandSpace::Preflop169 => u8::try_from(hand)
            .ok()
            .and_then(|index| HandClass::from_index(index).ok())
            .map_or(0, |class| u32::from(class.combo_count())),
        HandSpace::Postflop1326 => u32::from(hand < space.size()),
    }
}

/// The hand-level noise flags of 05 section 9 for `hand` against `floor_pct_pot` (the
/// node's floor in percent of the pot, from `floor`), in `NoiseFlag` order:
///
/// - `close_ev_mix`: two or more actions are played at `MIX_EPSILON` or more and the
///   largest loss among them is under the floor;
/// - `rare_line`: the acting seat reaches the node with the hand under `RARE_LINE_REACH`;
/// - `suit_mixing`: at a `postflop_1326` node, the held combos of the hand's class do not
///   all share one best action.
///
/// Empty for a hand the node does not hold; callers that need a 404 check that first.
/// The insights handler shares this function (plan C.3).
#[must_use]
pub fn noise_flags(view: &NodeView, hand: u16, floor_pct_pot: f32) -> Vec<NoiseFlag> {
    let Some(numbers) = hand_numbers(view, hand) else {
        return Vec::new();
    };
    let checks = [
        (
            close_ev_mix(&numbers.frequencies, &numbers.loss_units, floor_pct_pot),
            NoiseFlag::CloseEvMix,
        ),
        (rare_line(view, numbers.reach), NoiseFlag::RareLine),
        (suit_mixing(view, hand), NoiseFlag::SuitMixing),
    ];
    checks.into_iter().filter(|(on, _)| *on).map(|(_, flag)| flag).collect()
}

/// True when two or more played actions all lose under the floor (05 section 9).
fn close_ev_mix(frequencies: &[f32], loss_units: &[u16], floor_pct_pot: f32) -> bool {
    let played: Vec<u16> = frequencies
        .iter()
        .zip(loss_units)
        .filter(|(frequency, _)| **frequency >= MIX_EPSILON)
        .map(|(_, units)| *units)
        .collect();
    let largest = played.iter().copied().max().map(loss_pct_pot);
    played.len() >= 2 && largest.is_some_and(|loss| loss < floor_pct_pot)
}

/// True when the acting seat's reach for the hand is under `RARE_LINE_REACH`.
fn rare_line(view: &NodeView, reach: Option<[f32; 2]>) -> bool {
    match (reach, acting_seat(view)) {
        (Some(reach), Some(seat)) => reach[seat] < RARE_LINE_REACH,
        _ => false,
    }
}

/// True at a `postflop_1326` node when the held combos of the hand's class split their
/// best action (`ComboId::class`, `HandClass::combos`).
fn suit_mixing(view: &NodeView, hand: u16) -> bool {
    if view.record().hand_space != HandSpace::Postflop1326 {
        return false;
    }
    let Ok(combo) = ComboId::from_index(hand) else {
        return false;
    };
    let mut best_actions = combo
        .class()
        .combos()
        .into_iter()
        .filter_map(|sibling| best_action_of(view, sibling.index()));
    let Some(first) = best_actions.next() else {
        return false;
    };
    best_actions.any(|best| best != first)
}

/// The best action of `hand` from the stored losses alone; `None` when not held.
fn best_action_of(view: &NodeView, hand: u16) -> Option<usize> {
    let units = (0..view.actions().len())
        .map(|action| view.loss_units(hand, action))
        .collect::<Option<Vec<u16>>>()?;
    Some(best_action(&units))
}

/// The node-level noise flags: `rare_line` only (plan C.1), raised when the acting seat's
/// reach-weighted combos are under `RARE_LINE_REACH` of the combos it holds at the node,
/// that is when the seat reaches the node with under half a percent of its range. Empty
/// without reach.
#[must_use]
pub fn node_noise_flags(view: &NodeView) -> Vec<NoiseFlag> {
    let rare = acting_seat(view)
        .and_then(|seat| reach_share(view, seat))
        .is_some_and(|share| share < f64::from(RARE_LINE_REACH));
    if rare { vec![NoiseFlag::RareLine] } else { Vec::new() }
}

/// The seat's reach-weighted combos over its combos; `None` without reach or combos.
fn reach_share(view: &NodeView, seat: usize) -> Option<f64> {
    view.record().reach.as_ref()?;
    let (combos, weighted) = seat_totals(view, seat);
    (combos > 0).then(|| weighted / f64::from(combos))
}

/// The seat's (combos, reach-weighted combos) over every hand the node holds; a record
/// without reach weighs every hand once, so both totals agree.
#[must_use]
pub fn seat_totals(view: &NodeView, seat: usize) -> (u32, f64) {
    let space = view.record().hand_space;
    view.hands().into_iter().fold((0, 0.0), |(combos, weighted), hand| {
        let weight = hand_weight(space, hand);
        let reach = view.reach(hand).map_or(1.0, |reach| f64::from(reach[seat]));
        (combos.saturating_add(weight), weighted + f64::from(weight) * reach)
    })
}

/// The reach-weighted share of the acting seat's range taking each action, in record
/// order; the shares sum to 1 because every hand's frequencies do. Every share is 0 when the
/// seat holds no reach-weighted combo.
#[must_use]
pub fn action_shares(view: &NodeView) -> Vec<f64> {
    let actions = view.actions().len();
    let space = view.record().hand_space;
    let seat = acting_seat(view).unwrap_or_default();
    let mut taken = vec![0.0; actions];
    let mut total = 0.0;
    for hand in view.hands() {
        let Some(frequencies) = view.frequencies(hand) else {
            continue;
        };
        let reach = view.reach(hand).map_or(1.0, |reach| f64::from(reach[seat]));
        let weight = f64::from(hand_weight(space, hand)) * reach;
        total += weight;
        for (share, frequency) in taken.iter_mut().zip(frequencies) {
            *share += weight * f64::from(frequency);
        }
    }
    if total > 0.0 { taken.into_iter().map(|share| share / total).collect() } else { taken }
}

/// The difficulty features of a hand (R4.4, plan C.2 step 8) from its frequencies and
/// stored losses against the floor: the EV gap is the second smallest loss in percent of
/// the pot (0 with one action), purity the largest frequency, `mixed` two or more actions
/// at `MIX_EPSILON` or more, and `all_within_floor` every nonzero loss under the floor.
#[must_use]
pub fn difficulty_features(
    frequencies: &[f32],
    loss_units: &[u16],
    floor_pct_pot: f32,
) -> DifficultyFeatures {
    let mut sorted = loss_units.to_vec();
    sorted.sort_unstable();
    let played = frequencies.iter().filter(|frequency| **frequency >= MIX_EPSILON).count();
    DifficultyFeatures {
        ev_gap_pct_pot: sorted.get(1).map_or(0.0, |units| loss_pct_pot(*units)),
        purity: frequencies.iter().copied().fold(0.0, f32::max),
        n_actions: u8::try_from(loss_units.len()).unwrap_or(u8::MAX),
        mixed: played >= 2,
        all_within_floor: loss_units
            .iter()
            .filter(|units| **units > 0)
            .all(|units| loss_pct_pot(*units) < floor_pct_pot),
    }
}

#[cfg(test)]
mod tests;
