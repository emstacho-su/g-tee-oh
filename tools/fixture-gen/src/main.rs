//! `fixture-gen [--sets PATH] [--out DIR] [--prune] [--help]`: regenerate the synthetic
//! fixture sets (R2.20). Defaults: `validation/fixtures/synthetic/sets.json` and
//! `validation/fixtures/library` under the repository root. Leftover synthetic solutions are
//! removed on the committed library, and under an explicit `--out` only with `--prune`
//! (`fixture_gen::cli`). Exit 0 on success and for `--help`, 2 on a usage error or any
//! other error.

#![forbid(unsafe_code)]

use std::path::PathBuf;
use std::process::ExitCode;

use fixture_gen::cli::{self, Command, Options, USAGE};

/// The error exit code.
const EXIT_ERROR: u8 = 2;

fn main() -> ExitCode {
    match cli::parse(std::env::args().skip(1)) {
        Ok(Command::Help) => {
            println!("{USAGE}");
            ExitCode::SUCCESS
        }
        Ok(Command::Run(options)) => run(&options),
        Err(error) => {
            eprintln!("fixture-gen: {error}\n{USAGE}");
            ExitCode::from(EXIT_ERROR)
        }
    }
}

/// Generates with `options`, filling in the repository defaults.
fn run(options: &Options) -> ExitCode {
    let repo_root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("..");
    let sets_path = options
        .sets
        .clone()
        .unwrap_or_else(|| repo_root.join(fixture_gen::SETS_RELATIVE_TO_REPO_ROOT));
    let out = options
        .out
        .clone()
        .unwrap_or_else(|| repo_root.join(fixture_gen::LIBRARY_RELATIVE_TO_REPO_ROOT));
    let result = fixture_gen::load_sets(&sets_path)
        .and_then(|sets| fixture_gen::generate(&sets, &repo_root, &out, options.stale()));
    match result {
        Ok(summary) => {
            println!(
                "fixture-gen: {} solutions, {} bytes under {}",
                summary.solutions.len(),
                summary.bytes,
                out.display()
            );
            ExitCode::SUCCESS
        }
        Err(error) => {
            eprintln!("fixture-gen: {error}");
            ExitCode::from(EXIT_ERROR)
        }
    }
}
