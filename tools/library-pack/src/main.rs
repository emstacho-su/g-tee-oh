//! `library-pack`: an operator tool that converts node dumps into the solutions library
//! format (R2.8). It links `gto-library` and `gto-model` and no solver. Until the S14
//! subcommands land, the binary prints its name and version.

#![forbid(unsafe_code)]

/// The binary's package name.
const BIN_NAME: &str = env!("CARGO_PKG_NAME");

/// The binary's package version.
const VERSION: &str = env!("CARGO_PKG_VERSION");

/// Internal crates this binary links (A1 section 2), named so the edges are exercised.
const LINKS: &[&str] = &[gto_library::CRATE_NAME, gto_model::CRATE_NAME];

fn main() {
    println!("{BIN_NAME} {VERSION} (links {})", LINKS.join(", "));
}
