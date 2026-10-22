//! `solver-query` entry point: parse the subcommand (see `cli`) and run it. No argument or
//! `serve` runs the Hypertext Transfer Protocol (HTTP) server; `openapi --out <path>`
//! writes the `OpenAPI` document and exits; `healthz` probes the running server for the
//! container health check; `version` prints one line; anything else prints usage on
//! stderr and exits 2. The work lives in the library half of the crate so the integration
//! tests can reach it; this file only maps commands to exit codes.

#![forbid(unsafe_code)]

use std::ffi::OsString;
use std::path::Path;
use std::process::ExitCode;

use solver_query::app::{AppState, app_with};
use solver_query::cli::{self, Command, USAGE};
use solver_query::config::Config;
use solver_query::{openapi, probe, server};

/// Exit status for a usage error, the value shell conventions reserve for it.
const EXIT_USAGE: u8 = 2;

fn main() -> ExitCode {
    let args: Vec<OsString> = std::env::args_os().skip(1).collect();
    match cli::parse(&args) {
        Ok(Command::Serve) => serve(),
        Ok(Command::Openapi { out }) => write_openapi(&out),
        Ok(Command::Healthz) => healthz(),
        Ok(Command::Version) => {
            println!("{}", solver_query::version_line());
            ExitCode::SUCCESS
        }
        Err(error) => {
            eprintln!("solver-query: {error}\n{USAGE}");
            ExitCode::from(EXIT_USAGE)
        }
    }
}

/// Runs the server until ctrl-c; any startup or serve error goes to stderr with exit 1.
fn serve() -> ExitCode {
    match server::run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("solver-query: {error}");
            ExitCode::FAILURE
        }
    }
}

/// Writes the `OpenAPI` document to `out` from this process (O-116: never a redirection).
/// The document comes from the same `app_with` the server mounts, over an empty state: the
/// routes describe themselves, so no library scan, pool or environment is needed (plan
/// A.7), and `just contracts` runs without a fixture library or a database.
fn write_openapi(out: &Path) -> ExitCode {
    let (_router, document) = app_with(AppState::empty());
    match openapi::write_document(&document, out) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("solver-query openapi: {error}");
            ExitCode::FAILURE
        }
    }
}

/// Probes `/healthz` at the configured bind (through the loopback when the bind is every
/// interface, see `probe::probe_address`): exit 0 on a 200 status line, 1 otherwise.
fn healthz() -> ExitCode {
    let address = match Config::from_env() {
        Ok(config) => probe::probe_address(config.bind),
        Err(error) => {
            eprintln!("solver-query healthz: {error}");
            return ExitCode::FAILURE;
        }
    };
    match probe::status(address) {
        Ok(response) if response.healthy() => {
            println!("{}", response.body.trim_end());
            ExitCode::SUCCESS
        }
        Ok(response) => {
            eprintln!("solver-query healthz: status {} from {address}", response.status);
            ExitCode::FAILURE
        }
        Err(error) => {
            eprintln!("solver-query healthz: {error}");
            ExitCode::FAILURE
        }
    }
}
