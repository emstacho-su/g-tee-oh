//! The generator's inputs (O-126, O-136, O-225): the hand scores from the equity table, the
//! seed sizing convention of each format, the v1 catalog row of a configuration id and the
//! pairs of a set.
//!
//! Mechanism. A class's equity against a random hand is the pairs-weighted mean of its row
//! of the equity table: the sum over villain classes of pairs times equity, over the sum of
//! pairs, which counts every disjoint combo pair once and so keeps card removal exact. The
//! score is the class's combo-weighted percentile in that order (the share of the 1,326
//! combos ranked below it plus half its own), so a score of 0.8 reads as "better than about
//! 80 percent of hands". Every sum and sort runs in class index order with ties broken by
//! index, and only arithmetic is used, so the scores are the same bits on every platform.

use std::path::Path;

use gto_model::{GameConfig, GameFormat, HandClass, Position, PositionPair, v1_configs};
use gto_tree::SizingConventionSpec;

use crate::{
    EQUITY_RELATIVE_TO_REPO_ROOT, GenError, SIZING_LIVE_RELATIVE_TO_REPO_ROOT,
    SIZING_ONLINE_RELATIVE_TO_REPO_ROOT,
};

/// Hand classes in the preflop hand space.
pub(crate) const CLASSES: usize = HandClass::COUNT as usize;

/// The fields of the equity table the generator reads; the provenance fields are ignored.
#[derive(serde::Deserialize)]
struct EquityFile {
    classes: Vec<String>,
    equity: Vec<Vec<f64>>,
    pairs: Vec<Vec<u32>>,
}

/// Reads a file to text, naming the path on failure.
pub(crate) fn read_text(path: &Path) -> Result<String, GenError> {
    std::fs::read_to_string(path)
        .map_err(|source| GenError::Io { path: path.display().to_string(), source })
}

/// An input error naming the path.
pub(crate) fn input_error(path: &Path, message: impl Into<String>) -> GenError {
    GenError::Input { path: path.display().to_string(), message: message.into() }
}

/// The 169 class scores in class index order, each in `(0, 1)`.
pub(crate) fn class_scores(repo_root: &Path) -> Result<Vec<f64>, GenError> {
    let path = repo_root.join(EQUITY_RELATIVE_TO_REPO_ROOT);
    let file: EquityFile = serde_json::from_str(&read_text(&path)?)
        .map_err(|err| input_error(&path, format!("not an equity table: {err}")))?;
    check_equity_shape(&path, &file)?;
    let versus_random = file
        .equity
        .iter()
        .zip(&file.pairs)
        .enumerate()
        .map(|(class, (equities, pairs))| {
            let weighted: f64 =
                equities.iter().zip(pairs).map(|(equity, n)| f64::from(*n) * equity).sum();
            let total: f64 = pairs.iter().map(|n| f64::from(*n)).sum();
            if total > 0.0 {
                Ok(weighted / total)
            } else {
                Err(input_error(&path, format!("class {class} has no combo pairs")))
            }
        })
        .collect::<Result<Vec<f64>, GenError>>()?;
    Ok(percentiles(&versus_random))
}

/// Checks the class labels, in `HandClass` index order, and the 169 by 169 tables.
fn check_equity_shape(path: &Path, file: &EquityFile) -> Result<(), GenError> {
    let labels_match = file.classes.len() == CLASSES
        && HandClass::all().zip(&file.classes).all(|(class, label)| class.to_string() == *label);
    if !labels_match {
        return Err(input_error(path, "the classes are not the 169 labels in index order"));
    }
    let equity_ok = file.equity.len() == CLASSES
        && file.equity.iter().all(|row| row.len() == CLASSES)
        && file.equity.iter().flatten().all(|e| (0.0..=1.0).contains(e));
    let pairs_ok = file.pairs.len() == CLASSES && file.pairs.iter().all(|row| row.len() == CLASSES);
    if equity_ok && pairs_ok {
        Ok(())
    } else {
        Err(input_error(path, "equity and pairs must be 169 by 169, equities within [0, 1]"))
    }
}

