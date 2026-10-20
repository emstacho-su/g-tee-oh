//! `library-pack`: an operator tool that assembles a solutions library into a
//! distributable pack, using `gto-solve` to fill or verify entries while packing. In S01
//! the binary is a stub that prints its name and version.

#![forbid(unsafe_code)]

/// The binary's package name.
const BIN_NAME: &str = env!("CARGO_PKG_NAME");

/// The binary's package version.
const VERSION: &str = env!("CARGO_PKG_VERSION");

/// Internal crates this binary links (A1 section 2), named so the edges are exercised.
const LINKS: &[&str] = &[gto_library::CRATE_NAME, gto_solve::CRATE_NAME];

fn main() {
    println!("{BIN_NAME} {VERSION} (links {})", LINKS.join(", "));
}
