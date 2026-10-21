//! The 169 by 169 preflop equity table (R2.20, O-32, O-126): the equity of each hero
//! hand class against each villain hand class, exact over every disjoint combo pair and
//! every five-card board, scored by the vendored evaluator.
//!
//! Mechanism (S13 plan section C). A matchup of two combos is scored by walking every
//! C(48, 5) = 1,712,304 board the four hole cards leave and comparing the two seven-card
//! values from `postflop_engine::evaluator::eval7`; the walk is split across rayon
//! workers by the first board card. Relabelling the four suits changes no showdown, so
//! the disjoint ordered combo pairs of one class pair are grouped into orbits under the
//! 24 suit permutations, one representative per orbit (the smallest relabelled card
//! tuple) is scored, and its counts are multiplied by the orbit size. Over the 14,365
//! unordered class pairs that is tens of thousands of scored matchups instead of
//! 1,624,350, about 1.6e11 evaluations, minutes on 20 cores in release. The table scores
//! each unordered class pair once, under rayon, and reads the reverse entry from the
//! same counts (hero losses become villain wins), so `equity[i][j] + equity[j][i]` is 1
//! up to rounding and the diagonal is exactly 1/2. `pairs` keeps the number of disjoint
//! ordered combo pairs behind each entry so range weighting stays exact. The table is
//! generated once by `validate equity-table` and committed with a provenance note,
//! never regenerated in continuous integration.
//!
//! Card encoding. `gto_model::Card` and the engine's `cards::Card` are the same integer,
//! `rank * 4 + suit` with suits c, d, h, s as 0 to 3, so `2c` is 0 and `As` is 51; the
//! unit test below pins that. This is the only crate that may name the engine, so
//! `tools/validate` serialises the table and names no engine type.

use std::collections::BTreeMap;

use gto_model::{Card, ComboId, HandClass};
use postflop_engine::cards::Card as EngineCard;
use postflop_engine::evaluator::eval7;
use rayon::prelude::*;

/// Cards in the deck.
const DECK_SIZE: u8 = 52;

/// Cards left for the board once two two-card hands are dealt.
const STUB_SIZE: usize = 48;

/// Cards on a complete board.
const BOARD_SIZE: usize = 5;

/// Suits, and so the length of one suit permutation.
const SUIT_COUNT: usize = 4;

/// Permutations of the four suits, 4 factorial.
const PERMUTATION_COUNT: usize = 24;

/// Mask selecting the suit bits of a card integer.
const SUIT_MASK: u8 = 3;

/// Every permutation of the four suits.
const SUIT_PERMUTATIONS: [[u8; SUIT_COUNT]; PERMUTATION_COUNT] = suit_permutations();

/// One matchup as four engine cards: hero low, hero high, villain low, villain high.
/// Arrays order lexicographically, which makes the orbit representative well defined.
type PairKey = [EngineCard; 4];

/// The outcome counts of one matchup over every board, hero against villain.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PairEquity {
    /// Boards the hero wins outright.
    pub wins: u64,
    /// Boards that split.
    pub ties: u64,
    /// Boards scored: `pairs` times C(48, 5).
    pub total: u64,
    /// Disjoint ordered combo pairs behind the counts: 1 for one combo pair, up to
    /// 12 times 12 for two offsuit classes.
    pub pairs: u32,
}

impl PairEquity {
    /// No matchup: every count zero.
    const ZERO: PairEquity = PairEquity { wins: 0, ties: 0, total: 0, pairs: 0 };