/// The combo-weighted percentile of each class in the order of `values`.
fn percentiles(values: &[f64]) -> Vec<f64> {
    let combos = |class: usize| {
        u8::try_from(class)
            .ok()
            .and_then(|index| HandClass::from_index(index).ok())
            .map_or(0.0, |hand| f64::from(hand.combo_count()))
    };
    let total: f64 = (0..values.len()).map(combos).sum();
    let mut order: Vec<usize> = (0..values.len()).collect();
    order.sort_by(|a, b| values[*a].total_cmp(&values[*b]).then(a.cmp(b)));
    let mut scores = vec![0.0; values.len()];
    let mut below = 0.0;
    for class in order {
        let own = combos(class);
        scores[class] = (below + own / 2.0) / total;
        below += own;
    }
    scores
}

/// The seed sizing convention of each format, parsed once (O-136).
pub(crate) struct Specs {
    online: SizingConventionSpec,
    live: SizingConventionSpec,
}

impl Specs {
    /// Reads both seed conventions under `repo_root`.
    pub(crate) fn load(repo_root: &Path) -> Result<Specs, GenError> {
        let read = |relative: &str| {
            let path = repo_root.join(relative);
            SizingConventionSpec::from_json(&read_text(&path)?)
                .map_err(|err| input_error(&path, err.to_string()))
        };
        Ok(Specs {
            online: read(SIZING_ONLINE_RELATIVE_TO_REPO_ROOT)?,
            live: read(SIZING_LIVE_RELATIVE_TO_REPO_ROOT)?,
        })
    }

    /// The convention of a format.
    pub(crate) fn of(&self, format: GameFormat) -> &SizingConventionSpec {
        match format {
            GameFormat::Online => &self.online,
            GameFormat::Live => &self.live,
        }
    }
}

/// The v1 catalog row of a configuration id, or `None` off the catalog.
pub(crate) fn catalog_config(config_id: &str) -> Option<GameConfig> {
    v1_configs().into_iter().find(|config| config.config_id().as_str() == config_id)
}

/// Every pair of the table in seat order: the first seat in preflop order, then the second.
pub(crate) fn table_pairs(config: &GameConfig) -> Result<Vec<PositionPair>, GenError> {
    let seated = Position::seated(config.table_size);
    let mut pairs = Vec::new();
    for (index, first) in seated.iter().enumerate() {
        for second in &seated[index + 1..] {
            pairs.push(
                PositionPair::new(*first, *second)
                    .map_err(|err| GenError::Build(format!("pair {first}-{second}: {err}")))?,
            );
        }
    }
    Ok(pairs)
}

/// The pairs a set names, each canonical (`BB-BTN`) and seated at the table.
pub(crate) fn named_pairs(
    sets_path: &Path,
    config: &GameConfig,
    names: &[String],
) -> Result<Vec<PositionPair>, GenError> {
    let seated = Position::seated(config.table_size);
    names
        .iter()
        .map(|name| {
            let pair: PositionPair = name
                .parse()
                .map_err(|err| input_error(sets_path, format!("pair {name}: {err}")))?;
            if seated.contains(&pair.oop()) && seated.contains(&pair.ip()) {
                Ok(pair)
            } else {
                Err(input_error(sets_path, format!("pair {name} is not seated at the table")))
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::percentiles;

    #[test]
    fn r2_20_percentiles_follow_the_order_and_weight_combos() {
        // Classes 0 (AA, 6 combos), 1 (KK, 6) and 13 (AKs, 4) only matter through their
        // combos; a three-value input uses classes 0 to 2, all pairs of 6 combos.
        let scores = percentiles(&[0.9, 0.1, 0.5]);
        assert!(scores[1] < scores[2] && scores[2] < scores[0], "{scores:?}");
        assert!((scores[1] - 1.0 / 6.0).abs() < 1e-12, "{scores:?}");
        assert!((scores[0] - 5.0 / 6.0).abs() < 1e-12, "{scores:?}");
    }
}
