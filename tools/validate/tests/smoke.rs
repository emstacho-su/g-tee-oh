//! Smoke tests for the `validate` binary: the workspace builds it and it runs (R0.1), and
//! `g4` compares the committed tiny pair end to end (R2.11).

use std::path::{Path, PathBuf};
use std::process::Command;

/// The committed tiny pair, relative to the fixture root.
const TINY_DIR: &str = "../../validation/fixtures/g4";
/// The report id `g4` writes (O-170).
const G4_REPORT: &str = "g4-oracle";

fn tiny(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join(TINY_DIR).join(name)
}

/// R2.11: `validate g4 --spots --engine --oracle --out --allow-dirty` on the committed
/// tiny pair exits 0 and leaves both report files; on the failing twin it exits 1 with
/// both files still written (the write-first rule of `main.rs`).
#[test]
fn r2_11_validate_g4_writes_both_files_and_exits_on_the_verdict() {
    for (oracle, code) in [("oracle-tiny.json", 0), ("oracle-tiny-failing.json", 1)] {
        let out = Path::new(env!("CARGO_TARGET_TMPDIR")).join(format!("g4-smoke-{code}"));
        let _ = std::fs::remove_dir_all(&out);
        let output = Command::new(env!("CARGO_BIN_EXE_validate"))
            .arg("g4")
            .args(["--spots".as_ref(), tiny("tiny-spots.json").as_os_str()])
            .args(["--engine".as_ref(), tiny("engine-tiny.json").as_os_str()])
            .args(["--oracle".as_ref(), tiny(oracle).as_os_str()])
            .args(["--out".as_ref(), out.as_os_str()])
            .args(["--machine", "test-machine", "--allow-dirty"])
            .output()
            .expect("the validate binary built by cargo should start");
        let stderr = String::from_utf8_lossy(&output.stderr);
        assert_eq!(output.status.code(), Some(code), "{oracle}: {stderr}");
        assert!(out.join(format!("{G4_REPORT}.json")).is_file(), "{oracle}: no JSON report");
        assert!(out.join(format!("{G4_REPORT}.md")).is_file(), "{oracle}: no Markdown twin");
        let stdout = String::from_utf8_lossy(&output.stdout);
        let verdict = if code == 0 { "pass" } else { "FAIL" };
        assert!(stdout.contains(verdict), "{oracle}: {stdout}");
    }
}

#[test]
fn r0_1_validate_runs() {
    let output = Command::new(env!("CARGO_BIN_EXE_validate"))
        .output()
        .expect("the validate binary built by cargo should start");
    assert!(output.status.success(), "exit status was {:?}", output.status);

    let stdout = String::from_utf8_lossy(&output.stdout);
    let expected = format!("{} {}", env!("CARGO_PKG_NAME"), env!("CARGO_PKG_VERSION"));
    assert!(stdout.starts_with(&expected), "stdout was: {stdout}");
    assert_eq!(stdout.lines().count(), 1, "one line expected, stdout was: {stdout}");
}
