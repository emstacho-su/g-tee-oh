//! What a heads-up postflop solve is asked to solve (R2.10, A2 section 3, O-135): the game
//! configuration, the preflop line that reached the board, the board, both ranges, the pot
//! and stacks at the root, and the postflop tree configuration.
//!
//! Mechanism: a `Range` holds one `f32` weight per combo in `gto_model::ComboId` order, so
//! index `i` is the combo `ComboId::from_index(i)`. That order is the engine's canonical
//! combo order as well (both crates order combos by their lower card, then their higher
//! card, with cards encoded `rank * 4 + suit`), and the mapping test checks all 1,326
//! combos. The engine reads a range as text, so `Range::to_engine_notation` writes every
//! combo with a positive weight as an explicit combo such as `AhKh:0.5`; `f32` display
//! round-trips exactly, so the engine parses back the same weights.

use std::fmt;

use gto_model::{Board, Card, Cbb, ComboId, GameConfig, Street};
use gto_tree::{PreflopLine, RootState, TreeConfig};
use postflop_engine::range::Range as EngineRange;

use super::error::SolveError;

/// Combos in a range: every unordered pair of distinct cards.
pub const COMBO_COUNT: usize = ComboId::COUNT as usize;

/// Room reserved per combo in the engine notation: four card characters, a colon, a
/// weight of up to ten digits and the comma (`AhKh:0.33333334,`).
const NOTATION_BYTES_PER_COMBO: usize = 16;

/// One player's range: a weight from 0 to 1 per combo, in `ComboId` order.
#[derive(Clone, Debug, PartialEq)]
pub struct Range {
    weights: Box<[f32; COMBO_COUNT]>,
}

impl Range {
    /// A range from 1,326 weights in `ComboId` order.
    ///
    /// # Errors
    ///
    /// `SolveError::Problem` when the slice is not 1,326 long or a weight is not a finite
    /// number from 0 to 1.
    pub fn from_weights(weights: &[f32]) -> Result<Self, SolveError> {
        let array: [f32; COMBO_COUNT] = weights.try_into().map_err(|_| {
            SolveError::Problem(format!(
                "a range needs {COMBO_COUNT} weights, got {}",
                weights.len()
            ))
        })?;
        if let Some((index, weight)) =
            array.iter().enumerate().find(|(_, w)| !(w.is_finite() && (0.0..=1.0).contains(*w)))
        {
            return Err(SolveError::Problem(format!(
                "range weight {weight} at combo {index} is not a number from 0 to 1"
            )));
        }
        Ok(Range { weights: Box::new(array) })
    }

    /// A range from standard range notation, as the engine reads it: pairs (`TT+`),
    /// suited and offsuit hands (`AKs`, `QJo`), dash ranges (`A5s-A2s`) and explicit combos
    /// (`AhKh`), each with an optional `:weight`.
    ///
    /// # Errors
    ///
    /// `SolveError::Problem` with the engine's message for notation it cannot read.
    pub fn parse(notation: &str) -> Result<Self, SolveError> {
        let parsed = EngineRange::parse(notation)
            .map_err(|message| SolveError::Problem(format!("range {notation:?}: {message}")))?;
        Range::from_weights(parsed.weights())
    }

    /// The weight of one combo.
    #[must_use]
    pub fn weight(&self, combo: ComboId) -> f32 {
        self.weights[usize::from(combo.index())]
    }

    /// All 1,326 weights in `ComboId` order.
    #[must_use]
    pub fn weights(&self) -> &[f32] {
        self.weights.as_slice()
    }

    /// The combos with a positive weight that share no card with the board, in `ComboId`
    /// order: the combos the engine keeps at the root.
    #[must_use]
    pub fn live_combos(&self, board: &[Card]) -> Vec<ComboId> {
        ComboId::all()
            .filter(|combo| self.weight(*combo) > 0.0 && !combo.conflicts_with(board))
            .collect()
    }

    /// Every combo with a positive weight as an explicit engine combo, lower card first,
    /// with `:weight` unless the weight is 1, joined by commas. The text is written into
    /// one string, so a solve refused for memory allocates little for it.
    ///
    /// # Panics
    ///
    /// Never: a `String` accepts every write.
    #[must_use]
    pub fn to_engine_notation(&self) -> String {
        let combos = self.weights.iter().filter(|&&weight| weight > 0.0).count();
        let mut text = String::with_capacity(combos * NOTATION_BYTES_PER_COMBO);
        self.write_engine_notation(&mut text).expect("writing to a String cannot fail");
        text
    }

    /// The byte length of `to_engine_notation`, counted without building the text, for
    /// the memory estimate.
    pub(crate) fn engine_notation_len(&self) -> usize {
        let mut counter = ByteCounter::default();
        self.write_engine_notation(&mut counter).expect("counting bytes cannot fail");
        counter.bytes
    }

