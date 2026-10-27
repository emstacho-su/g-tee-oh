//! The command line of the `validate` binary, parsed by hand (no argument-parsing
//! crate): the first token is the command, the rest are `--flag value` pairs and the bare
//! `--allow-dirty`, each given at most once. Commands: `g1`, `g2`, `g3` and `gates` (the
//! toy-game gates, R2.4 to R2.6), `equity-table` (R2.20) and `g4` (the oracle gate,
//! R2.11), whose own options `--spots`, `--oracle`, `--engine`, `--write-engine` and
//! `--report-id` are refused on any other command. A missing `--oracle` on `g4`,
//! `--write-engine` beside `--engine` (nothing is solved, so there is no engine dump to
//! write), and a `--report-id` outside the report schema's id pattern are usage errors
//! naming the option. `main.rs` dispatches on the result. The unit tests live in the
//! `tests` child module.

use std::path::PathBuf;

use crate::gates::Gate;

/// The one option that takes no value.
pub const ALLOW_DIRTY: &str = "--allow-dirty";

/// The usage text `help` prints and every usage error repeats.
pub const USAGE: &str = "\
usage: validate [COMMAND] [--out DIR|FILE] [--machine NAME] [--commit SHA] [--allow-dirty]
       validate g4 --oracle PATH [--spots PATH] [--engine PATH] [--write-engine PATH]
                   [--report-id ID] ...
       validate g6a [--chart PATH] ...

commands
  g1 | g2 | g3   run one toy-game gate and write its JSON and Markdown report
  gates          run G1, G2 and G3 (--out is the report directory)
  g4             compare the engine against an oracle dump over the G4 spot list (R2.11)
  g6a            solve heads-up push/fold at 1 to 15 bb, certify it, compare it with the
                 committed library and, given a chart, with the published chart (R2.19)
  g6a-pack       solve push/fold and pack the 15 solutions under --out (default
                 validation/fixtures/library) (R2.19)
  spike-preflop  measure seconds and peak bytes of push/fold and the heads-up 100bb run
                 and write the spike report (R2.21)
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
  --report-id    the report id and file stem (default g4-oracle; g4-oracle-raked for the
                 raked list): lowercase words of letters and digits joined by dashes

g6a options
  --chart        the local chart transcription (default $G6A_CHART_PATH); without it the
                 chart comparison is skipped and the report says so (O-221)

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
const REPORT_ID: &str = "--report-id";
/// The flag that takes a value, `g6a` only.
const CHART: &str = "--chart";
/// The `g4` command name, for its usage errors.
const G4: &str = "g4";
/// The `g6a` command name, for its usage errors.
const G6A: &str = "g6a";
/// The character between the words of a report id (report.schema.json).
const ID_WORD_SEPARATOR: char = '-';

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
    /// Gate G6a, heads-up push/fold (R2.19).
    G6a(G6aOptions),
    /// Solve push/fold and pack the G6a library fixture (R2.19).
    G6aPack,
    /// The preflop spike measurement (R2.21).
    SpikePreflop,
}

/// The options of `g6a`.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct G6aOptions {
    /// `--chart`: the local chart transcription; else `$G6A_CHART_PATH`, else none (O-221).
    pub chart: Option<PathBuf>,
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
    /// `--report-id`: the report id and file stem, else the gate's default.
    pub report_id: Option<String>,
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
    report_id: Option<String>,
    chart: Option<PathBuf>,
}

/// Parse the arguments after the program name.
///
/// # Errors
///
/// A usage message naming the offending token: an unknown command or option, a missing,
/// empty or repeated value, a `g4` option on another command, a `g4` without `--oracle`,
/// `--write-engine` beside `--engine`, or a `--report-id` outside the id pattern.
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
        G6A => Command::G6a(G6aOptions { chart: raw.chart.clone() }),
        "g6a-pack" => Command::G6aPack,
        "spike-preflop" => Command::SpikePreflop,
        name => match Gate::from_name(name) {
            Some(gate) => Command::Gates(vec![gate]),
            None => return Err(format!("unknown command {name:?}")),
        },
    };
    if !matches!(command, Command::G4(_)) {
        refuse_g4_flags(&raw)?;
    }
    if !matches!(command, Command::G6a(_)) && raw.chart.is_some() {
        return Err(format!("{CHART} is an option of {G6A} only"));
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
        report_id: raw.report_id.clone(),
    })
}

/// A `g4` option on another command is a usage error naming it.
fn refuse_g4_flags(raw: &Raw) -> Result<(), String> {
    let given = [
        (SPOTS, raw.spots.is_some()),
        (ORACLE, raw.oracle.is_some()),
        (ENGINE, raw.engine.is_some()),
        (WRITE_ENGINE, raw.write_engine.is_some()),
        (REPORT_ID, raw.report_id.is_some()),
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
        REPORT_ID => {
            if !is_report_id(value) {
                return Err(format!(
                    "{flag} must be lowercase words of letters and digits joined by dashes, \
                     got {value:?}"
                ));
            }
            Ok(Raw { report_id: set_once(raw.report_id.as_ref(), text, flag)?, ..raw })
        }
        CHART => Ok(Raw { chart: set_once(raw.chart.as_ref(), path, flag)?, ..raw }),
        other => Err(format!("unknown option {other:?}")),
    }
}

/// Whether `id` matches the report schema's id pattern: words of lowercase letters and
/// digits, the first starting with a letter, joined by single dashes.
fn is_report_id(id: &str) -> bool {
    let starts_with_letter = id.chars().next().is_some_and(|c| c.is_ascii_lowercase());
    let word = |word: &str| {
        !word.is_empty() && word.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
    };
    starts_with_letter && id.split(ID_WORD_SEPARATOR).all(word)
}

/// `value` for a flag that has not been given yet; an error naming the flag otherwise.
fn set_once<T>(given: Option<&T>, value: T, flag: &str) -> Result<Option<T>, String> {
    match given {
        Some(_) => Err(format!("{flag} given twice")),
        None => Ok(Some(value)),
    }
}

#[cfg(test)]
mod tests;
