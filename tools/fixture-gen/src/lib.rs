//! `fixture-gen`: the seeded generator of the labeled synthetic preflop fixture sets
//! (R2.20, O-30, O-57, O-225, O-226).
//!
//! Mechanism. `validation/fixtures/synthetic/sets.json` names each set: a seed, the
//! configuration ids and the position pairs (all pairs of the table when omitted), and the
//! fixed `created_at`. For every configuration and pair the generator builds the real
//! preflop pair tree with `gto_tree::PreflopTree::build` from the seed sizing convention of
//! its format, then fills every node with a seeded synthetic strategy (O-226, `strategy`):
//! never a solve. The draws of one solution come from a `ChaCha8` generator seeded with the
//! sha256 of the set seed, the configuration id and the pair, so each solution is
//! independent of the others and of the order they are built in. Each tree becomes a
//! `preflop_169` node dump (source `reference`, engine label `synthetic`, the set seed) and
//! is packed through `library_pack::pack` with `synthetic: true`, which applies the
//! criterion 2 invariants; the solution id is the dump's sha256 (O-131), so two runs from
//! one seed are byte-identical. Nothing reads the clock, iterates a hash map or depends on
//! the order a directory lists in.
//!
//! After a configuration is packed, any other synthetic solution left under its directory
//! by an earlier seed is removed (`stale`), so a regenerated library holds exactly the sets
//! of the sets file; a solution without `synthetic: true` is never touched.

#![forbid(unsafe_code)]

mod emit;
mod inputs;
mod line;
mod stale;
mod strategy;

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use gto_model::{GameConfig, PositionPair};
use gto_tree::PreflopTree;
use rand::SeedableRng;
use rand_chacha::ChaCha8Rng;

use crate::emit::Target;
use crate::inputs::Specs;

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

/// The only sets file schema version.
pub const SETS_SCHEMA_VERSION: u32 = 1;

/// Hexadecimal digits of the sha256 that seed one solution's generator: 64 bits.
const SEED_HEX_DIGITS: usize = 16;

/// Errors of the generator.
#[derive(Debug, thiserror::Error)]
pub enum GenError {
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
    let text = inputs::read_text(path)?;
    let sets: Sets = serde_json::from_str(&text)
        .map_err(|err| inputs::input_error(path, format!("not a sets file: {err}")))?;
    check_sets(&sets).map_err(|message| inputs::input_error(path, message))?;
    Ok(sets)
}

/// The rules of a sets file: schema version 1, at least one set, unique non-empty names, a
/// UTC timestamp, at least one configuration per set, every configuration in the v1
/// catalog and in one set only (a configuration's directory belongs to one set, which is
/// what lets `stale` clean it), and a non-empty pair list when one is given.
fn check_sets(sets: &Sets) -> Result<(), String> {
    if sets.schema_version != SETS_SCHEMA_VERSION {
        return Err(format!("schema_version {} is not {SETS_SCHEMA_VERSION}", sets.schema_version));
    }
    if sets.sets.is_empty() {
        return Err("no sets".to_owned());
    }
    let mut names = BTreeSet::new();
    let mut configs = BTreeSet::new();
    for set in &sets.sets {
        let name = &set.name;
        let problems = [
            name.is_empty().then(|| "a set has an empty name".to_owned()),
            (!names.insert(name.as_str())).then(|| format!("set {name} is listed twice")),
            (!gto_library::is_timestamp(&set.created_at)).then(|| {
                format!("set {name} created_at {:?} is not a UTC timestamp", set.created_at)
            }),
            set.config_ids.is_empty().then(|| format!("set {name} has no config_ids")),
            set.pairs
                .as_ref()
                .filter(|p| p.is_empty())
                .map(|_| format!("set {name} lists no pairs")),
        ];
        if let Some(problem) = problems.into_iter().flatten().next() {
            return Err(problem);
        }
        for id in &set.config_ids {
            if inputs::catalog_config(id).is_none() {
                return Err(format!("set {name}: {id} is not a v1 configuration"));
            }
            if !configs.insert(id.as_str()) {
                return Err(format!("set {name}: {id} is generated by another set"));
            }
        }
    }
    Ok(())
}

