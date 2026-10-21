//! `validate`: the operator tool that runs the public validation gates and writes their
//! reports (A2 section 6). Subcommands: `g1`, `g2` and `g3` run one toy-game gate
//! (R2.4, R2.5, R2.6), `gates` runs all three, `equity-table` writes the 169 by 169
//! preflop equity fixture (R2.20). Options: `--out DIR|FILE` (the report directory, or
//! the fixture file for `equity-table`), `--machine NAME` (default `VALIDATE_MACHINE`,
//! else the host name mapped onto the schema's name pattern), `--commit SHA` (default
//! `git rev-parse HEAD`) and `--allow-dirty`. With no argument the tool prints its name
//! and version, which `tests/smoke.rs` checks. The S29 `recompute` subcommand (O-60)
//! lands later.
//!
//! Mechanism. The command line is parsed by hand (no argument-parsing crate): the first
//! token is the command, the rest are `--flag value` pairs and the bare `--allow-dirty`,
//! each given at most once. Both writing commands resolve the commit through
//! `machine::resolve_commit`, which first runs `git status --porcelain`: a dirty working
//! tree is refused, naming the first dirty path, unless `--allow-dirty` is given, and
//! then every gate report's notes end with the line "working tree dirty at run time"
//! (the equity fixture has no notes field, so `equity-table` prints that line to
//! standard error instead). The gate commands build the run context (machine block,
//! commit, date, toolchain), then `validate::gates::write_gate_reports` runs every gate
//! and writes both report files per gate before the verdict is read, so a failed gate
//! still leaves its report. Exit codes: 0 when every gate passed, 1 when any gate
//! failed, 2 on a usage error, a refused dirty tree, or when a fixture, a probe or a
//! report write failed.

#![forbid(unsafe_code)]

use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::time::SystemTime;

use validate::gates::{self, Gate};
use validate::machine::{self, MACHINE_ENV, ResolvedCommit};
use validate::report::{self, Context, DIRTY_TREE_NOTE, REPORTS_RELATIVE_TO_REPO_ROOT};

/// The binary's package name.
const BIN_NAME: &str = env!("CARGO_PKG_NAME");

/// The binary's package version.
const VERSION: &str = env!("CARGO_PKG_VERSION");

/// Internal crates this binary links (A1 section 2), named so the edges are exercised.
const LINKS: &[&str] = &[gto_library::CRATE_NAME, gto_solve::CRATE_NAME];

/// A gate failed its rule after every report was written.
const EXIT_GATE_FAILED: u8 = 1;

/// A usage error, a refused dirty tree, or a fixture, probe or write failure.
const EXIT_ERROR: u8 = 2;

/// The one option that takes no value.
const ALLOW_DIRTY: &str = "--allow-dirty";

const USAGE: &str = "\
usage: validate [COMMAND] [--out DIR|FILE] [--machine NAME] [--commit SHA] [--allow-dirty]

commands
  g1 | g2 | g3   run one toy-game gate and write its JSON and Markdown report
  gates          run G1, G2 and G3 (--out is the report directory)
  equity-table   write the 169 by 169 preflop equity fixture (--out is the file)
  help           print this text

options
  --out          the report directory (default validation/reports) or the fixture file
                 (default validation/fixtures/equity/preflop-169.json)
  --machine      the machine name recorded in the report (default $VALIDATE_MACHINE,
                 else the host name lowercased with other characters turned into dashes)
  --commit       the commit recorded in the report (default git rev-parse HEAD)
  --allow-dirty  run on a working tree with changes; the reports' notes then say so

With no command the tool prints its name and version. A dirty working tree is refused
unless --allow-dirty is given. Exit 1 when a gate failed, 2 on an error.";

/// What the command line asked for.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Command {
    /// No argument: the name and version line.
    Version,
    /// The usage text.
    Help,
    /// One or all three gates.
    Gates(Vec<Gate>),
    /// The equity table fixture.
    EquityTable,
}

