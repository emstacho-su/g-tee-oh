//! Smoke test for the `validate` binary (R0.1): the workspace builds it and it runs.

use std::process::Command;

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
