//! The command line of the `validate` binary, parsed by hand (no argument-parsing
//! crate): the first token is the command, the rest are `--flag value` pairs and the bare
//! `--allow-dirty`, each given at most once. Commands: `g1`, `g2`, `g3` and `gates` (the
//! toy-game gates, R2.4 to R2.6), `equity-table` (R2.20) and `g4` (the oracle gate,
//! R2.11), whose own options `--spots`, `--oracle`, `--engine` and `--write-engine` are
//! refused on any other command. A missing `--oracle` on `g4`, and `--write-engine`
//! beside `--engine` (nothing is solved, so there is no engine dump to write), are usage
//! errors naming the option. `main.rs` dispatches on the result.

use std::path::PathBuf;

use crate::gates::Gate;

/// The one option that takes no value.
pub const ALLOW_DIRTY: &str = "--allow-dirty";

/// The usage text `help` prints and every usage error repeats.
pub const USAGE: &str = "\
usage: validate [COMMAND] [--out DIR|FILE] [--machine NAME] [--commit SHA] [--allow-dirty]
       validate g4 --oracle PATH [--spots PATH] [--engine PATH] [--write-engine PATH] ...

commands
  g1 | g2 | g3   run one toy-game gate and write its JSON and Markdown report
  gates          run G1, G2 and G3 (--out is the report directory)
  g4             compare the engine against an oracle dump over the G4 spot list (R2.11)
  equity-table   write the 169 by 169 preflop equity fixture (--out is the file)
  help           print this text

options
  --out          the report directory (default validation/reports, or target/gate-reports/g4
                 for g4) or the fixture file (default validation/fixtures/equity/preflop-169.json)
  --machine      the machine name recorded in the report (default $VALIDATE_MACHINE,
                 else the host name lowercased with other characters turned into dashes)
  --commit       the commit recorded in the report (default git rev-parse HEAD)
  --allow-dirty  run on a working tree with changes; the reports' notes then say so

g4 options
  --spots        the spot list (default validation/fixtures/g4-spots.json)
  --oracle       the oracle node dump to compare against (required)
  --engine       a committed engine node dump to compare instead of solving
  --write-engine where to write the engine dump this run solves (not with --engine)

With no command the tool prints its name and version. A dirty working tree is refused
unless --allow-dirty is given. Exit 1 when a gate failed, 2 on an error.";

/// The flags that take a value, shared by every command.
const OUT: &str = "--out";
const MACHINE: &str = "--machine";
const COMMIT: &str = "--commit";
/// The flags that take a value, `g4` only.
const SPOTS: &str = "--spots";
const ORACLE: &str = "--oracle";
const ENGINE: &str = "--engine";
const WRITE_ENGINE: &str = "--write-engine";
/// The `g4` command name, for its usage errors.
const G4: &str = "g4";

/// What the command line asked for.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Command {
    /// No argument: the name and version line.
    Version,
    /// The usage text.
    Help,
    /// One or all three toy-game gates.
    Gates(Vec<Gate>),
    /// The equity table fixture.
    EquityTable,
    /// The oracle gate.
    G4(G4Options),
}

/// The shared options: three `--flag value` pairs and the bare `--allow-dirty`.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Options {
    /// `--out`.
    pub out: Option<PathBuf>,
    /// `--machine`.
    pub machine: Option<String>,
    /// `--commit`.
    pub commit: Option<String>,
    /// `--allow-dirty`.
    pub allow_dirty: bool,
}

/// The options of `g4`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct G4Options {
    /// `--spots`, else the committed list.
    pub spots: Option<PathBuf>,
    /// `--oracle`, required.
    pub oracle: PathBuf,
    /// `--engine`: compare this dump instead of solving.
    pub engine: Option<PathBuf>,
    /// `--write-engine`: where the solved engine dump goes.
    pub write_engine: Option<PathBuf>,
}

/// A parsed command line.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Invocation {
    /// The command.
    pub command: Command,
    /// The shared options.
    pub options: Options,
}

/// Every flag with a value, before the command decides which it accepts.
#[derive(Debug, Default)]
struct Raw {
    options: Options,
    spots: Option<PathBuf>,
    oracle: Option<PathBuf>,
    engine: Option<PathBuf>,
    write_engine: Option<PathBuf>,
}

