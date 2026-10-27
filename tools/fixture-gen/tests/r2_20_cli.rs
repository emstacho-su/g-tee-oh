//! R2.20 command line tests of the `fixture-gen` binary (O-225). R2.20 is a requirement
//! identifier (R ID).
//!
//! Mechanism: each test runs the built binary with a one-pair sets file and an explicit
//! `--out` into a temporary directory, so no case, even a regression, can write into the
//! committed library. A usage error exits 2 with a usage line, `--help` exits 0, and the
//! removal of leftover synthetic solutions runs with an explicit `--out` only under
//! `--prune`.

use std::path::{Path, PathBuf};
use std::process::{Command, Output};

/// The usage error and generator error exit code.
const EXIT_USAGE: i32 = 2;

/// The configuration the one-pair sets file generates.
const CONFIG_ID: &str = "cfg_6_online_100";

/// A one-set, one-pair sets file with its own seed.
const TINY_SETS: &str = r#"{
  "schema_version": 1,
  "sets": [
    {
      "name": "cli-test",
      "seed": 7,
      "config_ids": ["cfg_6_online_100"],
      "pairs": ["BB-BTN"],
      "created_at": "2026-10-27T00:00:00Z"
    }
  ]
}"#;

/// A temporary directory holding the sets file and an output root.
struct Scratch {
    dir: tempfile::TempDir,
}

impl Scratch {
    fn new() -> Scratch {
        let dir = tempfile::tempdir().expect("a directory");
        std::fs::write(dir.path().join("sets.json"), TINY_SETS).expect("a sets file");
        Scratch { dir }
    }

    fn sets(&self) -> PathBuf {
        self.dir.path().join("sets.json")
    }

    fn out(&self) -> PathBuf {
        self.dir.path().join("out")
    }

    /// Plants a leftover synthetic solution under the configuration's directory.
    fn leftover(&self) -> PathBuf {
        let dir = self.out().join("preflop").join(CONFIG_ID).join("zz-leftover");
        std::fs::create_dir_all(&dir).expect("a directory");
        std::fs::write(dir.join("manifest.json"), "{\"synthetic\": true}").expect("a manifest");
        dir
    }
}

fn run(args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_fixture-gen")).args(args).output().expect("the binary runs")
}

fn text(path: &Path) -> &str {
    path.to_str().expect("a UTF-8 path")
}

fn assert_usage_error(output: &Output, case: &str) {
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert_eq!(output.status.code(), Some(EXIT_USAGE), "{case}: {stderr}");
    assert!(stderr.contains("usage: fixture-gen"), "{case} prints the usage line: {stderr}");
}

#[test]
fn r2_20_cli_refuses_an_unknown_flag() {
    let scratch = Scratch::new();
    let output = run(&["--sets", text(&scratch.sets()), "--out", text(&scratch.out()), "--bogus"]);
    assert_usage_error(&output, "--bogus");
    assert!(!scratch.out().exists(), "nothing is generated");
}

#[test]
fn r2_20_cli_refuses_a_flag_given_twice() {
    let scratch = Scratch::new();
    let out = text(&scratch.out()).to_owned();
    let output = run(&["--sets", text(&scratch.sets()), "--out", &out, "--out", &out]);
    assert_usage_error(&output, "--out twice");
}

#[test]
fn r2_20_cli_refuses_the_equals_form() {
    let scratch = Scratch::new();
    let out = text(&scratch.out()).to_owned();
    let equals = format!("--out={out}");
    let output = run(&["--sets", text(&scratch.sets()), "--out", &out, &equals]);
    assert_usage_error(&output, "--out=DIR");
}

#[test]
fn r2_20_cli_help_prints_the_usage_and_exits_zero() {
    let scratch = Scratch::new();
    let output = run(&["--sets", text(&scratch.sets()), "--out", text(&scratch.out()), "--help"]);
    assert_eq!(output.status.code(), Some(0));
    assert!(String::from_utf8_lossy(&output.stdout).contains("usage: fixture-gen"));
    assert!(!scratch.out().exists(), "help generates nothing");
}

#[test]
fn r2_20_cli_explicit_out_keeps_leftovers_unless_pruned() {
    let scratch = Scratch::new();
    let leftover = scratch.leftover();
    let (sets, out) = (text(&scratch.sets()).to_owned(), text(&scratch.out()).to_owned());
    let kept = run(&["--sets", &sets, "--out", &out]);
    assert_eq!(kept.status.code(), Some(0), "{}", String::from_utf8_lossy(&kept.stderr));
    assert!(leftover.is_dir(), "an explicit --out without --prune deletes nothing");
    let pruned = run(&["--sets", &sets, "--out", &out, "--prune"]);
    assert_eq!(pruned.status.code(), Some(0), "{}", String::from_utf8_lossy(&pruned.stderr));
    assert!(!leftover.exists(), "--prune removes the leftover synthetic solution");
}
