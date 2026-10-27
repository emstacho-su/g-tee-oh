//! The command line, hand-rolled like `solver-query`'s (no parser dependency).

use std::ffi::OsString;
use std::path::PathBuf;

use crate::error::BuilderError;

/// The usage line.
pub const USAGE: &str = "usage: library-builder [run | --version | plan | verify | healthz \
| --once [--job <uuid>] | --once --job-spec <file> [--summary-out <file>] \
| estimate --job-spec <file> [--out <file>] \
| bench-report --judged <summary> [--informational <summary>] [--sweep <file>] --out <dir>]";

/// A parsed command.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Command {
    /// The claim loop and the operations surface (the default with no argument).
    Run,
    /// Print the version line and exit (the R0.1 smoke test, O-189).
    Version,
    /// One planner pass.
    Plan,
    /// One verify pass (O-186).
    Verify,
    /// Probe the running `/healthz` and exit 0 on a 200.
    Healthz,
    /// Claim and run one job in the foreground.
    Once {
        /// The job to claim, else the queue head.
        job: Option<String>,
    },
    /// Run one job spec without a database (O-205).
    OnceSpec {
        /// The spec.
        spec: PathBuf,
        /// Where to write the summary JSON, besides stdout.
        summary_out: Option<PathBuf>,
    },
    /// The estimate sweep of a spec (O-194).
    Estimate {
        /// The spec.
        spec: PathBuf,
        /// Where to write the sweep JSON, besides stdout.
        out: Option<PathBuf>,
    },
    /// Write the bench report from run summaries (O-190).
    BenchReport {
        /// The judged run's summary.
        judged: PathBuf,
        /// An informational run's summary.
        informational: Option<PathBuf>,
        /// The estimate sweep.
        sweep: Option<PathBuf>,
        /// The report directory.
        out: PathBuf,
    },
}

/// Parses the arguments after the program name.
///
/// # Errors
///
/// `BuilderError::Usage` naming what is wrong, with [`USAGE`].
pub fn parse(args: &[OsString]) -> Result<Command, BuilderError> {
    let _ = args;
    Err(BuilderError::NotImplemented("cli::parse"))
}
