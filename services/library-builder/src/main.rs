//! `library-builder`: maps a parsed command (`library_builder::cli`) to the library half of
//! the crate. With no argument it runs the claim loop and the operations surface;
//! `--version` prints the S01 line (O-189).

#![forbid(unsafe_code)]

use std::ffi::OsString;
use std::process::ExitCode;

use library_builder::cli::{self, Command, USAGE};
use library_builder::version_line;

fn main() -> ExitCode {
    let args: Vec<OsString> = std::env::args_os().skip(1).collect();
    match cli::parse(&args) {
        Ok(Command::Version) => {
            println!("{}", version_line());
            ExitCode::SUCCESS
        }
        Ok(command) => {
            eprintln!("library-builder: {command:?} is not implemented yet (S18)");
            ExitCode::FAILURE
        }
        Err(error) => {
            eprintln!("library-builder: {error}\n{USAGE}");
            ExitCode::from(2)
        }
    }
}
