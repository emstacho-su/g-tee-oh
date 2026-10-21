//! The command line (R2.8):
//!
//! - `library-pack pack --dump <file> --out <library-root> [--solution-id <uuid>]
//!   [--created-at <ts>] [--engine-version <s>] [--seed <n>] [--iterations <n>]
//!   [--synthetic]` writes `<root>/preflop/<config_id>/<id>/`;
//! - `library-pack check --dump <file>` runs the invariants only;
//! - `library-pack verify --library <root> --prefix <p> --dump <file>` reads back and
//!   compares;
//! - `library-pack estimate --seed <n> [--out <file>]` writes the size estimate, by default
//!   to `ESTIMATE_REPORT_PATH`;
//! - `library-pack --version` prints `library-pack <version>`.
//!
//! Mechanism: clap parses the arguments; help and version go to `out` with `EXIT_OK`, and
//! any other parse failure goes to `err` with `EXIT_USAGE`. A subcommand's success line goes
//! to `out`. Its failure goes to `err`: a rejection or a mismatch as one sentence per line,
//! then a summary line, with `EXIT_REJECTED`; anything else as one line with `EXIT_USAGE`.
//!
//! Lane P (pack) owns this file.

use std::ffi::OsString;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use clap::error::ErrorKind;
use clap::{Args, Parser, Subcommand};

use crate::convert::PackOptions;
use crate::error::{EXIT_OK, EXIT_USAGE, PackError};
use crate::estimate::{ESTIMATE_REPORT_PATH, estimate};
use crate::pack::{check_dump_file, pack, verify};

/// Converts node dumps into the solutions library format and checks them (R2.8).
#[derive(Debug, Parser)]
#[command(name = "library-pack", version, about)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    /// Checks a dump and packs it into a library root.
    Pack(PackArgs),
    /// Checks a dump against the criterion 2 invariants and the structural rules.
    Check {
        /// The node dump file.
        #[arg(long)]
        dump: PathBuf,
    },
    /// Reads a packed solution back and compares it with its dump.
    Verify {
        /// The library root the solution was packed into.
        #[arg(long)]
        library: PathBuf,
        /// The solution's directory under the root, for example
        /// `preflop/cfg_6_online_100/<id>`.
        #[arg(long)]
        prefix: String,
        /// The node dump file.
        #[arg(long)]
        dump: PathBuf,
    },
    /// Writes the synthetic library size estimate (R-19).
    Estimate {
        /// The generator seed.
        #[arg(long)]
        seed: u64,
        /// The report file.
        #[arg(long, default_value = ESTIMATE_REPORT_PATH)]
        out: PathBuf,
    },
}

#[derive(Debug, Args)]
struct PackArgs {
    /// The node dump file.
    #[arg(long)]
    dump: PathBuf,
    /// The library root to write under.
    #[arg(long)]
    out: PathBuf,
    /// The solution id, a lowercase universally unique identifier (UUID); by default the
    /// dump's sha256 as a version-8 UUID.
    #[arg(long)]
    solution_id: Option<String>,
    /// The manifest timestamp; by default the dump's `exported_at`.
    #[arg(long)]
    created_at: Option<String>,
    /// The engine version; required for an own dump.
    #[arg(long)]
    engine_version: Option<String>,
    /// The solve's seed; required for an own dump.
    #[arg(long)]
    seed: Option<u64>,
    /// The solve's iteration count; required for an own dump.
    #[arg(long)]
    iterations: Option<u64>,
    /// Marks the solution as synthetic test data.
    #[arg(long)]
    synthetic: bool,
}

impl PackArgs {
    fn options(&self) -> PackOptions {
        PackOptions {
            solution_id: self.solution_id.clone(),
            created_at: self.created_at.clone(),
            engine_version: self.engine_version.clone(),
            seed: self.seed,
            iterations: self.iterations,
            synthetic: self.synthetic,
        }
    }
}

/// Runs the tool on `args` (the program name first), writing to `out` and `err`, and
/// returns the exit code.
pub fn run(args: &[OsString], out: &mut dyn Write, err: &mut dyn Write) -> u8 {
    let cli = match Cli::try_parse_from(args) {
        Ok(cli) => cli,
        Err(parse_error) => return report_parse_error(&parse_error, out, err),
    };
    let result = execute(&cli.command).and_then(|line| {
        writeln!(out, "{line}").map_err(|source| stream_error("standard output", source))
    });
    match result {
        Ok(()) => EXIT_OK,
        Err(failure) => report_failure(&failure, err),
    }
}

/// Runs one subcommand and returns its success line.
fn execute(command: &Command) -> Result<String, PackError> {
    match command {
        Command::Pack(args) => {
            let manifest = pack(&args.dump, &args.out, &args.options())?;
            let nodes: u32 = manifest.chunks.iter().flatten().map(|chunk| chunk.node_count).sum();
            let config_id = manifest.config_id.as_ref().map(ToString::to_string);
            let config_id = config_id.unwrap_or_default();
            Ok(format!("packed {nodes} nodes as preflop/{config_id}/{}", manifest.id))
        }
        Command::Check { dump } => {
            let checked = check_dump_file(dump)?;
            Ok(format!("{}: {} nodes, no violations", dump.display(), checked.nodes.len()))
        }
        Command::Verify { library, prefix, dump } => {
            verify(library, prefix, dump)?;
            Ok(format!("{prefix} reads back as {} within tolerance", dump.display()))
        }
        Command::Estimate { seed, out } => {
            let report = estimate(*seed)?.to_markdown();
            write_report(out, &report)?;
            Ok(format!("wrote the size estimate for seed {seed} to {}", out.display()))
        }
    }
}

fn write_report(path: &Path, report: &str) -> Result<(), PackError> {
    let io = |source| PackError::Io { path: path.display().to_string(), source };
    if let Some(parent) = path.parent().filter(|parent| !parent.as_os_str().is_empty()) {
        fs::create_dir_all(parent).map_err(io)?;
    }
    fs::write(path, report).map_err(io)
}

fn stream_error(stream: &str, source: std::io::Error) -> PackError {
    PackError::Io { path: stream.to_owned(), source }
}

/// Help and version are successes on `out`; every other parse failure is a usage error.
fn report_parse_error(parse_error: &clap::Error, out: &mut dyn Write, err: &mut dyn Write) -> u8 {
    let informational =
        matches!(parse_error.kind(), ErrorKind::DisplayHelp | ErrorKind::DisplayVersion);
    let (written, code) = if informational {
        (write!(out, "{parse_error}"), EXIT_OK)
    } else {
        (write!(err, "{parse_error}"), EXIT_USAGE)
    };
    // A stream that cannot be written leaves nowhere to report to; the exit code says it.
    if written.is_ok() { code } else { EXIT_USAGE }
}

/// One line per violation or difference, then the error's own line.
fn report_failure(failure: &PackError, err: &mut dyn Write) -> u8 {
    let details: Vec<String> = match failure {
        PackError::Rejected(found) => found.iter().map(ToString::to_string).collect(),
        PackError::Mismatch(found) => found.clone(),
        _ => Vec::new(),
    };
    let written = details
        .iter()
        .try_for_each(|line| writeln!(err, "{line}"))
        .and_then(|()| writeln!(err, "library-pack: {failure}"));
    // Standard error itself failing leaves nowhere to report to; the exit code says it.
    if written.is_ok() { failure.exit_code() } else { EXIT_USAGE }
}
