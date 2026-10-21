//! The E3 insight computations (R2.14, O-32, O-153, plan C.3): the threshold card, the
//! equity distributions, the range and nut advantages, the blockers and the hand role
//! over `equity::EquityTable` and a `NodeView`, with the O-153 constants as named consts.
//!
//! Mechanism: `compute` reads the node's hand space. At a `preflop_169` node `ranges`
//! turns each seat's reach into a 169-class range with every class's strength (its equity
//! against the other seat's reach-weighted range, `EquityTable::range_equity`) and its
//! live-matchup weight; `threshold` reads the acting seat's range for the card, the hand's
//! rank and its role; `ranges` also bins both ranges and takes their means and nut shares.
//! At a `postflop_1326` node no equity exists in v1 (O-32), so those blocks are null. The
//! blockers (`blockers`) and the noise flags (`crate::grade::noise_flags`, the one set of
//! 05 section 9 rules shared with `/v1/grade`) are filled at every node.
//!
//! Two weightings follow plan C.3: a share of a range and a rank in it weight a class by
//! reach times its combo count; a distribution, a mean equity and a nut share weight a
//! class by reach times its live matchups against the other range, so identical ranges
//! give exactly even equity.

mod blockers;
mod ranges;
#[cfg(test)]
mod tests;
mod threshold;

use gto_library::{HandSpace, NodeRecord, NodeView};

pub use blockers::blockers;
pub use ranges::{SeatRange, equity_distribution, nut_advantage, range_advantage, seat_ranges};
pub use threshold::{hand_role, rank_in_range, threshold_card};

use crate::api::insights::{
    EquityDistribution, HandRole, InsightsResponse, NutAdvantage, RangeAdvantage, ThresholdCard,
};
use crate::equity::EquityTable;
use crate::grade::noise_flags;
use crate::hand::HandRef;

/// A hand takes an action, folds, or is dominated by a passive action, at or above this
/// frequency (O-153: thresholds at 0.5).
pub const THRESHOLD_FREQUENCY: f64 = 0.5;
/// Equity bins of a range's distribution (O-153: ten bins from 0 to 1).
pub const EQUITY_BINS: usize = 10;
/// The equity at or above which a hand counts as a nut hand (O-153).
pub const NUT_EQUITY: f64 = 0.80;
/// The rank in range at or above which an aggressive hand is value and a passive hand a
/// trap (O-153, plan C.3).
pub const VALUE_RANK: f64 = 0.75;
/// The rank in range under which an aggressive hand is a bluff (O-153, plan C.3).
pub const BLUFF_RANK: f64 = 0.4;
/// How many blocked villain classes the blockers block lists (plan C.3: the five most).
pub const TOP_BLOCKED: usize = 5;
/// The equity of a hand with no live matchup, and the mean of an empty range: even, so a
/// range the node does not hold reads as no advantage.
pub const EVEN_EQUITY: f64 = 0.5;
/// The reach of a held hand when the record stores no reach (A3 section 4: absent reach is
/// a cleared flag), so such a node reads as full ranges.
pub const REACH_WHEN_ABSENT: f64 = 1.0;

/// The equity-based blocks of a `preflop_169` node (O-32).
struct EquityBlocks {
    threshold_card: ThresholdCard,
    equity_distribution: EquityDistribution,
    range_advantage: RangeAdvantage,
    nut_advantage: NutAdvantage,
    hand_role: HandRole,
}

/// The insight data of `hand` (written as `text`) at the node `view`, with `floor_pct_pot`
/// the grading floor of plan C.2 step 5 for the noise flags.
#[must_use]
pub fn compute(
    table: &EquityTable,
    view: &NodeView,
    hand: HandRef,
    text: &str,
    floor_pct_pot: f32,
) -> InsightsResponse {
    let blockers = blockers(view, hand, text);
    let noise_flags = noise_flags(view, hand.index, floor_pct_pot);
    let blocks = match view.record().hand_space {
        HandSpace::Preflop169 => Some(equity_blocks(table, view, hand, text)),
        HandSpace::Postflop1326 => None,
    };
    match blocks {
        Some(blocks) => InsightsResponse {
            threshold_card: Some(blocks.threshold_card),
            equity_distribution: Some(blocks.equity_distribution),
            range_advantage: Some(blocks.range_advantage),
            nut_advantage: Some(blocks.nut_advantage),
            blockers,
            hand_role: Some(blocks.hand_role),
            noise_flags,
        },
        None => InsightsResponse {
            threshold_card: None,
            equity_distribution: None,
            range_advantage: None,
            nut_advantage: None,
            blockers,
            hand_role: None,
            noise_flags,
        },
    }
}

/// Every equity-based block of a `preflop_169` node.
fn equity_blocks(table: &EquityTable, view: &NodeView, hand: HandRef, text: &str) -> EquityBlocks {
    let seats = seat_ranges(table, view);
    let to_act = acting_seat(view.record());
    let acting = &seats[to_act];
    let class = usize::from(hand.index);
    let rank = rank_in_range(acting, class);
    EquityBlocks {
        threshold_card: threshold_card(view, acting, class, text, rank),
        equity_distribution: equity_distribution(&seats),
        range_advantage: range_advantage(&seats, to_act),
        nut_advantage: nut_advantage(&seats, to_act),
        hand_role: hand_role(view, hand.index, rank),
    }
}

/// The acting seat's index in the pair, 0 out of position and 1 in position (O-130).
#[must_use]
pub fn acting_seat(record: &NodeRecord) -> usize {
    usize::from(record.to_act != 0)
}

/// The other seat's index in the pair.
#[must_use]
pub fn villain_seat(record: &NodeRecord) -> usize {
    usize::from(record.to_act == 0)
}

/// One hand's frequencies in record order as f64, `None` when the node does not hold it.
#[must_use]
pub fn frequencies_of(view: &NodeView, hand: u16) -> Option<Vec<f64>> {
    view.frequencies(hand).map(|row| row.into_iter().map(f64::from).collect())
}

/// One hand's reach for `seat`, `REACH_WHEN_ABSENT` when the record stores no reach;
/// `None` when the node does not hold the hand.
#[must_use]
pub fn reach_of(view: &NodeView, hand: u16, seat: usize) -> Option<f64> {
    view.frequencies(hand)?;
    Some(view.reach(hand).map_or(REACH_WHEN_ABSENT, |reach| f64::from(reach[seat])))
}
