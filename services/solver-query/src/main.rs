//! `solver-query`: the query service that answers spot lookups from the solutions
//! library. It links the read-only face of `gto-library` and nothing that can solve, so
//! no request path can start a solve (ADR 0018, success criterion 10). In S01 the binary
//! is a stub that prints its name and version; the HTTP surface lands in S06.

#![forbid(unsafe_code)]

/// The binary's package name.
const BIN_NAME: &str = env!("CARGO_PKG_NAME");

/// The binary's package version.
const VERSION: &str = env!("CARGO_PKG_VERSION");

/// Internal crates this binary links (A1 section 2), named so the edges are exercised.
const LINKS: &[&str] = &[gto_library::CRATE_NAME];

fn main() {
    println!("{BIN_NAME} {VERSION} (links {})", LINKS.join(", "));
}