    /// The equity figure, `(wins + ties / 2) / total`, the one definition the table
    /// writer and the tests share so a regenerated entry matches a committed one exactly.
    #[must_use]
    #[allow(
        clippy::cast_precision_loss,
        reason = "counts stay far below 2^53, so the conversion to f64 is exact"
    )]
    pub fn equity(&self) -> f64 {
        (self.wins as f64 + self.ties as f64 / 2.0) / self.total as f64
    }

    /// The same counts seen from the villain's seat: the hero's losses are its wins.
    fn reversed(self) -> PairEquity {
        PairEquity { wins: self.total - self.wins - self.ties, ..self }
    }

    /// Both sets of counts together.
    fn plus(self, other: PairEquity) -> PairEquity {
        PairEquity {
            wins: self.wins + other.wins,
            ties: self.ties + other.ties,
            total: self.total + other.total,
            pairs: self.pairs + other.pairs,
        }
    }

    /// These counts repeated `times` times, for an orbit of that many combo pairs.
    fn times(self, times: u32) -> PairEquity {
        let factor = u64::from(times);
        PairEquity {
            wins: self.wins * factor,
            ties: self.ties * factor,
            total: self.total * factor,
            pairs: self.pairs * times,
        }
    }
}

/// The 169 by 169 table in `HandClass` index order (AA 0 to 32o 168).
#[derive(Debug, Clone, PartialEq)]
pub struct EquityTable {
    /// The class labels, `AA`, `AKs`, `AKo`, in index order.
    pub classes: Vec<String>,
    /// `equity[hero][villain]` as [`PairEquity::equity`] computes it.
    pub equity: Vec<Vec<f64>>,
    /// `pairs[hero][villain]`, the disjoint ordered combo pairs behind each entry.
    pub pairs: Vec<Vec<u32>>,
}

/// The counts of `hero` against `villain` over every disjoint ordered combo pair of the
/// two classes and every board. Each suit-permutation orbit of combo pairs is scored
/// once through its representative and weighted by the orbit size, which gives the same
/// integers as summing [`combo_pair_equity`] over every combo pair.
#[must_use]
pub fn class_pair_equity(hero: HandClass, villain: HandClass) -> PairEquity {
    orbits(hero, villain)
        .into_par_iter()
        .map(|(key, size)| score([key[0], key[1]], [key[2], key[3]]).times(size))
        .reduce(|| PairEquity::ZERO, PairEquity::plus)
}

/// The counts of one combo against another over every board; `pairs` is 1, or 0 when
/// the combos share a card and nothing is scored.
#[must_use]
pub fn combo_pair_equity(hero: ComboId, villain: ComboId) -> PairEquity {
    let (hero_low, hero_high) = hero.cards();
    if villain.conflicts_with(&[hero_low, hero_high]) {
        return PairEquity::ZERO;
    }
    let (villain_low, villain_high) = villain.cards();
    score(
        [engine_card(hero_low), engine_card(hero_high)],
        [engine_card(villain_low), engine_card(villain_high)],
    )
}

/// The whole table: each unordered class pair scored once under rayon, the reverse
/// entry read from the same counts.
#[must_use]
pub fn table() -> EquityTable {
    let classes: Vec<HandClass> = HandClass::all().collect();
    let count = classes.len();
    let upper: Vec<(usize, usize)> =
        (0..count).flat_map(|i| (i..count).map(move |j| (i, j))).collect();
    let scored: BTreeMap<(usize, usize), PairEquity> = upper
        .into_par_iter()
        .map(|(i, j)| ((i, j), class_pair_equity(classes[i], classes[j])))
        .collect();
    let entry = |i: usize, j: usize| -> PairEquity {
        if i <= j { scored[&(i, j)] } else { scored[&(j, i)].reversed() }
    };
    let rows = |i: usize| (0..count).map(move |j| entry(i, j));
    EquityTable {
        classes: classes.iter().map(ToString::to_string).collect(),
        equity: (0..count).map(|i| rows(i).map(|pair| pair.equity()).collect()).collect(),
        pairs: (0..count).map(|i| rows(i).map(|pair| pair.pairs).collect()).collect(),
    }
}

/// The engine's integer for a `gto_model` card: the same `rank * 4 + suit`.
fn engine_card(card: Card) -> EngineCard {
    card.index()
}

