//! `library-pack synthetic` (R2.13, O-149): a seeded synthetic node dump from
//! `gto_library::synthetic_tree`, written through the same `export_dump` the round trip
//! uses, so `library-pack pack` turns it into a library and `verify` reads it back.
//!
//! Mechanism: the generator draws one v1 catalog configuration and one pair from the
//! seed and gives `nodes` preflop nodes of the 169 classes, the one kind v1 packs (O-132).
//! The dump carries the metadata the solver-query fixture uses: source `reference`, the
//! engine label `synthetic`, the catalog row the seed drew, no exploitability, and a fixed
//! `exported_at`, so one seed always writes the same bytes and `pack` derives one solution
//! id from them. Nothing here is a solve; a library packed from the dump with `--synthetic`
//! carries `synthetic: true` (O-57).
//!
//! The integrator of S16 owns this file.

use std::fs;
use std::path::Path;

use gto_library::synthetic::TreeLayout;
use gto_library::{
    HandSpace, ManifestConfig, SolutionMeta, SolvedNode, Source, SyntheticParams, is_timestamp,
    synthetic_tree,
};
use gto_model::v1_configs;

use crate::convert::tree_hash;
use crate::dump::NodeDump;
use crate::error::PackError;
use crate::export::export_dump;
use crate::invariants::{Rule, Violation};

/// The engine label of a synthetic dump: an opaque label, never a product name.
pub const SYNTHETIC_ENGINE: &str = "synthetic";

/// The `exported_at` a synthetic dump carries unless overridden; fixed so that one seed
/// gives one file and `pack` one default solution id.
pub const SYNTHETIC_EXPORTED_AT: &str = "2026-01-01T00:00:00Z";

/// The share of hands that play one action at frequency 1 when no option is given.
pub const DEFAULT_PURE_SHARE: f64 = 0.5;

/// The share of the 169 classes each node holds when no option is given: dense records.
pub const DEFAULT_RANGE_FRACTION: f64 = 1.0;

/// The inclusive action count bounds when no option is given.
pub const DEFAULT_ACTIONS: (u8, u8) = (2, 4);

/// The solution id of the in-memory metadata; the dump carries no id, `pack` assigns one.
const PLACEHOLDER_ID: &str = "00000000-0000-8000-8000-000000000000";

/// What to generate (the `SyntheticParams` worth exposing on the command line).
#[derive(Clone, Debug, PartialEq)]
pub struct SyntheticOptions {
    /// The generator seed.
    pub seed: u64,
    /// How many preflop nodes, each with a distinct key.
    pub nodes: usize,
    /// The share of hands that play one action at frequency 1, in `[0, 1]`.
    pub pure_share: f64,
    /// The share of the 169 classes each node holds, in `(0, 1]`.
    pub range_fraction: f64,
    /// The inclusive range of actions per node.
    pub actions: (u8, u8),
    /// The dump's `exported_at`, `YYYY-MM-DDTHH:MM:SSZ`.
    pub exported_at: String,
}

impl Default for SyntheticOptions {
    /// Seed 7 and 64 dense nodes, half the hands pure, 2 to 4 actions, the fixed timestamp.
    fn default() -> Self {
        SyntheticOptions {
            seed: 7,
            nodes: 64,
            pure_share: DEFAULT_PURE_SHARE,
            range_fraction: DEFAULT_RANGE_FRACTION,
            actions: DEFAULT_ACTIONS,
            exported_at: SYNTHETIC_EXPORTED_AT.to_owned(),
        }
    }
}

/// The dump for `o`: `o.nodes` preflop nodes of one configuration and pair under the
/// synthetic reference metadata, in the shape `pack` accepts.
///
/// # Errors
///
/// `PackError::Rejected` when `exported_at` is not a UTC timestamp, so a dump that `pack`
/// would refuse is never written.
pub fn synthetic_dump(o: &SyntheticOptions) -> Result<NodeDump, PackError> {
    if !is_timestamp(&o.exported_at) {
        let message = format!("The exported_at {:?} is not a UTC timestamp.", o.exported_at);
        return Err(PackError::Rejected(vec![Violation::new(Rule::Structural, message)]));
    }
    let nodes = synthetic_tree(&SyntheticParams {
        seed: o.seed,
        nodes: o.nodes,
        hand_space: HandSpace::Preflop169,
        range_fraction: o.range_fraction,
        pure_share: o.pure_share,
        actions: o.actions,
        layout: TreeLayout::Preflop,
    });
    let meta = synthetic_meta(&nodes, &o.exported_at)?;
    Ok(export_dump(&meta, &nodes))
}

