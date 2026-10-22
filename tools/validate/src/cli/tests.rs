//! Unit tests of `cli` (R2.4 to R2.6, R2.11): the gate commands and their options, the
//! bare `--allow-dirty`, the usage errors, and the `g4` options with `--report-id`.

use std::path::PathBuf;

use crate::gates::Gate;

use super::{Command, G4Options, Invocation, Options, parse};

fn args(words: &[&str]) -> Vec<String> {
    words.iter().map(|word| (*word).to_owned()).collect()
}

/// R2.4, R2.5, R2.6 (the command line the gate reports are written through): no
/// argument is the version line, a gate name selects one gate, `gates` all three,
/// and the three options are read as pairs in any order.
#[test]
fn r2_4_r2_5_r2_6_cli_parses_gate_commands_and_options() {
    assert_eq!(
        parse(&[]),
        Ok(Invocation { command: Command::Version, options: Options::default() })
    );
    let one = parse(&args(&["g2", "--commit", "abc", "--out", "reports"])).expect("parses");
    assert_eq!(one.command, Command::Gates(vec![Gate::G2]));
    assert_eq!(one.options.out, Some(PathBuf::from("reports")));
    assert_eq!(one.options.commit.as_deref(), Some("abc"));
    assert_eq!(one.options.machine, None);
    assert!(!one.options.allow_dirty);
    let all = parse(&args(&["gates", "--machine", "github-ubuntu"])).expect("parses");
    assert_eq!(all.command, Command::Gates(Gate::ALL.to_vec()));
    assert_eq!(all.options.machine.as_deref(), Some("github-ubuntu"));
    assert_eq!(parse(&args(&["equity-table"])).map(|i| i.command), Ok(Command::EquityTable));
    assert_eq!(parse(&args(&["--help"])).map(|i| i.command), Ok(Command::Help));
}

/// R2.4, R2.5, R2.6: `--allow-dirty` takes no value and may sit anywhere among the
/// pairs, for the gates and for the equity table alike.
#[test]
fn r2_4_r2_5_r2_6_cli_reads_allow_dirty_as_a_bare_flag() {
    let first =
        parse(&args(&["gates", "--allow-dirty", "--out", "target/gate-reports"])).expect("parses");
    assert!(first.options.allow_dirty);
    assert_eq!(first.options.out, Some(PathBuf::from("target/gate-reports")));
    let last = parse(&args(&["g1", "--machine", "zenbook", "--allow-dirty"])).expect("parses");
    assert!(last.options.allow_dirty);
    assert_eq!(last.options.machine.as_deref(), Some("zenbook"));
    let middle = parse(&args(&["equity-table", "--out", "a", "--allow-dirty", "--commit", "c"]))
        .expect("parses");
    assert!(middle.options.allow_dirty);
    assert_eq!(middle.options.commit.as_deref(), Some("c"));
    assert_eq!(middle.command, Command::EquityTable);
}

/// R2.4, R2.5, R2.6: an unknown command, an unknown option, a missing or empty value
/// and a repeated option are usage errors that name the offending token.
#[test]
fn r2_4_r2_5_r2_6_cli_rejects_bad_arguments() {
    let rejects = |words: &[&str], needle: &str| {
        let error = parse(&args(words)).expect_err("rejected");
        assert!(error.contains(needle), "{error:?} does not name {needle:?}");
    };
    rejects(&["g5"], "g5");
    rejects(&["gates", "--seed", "1"], "--seed");
    rejects(&["gates", "--out"], "--out");
    rejects(&["gates", "--out", ""], "--out");
    rejects(&["gates", "--out", "--machine"], "--out");
    rejects(&["gates", "--out", "--allow-dirty"], "--out");
    rejects(&["gates", "--out", "a", "--out", "b"], "twice");
    rejects(&["gates", "--allow-dirty", "--allow-dirty"], "--allow-dirty given twice");
    rejects(&["gates", "--allow-dirty=yes"], "--allow-dirty=yes");
}

