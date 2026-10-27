//! `fixture-gen [--sets PATH] [--out DIR]`: regenerate the synthetic fixture sets (R2.20).
//! Defaults: `validation/fixtures/synthetic/sets.json` and `validation/fixtures/library`
//! under the repository root. Exit 0 on success, 2 on any error.

#![forbid(unsafe_code)]

use std::path::PathBuf;
use std::process::ExitCode;

/// The error exit code.
const EXIT_ERROR: u8 = 2;

fn main() -> ExitCode {
    let repo_root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("..");
    let args: Vec<String> = std::env::args().skip(1).collect();
    let flag = |name: &str| {
        args.iter().position(|arg| arg == name).and_then(|i| args.get(i + 1)).map(PathBuf::from)
    };
    let sets_path =
        flag("--sets").unwrap_or_else(|| repo_root.join(fixture_gen::SETS_RELATIVE_TO_REPO_ROOT));
    let out =
        flag("--out").unwrap_or_else(|| repo_root.join(fixture_gen::LIBRARY_RELATIVE_TO_REPO_ROOT));
    let result = fixture_gen::load_sets(&sets_path)
        .and_then(|sets| fixture_gen::generate(&sets, &repo_root, &out));
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
