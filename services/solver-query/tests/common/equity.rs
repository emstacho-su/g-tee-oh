//! The 169 by 169 preflop equity table as the insights tests read it (R2.14, O-32, O-126):
//! straight from `validation/fixtures/equity/preflop-169.json`, independent of the
//! service's own `equity.rs`, so the expected numbers in `tests/insights.rs` come from the
//! committed table and the plan C.3 formulas rather than from the code under test.
//!
//! `range_equity` is the hand strength of plan C.3: hero class `i` against the villain's
//! reach-weighted range, `sum_j w_ij * equity[i][j] / sum_j w_ij` with
//! `w_ij = reach_v[j] * pairs[i][j]`, the live matchups of the two classes.

use std::fs;
use std::path::Path;

use gto_model::HandClass;
use serde::Deserialize;

/// The committed table, relative to this crate's manifest directory.
const TABLE_PATH: &str = "../../validation/fixtures/equity/preflop-169.json";

/// Hand classes in the table.
pub const CLASSES: usize = 169;

/// The table as the file holds it.
#[derive(Debug, Clone, Deserialize)]
pub struct EquityFixture {
    /// The class names in `HandClass` index order.
    pub classes: Vec<String>,
    /// `equity[i][j]`: hero class `i`'s pot share against villain class `j`.
    pub equity: Vec<Vec<f64>>,
    /// `pairs[i][j]`: the disjoint combo matchups of the two classes.
    pub pairs: Vec<Vec<f64>>,
}

impl EquityFixture {
    /// Reads the committed table.
    #[must_use]
    pub fn load() -> Self {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join(TABLE_PATH);
        let bytes =
            fs::read(&path).unwrap_or_else(|err| panic!("cannot read {}: {err}", path.display()));
        let table: EquityFixture = serde_json::from_slice(&bytes).expect("the table is JSON");
        assert_eq!(table.classes.len(), CLASSES, "169 classes");
        table
    }

    /// The index of a class name.
    #[must_use]
    pub fn index(&self, class: &str) -> usize {
        self.classes
            .iter()
            .position(|name| name == class)
            .unwrap_or_else(|| panic!("{class} is not a hand class"))
    }

    /// Hero class `hero`'s equity against a villain range given as reach per class.
    #[must_use]
    pub fn range_equity(&self, hero: usize, villain_reach: &[f64]) -> f64 {
        let (mut weighted, mut weight) = (0.0, 0.0);
        for (villain, reach) in villain_reach.iter().enumerate() {
            let w = reach * self.pairs[hero][villain];
            weighted += w * self.equity[hero][villain];
            weight += w;
        }
        weighted / weight
    }

    /// The live-matchup weight of hero class `hero` against a villain range: the sum over
    /// villain classes of `reach_v[j] * pairs[hero][j]`.
    #[must_use]
    pub fn live_weight(&self, hero: usize, villain_reach: &[f64]) -> f64 {
        villain_reach.iter().enumerate().map(|(j, reach)| reach * self.pairs[hero][j]).sum()
    }
}

/// A range with reach 1 for every class.
#[must_use]
pub fn full_range() -> Vec<f64> {
    vec![1.0; CLASSES]
}

/// The combo count of class `index`: 6 for a pair, 4 suited, 12 offsuit.
#[must_use]
pub fn combos(index: usize) -> f64 {
    let class = HandClass::from_index(u8::try_from(index).expect("a class index"));
    f64::from(class.expect("a class index").combo_count())
}

/// Every class's strength against `villain_reach` (plan C.3), indexed by class.
#[must_use]
pub fn strengths(table: &EquityFixture, villain_reach: &[f64]) -> Vec<f64> {
    (0..CLASSES).map(|hero| table.range_equity(hero, villain_reach)).collect()
}

/// The classes strongest first by `strengths`.
#[must_use]
pub fn strongest_first(strengths: &[f64]) -> Vec<usize> {
    let mut order: Vec<usize> = (0..CLASSES).collect();
    order.sort_by(|a, b| strengths[*b].partial_cmp(&strengths[*a]).expect("finite equities"));
    order
}

/// The reach-weighted percentile of class `hero` in a hero range where every class is held
/// at reach 1: the combo mass of the classes at or below its strength over the whole mass,
/// so the strongest class is exactly 1 (the `rank_in_range` of plan C.3).
#[must_use]
pub fn rank_in_full_range(strengths: &[f64], hero: usize) -> f64 {
    let total: f64 = (0..CLASSES).map(combos).sum();
    let below: f64 = (0..CLASSES).filter(|j| strengths[*j] <= strengths[hero]).map(combos).sum();
    below / total
}

/// A range holding only the given classes at the given reach.
#[must_use]
pub fn range_of(table: &EquityFixture, classes: &[(&str, f64)]) -> Vec<f64> {
    let mut reach = vec![0.0; CLASSES];
    for (class, value) in classes {
        reach[table.index(class)] = *value;
    }
    reach
}
