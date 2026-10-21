//! R2.9 and R1.6 sizing convention spec tests (O-75, O-76). R2.9 and R1.6 are requirement
//! identifiers (R IDs).
//!
//! Mechanism: the seed migration is the catalog of record, so the R1.6 public test reads it
//! from the repository with plain string handling, as `gto-model`'s catalog test does. The
//! `base` rows of the common table expression (CTE) hold the sizes per format and the `cfg`
//! rows the eleven configurations; each base row spans two lines and its JavaScript Object
//! Notation (JSON) literals hold commas, so the scanner joins the block into one text and
//! splits it on the parentheses and commas outside single quotes. The test rebuilds each
//! configuration's spec the way the seed's `jsonb_build_object` does, parses it, and builds
//! a `TreeConfig` and the preflop tree of every seated pair. The shared examples of the
//! contracts package must agree with the schema: every valid example builds and every
//! invalid one is rejected.

#[allow(dead_code, reason = "each test binary uses a subset of the shared fixtures")]
mod support;

use std::fs;
use std::path::{Path, PathBuf};

use gto_model::{GameConfig, v1_configs};
use gto_tree::{PreflopTree, SPEC_VERSION, SizingConventionSpec, TreeConfig, TreeError};
use serde_json::{Value, json};

/// The seed migration, relative to this crate's manifest directory.
const SEED_RELATIVE_PATH: &str = "../../db/migrations/20261020001100_seed_catalog.sql";

/// The shared spec examples of the contracts package, relative to the manifest directory.
const EXAMPLES_RELATIVE_PATH: &str = "../../packages/contracts/schemas/examples/sizing-convention";

/// The line that opens the base rows; they run to the line that reads `),`.
const BASE_OPENER: &str = "with base (format, open_bb, iso_rule, threebet_ip, threebet_oop,";

/// The line that opens the configuration rows; they run to the line that reads `),`.
const CONFIG_OPENER: &str = "cfg (id, format, table_size, stake_label, depth_cbb) as (";

/// Columns in a base row: format, `open_bb`, `iso_rule`, `threebet_ip`, `threebet_oop`,
/// `fourbet`, postflop.
const BASE_COLUMNS: usize = 7;

/// Columns in a configuration row: id, format, `table_size`, `stake_label`, `depth_cbb`.
const CONFIG_COLUMNS: usize = 5;

/// Catalog rows the seed inserts (R0.6, O-72).
const CONFIG_ROWS: usize = 11;

/// The environment variable naming the reference rows file S11 supplies (O-75).
const REFERENCE_ROWS_VAR: &str = "SIZING_SPECS_FILE";

fn repo_path(relative: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join(relative)
}

fn read(path: &Path) -> String {
    fs::read_to_string(path).unwrap_or_else(|err| panic!("cannot read {}: {err}", path.display()))
}

/// The text of the block after the line starting with `opener` up to the line `),`,
/// joined with spaces.
fn block(seed: &str, opener: &str) -> String {
    let mut lines = seed.lines().map(str::trim);
    assert!(lines.any(|line| line.starts_with(opener)), "the seed has no line {opener:?}");
    let body: Vec<&str> = lines.take_while(|line| *line != "),").collect();
    body.join(" ")
}

/// The inner text of every top-level parenthesised group outside single quotes.
fn groups(text: &str) -> Vec<String> {
    let (mut out, mut current, mut depth, mut quoted) = (Vec::new(), String::new(), 0_u32, false);
    for c in text.chars() {
        match c {
            '\'' => quoted = !quoted,
            '(' if !quoted => {
                depth += 1;
                if depth == 1 {
                    continue;
                }
            }
            ')' if !quoted => {
                depth -= 1;
                if depth == 0 {
                    out.push(std::mem::take(&mut current));
                    continue;
                }
            }
            _ => {}
        }
        if depth > 0 {
            current.push(c);
        }
    }
    out
}

/// Splits a value list on the commas outside single quotes, trimming each field and
/// dropping a `::type` cast.
fn fields(list: &str) -> Vec<String> {
    let (mut out, mut current, mut quoted) = (Vec::new(), String::new(), false);
    for c in list.chars() {
        match c {
            '\'' => {
                quoted = !quoted;
                current.push(c);
            }
            ',' if !quoted => out.push(std::mem::take(&mut current)),
            _ => current.push(c),
        }
    }
    out.push(current);
    out.iter()
        .map(|field| {
            let field = field.trim();
            field.split_once("::").map_or(field, |(literal, _)| literal).to_owned()
        })
        .collect()
}

