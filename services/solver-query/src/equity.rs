//! The 169 by 169 preflop equity table and the range equity helpers (R2.14, O-32, O-126,
//! O-148, plan C.3). The committed table `validation/fixtures/equity/preflop-169.json`
//! (keys `classes[169]`, `equity[169][169]`, hero class `i` against villain class `j` as
//! a pot share, and `pairs[169][169]`, the disjoint combo matchups) is embedded at build
//! time with `include_str!` and parsed once into a process-wide table, because the Docker
//! build context copies `validation/fixtures/equity` and nothing else of `validation/`
//! (O-148, `infra/docker/solver-query.Dockerfile`).
//!
//! Hand strength at a node (plan C.3) is a class's equity against the villain's
//! reach-weighted range: with `w_ij = reach_v[j] * pairs[i][j]`, the live matchups of the
//! two classes, `range_equity(i) = sum_j w_ij * equity[i][j] / sum_j w_ij`. A class with no
//! live matchup (every villain combo shares a card with every combo of the class, or the
//! villain range is empty) has no equity, so the helpers answer `None` for it.
//!
//! `classes[i]` is pinned to `HandClass::from_index(i)` by a test, so a class index is a
//! table index and nothing maps names at request time.

use std::sync::{Arc, LazyLock};

use serde::Deserialize;

/// The committed table, relative to this file.
const TABLE_JSON: &str = include_str!("../../../validation/fixtures/equity/preflop-169.json");

/// Hand classes in the table.
pub const CLASSES: usize = 169;

/// The table as the file holds it.
#[derive(Clone, Debug, Deserialize)]
pub struct EquityTable {
    /// The class names in `HandClass` index order.
    pub classes: Vec<String>,
    /// `equity[i][j]`: hero class `i`'s pot share against villain class `j`.
    pub equity: Vec<Vec<f64>>,
    /// `pairs[i][j]`: the disjoint combo matchups of the two classes.
    pub pairs: Vec<Vec<f64>>,
}

/// The embedded table, parsed on first use and shared by every `AppState`.
static EMBEDDED: LazyLock<Arc<EquityTable>> = LazyLock::new(|| Arc::new(parse_embedded()));

impl EquityTable {
    /// The committed table, shared: one parse per process (plan C.3).
    #[must_use]
    pub fn embedded() -> Arc<EquityTable> {
        Arc::clone(&EMBEDDED)
    }

    /// The live-matchup weight of hero class `hero` against a villain range given as reach
    /// per class: `sum_j reach_v[j] * pairs[hero][j]`. A range shorter than the table
    /// counts the classes it names.
    #[must_use]
    pub fn live_weight(&self, hero: usize, villain_reach: &[f64]) -> f64 {
        self.pairs[hero].iter().zip(villain_reach).map(|(pairs, reach)| reach * pairs).sum()
    }

    /// Hero class `hero`'s equity against a villain range given as reach per class, the
    /// hand strength of plan C.3; `None` when the class has no live matchup against it.
    #[must_use]
    pub fn range_equity(&self, hero: usize, villain_reach: &[f64]) -> Option<f64> {
        let (mut weighted, mut weight) = (0.0, 0.0);
        let cells = self.pairs[hero].iter().zip(&self.equity[hero]).zip(villain_reach);
        for ((pairs, equity), reach) in cells {
            let w = reach * pairs;
            weighted += w * equity;
            weight += w;
        }
        (weight > 0.0).then(|| weighted / weight)
    }

    /// Every class's strength against `villain_reach`, indexed by class.
    #[must_use]
    pub fn strengths(&self, villain_reach: &[f64]) -> Vec<Option<f64>> {
        (0..CLASSES).map(|hero| self.range_equity(hero, villain_reach)).collect()
    }

    /// Every class's live-matchup weight against `villain_reach`, indexed by class.
    #[must_use]
    pub fn live_weights(&self, villain_reach: &[f64]) -> Vec<f64> {
        (0..CLASSES).map(|hero| self.live_weight(hero, villain_reach)).collect()
    }
}

/// Parses the embedded text; a table that does not parse or is not 169 by 169 is a build
/// defect, so it stops the process with the reason.
fn parse_embedded() -> EquityTable {
    let table: EquityTable = serde_json::from_str(TABLE_JSON)
        .unwrap_or_else(|err| panic!("the embedded equity table does not parse: {err}"));
    let square = table.classes.len() == CLASSES
        && table.equity.len() == CLASSES
        && table.pairs.len() == CLASSES
        && table.equity.iter().chain(&table.pairs).all(|row| row.len() == CLASSES);
    assert!(square, "the embedded equity table is not {CLASSES} by {CLASSES}");
    table
}

