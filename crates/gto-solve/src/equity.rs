//! The 169 by 169 preflop equity table (R2.20, O-32, O-126): the equity of each hero
//! hand class against each villain hand class, exact over every disjoint combo pair and
//! every five-card board, scored by the vendored evaluator. Owner: the S13 integrator
//! (plan task 6). The generator is a stub until then; the card-encoding pin and the
//! equity figure's definition are settled here.
//!
//! Mechanism (S13 plan section C). The 1,624,350 disjoint ordered combo pairs are
//! canonicalised under the 24 suit permutations into about 47 thousand classes with
//! multiplicities; each class enumerates the C(48, 5) = 1,712,304 boards the four cards
//! leave and scores both hands with `postflop_engine::evaluator::eval7`, the rayon
//! work split across classes; the wins, ties and board counts are then reduced to hand
//! class pairs, with `pairs` keeping the number of disjoint ordered combo pairs so range
//! weighting stays exact. About 1.6e11 evaluations, minutes on 20 cores in release; the
//! table is generated once by `validate equity-table` and committed with a provenance
//! note, never regenerated in continuous integration.
//!
//! Card encoding. `gto_model::Card` and the engine's `cards::Card` are the same integer,
//! `rank * 4 + suit` with suits c, d, h, s as 0 to 3, so `2c` is 0 and `As` is 51; the
//! unit test below pins that before any table is built. This is the only crate that may
//! name the engine, so `tools/validate` serialises the table and names no engine type.

use gto_model::{Card, ComboId, HandClass};

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
/// two classes and every board.
#[must_use]
pub fn class_pair_equity(hero: HandClass, villain: HandClass) -> PairEquity {
    todo!("integrator: {hero} against {villain} over every disjoint combo pair and board")
}

/// The counts of one combo against another over every board; `pairs` is 1, or 0 when
/// the combos share a card and nothing is scored.
#[must_use]
pub fn combo_pair_equity(hero: ComboId, villain: ComboId) -> PairEquity {
    todo!("integrator: {hero} against {villain} over every board")
}

/// The whole table.
#[must_use]
pub fn table() -> EquityTable {
    todo!("integrator: the 169 by 169 table under rayon")
}

/// The engine's integer for a `gto_model` card: the same `rank * 4 + suit`.
#[allow(dead_code, reason = "the integrator's generator calls this; the test pins it now")]
fn engine_card(card: Card) -> postflop_engine::cards::Card {
    todo!("integrator: the shared card encoding for {card}")
}

#[cfg(test)]
mod tests {
    use gto_model::Card;
    use postflop_engine::cards::{card_to_string, parse_card};

    use super::engine_card;

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
}