/// R2.11: `g4` is a known command that reads its four options and the four shared
/// ones in any order; a missing `--oracle` is a usage error naming it, a `g4` option
/// on another command names the option, and `--write-engine` beside `--engine` is
/// refused.
#[test]
fn r2_11_cli_parses_g4_and_its_options() {
    let words = [
        "g4",
        "--spots",
        "s.json",
        "--oracle",
        "o.json",
        "--engine",
        "e.json",
        "--out",
        "dir",
        "--machine",
        "zenbook",
        "--commit",
        "abc",
        "--allow-dirty",
    ];
    let parsed = parse(&args(&words)).expect("parses");
    let expected = G4Options {
        spots: Some(PathBuf::from("s.json")),
        oracle: PathBuf::from("o.json"),
        engine: Some(PathBuf::from("e.json")),
        write_engine: None,
        report_id: None,
    };
    assert_eq!(parsed.command, Command::G4(expected));
    assert_eq!(parsed.options.out, Some(PathBuf::from("dir")));
    assert_eq!(parsed.options.machine.as_deref(), Some("zenbook"));
    assert_eq!(parsed.options.commit.as_deref(), Some("abc"));
    assert!(parsed.options.allow_dirty);
    let solve = parse(&args(&["g4", "--oracle", "o.json", "--write-engine", "w.json"]));
    let solve = solve.expect("parses").command;
    let Command::G4(options) = solve else { panic!("not g4: {solve:?}") };
    assert_eq!(options.write_engine, Some(PathBuf::from("w.json")));
    assert_eq!((options.spots, options.engine), (None, None));

    let rejects = |words: &[&str], needle: &str| {
        let error = parse(&args(words)).expect_err("rejected");
        assert!(error.contains(needle), "{error:?} does not name {needle:?}");
    };
    rejects(&["g4"], "--oracle");
    rejects(&["g4", "--spots", "s.json"], "--oracle");
    rejects(&["gates", "--oracle", "o.json"], "--oracle");
    rejects(&["g1", "--write-engine", "w.json"], "--write-engine");
    rejects(&["g4", "--oracle", "o", "--engine", "e", "--write-engine", "w"], "--write-engine");
    rejects(&["g4", "--oracle", "o", "--oracle", "p"], "twice");
}

/// R2.11 (review finding F1): `--report-id` names the report the raked list's run
/// writes beside the gated one; it is absent by default, must match the report
/// schema's id pattern (lowercase words joined by single dashes), and is a `g4`
/// option only.
#[test]
fn r2_11_cli_reads_report_id_on_g4_only() {
    let words = ["g4", "--oracle", "o.json", "--report-id", "g4-oracle-raked"];
    let parsed = parse(&args(&words)).expect("parses").command;
    let Command::G4(options) = parsed else { panic!("not g4: {parsed:?}") };
    assert_eq!(options.report_id.as_deref(), Some("g4-oracle-raked"));
    let plain = parse(&args(&["g4", "--oracle", "o.json"])).expect("parses").command;
    let Command::G4(options) = plain else { panic!("not g4: {plain:?}") };
    assert_eq!(options.report_id, None);

    let rejects = |words: &[&str], needle: &str| {
        let error = parse(&args(words)).expect_err("rejected");
        assert!(error.contains(needle), "{error:?} does not name {needle:?}");
    };
    rejects(&["g4", "--oracle", "o", "--report-id", "G4 Oracle"], "--report-id");
    rejects(&["g4", "--oracle", "o", "--report-id", "-raked"], "--report-id");
    rejects(&["g4", "--oracle", "o", "--report-id", "g4--raked"], "--report-id");
    rejects(&["g4", "--oracle", "o", "--report-id", "a", "--report-id", "b"], "twice");
    rejects(&["gates", "--report-id", "g4-oracle"], "--report-id");
}