#[cfg(test)]
mod tests {
    use gto_model::HandClass;

    use super::{CLASSES, EquityTable};

    /// The AA versus KK equity band from `validation/fixtures/equity/PROVENANCE.md`.
    const AA_VS_KK_BAND: (f64, f64) = (0.81, 0.83);
    /// Disjoint combo matchups of two different pairs: 6 by 6.
    const PAIR_VS_PAIR_MATCHUPS: f64 = 36.0;

    fn index(class: &str) -> usize {
        let class: HandClass = class.parse().expect("a hand class");
        usize::from(class.index())
    }

    fn range_of(classes: &[(&str, f64)]) -> Vec<f64> {
        let mut reach = vec![0.0; CLASSES];
        for (class, value) in classes {
            reach[index(class)] = *value;
        }
        reach
    }

    #[test]
    fn r2_13_embedded_equity_table_is_169_by_169_and_shared() {
        let table = EquityTable::embedded();
        assert_eq!(table.classes.len(), CLASSES);
        assert_eq!(table.classes[0], "AA");
        assert!(table.equity.iter().all(|row| row.len() == CLASSES));
        assert!(table.pairs.iter().all(|row| row.len() == CLASSES));
        assert!(std::sync::Arc::ptr_eq(&table, &EquityTable::embedded()), "one parse");
    }

    #[test]
    fn r2_14_equity_table_matches_hand_class_order_and_symmetry() {
        let table = EquityTable::embedded();
        for (i, name) in table.classes.iter().enumerate() {
            let class = HandClass::from_index(u8::try_from(i).expect("a class index"));
            assert_eq!(name, &class.expect("a class").to_string(), "class {i}");
        }
        for i in 0..CLASSES {
            assert!((table.equity[i][i] - 0.5).abs() < 1e-12, "diagonal {i}");
            for j in 0..CLASSES {
                let sum = table.equity[i][j] + table.equity[j][i];
                assert!((sum - 1.0).abs() < 1e-9, "equity {i} {j}");
                assert!((table.pairs[i][j] - table.pairs[j][i]).abs() < 1e-12, "pairs {i} {j}");
            }
        }
        let (aa, kk) = (index("AA"), index("KK"));
        let edge = table.equity[aa][kk];
        assert!((AA_VS_KK_BAND.0..=AA_VS_KK_BAND.1).contains(&edge), "AA versus KK: {edge}");
        assert!((table.pairs[aa][kk] - PAIR_VS_PAIR_MATCHUPS).abs() < 1e-12);
    }

    #[test]
    fn r2_14_range_equity_against_one_class_is_the_cell() {
        let table = EquityTable::embedded();
        let (aa, kk) = (index("AA"), index("KK"));
        let villain = range_of(&[("KK", 0.5)]);
        let equity = table.range_equity(aa, &villain).expect("a live matchup");
        assert!((equity - table.equity[aa][kk]).abs() < 1e-12, "{equity}");
        let live = table.live_weight(aa, &villain);
        assert!((live - 0.5 * PAIR_VS_PAIR_MATCHUPS).abs() < 1e-12, "{live}");
        assert_eq!(table.strengths(&villain)[aa], Some(equity));
        assert_eq!(table.live_weights(&villain)[aa], live);
    }

    #[test]
    fn r2_14_range_equity_weights_villain_classes_by_reach_and_pairs() {
        let table = EquityTable::embedded();
        let (hero, kk, qq) = (index("AKs"), index("KK"), index("QQ"));
        let villain = range_of(&[("KK", 1.0), ("QQ", 0.25)]);
        let (w_kk, w_qq) = (table.pairs[hero][kk], 0.25 * table.pairs[hero][qq]);
        let expected =
            (w_kk * table.equity[hero][kk] + w_qq * table.equity[hero][qq]) / (w_kk + w_qq);
        let equity = table.range_equity(hero, &villain).expect("a live matchup");
        assert!((equity - expected).abs() < 1e-12, "{equity} versus {expected}");
    }

    #[test]
    fn r2_14_range_equity_is_none_without_a_live_matchup() {
        let table = EquityTable::embedded();
        let empty = vec![0.0; CLASSES];
        assert_eq!(table.range_equity(index("AA"), &empty), None);
        assert_eq!(table.live_weight(index("AA"), &empty), 0.0);
        assert!(table.strengths(&empty).iter().all(Option::is_none));
        let short: Vec<f64> = Vec::new();
        assert_eq!(table.range_equity(index("AA"), &short), None, "a short range names none");
    }
}