/// Generates every set of `sets` into `out_root`, reading the equity table and the sizing
/// conventions under `repo_root`.
///
/// # Errors
///
/// `GenError` naming the set, configuration and pair that failed.
pub fn generate(sets: &Sets, repo_root: &Path, out_root: &Path) -> Result<Summary, GenError> {
    let label = Path::new(SETS_RELATIVE_TO_REPO_ROOT);
    check_sets(sets).map_err(|message| inputs::input_error(label, message))?;
    let inputs =
        Inputs { scores: inputs::class_scores(repo_root)?, specs: Specs::load(repo_root)? };
    let scratch = tempfile::tempdir()
        .map_err(|source| GenError::Io { path: "a temporary directory".to_owned(), source })?;
    let mut solutions = Vec::new();
    for set in &sets.sets {
        for config_id in &set.config_ids {
            let config = inputs::catalog_config(config_id).ok_or_else(|| {
                inputs::input_error(label, format!("{config_id} is not a v1 configuration"))
            })?;
            let pairs = match &set.pairs {
                Some(names) => inputs::named_pairs(label, &config, names)?,
                None => inputs::table_pairs(&config)?,
            };
            let mut packed = Vec::with_capacity(pairs.len());
            for pair in pairs {
                let target = Target {
                    set: &set.name,
                    seed: set.seed,
                    created_at: &set.created_at,
                    config: &config,
                    pair,
                };
                packed.push(one_solution(&inputs, &target, scratch.path(), out_root)?);
            }
            stale::remove(out_root, &config.config_id(), &packed)?;
            solutions.extend(packed);
        }
    }
    let bytes =
        solutions.iter().try_fold(0_u64, |total, s| Ok(total + emit::bytes_under(&s.prefix)?))?;
    Ok(Summary { solutions, bytes })
}

/// What every solution reads: the class scores and the sizing conventions.
struct Inputs {
    scores: Vec<f64>,
    specs: Specs,
}

/// Builds, fills and packs one solution.
fn one_solution(
    inputs: &Inputs,
    target: &Target<'_>,
    scratch: &Path,
    out_root: &Path,
) -> Result<Generated, GenError> {
    let named = |err: GenError| match err {
        GenError::Build(message) => GenError::Build(format!("{}: {message}", target.name())),
        other => other,
    };
    let spec = inputs.specs.of(target.config.format);
    let tree = PreflopTree::build(spec, target.config, target.pair)
        .map_err(|err| GenError::Build(format!("{}: {err}", target.name())))?;
    let mut rng =
        ChaCha8Rng::seed_from_u64(solution_seed(target.seed, target.config, target.pair)?);
    let rows = strategy::strategies(&tree, &inputs.scores, &mut rng).map_err(named)?;
    let nodes = emit::solved_nodes(target, &tree, rows).map_err(named)?;
    emit::pack_nodes(target, &nodes, scratch, out_root)
}

/// The seed of one solution's generator: the first 64 bits of the sha256 of the set seed,
/// the configuration id and the pair, one per line.
fn solution_seed(seed: u64, config: &GameConfig, pair: PositionPair) -> Result<u64, GenError> {
    let text = format!("{seed}\n{}\n{pair}\n", config.config_id());
    let hex = gto_library::sha256_hex(text.as_bytes());
    hex.get(..SEED_HEX_DIGITS)
        .and_then(|digits| u64::from_str_radix(digits, 16).ok())
        .ok_or_else(|| GenError::Build(format!("the sha256 {hex:?} does not give a seed")))
}

#[cfg(test)]
mod tests {
    use super::{SETS_SCHEMA_VERSION, SetSpec, Sets, check_sets};

    fn set(name: &str, config: &str) -> SetSpec {
        SetSpec {
            name: name.to_owned(),
            seed: 1,
            config_ids: vec![config.to_owned()],
            pairs: None,
            created_at: "2026-10-27T00:00:00Z".to_owned(),
        }
    }

    #[test]
    fn r2_20_sets_rules_reject_what_the_generator_cannot_build() {
        let good =
            Sets { schema_version: SETS_SCHEMA_VERSION, sets: vec![set("a", "cfg_6_online_100")] };
        assert_eq!(check_sets(&good), Ok(()));
        let cases = [
            Sets { schema_version: 2, ..good.clone() },
            Sets { sets: Vec::new(), ..good.clone() },
            Sets {
                sets: vec![set("a", "cfg_6_online_100"), set("a", "cfg_6_online_150")],
                ..good.clone()
            },
            Sets {
                sets: vec![set("a", "cfg_6_online_100"), set("b", "cfg_6_online_100")],
                ..good.clone()
            },
            Sets { sets: vec![set("a", "cfg_2_online_norake_10")], ..good.clone() },
            Sets {
                sets: vec![SetSpec { created_at: "today".into(), ..set("a", "cfg_6_online_100") }],
                ..good.clone()
            },
            Sets {
                sets: vec![SetSpec { pairs: Some(Vec::new()), ..set("a", "cfg_6_online_100") }],
                ..good.clone()
            },
        ];
        for case in cases {
            assert!(check_sets(&case).is_err(), "{case:?}");
        }
    }
}
