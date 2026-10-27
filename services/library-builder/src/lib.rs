//! `library-builder`: the background worker that takes the planner's build list, solves
//! each spot through `gto-solve` and writes the result into the solutions library. It is
//! the one process that solves, and it runs outside every request path, which is what
//! lets `solver-query` stay solve-free (architecture decision record (ADR) 0018).
//!
//! The library half of the crate holds everything the binary and the integration tests
//! share; `src/main.rs` only maps a parsed command to one of the modules below. Every
//! module is declared here so no build lane edits this file (S18 plan section J):
//!
//! - `config`: the environment (O-146, ADR 0019); `settings`: the live `builder_setting`
//!   rows (A1 section 6, O-188); `notify`: the channels and payloads (A4 section 4).
//! - `queue` with `queue::pg` and `queue::mem`: the claim, publish and failure
//!   transactions (A5 section 4, ADR 0005).
//! - `ranges`: flop ranges (O-181); `solve`: the solve seam over `gto-solve`; `extract`:
//!   runout extraction to the library's nodes (R2.12, O-173); `store`: the library target,
//!   upload and read-back verification (O-183, O-184).
//! - `job`: one job end to end; `run`: the loop, `--once`, the planner and verify passes.
//! - `ops`: `/healthz` and `/metrics` on 7071 (R2.18, O-207); `cli`: the command line;
//!   `spec`: a job without a database (O-205); `bench`: the flop-line report (O-190).

#![forbid(unsafe_code)]
#![allow(
    clippy::unused_async,
    reason = "S18 skeleton: stubs answer before awaiting; the integrator removes this at join"
)]

pub mod bench;
pub mod cli;
pub mod config;
pub mod error;
pub mod extract;
pub mod job;
pub mod notify;
pub mod ops;
pub mod queue;
pub mod ranges;
pub mod run;
pub mod settings;
pub mod solve;
pub mod spec;
pub mod store;

pub use error::BuilderError;

/// The binary's package name.
pub const BIN_NAME: &str = env!("CARGO_PKG_NAME");

/// The binary's package version.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// Internal crates this binary links (A1 section 2), named so the edges are exercised.
pub const LINKS: &[&str] =
    &[gto_solve::CRATE_NAME, gto_planner::CRATE_NAME, gto_library::CRATE_NAME];

/// The version line `--version` prints (the S01 smoke line, O-189).
#[must_use]
pub fn version_line() -> String {
    format!("{BIN_NAME} {VERSION} (links {})", LINKS.join(", "))
}