/// The options: three `--flag value` pairs and the bare `--allow-dirty`.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
struct Options {
    out: Option<PathBuf>,
    machine: Option<String>,
    commit: Option<String>,
    allow_dirty: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Invocation {
    command: Command,
    options: Options,
}

fn parse(args: &[String]) -> Result<Invocation, String> {
    let Some((first, rest)) = args.split_first() else {
        return Ok(Invocation { command: Command::Version, options: Options::default() });
    };
    let command = match first.as_str() {
        "gates" => Command::Gates(Gate::ALL.to_vec()),
        "equity-table" => Command::EquityTable,
        "help" | "--help" | "-h" => Command::Help,
        name => match Gate::from_name(name) {
            Some(gate) => Command::Gates(vec![gate]),
            None => return Err(format!("unknown command {name:?}")),
        },
    };
    Ok(Invocation { command, options: parse_options(rest, Options::default())? })
}

/// Read the options after the command into `options`, one token or pair at a time.
fn parse_options(args: &[String], options: Options) -> Result<Options, String> {
    match args {
        [] => Ok(options),
        [flag, rest @ ..] if flag == ALLOW_DIRTY => {
            if options.allow_dirty {
                return Err(format!("{flag} given twice"));
            }
            parse_options(rest, Options { allow_dirty: true, ..options })
        }
        [flag, value, rest @ ..] => parse_options(rest, with_value(options, flag, value)?),
        [flag] => Err(format!("expected a value after {flag:?}")),
    }
}

/// `options` with `flag` set to `value`, or the usage error naming the flag.
fn with_value(options: Options, flag: &str, value: &str) -> Result<Options, String> {
    if value.is_empty() || value.starts_with("--") {
        return Err(format!("{flag} needs a value, got {value:?}"));
    }
    match flag {
        "--out" => {
            let out = set_once(options.out.as_ref(), PathBuf::from(value), flag)?;
            Ok(Options { out, ..options })
        }
        "--machine" => {
            let machine = set_once(options.machine.as_ref(), value.to_owned(), flag)?;
            Ok(Options { machine, ..options })
        }
        "--commit" => {
            let commit = set_once(options.commit.as_ref(), value.to_owned(), flag)?;
            Ok(Options { commit, ..options })
        }
        other => Err(format!("unknown option {other:?}")),
    }
}

/// `value` for a flag that has not been given yet; an error naming the flag otherwise.
fn set_once<T>(given: Option<&T>, value: T, flag: &str) -> Result<Option<T>, String> {
    match given {
        Some(_) => Err(format!("{flag} given twice")),
        None => Ok(Some(value)),
    }
}

fn main() -> ExitCode {
    let args: Result<Vec<String>, _> =
        std::env::args_os().skip(1).map(std::ffi::OsString::into_string).collect();
    let Ok(args) = args else {
        eprintln!("{BIN_NAME}: an argument is not valid Unicode");
        return ExitCode::from(EXIT_ERROR);
    };
    let invocation = match parse(&args) {
        Ok(invocation) => invocation,
        Err(message) => {
            eprintln!("{BIN_NAME}: {message}\n{USAGE}");
            return ExitCode::from(EXIT_ERROR);
        }
    };
    match invocation.command {
        Command::Version => {
            println!("{BIN_NAME} {VERSION} (links {})", LINKS.join(", "));
            ExitCode::SUCCESS
        }
        Command::Help => {
            println!("{USAGE}");
            ExitCode::SUCCESS
        }
        Command::Gates(gates) => match run_gates(&gates, &invocation.options) {
            Ok(true) => ExitCode::SUCCESS,
            Ok(false) => ExitCode::from(EXIT_GATE_FAILED),
            Err(message) => fail(&message),
        },
        Command::EquityTable => match run_equity_table(&invocation.options) {
            Ok(()) => ExitCode::SUCCESS,
            Err(message) => fail(&message),
        },
    }
}

/// Print `message` under the binary's name and hand back the error exit code.
fn fail(message: &str) -> ExitCode {
    eprintln!("{BIN_NAME}: {message}");
    ExitCode::from(EXIT_ERROR)
}

/// Run `gates`, write their reports, print one line per gate, and say whether all passed.
fn run_gates(gates: &[Gate], options: &Options) -> Result<bool, String> {
    let repo_root = validate::repo_root();
    let context = run_context(&repo_root, options)?;
    let out_dir =
        options.out.clone().unwrap_or_else(|| repo_root.join(REPORTS_RELATIVE_TO_REPO_ROOT));
    let written =
        gates::write_gate_reports(gates, &gates::fixtures_dir(&repo_root), &context, &out_dir)
            .map_err(|error| error.to_string())?;
    for report in &written {
        let verdict = if report.pass { "pass" } else { "FAIL" };
        println!(
            "{BIN_NAME}: {} {verdict} ({}, {})",
            report.gate.report_id(),
            report.json.display(),
            report.markdown.display()
        );
    }
    Ok(written.iter().all(|report| report.pass))
}

/// The commit for this run through the one resolution path, `machine::resolve_commit`
/// (the dirty-tree check included), with a warning on standard error when a dirty tree
/// was allowed.
fn resolve_commit(repo_root: &Path, options: &Options) -> Result<ResolvedCommit, String> {
    let resolved =
        machine::resolve_commit(repo_root, options.commit.as_deref(), options.allow_dirty)
            .map_err(|error| error.to_string())?;
    if resolved.tree_dirty {
        eprintln!("{BIN_NAME}: {DIRTY_TREE_NOTE} ({ALLOW_DIRTY})");
    }
    Ok(resolved)
}

/// The machine block, the commit, the date and the toolchain for this run.
fn run_context(repo_root: &Path, options: &Options) -> Result<Context, String> {
    let env = std::env::var(MACHINE_ENV).ok();
    let name =
        machine::machine_name(options.machine.as_deref(), env.as_deref(), machine::host_name)
            .map_err(|error| error.to_string())?;
    let machine = machine::detect(&name).map_err(|error| error.to_string())?;
    let ResolvedCommit { commit, tree_dirty } = resolve_commit(repo_root, options)?;
    let toolchain = machine::rustc_version().to_owned();
    let date = report::iso_8601_utc(SystemTime::now()).map_err(|error| error.to_string())?;
    Ok(Context { machine, commit, date, toolchain, tree_dirty })
}

/// Build the equity table, write the fixture, read it back and check that every number
/// survived the JSON round trip exactly, then print the elapsed time and the path.
fn run_equity_table(options: &Options) -> Result<(), String> {
    use validate::equity_fixture;

    let repo_root = validate::repo_root();
    let out = options.out.clone().unwrap_or_else(|| repo_root.join(equity_fixture::DEFAULT_PATH));
    let ResolvedCommit { commit, .. } = resolve_commit(&repo_root, options)?;
    let generated_at =
        report::iso_8601_utc(SystemTime::now()).map_err(|error| error.to_string())?;
    let started = std::time::Instant::now();
    let fixture = equity_fixture::build(&generated_at, &commit);
    let elapsed = started.elapsed();
    equity_fixture::write(&fixture, &out).map_err(|error| error.to_string())?;
    let reread = equity_fixture::load(&out).map_err(|error| error.to_string())?;
    if reread != fixture {
        return Err(format!("{} does not read back to the table written", out.display()));
    }
    println!(
        "{BIN_NAME}: equity table written to {} in {:.1} s at {commit}",
        out.display(),
        elapsed.as_secs_f64()
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use validate::gates::Gate;

    use super::{Command, Invocation, Options, parse};

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
        let first = parse(&args(&["gates", "--allow-dirty", "--out", "target/gate-reports"]))
            .expect("parses");
        assert!(first.options.allow_dirty);
        assert_eq!(first.options.out, Some(PathBuf::from("target/gate-reports")));
        let last = parse(&args(&["g1", "--machine", "zenbook", "--allow-dirty"])).expect("parses");
        assert!(last.options.allow_dirty);
        assert_eq!(last.options.machine.as_deref(), Some("zenbook"));
        let middle =
            parse(&args(&["equity-table", "--out", "a", "--allow-dirty", "--commit", "c"]))
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
        rejects(&["g4"], "g4");
        rejects(&["gates", "--seed", "1"], "--seed");
        rejects(&["gates", "--out"], "--out");
        rejects(&["gates", "--out", ""], "--out");
        rejects(&["gates", "--out", "--machine"], "--out");
        rejects(&["gates", "--out", "--allow-dirty"], "--out");
        rejects(&["gates", "--out", "a", "--out", "b"], "twice");
        rejects(&["gates", "--allow-dirty", "--allow-dirty"], "--allow-dirty given twice");
        rejects(&["gates", "--allow-dirty=yes"], "--allow-dirty=yes");
    }
}
