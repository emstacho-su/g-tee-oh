//! Both seats' preflop ranges at a node and the blocks read straight off them (plan C.3):
//! the ten-bin equity distributions, the range advantage and the nut advantage. A range
//! is 169 classes with the seat's reach, each class's strength against the other seat's
//! reach-weighted range and its live-matchup weight; a class the node does not hold has
//! reach 0 and no weight anywhere.

use std::array;

use gto_library::{NodeView, narrow_f32};
use gto_model::HandClass;

use super::{EQUITY_BINS, EVEN_EQUITY, NUT_EQUITY, reach_of};
use crate::api::insights::{EquityDistribution, NutAdvantage, RangeAdvantage};
use crate::equity::{CLASSES, EquityTable};

/// Seats in a pair: out of position, in position.
const SEATS: usize = 2;
/// Equity points per unit of equity, for `to_act_advantage_pct_points`.
const PCT_POINTS: f64 = 100.0;
/// The bin count as a float, for the bin arithmetic.
#[expect(clippy::cast_precision_loss, reason = "ten bins")]
const BINS_WIDE: f64 = EQUITY_BINS as f64;

/// One seat's range over the 169 classes.
#[derive(Clone, Debug, PartialEq)]
pub struct SeatRange {
    /// The seat's reach per class; 0 for a class the node does not hold.
    pub reach: Vec<f64>,
    /// Each class's equity against the other seat's range; `None` without a live matchup.
    pub strength: Vec<Option<f64>>,
    /// Each class's live matchups against the other seat's range,
    /// `sum_j reach_other[j] * pairs[i][j]`.
    pub live: Vec<f64>,
}

impl SeatRange {
    /// The classes the seat holds, reach above 0, in index order.
    pub fn held(&self) -> impl Iterator<Item = usize> + '_ {
        self.reach.iter().enumerate().filter(|(_, reach)| **reach > 0.0).map(|(i, _)| i)
    }

    /// The held classes with a strength, as (class, strength).
    pub fn held_with_strength(&self) -> impl Iterator<Item = (usize, f64)> + '_ {
        self.held().filter_map(|i| self.strength[i].map(|strength| (i, strength)))
    }

    /// A class's reach times its live matchups: the weight of a distribution, a mean and a
    /// nut share.
    #[must_use]
    pub fn live_weight(&self, class: usize) -> f64 {
        self.reach[class] * self.live[class]
    }

    /// A class's reach times its combo count: the weight of a share and a rank.
    #[must_use]
    pub fn combo_weight(&self, class: usize) -> f64 {
        self.reach[class] * combos(class)
    }
}

/// The combo count of class `index`: 6 for a pair, 4 suited, 12 offsuit; 0 outside the
/// 169 classes.
#[must_use]
pub fn combos(index: usize) -> f64 {
    u8::try_from(index)
        .ok()
        .and_then(|index| HandClass::from_index(index).ok())
        .map_or(0.0, |class| f64::from(class.combo_count()))
}

/// Both seats' ranges at a `preflop_169` node, out of position first.
#[must_use]
pub fn seat_ranges(table: &EquityTable, view: &NodeView) -> [SeatRange; SEATS] {
    let reach: [Vec<f64>; SEATS] = array::from_fn(|seat| class_reach(view, seat));
    array::from_fn(|seat| {
        let other = &reach[SEATS - 1 - seat];
        SeatRange {
            reach: reach[seat].clone(),
            strength: table.strengths(other),
            live: table.live_weights(other),
        }
    })
}

/// One seat's reach per class, 0 for a class the node does not hold.
fn class_reach(view: &NodeView, seat: usize) -> Vec<f64> {
    let mut reach = vec![0.0; CLASSES];
    for hand in view.hands() {
        if let (Some(slot), Some(value)) =
            (reach.get_mut(usize::from(hand)), reach_of(view, hand, seat))
        {
            *slot = value;
        }
    }
    reach
}

/// Both ranges' equity histograms: ten bins from 0 to 1, each seat's bins summing to 1.
#[must_use]
pub fn equity_distribution(seats: &[SeatRange; SEATS]) -> EquityDistribution {
    #[expect(clippy::cast_precision_loss, reason = "eleven edges")]
    let bin_edges = array::from_fn(|k| narrow_f32(k as f64 / BINS_WIDE));
    EquityDistribution { bin_edges, oop: histogram(&seats[0]), ip: histogram(&seats[1]) }
}

/// One range's bins: each held class's reach times live matchups at its strength's bin,
/// normalized to sum to 1 (all zeros for an empty range).
fn histogram(seat: &SeatRange) -> [f32; EQUITY_BINS] {
    let mut bins = [0.0_f64; EQUITY_BINS];
    for (class, strength) in seat.held_with_strength() {
        bins[bin_of(strength)] += seat.live_weight(class);
    }
    let total: f64 = bins.iter().sum();
    bins.map(|bin| narrow_f32(if total > 0.0 { bin / total } else { 0.0 }))
}

/// The bin of an equity in `[0, 1]`: `floor(equity * 10)`, with 1.0 in the last bin.
#[expect(clippy::cast_possible_truncation, clippy::cast_sign_loss, reason = "a bin index")]
fn bin_of(strength: f64) -> usize {
    ((strength.clamp(0.0, 1.0) * BINS_WIDE).floor() as usize).min(EQUITY_BINS - 1)
}

/// Each seat's reach-weighted mean equity and the acting seat's edge over even in
/// percentage points.
#[must_use]
pub fn range_advantage(seats: &[SeatRange; SEATS], to_act: usize) -> RangeAdvantage {
    let means = [mean_equity(&seats[0]), mean_equity(&seats[1])];
    RangeAdvantage {
        oop_mean_equity: narrow_f32(means[0]),
        ip_mean_equity: narrow_f32(means[1]),
        to_act_advantage_pct_points: narrow_f32((means[to_act] - EVEN_EQUITY) * PCT_POINTS),
    }
}

/// A range's mean strength weighted by reach times live matchups; even for an empty range.
fn mean_equity(seat: &SeatRange) -> f64 {
    let (mut weighted, mut weight) = (0.0, 0.0);
    for (class, strength) in seat.held_with_strength() {
        let w = seat.live_weight(class);
        weighted += w * strength;
        weight += w;
    }
    if weight > 0.0 { weighted / weight } else { EVEN_EQUITY }
}

/// Each seat's share of its range at or above `NUT_EQUITY` and the acting seat's lead.
#[must_use]
pub fn nut_advantage(seats: &[SeatRange; SEATS], to_act: usize) -> NutAdvantage {
    let shares = [nut_share(&seats[0]), nut_share(&seats[1])];
    NutAdvantage {
        threshold_equity: narrow_f32(NUT_EQUITY),
        oop_share: narrow_f32(shares[0]),
        ip_share: narrow_f32(shares[1]),
        to_act_advantage: narrow_f32(shares[to_act] - shares[SEATS - 1 - to_act]),
    }
}

/// The share of a range's reach times live matchups held by classes at or above
/// `NUT_EQUITY`; 0 for an empty range.
fn nut_share(seat: &SeatRange) -> f64 {
    let (mut nuts, mut weight) = (0.0, 0.0);
    for (class, strength) in seat.held_with_strength() {
        let w = seat.live_weight(class);
        weight += w;
        if strength >= NUT_EQUITY {
            nuts += w;
        }
    }
    if weight > 0.0 { nuts / weight } else { 0.0 }
}