fn unquote(field: &str) -> &str {
    field
        .strip_prefix('\'')
        .and_then(|rest| rest.strip_suffix('\''))
        .unwrap_or_else(|| panic!("{field:?} is not a quoted literal"))
}

fn number(field: &str) -> Value {
    let value: f64 = field.parse().unwrap_or_else(|err| panic!("{field:?}: {err}"));
    json!(value)
}

fn jsonb(field: &str) -> Value {
    serde_json::from_str(unquote(field)).unwrap_or_else(|err| panic!("{field:?}: {err}"))
}

/// The base spec fields per format, from the seed's base rows.
fn base_specs(seed: &str) -> Vec<(String, Value)> {
    groups(&block(seed, BASE_OPENER))
        .iter()
        .map(|row| {
            let f = fields(row);
            assert_eq!(f.len(), BASE_COLUMNS, "base row {row:?}");
            let spec = json!({
                "open_bb": number(&f[1]),
                "iso_rule": jsonb(&f[2]),
                "threebet_ip": number(&f[3]),
                "threebet_oop": number(&f[4]),
                "fourbet": number(&f[5]),
                "straddle_bb": null,
                "postflop": jsonb(&f[6]),
            });
            (unquote(&f[0]).to_owned(), spec)
        })
        .collect()
}

/// Every seed spec as (configuration id, spec JSON text), the way the seed builds it.
fn seed_specs() -> Vec<(String, String)> {
    let seed = read(&repo_path(SEED_RELATIVE_PATH));
    let bases = base_specs(&seed);
    groups(&block(&seed, CONFIG_OPENER))
        .iter()
        .map(|row| {
            let f = fields(row);
            assert_eq!(f.len(), CONFIG_COLUMNS, "config row {row:?}");
            let (id, format) = (unquote(&f[0]).to_owned(), unquote(&f[1]));
            let (_, base) = bases.iter().find(|(name, _)| name == format).expect("a base row");
            let mut spec = base.clone();
            spec["placeholder_for"] = json!(id);
            (id, spec.to_string())
        })
        .collect()
}

/// Builds the tree configuration and every seated pair's preflop tree of one spec.
fn build_everything(spec: &SizingConventionSpec, config: &GameConfig) -> Result<(), TreeError> {
    TreeConfig::from_spec(spec)?;
    for pair in support::seated_pairs(config) {
        let tree = PreflopTree::build(spec, config, pair)?;
        assert!(!tree.flop_lines().is_empty(), "{pair} reaches no flop");
    }
    Ok(())
}

/// R1.6: every seed convention parses and builds a tree configuration and the preflop tree
/// of every seated pair (O-75).
#[test]
fn r1_6_every_seed_convention_builds_a_tree() {
    let specs = seed_specs();
    assert_eq!(specs.len(), CONFIG_ROWS);
    let configs = v1_configs();
    for (id, text) in specs {
        let config = configs.iter().find(|c| c.config_id().as_str() == id).expect("a v1 config");
        let spec =
            SizingConventionSpec::from_json(&text).unwrap_or_else(|err| panic!("{id}: {err}"));
        assert_eq!(spec.placeholder_for.as_deref(), Some(id.as_str()));
        build_everything(&spec, config).unwrap_or_else(|err| panic!("{id}: {err}"));
    }
}

/// The online placeholder with `value` set at the dotted `path`, as JSON text.
fn online_with(path: &[&str], value: Value) -> String {
    let mut spec: Value = serde_json::from_str(support::ONLINE_PLACEHOLDER_JSON).expect("json");
    let (last, parents) = path.split_last().expect("a non-empty path");
    let parent = parents.iter().fold(&mut spec, |node, key| &mut node[*key]);
    parent[*last] = value;
    spec.to_string()
}

/// R2.9: unknown fields, values that are not positive, and values off their integer grid
/// are rejected when the spec is parsed.
#[test]
fn r2_9_spec_rejects_unknown_and_off_grid_fields() {
    assert!(SizingConventionSpec::from_json(support::ONLINE_PLACEHOLDER_JSON).is_ok());
    let spec_errors = [
        online_with(&["rake"], json!(1)),
        online_with(&["postflop", "donk_flop"], json!([0.5])),
        online_with(&["iso_rule", "per_straddle_bb"], json!(1.0)),
        online_with(&["open_bb"], json!(-2.5)),
        online_with(&["postflop", "flop"], json!([0.0])),
        online_with(&["spec_version"], json!(2)),
    ];
    for text in spec_errors {
        let result = SizingConventionSpec::from_json(&text);
        assert!(matches!(result, Err(TreeError::Spec(_))), "{text}: {result:?}");
    }
    let off_grid = [
        (online_with(&["open_bb"], json!(2.555)), "open_bb"),
        (online_with(&["fourbet"], json!(2.225)), "fourbet"),
        (online_with(&["postflop", "flop"], json!([0.33, 0.333_33])), "postflop.flop"),
        (online_with(&["iso_rule", "base_bb"], json!(3.001)), "iso_rule.base_bb"),
    ];
    for (text, field) in off_grid {
        let result = SizingConventionSpec::from_json(&text);
        let named = matches!(&result, Err(TreeError::OffGrid { field: got, .. }) if *got == field);
        assert!(named, "{text}: {result:?}");
    }
}

