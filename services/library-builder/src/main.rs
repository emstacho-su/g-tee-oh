//! `library-builder`: the background worker that takes the planner's build list, solves
//! each spot through `gto-solve` and writes the result into the solutions library. It
//! runs outside every request path, which is what lets `solver-query` stay solve-free
//! (ADR 0018). In S01 the binary is a stub that prints its name and version.

#![forbid(unsafe_code)]

/// The binary's package name.
const BIN_NAME: &str = env!("CARGO_PKG_NAME");

/// The binary's package version.
const VERSION: &str = env!("CARGO_PKG_VERSION");

/// Internal crates this binary links (A1 section 2), named so the edges are exercised.
const LINKS: &[&str] = &[gto_solve::CRATE_NAME, gto_planner::CRATE_NAME, gto_library::CRATE_NAME];

fn main() {
    println!("{BIN_NAME} {VERSION} (links {})", LINKS.join(", "));
}
