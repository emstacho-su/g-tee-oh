//! R2.8 command line: exit code 0 on success, 1 on a rejected dump (one sentence per
//! violation on standard error), 2 on a usage or input/output error.
//!
//! Lane P (pack) owns this file.

use std::fs;
use std::process::{Command, Output};

const EXAMPLE_DUMP: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../packages/contracts/schemas/examples/node-dump.json"
);

fn run(args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_library-pack"))
        .args(args)
        .output()
        .expect("the library-pack binary built by cargo should start")
}

fn code(output: &Output) -> Option<i32> {
    output.status.code()
}

#[test]
fn r2_8_cli_exit_codes_0_1_2() {
    let scratch = tempfile::tempdir().expect("a scratch directory");
    assert_eq!(code(&run(&["check", "--dump", EXAMPLE_DUMP])), Some(0), "a valid dump checks");

    let example = fs::read_to_string(EXAMPLE_DUMP).expect("the example exists");
    let bad = example.replace("[0.85, 0.05, 0.1]", "[0.85, 0.05, 0.2]");
    assert_ne!(bad, example, "the edit applies");
    let bad_path = scratch.path().join("bad.json");
    fs::write(&bad_path, bad).expect("write");
    let rejected = run(&[
        "check",
        "--dump",
        bad_path.to_str().expect("a path in UTF-8 (Unicode Transformation Format, 8-bit)"),
    ]);
    assert_eq!(code(&rejected), Some(1), "a rejected dump exits 1");
    let stderr = String::from_utf8_lossy(&rejected.stderr);
    assert!(stderr.contains("72o"), "the sentence names the hand: {stderr}");

    assert_eq!(code(&run(&["check"])), Some(2), "a missing --dump is a usage error");
    let missing = scratch.path().join("missing.json");
    assert_eq!(code(&run(&["check", "--dump", missing.to_str().expect("UTF-8")])), Some(2));
    assert_eq!(code(&run(&["no-such-command"])), Some(2));

    let out = scratch.path().join("library");
    fs::create_dir(&out).expect("mkdir");
    let packed = run(&[
        "pack",
        "--dump",
        EXAMPLE_DUMP,
        "--out",
        out.to_str().expect("UTF-8"),
        "--engine-version",
        "0.1.0",
        "--seed",
        "1",
        "--iterations",
        "100",
    ]);
    assert_eq!(code(&packed), Some(0), "stderr: {}", String::from_utf8_lossy(&packed.stderr));
    assert!(out.join("preflop").join("cfg_6_online_100").is_dir(), "the solution was written");
}

/// The synthetic subcommand (R2.13, O-149): one seed writes one file, `pack` accepts it
/// with `--synthetic`, and `verify` reads the packed library back within tolerance.
#[test]
fn r2_13_synthetic_dump_packs_and_reads_back() {
    let scratch = tempfile::tempdir().expect("a scratch directory");
    let dump = scratch.path().join("fixtures").join("synthetic-dump.json");
    let dump_text = dump.to_str().expect("UTF-8");
    let written = run(&["synthetic", "--seed", "7", "--nodes", "8", "--out", dump_text]);
    assert_eq!(code(&written), Some(0), "stderr: {}", String::from_utf8_lossy(&written.stderr));
    let stdout = String::from_utf8_lossy(&written.stdout);
    assert!(stdout.contains("wrote 8 synthetic preflop nodes"), "stdout was {stdout}");
    let first = fs::read(&dump).expect("the dump was written");
    assert!(first.ends_with(b"\n"), "one trailing newline");
    assert_eq!(
        code(&run(&["synthetic", "--seed", "7", "--nodes", "8", "--out", dump_text])),
        Some(0)
    );
    assert_eq!(fs::read(&dump).expect("rewritten"), first, "one seed, one file");

    let bad = run(&[
        "synthetic",
        "--seed",
        "7",
        "--nodes",
        "8",
        "--out",
        dump_text,
        "--exported-at",
        "x",
    ]);
    assert_eq!(code(&bad), Some(1), "a malformed timestamp is a rejection");

    let out = scratch.path().join("library");
    let out_text = out.to_str().expect("UTF-8");
    let packed = run(&["pack", "--dump", dump_text, "--out", out_text, "--synthetic"]);
    assert_eq!(code(&packed), Some(0), "stderr: {}", String::from_utf8_lossy(&packed.stderr));
    let stdout = String::from_utf8_lossy(&packed.stdout);
    let prefix = stdout.trim().rsplit(" as ").next().expect("the pack line names the prefix");
    assert!(prefix.starts_with("preflop/"), "stdout was {stdout}");
    let manifest = fs::read_to_string(out.join(prefix).join("manifest.json")).expect("a manifest");
    assert!(manifest.contains("\"synthetic\": true"), "the library is marked synthetic (O-57)");

    let verified = run(&["verify", "--library", out_text, "--prefix", prefix, "--dump", dump_text]);
    assert_eq!(code(&verified), Some(0), "stderr: {}", String::from_utf8_lossy(&verified.stderr));
}
