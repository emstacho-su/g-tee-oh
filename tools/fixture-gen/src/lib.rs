//! `fixture-gen`: the seeded generator of the labeled synthetic preflop fixture sets
//! (R2.20, O-30, O-57, O-225, O-226).
//!
//! Mechanism. `validation/fixtures/synthetic/sets.json` names each set: a seed, the
//! configuration ids and the position pairs (all pairs of the table when omitted), and the
//! fixed `created_at`. For every configuration and pair the generator builds the real
//! preflop pair tree with `gto_tree::PreflopTree::build` from the seed sizing convention of
//! its format, then fills every node with a seeded synthetic strategy (O-226): never a
//! solve. Each tree becomes a `preflop_169` node dump (source `reference`, engine label
//! `synthetic`, the set seed) and is packed through `library_pack::pack` with
//! `synthetic: true`, which applies the criterion 2 invariants; the solution id is the
//! dump's sha256 (O-131), so two runs from one seed are byte-identical.

#![forbid(unsafe_code)]

use std::path::{Path, PathBuf};

/// The set definitions, relative to the repository root.
pub const SETS_RELATIVE_TO_REPO_ROOT: &str = "validation/fixtures/synthetic/sets.json";

/// The committed library root, relative to the repository root (O-62).
pub const LIBRARY_RELATIVE_TO_REPO_ROOT: &str = "validation/fixtures/library";

/// The equity table, relative to the repository root (O-126).
pub const EQUITY_RELATIVE_TO_REPO_ROOT: &str = "validation/fixtures/equity/preflop-169.json";

/// The seed sizing conventions, relative to the repository root (O-136).
pub const SIZING_ONLINE_RELATIVE_TO_REPO_ROOT: &str =
    "packages/contracts/schemas/examples/sizing-convention/valid/seed-online.json";

/// The seed live sizing convention, relative to the repository root (O-136).
pub const SIZING_LIVE_RELATIVE_TO_REPO_ROOT: &str =
    "packages/contracts/schemas/examples/sizing-convention/valid/seed-live.json";

/// Errors of the generator.
#[derive(Debug, thiserror::Error)]
pub enum GenError {
    /// A part the session skeleton has not filled yet.
    #[error("not implemented yet: {0}")]
    NotImplemented(&'static str),
    /// A file could not be read or written.
    #[error("{path}: {source}")]
    Io {
        /// The path.
        path: String,
        /// The cause.
        source: std::io::Error,
    },
    /// A sets file, sizing spec or equity table was malformed.
    #[error("invalid input {path}: {message}")]
    Input {
        /// The path.
        path: String,
        /// What was wrong.
        message: String,
    },
    /// A tree, dump or pack step failed.
    #[error("{0}")]
    Build(String),
}

/// One synthetic set.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SetSpec {
    /// The set name, such as `synthetic-6max`.
    pub name: String,
    /// The seed every draw of the set derives from.
    pub seed: u64,
    /// The configuration ids, each in `gto_model::v1_configs()`.
    pub config_ids: Vec<String>,
    /// The pairs, written like `BB-BTN`; every pair of the table when absent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pairs: Option<Vec<String>>,
    /// The `created_at` of every manifest, fixed for byte determinism.
    pub created_at: String,
}

/// The sets file.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Sets {
    /// Always 1.
    pub schema_version: u32,
    /// The sets.
    pub sets: Vec<SetSpec>,
}

/// One packed solution.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Generated {
    /// The set name.
    pub set: String,
    /// The configuration id.
    pub config_id: String,
    /// The pair.
    pub pair: String,
    /// The solution id.
    pub solution_id: String,
    /// The solution directory under the output root.
    pub prefix: PathBuf,
}

/// What a run wrote.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Summary {
    /// Every solution, in sets order, then configuration, then pair.
    pub solutions: Vec<Generated>,
    /// The bytes written.
    pub bytes: u64,
}

/// Reads and checks the sets file.
///
/// # Errors
///
/// `GenError::Io` or `GenError::Input` naming the file.
pub fn load_sets(path: &Path) -> Result<Sets, GenError> {
    let _ = path;
    Err(GenError::NotImplemented("load_sets"))
}

/// Generates every set of `sets` into `out_root`, reading the equity table and the sizing
/// conventions under `repo_root`.
///
/// # Errors
///
/// `GenError` naming the set, configuration and pair that failed.
pub fn generate(sets: &Sets, repo_root: &Path, out_root: &Path) -> Result<Summary, GenError> {
    let _ = (sets, repo_root, out_root);
    Err(GenError::NotImplemented("generate"))
}
