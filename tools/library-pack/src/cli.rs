//! The command line (R2.8):
//!
//! - `library-pack pack --dump <file> --out <library-root> [--solution-id <uuid>]
//!   [--created-at <ts>] [--engine-version <s>] [--seed <n>] [--iterations <n>]
//!   [--synthetic]` writes `<root>/preflop/<config_id>/<id>/`;
//! - `library-pack check --dump <file>` runs the invariants only;
//! - `library-pack verify --library <root> --prefix <p> --dump <file>` reads back and
//!   compares;
//! - `library-pack estimate --seed <n> --out <file>` writes the size estimate;
//! - `library-pack --version` prints `library-pack <version>`.
//!
//! Exit codes are `EXIT_OK`, `EXIT_REJECTED` and `EXIT_USAGE` from `error`; a rejection
//! prints one sentence per violation on standard error.
//!
//! Lane P (pack) owns this file.

#![allow(unused_variables, reason = "S14 red skeleton: lane P replaces the todo!() body")]

use std::ffi::OsString;
use std::io::Write;

/// Runs the tool on `args` (the program name first), writing to `out` and `err`, and
/// returns the exit code.
pub fn run(args: &[OsString], out: &mut dyn Write, err: &mut dyn Write) -> u8 {
    todo!("lane P: clap parse and dispatch")
}