/// The four engine cards of a matchup, each hand low card first.
fn pair_key(hero: ComboId, villain: ComboId) -> PairKey {
    let ((hero_low, hero_high), (villain_low, villain_high)) = (hero.cards(), villain.cards());
    [
        engine_card(hero_low),
        engine_card(hero_high),
        engine_card(villain_low),
        engine_card(villain_high),
    ]
}

/// The orbits of the disjoint ordered combo pairs of two classes under the 24 suit
/// permutations: each orbit's representative and the number of combo pairs in it.
fn orbits(hero: HandClass, villain: HandClass) -> BTreeMap<PairKey, u32> {
    let villain_combos = villain.combos();
    hero.combos()
        .into_iter()
        .flat_map(|h| villain_combos.iter().map(move |v| (h, *v)))
        .filter(|(h, v)| {
            let (low, high) = h.cards();
            !v.conflicts_with(&[low, high])
        })
        .fold(BTreeMap::new(), |orbits, (h, v)| {
            let key = canonical(pair_key(h, v));
            let size = orbits.get(&key).map_or(1, |size| size + 1);
            let mut next = orbits;
            next.insert(key, size);
            next
        })
}

/// The smallest relabelling of a matchup over the 24 suit permutations, each hand's two
/// cards kept low first.
fn canonical(cards: PairKey) -> PairKey {
    let ordered = |a: EngineCard, b: EngineCard| if a < b { [a, b] } else { [b, a] };
    SUIT_PERMUTATIONS
        .iter()
        .map(|permutation| {
            let relabel =
                |card: EngineCard| (card & !SUIT_MASK) | permutation[usize::from(card & SUIT_MASK)];
            let [h0, h1] = ordered(relabel(cards[0]), relabel(cards[1]));
            let [v0, v1] = ordered(relabel(cards[2]), relabel(cards[3]));
            [h0, h1, v0, v1]
        })
        .min()
        .unwrap_or(cards)
}

/// Every board the four hole cards leave, split across rayon workers by the first
/// board card; `pairs` is 1 and `total` is the number of boards walked.
///
/// # Panics
///
/// When the four hole cards are not distinct, which the callers rule out.
fn score(hero: [EngineCard; 2], villain: [EngineCard; 2]) -> PairEquity {
    let dealt = [hero[0], hero[1], villain[0], villain[1]];
    let stub: Vec<EngineCard> = (0..DECK_SIZE).filter(|card| !dealt.contains(card)).collect();
    assert_eq!(stub.len(), STUB_SIZE, "the four hole cards must be distinct: {dealt:?}");
    let counts = (0..=STUB_SIZE - BOARD_SIZE)
        .into_par_iter()
        .map(|first| score_from(&stub, first, hero, villain))
        .reduce(|| PairEquity::ZERO, PairEquity::plus);
    PairEquity { pairs: 1, ..counts }
}

/// The boards whose lowest stub position is `first`, scored for both hands; `pairs`
/// is left at 0 for the caller to set.
fn score_from(
    stub: &[EngineCard],
    first: usize,
    hero: [EngineCard; 2],
    villain: [EngineCard; 2],
) -> PairEquity {
    let n = stub.len();
    let (mut wins, mut ties, mut total) = (0_u64, 0_u64, 0_u64);
    let mut hero_seven = [hero[0], hero[1], stub[first], 0, 0, 0, 0];
    let mut villain_seven = [villain[0], villain[1], stub[first], 0, 0, 0, 0];
    for b in first + 1..n {
        for c in b + 1..n {
            for d in c + 1..n {
                for e in d + 1..n {
                    let rest = [stub[b], stub[c], stub[d], stub[e]];
                    hero_seven[3..].copy_from_slice(&rest);
                    villain_seven[3..].copy_from_slice(&rest);
                    let (h, v) = (eval7(&hero_seven), eval7(&villain_seven));
                    wins += u64::from(h > v);
                    ties += u64::from(h == v);
                    total += 1;
                }
            }
        }
    }
    PairEquity { wins, ties, total, pairs: 0 }
}