    /// Writes the engine notation into `out`: the one writer behind the text and its
    /// length.
    fn write_engine_notation(&self, out: &mut impl fmt::Write) -> fmt::Result {
        let positive = ComboId::all().filter(|&combo| self.weight(combo) > 0.0);
        for (index, combo) in positive.enumerate() {
            if index > 0 {
                out.write_char(',')?;
            }
            let (low, high) = combo.cards();
            write!(out, "{low}{high}")?;
            let weight = self.weight(combo);
            if weight < 1.0 {
                write!(out, ":{weight}")?;
            }
        }
        Ok(())
    }
}

/// A `fmt::Write` sink that counts the bytes written and keeps none of them.
#[derive(Default)]
struct ByteCounter {
    bytes: usize,
}

impl fmt::Write for ByteCounter {
    fn write_str(&mut self, text: &str) -> fmt::Result {
        self.bytes += text.len();
        Ok(())
    }
}

/// A heads-up postflop problem. The fields are public data; `PostflopProblem::validate`
/// checks them and every solve and estimate calls it first.
#[derive(Clone, Debug, PartialEq)]
pub struct PostflopProblem {
    /// The game configuration, which sets the rake.
    pub config: GameConfig,
    /// The preflop line that reached the board.
    pub line: PreflopLine,
    /// The board: a flop for the library builder, or a turn or river board for the
    /// comparisons of S17 (O-135).
    pub board: Board,
    /// The ranges, `[oop, ip]` as `gto_tree::Player` indexes them.
    pub ranges: [Range; 2],
    /// The pot at the root.
    pub pot: Cbb,
    /// The stacks behind at the root, `[oop, ip]`. The solve plays the smaller one.
    pub stacks: [Cbb; 2],
    /// The postflop tree configuration.
    pub tree: TreeConfig,
}

impl PostflopProblem {
    /// The problem a preflop line leads to: its flop pot and flop stack on `board`.
    ///
    /// # Errors
    ///
    /// The errors of `PostflopProblem::validate`.
    pub fn from_line(
        config: GameConfig,
        line: PreflopLine,
        board: Board,
        ranges: [Range; 2],
        tree: TreeConfig,
    ) -> Result<Self, SolveError> {
        let pot = line.flop_pot;
        let stacks = [line.flop_stack; 2];
        let problem = PostflopProblem { config, line, board, ranges, pot, stacks, tree };
        problem.validate()?;
        Ok(problem)
    }

    /// Checks the problem.
    ///
    /// # Errors
    ///
    /// `SolveError::Problem` for a pot or effective stack of zero, or a range with no
    /// live combo on the board.
    pub fn validate(&self) -> Result<(), SolveError> {
        if self.pot == Cbb::ZERO {
            return Err(SolveError::Problem("the pot at the root is zero".to_owned()));
        }
        if self.effective_stack() == Cbb::ZERO {
            return Err(SolveError::Problem("the effective stack at the root is zero".to_owned()));
        }
        let board = self.board.cards();
        for (range, name) in self.ranges.iter().zip(["oop", "ip"]) {
            if range.live_combos(&board).is_empty() {
                return Err(SolveError::Problem(format!(
                    "the {name} range has no combo with a positive weight on board {}",
                    gto_model::format_cards(&board)
                )));
            }
        }
        Ok(())
    }

    /// The smaller of the two stacks: what both players can still bet.
    #[must_use]
    pub fn effective_stack(&self) -> Cbb {
        self.stacks[0].min(self.stacks[1])
    }

    /// The street the solve starts on, from the board.
    #[must_use]
    pub fn street(&self) -> Street {
        self.board.street()
    }

    /// The root of the betting skeleton: the board's street, the pot and the effective
    /// stack.
    #[must_use]
    pub fn root(&self) -> RootState {
        RootState { street: self.street(), pot: self.pot, stack: self.effective_stack() }
    }
}

#[cfg(test)]
mod tests {
    use super::{COMBO_COUNT, Range};

    /// R2.10 (O-139): the counted length of the engine notation is the length of the text,
    /// whether the weights are whole, fractional or mixed, so the estimate's text term is
    /// exact without building the text.
    #[test]
    fn r2_10_engine_notation_len_matches_the_text() {
        let mixed: Vec<f32> = (0..COMBO_COUNT)
            .map(|index| match index % 4 {
                0 => 1.0,
                1 => 0.5,
                2 => 0.0,
                _ => 1.0 / (f32::from(u16::try_from(index).expect("fits")) + 2.0),
            })
            .collect();
        let ranges = [
            Range::parse("AhKh").expect("a range"),
            Range::parse("QQ+,AKs:0.25").expect("a range"),
            Range::from_weights(&[1.0; COMBO_COUNT]).expect("valid weights"),
            Range::from_weights(&mixed).expect("valid weights"),
        ];
        for range in ranges {
            assert_eq!(range.engine_notation_len(), range.to_engine_notation().len());
        }
    }
}