/// Writes the dump for `o` to `path` as pretty JSON (JavaScript Object Notation) with one
/// trailing newline, creating the parent directory, and returns the node count.
///
/// # Errors
///
/// As `synthetic_dump`, plus `PackError::Io` when the file cannot be written.
pub fn write_synthetic_dump(path: &Path, o: &SyntheticOptions) -> Result<usize, PackError> {
    let dump = synthetic_dump(o)?;
    let mut bytes = serde_json::to_vec_pretty(&dump).map_err(|err| PackError::Io {
        path: path.display().to_string(),
        source: std::io::Error::other(err),
    })?;
    bytes.push(b'\n');
    let io = |source| PackError::Io { path: path.display().to_string(), source };
    if let Some(parent) = path.parent().filter(|parent| !parent.as_os_str().is_empty()) {
        fs::create_dir_all(parent).map_err(io)?;
    }
    fs::write(path, bytes).map_err(io)?;
    Ok(dump.nodes.len())
}

/// The reference metadata of a synthetic tree: the v1 catalog row its keys name.
fn synthetic_meta(nodes: &[SolvedNode], exported_at: &str) -> Result<SolutionMeta, PackError> {
    let first = nodes
        .first()
        .ok_or_else(|| PackError::Usage("the synthetic tree holds no node".to_owned()))?;
    let config_id = &first.key.config_id;
    let config = v1_configs()
        .into_iter()
        .find(|config| &config.config_id() == config_id)
        .ok_or_else(|| {
            PackError::Usage(format!(
                "the synthetic configuration {config_id} is not in the catalog"
            ))
        })?;
    Ok(SolutionMeta {
        id: PLACEHOLDER_ID.to_owned(),
        source: Source::Reference,
        engine_version: SYNTHETIC_ENGINE.to_owned(),
        config: ManifestConfig {
            format: config.format,
            table_size: config.table_size,
            stake: config.stake.label.clone(),
            depth_cbb: config.depth_cbb,
            straddle: config.straddle,
            ante_cbb: config.ante_cbb,
        },
        config_id: config_id.clone(),
        pair: first.key.pair,
        tree_hash: tree_hash(nodes),
        seed: None,
        iterations: None,
        exploitability_pct_pot: None,
        synthetic: true,
        created_at: exported_at.to_owned(),
    })
}

#[cfg(test)]
mod tests {
    use crate::invariants::{PREFLOP_169, check_invariants, check_structure};

    use super::{SYNTHETIC_ENGINE, SYNTHETIC_EXPORTED_AT, SyntheticOptions, synthetic_dump};

    #[test]
    fn r2_13_synthetic_dump_is_seeded_preflop_and_passes_both_checkers() {
        let options = SyntheticOptions { seed: 7, nodes: 5, ..SyntheticOptions::default() };
        let dump = synthetic_dump(&options).expect("the dump builds");
        assert_eq!(dump, synthetic_dump(&options).expect("again"), "one seed, one dump");
        assert_eq!(dump.nodes.len(), 5);
        assert_eq!(dump.hand_space, PREFLOP_169);
        assert_eq!(dump.source, "reference");
        assert_eq!(dump.exported_at, SYNTHETIC_EXPORTED_AT);
        assert!(dump.config_id.is_some(), "the catalog configuration is named");
        assert!(dump.nodes.iter().all(|node| node.street == "preflop"), "preflop only");
        assert_eq!(check_invariants(&dump), Vec::new());
        assert_eq!(check_structure(&dump), Vec::new());
        let other = synthetic_dump(&SyntheticOptions { seed: 8, ..options }).expect("builds");
        assert_ne!(dump, other, "another seed is another dump");
        assert_eq!(SYNTHETIC_ENGINE, "synthetic");
    }

    #[test]
    fn r2_13_synthetic_dump_rejects_a_malformed_timestamp() {
        let options =
            SyntheticOptions { exported_at: "yesterday".to_owned(), ..SyntheticOptions::default() };
        let error = synthetic_dump(&options).expect_err("not a timestamp");
        assert!(error.to_string().contains("rejected"), "{error}");
    }
}
