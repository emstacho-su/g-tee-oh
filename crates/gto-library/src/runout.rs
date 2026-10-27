//! Runout draws for a flop build (S18, R2.12, ADR 0023, A2 section 2, O-192).
//!
//! Mechanism: the 49 cards off the flop give 49 times 48 = 2,352 ordered (turn, river)
//! pairs. [`draw_runouts`] lists them in card-index order, then runs a partial
//! Fisher-Yates shuffle driven by an in-crate `SplitMix64` generator seeded with `seed`, and
//! keeps the first `k`: a uniform draw without replacement that depends on the seed alone,
//! so the same seed always yields the same runouts on every machine. No dependency is
//! added to the crate (O-192).

use std::fmt;

use gto_model::{Card, Flop};

use crate::error::LibraryError;

/// The number of ordered (turn, river) pairs a flop leaves: 49 times 48.
pub const ORDERED_RUNOUTS: usize = 2_352;

/// One stored runout: the turn and the river dealt after a flop.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct RunoutSpec {
    /// The turn card.
    pub turn: Card,
    /// The river card.
    pub river: Card,
}

impl fmt::Display for RunoutSpec {
    /// The turn and river as one text, for example `Ks9h`, the directory name of the
    /// runout's files (A3 section 2).
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}{}", self.turn, self.river)
    }
}

/// `k` runouts of `flop` drawn uniformly without replacement by `seed`.
///
/// # Errors
///
/// `LibraryError::InvalidRequest` when `k` exceeds [`ORDERED_RUNOUTS`].
pub fn draw_runouts(flop: Flop, k: usize, seed: u64) -> Result<Vec<RunoutSpec>, LibraryError> {
    if k > ORDERED_RUNOUTS {
        return Err(LibraryError::InvalidRequest(format!(
            "{k} runouts asked of a flop that has {ORDERED_RUNOUTS}"
        )));
    }
    let mut pairs = ordered_runouts(flop);
    let mut rng = SplitMix64::new(seed);
    for i in 0..k {
        let j = i + rng.below(pairs.len() - i);
        pairs.swap(i, j);
    }
    pairs.truncate(k);
    Ok(pairs)
}

/// Every ordered (turn, river) pair of the cards off `flop`, in card-index order.
fn ordered_runouts(flop: Flop) -> Vec<RunoutSpec> {
    let off_flop: Vec<Card> = Card::all().filter(|card| !flop.contains(*card)).collect();
    off_flop
        .iter()
        .flat_map(|&turn| {
            off_flop
                .iter()
                .filter(move |&&river| river != turn)
                .map(move |&river| RunoutSpec { turn, river })
        })
        .collect()
}

/// The `SplitMix64` generator (Steele, Lea and Flood, 2014): a 64-bit counter stepped by the
/// golden-ratio increment and mixed by two multiply-xorshift rounds.
struct SplitMix64 {
    state: u64,
}

impl SplitMix64 {
    /// The golden-ratio increment of the counter.
    const GAMMA: u64 = 0x9E37_79B9_7F4A_7C15;
    /// The first mixing multiplier.
    const MIX_1: u64 = 0xBF58_476D_1CE4_E5B9;
    /// The second mixing multiplier.
    const MIX_2: u64 = 0x94D0_49BB_1331_11EB;

    fn new(seed: u64) -> Self {
        SplitMix64 { state: seed }
    }

    fn next_u64(&mut self) -> u64 {
        self.state = self.state.wrapping_add(Self::GAMMA);
        let mut z = self.state;
        z = (z ^ (z >> 30)).wrapping_mul(Self::MIX_1);
        z = (z ^ (z >> 27)).wrapping_mul(Self::MIX_2);
        z ^ (z >> 31)
    }

    /// A uniform index below `bound` (at least 1): draws above the largest multiple of
    /// `bound` are rejected, so no index is favoured by the modulo.
    fn below(&mut self, bound: usize) -> usize {
        let bound = bound as u64;
        let zone = u64::MAX - u64::MAX % bound;
        loop {
            let draw = self.next_u64();
            if draw < zone {
                // The remainder is below `bound`, which came from a usize.
                return usize::try_from(draw % bound).unwrap_or(0);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{ORDERED_RUNOUTS, SplitMix64, ordered_runouts};

    /// R2.12: the reference outputs of `SplitMix64` seeded with 0, so the draw stays the
    /// same on every machine and release.
    #[test]
    fn r2_12_splitmix64_matches_the_reference_sequence() {
        let mut rng = SplitMix64::new(0);
        assert_eq!(rng.next_u64(), 0xE220_A839_7B1D_CDAF);
        assert_eq!(rng.next_u64(), 0x6E78_9E6A_A1B9_65F4);
    }

    #[test]
    fn r2_12_ordered_runouts_lists_every_pair_once() {
        let pairs = ordered_runouts("Ah7d2c".parse().expect("a flop"));
        assert_eq!(pairs.len(), ORDERED_RUNOUTS);
        assert!(pairs.windows(2).all(|w| w[0] < w[1]), "card-index order");
    }
}
