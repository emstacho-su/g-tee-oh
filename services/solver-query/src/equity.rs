#![allow(unused_variables, dead_code, reason = "S16 stub: lane B fills this file")]
//! The 169 by 169 preflop equity table and the range equity helpers (R2.14, O-32, O-126,
//! O-148, plan C.3). The committed table `validation/fixtures/equity/preflop-169.json`
//! (keys `classes[169]`, `equity[169][169]`, hero class `i` against villain class `j` as
//! a pot share, and `pairs[169][169]`, the disjoint combo matchups) is embedded at build
//! time with `include_str!` and parsed once into a process-wide table, because the Docker
//! build context copies `validation/fixtures/equity` and nothing else of `validation/`
//! (O-148, `infra/docker/solver-query.Dockerfile`).
//!
//! S16 lands `EquityTable::embedded`, which `AppState` holds. Lane B adds the helpers of
//! plan C.3 (range equity of a class against a reach-weighted range, live-matchup
//! weights, the tests that pin `classes[i]` to `HandClass::from_index(i)`, the symmetry
//! and the AA versus KK band) and removes the allowance at the top of this file.

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
    use super::{CLASSES, EquityTable};

    #[test]
    fn r2_13_embedded_equity_table_is_169_by_169_and_shared() {
        let table = EquityTable::embedded();
        assert_eq!(table.classes.len(), CLASSES);
        assert_eq!(table.classes[0], "AA");
        assert!(table.equity.iter().all(|row| row.len() == CLASSES));
        assert!(table.pairs.iter().all(|row| row.len() == CLASSES));
        assert!(std::sync::Arc::ptr_eq(&table, &EquityTable::embedded()), "one parse");
    }
}