/// Parse the arguments after the program name.
///
/// # Errors
///
/// A usage message naming the offending token: an unknown command or option, a missing,
/// empty or repeated value, a `g4` option on another command, a `g4` without `--oracle`,
/// or `--write-engine` beside `--engine`.
pub fn parse(args: &[String]) -> Result<Invocation, String> {
    let Some((first, rest)) = args.split_first() else {
        return Ok(Invocation { command: Command::Version, options: Options::default() });
    };
    let raw = parse_raw(rest, Raw::default())?;
    let command = match first.as_str() {
        "gates" => Command::Gates(Gate::ALL.to_vec()),
        "equity-table" => Command::EquityTable,
        "help" | "--help" | "-h" => Command::Help,
        G4 => Command::G4(g4_options(&raw)?),
        name => match Gate::from_name(name) {
            Some(gate) => Command::Gates(vec![gate]),
            None => return Err(format!("unknown command {name:?}")),
        },
    };
    if !matches!(command, Command::G4(_)) {
        refuse_g4_flags(&raw)?;
    }
    Ok(Invocation { command, options: raw.options })
}

/// The `g4` options from the raw flags.
fn g4_options(raw: &Raw) -> Result<G4Options, String> {
    let oracle = raw.oracle.clone().ok_or_else(|| format!("{G4} needs {ORACLE} PATH"))?;
    if raw.engine.is_some() && raw.write_engine.is_some() {
        return Err(format!("{WRITE_ENGINE} needs a solve; drop {ENGINE}"));
    }
    Ok(G4Options {
        spots: raw.spots.clone(),
        oracle,
        engine: raw.engine.clone(),
        write_engine: raw.write_engine.clone(),
    })
}

/// A `g4` option on another command is a usage error naming it.
fn refuse_g4_flags(raw: &Raw) -> Result<(), String> {
    let given = [
        (SPOTS, raw.spots.is_some()),
        (ORACLE, raw.oracle.is_some()),
        (ENGINE, raw.engine.is_some()),
        (WRITE_ENGINE, raw.write_engine.is_some()),
    ];
    match given.into_iter().find(|(_, is_given)| *is_given) {
        Some((flag, _)) => Err(format!("{flag} is an option of {G4} only")),
        None => Ok(()),
    }
}

/// Read the options after the command into `raw`, one token or pair at a time.
fn parse_raw(args: &[String], raw: Raw) -> Result<Raw, String> {
    match args {
        [] => Ok(raw),
        [flag, rest @ ..] if flag == ALLOW_DIRTY => {
            if raw.options.allow_dirty {
                return Err(format!("{flag} given twice"));
            }
            let options = Options { allow_dirty: true, ..raw.options };
            parse_raw(rest, Raw { options, ..raw })
        }
        [flag, value, rest @ ..] => parse_raw(rest, with_value(raw, flag, value)?),
        [flag] => Err(format!("expected a value after {flag:?}")),
    }
}

/// `raw` with `flag` set to `value`, or the usage error naming the flag.
fn with_value(raw: Raw, flag: &str, value: &str) -> Result<Raw, String> {
    if value.is_empty() || value.starts_with("--") {
        return Err(format!("{flag} needs a value, got {value:?}"));
    }
    let path = PathBuf::from(value);
    let text = value.to_owned();
    match flag {
        OUT => Ok(Raw {
            options: Options {
                out: set_once(raw.options.out.as_ref(), path, flag)?,
                ..raw.options
            },
            ..raw
        }),
        MACHINE => {
            let machine = set_once(raw.options.machine.as_ref(), text, flag)?;
            Ok(Raw { options: Options { machine, ..raw.options }, ..raw })
        }
        COMMIT => {
            let commit = set_once(raw.options.commit.as_ref(), text, flag)?;
            Ok(Raw { options: Options { commit, ..raw.options }, ..raw })
        }
        SPOTS => Ok(Raw { spots: set_once(raw.spots.as_ref(), path, flag)?, ..raw }),
        ORACLE => Ok(Raw { oracle: set_once(raw.oracle.as_ref(), path, flag)?, ..raw }),
        ENGINE => Ok(Raw { engine: set_once(raw.engine.as_ref(), path, flag)?, ..raw }),
        WRITE_ENGINE => {
            Ok(Raw { write_engine: set_once(raw.write_engine.as_ref(), path, flag)?, ..raw })
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

#[cfg(test)]
mod tests {
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
}
