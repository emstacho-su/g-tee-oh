//! Subcommand parsing for the `solver-query` binary. The binary takes at most one
//! subcommand: none or `serve` runs the server, `openapi --out <path>` writes the `OpenAPI`
//! document and exits (O-116), `healthz` self-probes the running server for the container
//! health check, and `version` prints the one line the R0.1 smoke test reads. Anything
//! else is a usage error, which `main` prints on stderr with exit status 2.

use std::ffi::OsString;
use std::fmt;
use std::path::PathBuf;

/// The usage text printed on stderr after a usage error.
pub const USAGE: &str = "usage: solver-query [serve | openapi --out <path> | healthz | version]";

/// The flag that names the output file of `openapi`.
const OUT_FLAG: &str = "--out";

/// What the binary was asked to do.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Command {
    /// Run the server (the default when no argument is given).
    Serve,
    /// Write the `OpenAPI` document to `out` and exit.
    Openapi {
        /// The file to write; its directory must exist.
        out: PathBuf,
    },
    /// Probe the running server's `/healthz` and exit 0 when it answers 200.
    Healthz,
    /// Print the version line and exit.
    Version,
}

/// Why the arguments could not be parsed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UsageError {
    /// The first argument names no subcommand.
    UnknownSubcommand(String),
    /// `openapi` was given without `--out <path>`.
    MissingOut,
    /// A subcommand received arguments it does not take.
    UnexpectedArguments {
        /// The subcommand that was given.
        subcommand: &'static str,
        /// The arguments after it, lossily decoded for the message.
        arguments: Vec<String>,
    },
}

impl fmt::Display for UsageError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::UnknownSubcommand(name) => write!(f, "unknown subcommand {name:?}"),
            Self::MissingOut => write!(f, "openapi needs {OUT_FLAG} <path>"),
            Self::UnexpectedArguments { subcommand, arguments } => {
                write!(f, "{subcommand} takes no arguments, got {arguments:?}")
            }
        }
    }
}

impl std::error::Error for UsageError {}

/// Parses the arguments that follow the program name.
///
/// # Errors
///
/// Returns a `UsageError` when the subcommand is unknown, when `openapi` lacks
/// `--out <path>`, or when a subcommand gets arguments it does not take.
pub fn parse(args: &[OsString]) -> Result<Command, UsageError> {
    let Some(first) = args.first() else {
        return Ok(Command::Serve);
    };
    let rest = &args[1..];
    match first.to_string_lossy().as_ref() {
        "serve" => no_arguments("serve", rest).map(|()| Command::Serve),
        "healthz" => no_arguments("healthz", rest).map(|()| Command::Healthz),
        "version" => no_arguments("version", rest).map(|()| Command::Version),
        "openapi" => parse_openapi(rest),
        other => Err(UsageError::UnknownSubcommand(other.to_owned())),
    }
}

/// Accepts `rest` only when it is empty.
fn no_arguments(subcommand: &'static str, rest: &[OsString]) -> Result<(), UsageError> {
    if rest.is_empty() {
        Ok(())
    } else {
        Err(UsageError::UnexpectedArguments { subcommand, arguments: lossy(rest) })
    }
}

/// Parses the arguments after `openapi`: exactly `--out <path>`.
fn parse_openapi(rest: &[OsString]) -> Result<Command, UsageError> {
    match rest {
        [flag, path] if flag == OUT_FLAG => Ok(Command::Openapi { out: PathBuf::from(path) }),
        [] | [_] => Err(UsageError::MissingOut),
        _ => Err(UsageError::UnexpectedArguments { subcommand: "openapi", arguments: lossy(rest) }),
    }
}

/// Decodes arguments for an error message.
fn lossy(args: &[OsString]) -> Vec<String> {
    args.iter().map(|arg| arg.to_string_lossy().into_owned()).collect()
}

#[cfg(test)]
mod tests {
    use std::ffi::OsString;
    use std::path::PathBuf;

    use super::{Command, UsageError, parse};

    fn args(list: &[&str]) -> Vec<OsString> {
        list.iter().map(OsString::from).collect()
    }

    #[test]
    fn r0_7_cli_defaults_to_serve() {
        assert_eq!(parse(&[]), Ok(Command::Serve));
        assert_eq!(parse(&args(&["serve"])), Ok(Command::Serve));
    }

    #[test]
    fn r0_7_cli_parses_each_subcommand() {
        assert_eq!(parse(&args(&["healthz"])), Ok(Command::Healthz));
        assert_eq!(parse(&args(&["version"])), Ok(Command::Version));
        assert_eq!(
            parse(&args(&["openapi", "--out", "doc.json"])),
            Ok(Command::Openapi { out: PathBuf::from("doc.json") })
        );
    }

    #[test]
    fn r0_7_cli_rejects_bad_input() {
        assert_eq!(
            parse(&args(&["solve"])),
            Err(UsageError::UnknownSubcommand("solve".to_owned()))
        );
        assert_eq!(parse(&args(&["openapi"])), Err(UsageError::MissingOut));
        assert_eq!(parse(&args(&["openapi", "--out"])), Err(UsageError::MissingOut));
        assert_eq!(
            parse(&args(&["version", "--long"])),
            Err(UsageError::UnexpectedArguments {
                subcommand: "version",
                arguments: vec!["--long".to_owned()],
            })
        );
        assert_eq!(
            parse(&args(&["openapi", "--to", "doc.json"])),
            Err(UsageError::UnexpectedArguments {
                subcommand: "openapi",
                arguments: vec!["--to".to_owned(), "doc.json".to_owned()],
            })
        );
    }
}
