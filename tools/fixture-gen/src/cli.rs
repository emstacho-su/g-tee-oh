//! The command line of `fixture-gen` (R2.20, O-225).
//!
//! Mechanism. The arguments are read left to right. `--sets PATH` and `--out DIR` each take
//! the next argument as their value, which must be there and must not itself start with a
//! dash; `--prune` takes none. A flag given twice, a flag joined to its value with `=`, an
//! unknown flag or a stray value is a usage error. `--help` stops the reading and asks for
//! the usage text. Removing leftover synthetic solutions (`stale`) deletes directories, so
//! it runs only where that is the point: on the committed library (no `--out`), or when
//! `--prune` asks for it.

use std::path::PathBuf;

/// The usage line, printed with every usage error and by `--help`.
pub const USAGE: &str = "usage: fixture-gen [--sets PATH] [--out DIR] [--prune] [--help]";

/// The parsed options of a run.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Options {
    /// The sets file, when given.
    pub sets: Option<PathBuf>,
    /// The output root, when given; the committed library otherwise.
    pub out: Option<PathBuf>,
    /// `--prune`: remove leftover synthetic solutions under an explicit `--out`.
    pub prune: bool,
}

impl Options {
    /// Whether the run removes leftover synthetic solutions: always on the committed
    /// library, under an explicit `--out` only with `--prune`.
    #[must_use]
    pub fn stale(&self) -> crate::Stale {
        if self.out.is_none() || self.prune { crate::Stale::Remove } else { crate::Stale::Keep }
    }
}

/// What the command line asks for.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Command {
    /// Generate with these options.
    Run(Options),
    /// Print the usage text.
    Help,
}

/// A command line `parse` refuses, with what was wrong.
#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
#[error("{0}")]
pub struct UsageError(pub String);

/// Parses the arguments after the program name.
///
/// # Errors
///
/// `UsageError` for an unknown flag or stray value, a flag given twice, the `--flag=value`
/// form, or a `--sets` or `--out` with no value.
pub fn parse<I>(args: I) -> Result<Command, UsageError>
where
    I: IntoIterator<Item = String>,
{
    let mut args = args.into_iter();
    let mut options = Options::default();
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--help" | "-h" => return Ok(Command::Help),
            "--sets" => set_once(&mut options.sets, "--sets", value(&mut args, "--sets")?)?,
            "--out" => set_once(&mut options.out, "--out", value(&mut args, "--out")?)?,
            "--prune" if options.prune => return Err(twice("--prune")),
            "--prune" => options.prune = true,
            flag if flag.starts_with("--") && flag.contains('=') => {
                let name = flag.split('=').next().unwrap_or(flag);
                return Err(UsageError(format!("write {name} VALUE, not {flag}")));
            }
            flag if flag.starts_with('-') => {
                return Err(UsageError(format!("unknown flag {flag}")));
            }
            stray => return Err(UsageError(format!("unexpected argument {stray}"))),
        }
    }
    Ok(Command::Run(options))
}

/// The value after `flag`: present and not another flag.
fn value(args: &mut impl Iterator<Item = String>, flag: &str) -> Result<PathBuf, UsageError> {
    match args.next() {
        Some(value) if !value.starts_with('-') => Ok(PathBuf::from(value)),
        Some(other) => Err(UsageError(format!("{flag} needs a value, not the flag {other}"))),
        None => Err(UsageError(format!("{flag} needs a value"))),
    }
}

/// Stores `value` in `slot` unless `flag` was already given.
fn set_once(slot: &mut Option<PathBuf>, flag: &str, value: PathBuf) -> Result<(), UsageError> {
    if slot.is_some() {
        return Err(twice(flag));
    }
    *slot = Some(value);
    Ok(())
}

/// The error of a flag given twice.
fn twice(flag: &str) -> UsageError {
    UsageError(format!("{flag} is given twice"))
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::{Command, Options, parse};
    use crate::Stale;

    fn parsed(args: &[&str]) -> Result<Command, super::UsageError> {
        parse(args.iter().map(|arg| (*arg).to_owned()))
    }

    fn options(args: &[&str]) -> Options {
        match parsed(args) {
            Ok(Command::Run(options)) => options,
            other => panic!("{args:?} parsed to {other:?}"),
        }
    }

    #[test]
    fn r2_20_cli_parses_the_flags_and_their_values() {
        assert_eq!(options(&[]), Options::default());
        let all = options(&["--sets", "s.json", "--out", "dir", "--prune"]);
        assert_eq!(all.sets, Some(PathBuf::from("s.json")));
        assert_eq!(all.out, Some(PathBuf::from("dir")));
        assert!(all.prune);
        assert_eq!(parsed(&["--help"]), Ok(Command::Help));
        assert_eq!(parsed(&["--out", "dir", "-h"]), Ok(Command::Help));
    }

    #[test]
    fn r2_20_cli_refuses_every_malformed_command_line() {
        let cases: [&[&str]; 10] = [
            &["--bogus"],
            &["stray"],
            &["--out=dir"],
            &["--sets=s.json"],
            &["--out", "a", "--out", "b"],
            &["--sets", "a", "--sets", "b"],
            &["--prune", "--prune"],
            &["--out"],
            &["--out", "--prune"],
            &["--sets", "-x"],
        ];
        for case in cases {
            assert!(parsed(case).is_err(), "{case:?} is a usage error");
        }
    }

    #[test]
    fn r2_20_cli_prunes_the_library_or_on_request_only() {
        assert_eq!(options(&[]).stale(), Stale::Remove, "the committed library");
        assert_eq!(options(&["--sets", "s.json"]).stale(), Stale::Remove);
        assert_eq!(options(&["--out", "dir"]).stale(), Stale::Keep, "an explicit --out");
        assert_eq!(options(&["--out", "dir", "--prune"]).stale(), Stale::Remove);
    }
}
