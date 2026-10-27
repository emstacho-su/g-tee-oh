//! Smoke test for the `library-builder` binary (R0.1): the workspace builds it and
//! `--version` prints the S01 line and exits. With no argument the binary now runs the
//! claim loop (O-189), so the smoke test asks for the version.

use std::process::Command;

#[test]
fn r0_1_library_builder_runs() {
    let output = Command::new(env!("CARGO_BIN_EXE_library-builder"))
        .arg("--version")
        .output()
        .expect("the library-builder binary built by cargo should start");
    assert!(output.status.success(), "exit status was {:?}", output.status);

    let stdout = String::from_utf8_lossy(&output.stdout);
    let expected = format!("{} {}", env!("CARGO_PKG_NAME"), env!("CARGO_PKG_VERSION"));
    assert!(stdout.starts_with(&expected), "stdout was: {stdout}");
    assert_eq!(stdout.lines().count(), 1, "one line expected, stdout was: {stdout}");
}

#[test]
fn r2_18_an_unknown_subcommand_exits_with_usage() {
    let output = Command::new(env!("CARGO_BIN_EXE_library-builder"))
        .arg("bogus")
        .output()
        .expect("the binary starts");
    assert_eq!(output.status.code(), Some(2));
    assert!(String::from_utf8_lossy(&output.stderr).contains("usage: library-builder"));
}
