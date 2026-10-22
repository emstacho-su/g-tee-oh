//! `SplitMix64` (R2.13, O-151, plan C.4): the one-word generator behind the seeded deal
//! and `POST /v1/sample-action`. The state is one `u64`, so a seed or a state travels as a
//! `Hex64` (sixteen hexadecimal digits in a JSON string) and the caller can replay any
//! draw by sending the same state again; `sample-action` answers with the state after its
//! draw so the next request threads it through.
//!
//! Reference: Sebastiano Vigna, `splitmix64.c` (public domain,
//! `https://prng.di.unimi.it/splitmix64.c`), after Steele, Lea and Flood, "Fast splittable
//! pseudorandom number generators" (OOPSLA 2014). The state advances by the golden gamma
//! and the output is the advanced state through the two-multiply finalizer. The reference
//! vectors in the tests are that program's outputs for seed 1234567, the seed the
//! `rand_xoshiro` crate's reference test quotes; they were recomputed with an independent
//! arbitrary-precision script before being pinned here.

use crate::api::deal::Hex64;

/// The increment of the state per draw: the golden ratio in 64 bits ("golden gamma").
pub const GOLDEN_GAMMA: u64 = 0x9e37_79b9_7f4a_7c15;

/// The two multipliers of the output finalizer.
const MIX_1: u64 = 0xbf58_476d_1ce4_e5b9;
const MIX_2: u64 = 0x94d0_49bb_1331_11eb;

/// The three xor-shift distances of the finalizer.
const SHIFT_1: u32 = 30;
const SHIFT_2: u32 = 27;
const SHIFT_3: u32 = 31;

/// How many high bits of a draw become a unit float: the f64 mantissa holds 53, so the
/// result is exact and strictly under 1.
pub const UNIT_BITS: u32 = 53;

/// Two to the `UNIT_BITS`, the denominator of a unit draw.
const UNIT_DENOMINATOR: f64 = 9_007_199_254_740_992.0;

/// The generator: one word of state.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct SplitMix64 {
    state: u64,
}

impl SplitMix64 {
    /// A generator whose state is `seed`; the first draw is the finalizer of
    /// `seed + GOLDEN_GAMMA`.
    #[must_use]
    pub const fn new(seed: u64) -> SplitMix64 {
        SplitMix64 { state: seed }
    }

    /// The state now: after a draw, what a replay must start from to repeat the next one.
    #[must_use]
    pub const fn state(self) -> u64 {
        self.state
    }

    /// The generator `draws` draws ahead of this one, without making them: the state
    /// advances by one gamma per draw, so the jump is one multiplication. The request-id
    /// middleware takes draw `n` of a process-wide stream this way (`middleware`).
    #[must_use]
    pub const fn jump(self, draws: u64) -> SplitMix64 {
        SplitMix64 { state: self.state.wrapping_add(GOLDEN_GAMMA.wrapping_mul(draws)) }
    }

    /// The next 64-bit draw.
    pub fn next_u64(&mut self) -> u64 {
        self.state = self.state.wrapping_add(GOLDEN_GAMMA);
        let z = self.state;
        let z = (z ^ (z >> SHIFT_1)).wrapping_mul(MIX_1);
        let z = (z ^ (z >> SHIFT_2)).wrapping_mul(MIX_2);
        z ^ (z >> SHIFT_3)
    }

    /// The next draw as a float in `[0, 1)`: the top `UNIT_BITS` bits over two to the
    /// `UNIT_BITS`, the conversion the reference program documents.
    pub fn next_unit(&mut self) -> f64 {
        let top = self.next_u64() >> (u64::BITS - UNIT_BITS);
        #[expect(clippy::cast_precision_loss, reason = "53 bits fit the f64 mantissa exactly")]
        let numerator = top as f64;
        numerator / UNIT_DENOMINATOR
    }

    /// A uniform index under `bound` (a bound of 0 answers 0), by rejection on the 64-bit
    /// draw so no residue biases the shuffle.
    pub fn below(&mut self, bound: u8) -> u8 {
        let range = u64::from(bound.max(1));
        let limit = (u64::MAX / range) * range;
        loop {
            let draw = self.next_u64();
            if draw < limit {
                #[expect(clippy::cast_possible_truncation, reason = "the residue is under a u8")]
                let index = (draw % range) as u8;
                return index;
            }
        }
    }
}

impl From<Hex64> for SplitMix64 {
    fn from(state: Hex64) -> SplitMix64 {
        SplitMix64::new(state.get())
    }
}

impl From<SplitMix64> for Hex64 {
    fn from(generator: SplitMix64) -> Hex64 {
        Hex64(generator.state())
    }
}

