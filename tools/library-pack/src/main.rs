//! `library-pack`: converts node dumps into the solutions library format and checks them
//! (R2.8). The binary only hands its arguments to `library_pack::cli::run`.

#![forbid(unsafe_code)]

use std::ffi::OsString;
use std::io;
use std::process::ExitCode;

fn main() -> ExitCode {
    let args: Vec<OsString> = std::env::args_os().collect();
    let code = library_pack::cli::run(&args, &mut io::stdout().lock(), &mut io::stderr().lock());
    ExitCode::from(code)
}