/// The 24 permutations of the suits 0 to 3, in lexicographic order.
const fn suit_permutations() -> [[u8; SUIT_COUNT]; PERMUTATION_COUNT] {
    // The four suit indices sum to 0 + 1 + 2 + 3, so the last one is fixed by the rest.
    const SUIT_SUM: u8 = 6;
    let mut out = [[0_u8; SUIT_COUNT]; PERMUTATION_COUNT];
    let mut next = 0;
    let mut a = 0;
    while a < 4 {
        let mut b = 0;
        while b < 4 {
            let mut c = 0;
            while c < 4 {
                if a != b && a != c && b != c {
                    out[next] = [a, b, c, SUIT_SUM - a - b - c];
                    next += 1;
                }
                c += 1;
            }
            b += 1;
        }
        a += 1;
    }
    out
}

#[cfg(test)]
mod tests {
    use gto_model::{Card, ComboId, HandClass};
    use postflop_engine::cards::{card_to_string, parse_card};

    use super::{SUIT_PERMUTATIONS, canonical, engine_card, orbits, pair_key};

    fn class(label: &str) -> HandClass {
        label.parse().expect("a hand class")
    }

    fn combo(a: &str, b: &str) -> ComboId {
        let card = |label: &str| -> Card { label.parse().expect("a card") };
        ComboId::from_cards(card(a), card(b)).expect("two distinct cards")
    }

    /// R2.4 (the shared encoding the toy and equity adapters rely on): `gto_model::Card`
    /// and the engine agree on every card, `2c` being 0 and `As` 51.
    #[test]
    fn r2_4_card_encoding_matches_gto_model() {
        let two_of_clubs: Card = "2c".parse().expect("2c is a card");
        assert_eq!(engine_card(two_of_clubs), 0);
        assert_eq!(parse_card("2c"), Ok(0));
        let ace_of_spades: Card = "As".parse().expect("As is a card");
        assert_eq!(engine_card(ace_of_spades), 51);
        assert_eq!(parse_card("As"), Ok(51));
        for card in Card::all() {
            let engine = engine_card(card);
            assert_eq!(engine, card.index(), "{card}");
            assert_eq!(card_to_string(engine), card.to_string(), "{card}");
        }
    }

    /// R2.20: the 24 suit permutations are distinct and each one is a permutation.
    #[test]
    fn r2_20_suit_permutations_are_the_symmetric_group() {
        for permutation in SUIT_PERMUTATIONS {
            let mut sorted = permutation;
            sorted.sort_unstable();
            assert_eq!(sorted, [0, 1, 2, 3], "{permutation:?}");
        }
        let mut all = SUIT_PERMUTATIONS.to_vec();
        all.sort_unstable();
        all.dedup();
        assert_eq!(all.len(), 24);
    }

    /// R2.20: the orbits of a class pair cover every disjoint ordered combo pair once
    /// (36 for AA against KK, 6 for AA against itself, 24 for `AKs` against `AKo`, 84
    /// for `72o` against itself), and a relabelled matchup has the same representative.
    #[test]
    fn r2_20_orbits_partition_the_disjoint_combo_pairs() {
        let total = |hero: &str, villain: &str| -> u32 {
            orbits(class(hero), class(villain)).values().sum()
        };
        assert_eq!(total("AA", "KK"), 36);
        assert_eq!(total("AA", "AA"), 6);
        assert_eq!(total("AKs", "AKo"), 24);
        assert_eq!(total("72o", "72o"), 84);
        assert_eq!(orbits(class("AA"), class("KK")).len(), 3, "no, one or two shared suits");
        let key = |h: ComboId, v: ComboId| canonical(pair_key(h, v));
        let aces_kings = key(combo("As", "Ah"), combo("Kd", "Kc"));
        assert_eq!(aces_kings, key(combo("Ac", "Ad"), combo("Kh", "Ks")));
        assert_ne!(aces_kings, key(combo("As", "Ah"), combo("Ks", "Kc")));
    }
}
