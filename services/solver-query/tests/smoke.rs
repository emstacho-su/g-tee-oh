//! Smoke test for the `solver-query` binary (R0.1): the workspace builds it and it runs.
//! Since S06 the binary is a server, so the probe calls the `version` subcommand, which
//! prints the one line the S01 stub printed and exits.

use std::process::Command;

#[test]
fn r0_1_solver_query_runs() {
    let output = Command::new(env!("CARGO_BIN_EXE_solver-query"))
        .arg("version")
        .output()
        .expect("the solver-query binary built by cargo should start");
    assert!(output.status.success(), "exit status was {:?}", output.status);

    let stdout = String::from_utf8_lossy(&output.stdout);
    let expected = format!("{} {}", env!("CARGO_PKG_NAME"), env!("CARGO_PKG_VERSION"));
    assert!(stdout.starts_with(&expected), "stdout was: {stdout}");
    assert_eq!(stdout.lines().count(), 1, "one line expected, stdout was: {stdout}");
}

#[test]
fn r0_7_unknown_subcommand_prints_usage_and_exits_2() {
    let output = Command::new(env!("CARGO_BIN_EXE_solver-query"))
        .arg("no-such-subcommand")
        .output()
        .expect("the solver-query binary built by cargo should start");
    assert_eq!(output.status.code(), Some(2), "exit status was {:?}", output.status);

    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(stderr.contains("usage:"), "stderr was: {stderr}");
    assert!(stderr.contains("no-such-subcommand"), "stderr names the bad argument: {stderr}");
    assert!(output.stdout.is_empty(), "nothing on stdout, got: {:?}", output.stdout);
}