/// R2.9: the integer fields `raise_cap` and `spec_version` take an integer-valued float,
/// as Postgres jsonb hands back a row written with 3.0 and as the schema's integer type
/// does, and reject null and a float with a fractional part, as the schema does (O-132).
#[test]
fn r2_9_spec_integer_fields_take_whole_floats_and_reject_null() {
    let capped = online_with(&["postflop", "raise_cap"], json!(3.0));
    let spec = SizingConventionSpec::from_json(&capped).unwrap_or_else(|err| panic!("{err}"));
    assert_eq!(spec.postflop.raise_cap, Some(3));
    let versioned = online_with(&["spec_version"], json!(1.0));
    let spec = SizingConventionSpec::from_json(&versioned).unwrap_or_else(|err| panic!("{err}"));
    assert_eq!((spec.spec_version, spec.version()), (Some(SPEC_VERSION), SPEC_VERSION));
    let rejected = [
        online_with(&["postflop", "raise_cap"], json!(3.5)),
        online_with(&["postflop", "raise_cap"], json!(256.0)),
        online_with(&["postflop", "raise_cap"], json!(-1)),
        online_with(&["postflop", "raise_cap"], Value::Null),
        online_with(&["spec_version"], json!(1.5)),
        online_with(&["spec_version"], Value::Null),
    ];
    for text in rejected {
        let result = SizingConventionSpec::from_json(&text);
        assert!(matches!(result, Err(TreeError::Spec(_))), "{text}: {result:?}");
    }
}

/// The JSON files of one examples directory, sorted, with at least one present.
fn examples(kind: &str) -> Vec<(PathBuf, String)> {
    let dir = repo_path(EXAMPLES_RELATIVE_PATH).join(kind);
    let entries = fs::read_dir(&dir).unwrap_or_else(|err| panic!("{}: {err}", dir.display()));
    let mut files: Vec<PathBuf> = entries
        .map(|entry| entry.expect("a directory entry").path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "json"))
        .collect();
    files.sort();
    assert!(!files.is_empty(), "{} holds no examples", dir.display());
    files.into_iter().map(|path| (path.clone(), read(&path))).collect()
}

/// R2.9: the contracts package's valid examples parse and build a tree configuration, and
/// each invalid example is rejected by the parse or by the configuration (O-76).
#[test]
fn r2_9_shared_examples_agree_with_schema() {
    for (path, text) in examples("valid") {
        let built = SizingConventionSpec::from_json(&text).and_then(|s| TreeConfig::from_spec(&s));
        assert!(built.is_ok(), "{}: {built:?}", path.display());
    }
    for (path, text) in examples("invalid") {
        let built = SizingConventionSpec::from_json(&text).and_then(|s| TreeConfig::from_spec(&s));
        assert!(built.is_err(), "{} was accepted", path.display());
    }
}

/// R1.6: the reference rows S11 holds locally build too (O-75). `SIZING_SPECS_FILE` names a
/// JSON array of objects `{"config_id": "cfg_6_online_100", "spec": {...}}`.
#[test]
#[ignore = "R1.6: set SIZING_SPECS_FILE; S11 runs it on reference rows"]
fn r1_6_reference_rows_build() {
    let file = std::env::var(REFERENCE_ROWS_VAR)
        .unwrap_or_else(|_| panic!("set {REFERENCE_ROWS_VAR} to the reference rows file"));
    let rows: Vec<Value> = serde_json::from_str(&read(Path::new(&file))).expect("a JSON array");
    assert!(!rows.is_empty(), "{file} holds no rows");
    let configs = v1_configs();
    for row in rows {
        let id = row["config_id"].as_str().expect("a config_id string");
        let config = configs.iter().find(|c| c.config_id().as_str() == id).expect("a v1 config");
        let spec = SizingConventionSpec::from_json(&row["spec"].to_string())
            .unwrap_or_else(|err| panic!("{id}: {err}"));
        build_everything(&spec, config).unwrap_or_else(|err| panic!("{id}: {err}"));
    }
}
