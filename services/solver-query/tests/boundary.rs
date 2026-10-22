//! The dependency boundary of solver-query (R2.15, ADR 0018, A1 section 2, plan D.5):
//! the manifest declares no edge to a solver, and the crate's `LINKS` names exactly the
//! workspace crates it links, gto-library and gto-model. The compile-time proof stays
//! `just rust-boundary` (cargo tree, O-101); this test reads the manifest text so a
//! forbidden edge fails the test suite as well as the script.

use std::fs;
use std::path::Path;

/// The workspace crates the manifest lists and `LINKS` names, in the banner's order.
/// Third-party crates (sqlx, lru, sha2) are not workspace links.
const WORKSPACE_LINKS: [&str; 2] = ["gto-library", "gto-model"];
/// Crates the manifest must never list (the solver, the vendored engine, the builder).
const FORBIDDEN: [&str; 4] = ["gto-solve", "engine", "postflop-engine", "library-builder"];
/// The sections whose keys are dependency names.
const DEPENDENCY_SECTIONS: [&str; 3] =
    ["[dependencies]", "[dev-dependencies]", "[build-dependencies]"];

/// The keys of one `[section]` of a TOML text: the lines after the header up to the next
/// header, blank lines and comments skipped, each key the text before `=`.
fn section_keys(toml: &str, header: &str) -> Vec<String> {
    toml.lines()
        .map(str::trim)
        .skip_while(|line| *line != header)
        .skip(1)
        .take_while(|line| !line.starts_with('['))
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .filter_map(|line| line.split_once('=').map(|(key, _)| key.trim().to_owned()))
        .collect()
}

#[test]
fn r2_15_solver_query_manifest_declares_no_solver_edge() {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("Cargo.toml");
    let manifest = fs::read_to_string(&path).expect("the manifest reads");

    let dependencies = section_keys(&manifest, "[dependencies]");
    for link in WORKSPACE_LINKS {
        assert!(dependencies.contains(&link.to_owned()), "{link} missing: {dependencies:?}");
    }
    for section in DEPENDENCY_SECTIONS {
        let keys = section_keys(&manifest, section);
        for forbidden in FORBIDDEN {
            assert!(!keys.contains(&forbidden.to_owned()), "{section} lists {forbidden}: {keys:?}");
        }
    }
    assert_eq!(solver_query::LINKS, &WORKSPACE_LINKS, "LINKS names the workspace crates");
    for forbidden in FORBIDDEN {
        assert!(!solver_query::LINKS.contains(&forbidden), "LINKS names {forbidden}");
    }
}

#[test]
fn r2_15_section_keys_reads_one_section_only() {
    let toml = concat!(
        "[package]\nname = \"x\"\n\n",
        "[dependencies]\n# a comment\ngto-library = { workspace = true }\nserde = \"1\"\n\n",
        "[dev-dependencies]\ntempfile = \"3\"\n",
    );
    assert_eq!(section_keys(toml, "[dependencies]"), vec!["gto-library", "serde"]);
    assert_eq!(section_keys(toml, "[dev-dependencies]"), vec!["tempfile"]);
    assert_eq!(section_keys(toml, "[build-dependencies]"), Vec::<String>::new());
}