/// The action a unit draw `roll` picks from `frequencies`: the first action whose
/// cumulative frequency exceeds the roll, so each action owns the band of its frequency in
/// the order given. When rounding leaves the roll past the last band, the last action that
/// is played at all is picked (plan C.5). `None` when there is no action.
#[must_use]
pub fn pick_by_frequency(roll: f64, frequencies: &[f32]) -> Option<usize> {
    let mut cumulative = 0.0_f64;
    for (index, frequency) in frequencies.iter().enumerate() {
        cumulative += f64::from(*frequency);
        if roll < cumulative {
            return Some(index);
        }
    }
    let last_played = frequencies.iter().rposition(|frequency| *frequency > 0.0);
    last_played.or_else(|| frequencies.len().checked_sub(1))
}

#[cfg(test)]
mod tests {
    use super::{GOLDEN_GAMMA, SplitMix64, pick_by_frequency};
    use crate::api::deal::Hex64;

    /// The reference program's first outputs for seed 1234567 (see the module docs).
    const REFERENCE_SEED: u64 = 1_234_567;
    const REFERENCE_OUTPUTS: [u64; 6] = [
        6_457_827_717_110_365_317,
        3_203_168_211_198_807_973,
        9_817_491_932_198_370_423,
        4_593_380_528_125_082_431,
        16_408_922_859_458_223_821,
        7_804_594_928_223_864_054,
    ];

    #[test]
    fn r2_13_rng_splitmix64_matches_the_reference_vectors() {
        let mut generator = SplitMix64::new(REFERENCE_SEED);
        for (position, expected) in REFERENCE_OUTPUTS.iter().enumerate() {
            assert_eq!(generator.next_u64(), *expected, "output {position}");
        }
        let draws = u64::try_from(REFERENCE_OUTPUTS.len()).expect("a small count");
        assert_eq!(
            generator.state(),
            REFERENCE_SEED.wrapping_add(GOLDEN_GAMMA.wrapping_mul(draws)),
            "the state advances by one gamma per draw"
        );
    }

    #[test]
    fn r2_13_rng_jump_lands_on_the_reference_vectors_without_drawing() {
        for (position, expected) in REFERENCE_OUTPUTS.iter().enumerate() {
            let draws = u64::try_from(position).expect("a small count");
            let mut jumped = SplitMix64::new(REFERENCE_SEED).jump(draws);
            assert_eq!(jumped.next_u64(), *expected, "draw {draws} after the jump");
        }
        assert_eq!(SplitMix64::new(REFERENCE_SEED).jump(0), SplitMix64::new(REFERENCE_SEED));
    }

    #[test]
    fn r2_13_rng_unit_draws_lie_in_the_half_open_interval() {
        let mut generator = SplitMix64::new(u64::MAX);
        for draw in 0..10_000 {
            let unit = generator.next_unit();
            assert!((0.0..1.0).contains(&unit), "draw {draw} was {unit}");
        }
    }

    #[test]
    fn r2_13_rng_below_stays_under_the_bound_and_reaches_every_value() {
        let mut generator = SplitMix64::new(7);
        let mut seen = [false; 5];
        for _ in 0..1_000 {
            let index = generator.below(5);
            assert!(index < 5, "{index}");
            seen[usize::from(index)] = true;
        }
        assert!(seen.iter().all(|hit| *hit), "{seen:?}");
        assert_eq!(generator.below(1), 0);
        assert_eq!(generator.below(0), 0);
    }

    #[test]
    fn r2_13_rng_round_trips_through_hex64() {
        let state: Hex64 = "00000000deadbeef".parse().expect("sixteen hex digits");
        let mut generator = SplitMix64::from(state);
        assert_eq!(Hex64::from(generator), state);
        let _ = generator.next_u64();
        assert_eq!(Hex64::from(generator), Hex64(0xdead_beef_u64.wrapping_add(GOLDEN_GAMMA)));
    }

    #[test]
    fn r2_13_pick_by_frequency_owns_cumulative_bands() {
        let frequencies = [0.25_f32, 0.5, 0.25];
        assert_eq!(pick_by_frequency(0.0, &frequencies), Some(0));
        assert_eq!(pick_by_frequency(0.2499, &frequencies), Some(0));
        assert_eq!(pick_by_frequency(0.25, &frequencies), Some(1));
        assert_eq!(pick_by_frequency(0.7499, &frequencies), Some(1));
        assert_eq!(pick_by_frequency(0.75, &frequencies), Some(2));
        assert_eq!(pick_by_frequency(0.999_999_9, &frequencies), Some(2));
        let unplayed_last = [0.5_f32, 0.5, 0.0];
        assert_eq!(pick_by_frequency(1.0, &unplayed_last), Some(1), "the last action played");
        assert_eq!(pick_by_frequency(0.5, &[0.0_f32, 0.0]), Some(1), "nothing played: the last");
        assert_eq!(pick_by_frequency(0.5, &[]), None);
    }
}
