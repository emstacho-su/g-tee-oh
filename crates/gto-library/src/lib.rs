//! Solutions library: stores solved spots and serves them by key, so every request path
//! reads a prebuilt solution instead of starting a solve (ADR 0018, library-first).
//!
//! The crate has two faces selected by Cargo features. Without the `solve` feature it
//! depends on `gto-model` only and can read a library; this is the face `solver-query`
//! links. With `solve` (on by default) it also depends on `gto-solve` so the background
//! writers (`library-builder`, `validate`, `library-pack`) can fill and check entries.
//! `just rust-boundary` checks that the query service never picks up the second face.

#![forbid(unsafe_code)]

/// The crate's package name, used by the workspace link tests (R0.1).
pub const CRATE_NAME: &str = "gto-library";

/// Whether this build of the library can start a solve. False for the read-only face
/// that `solver-query` links, true for the writers.
pub const CAN_SOLVE: bool = cfg!(feature = "solve");

#[cfg(test)]
mod tests {
    use super::CRATE_NAME;

    #[test]
    fn r0_1_gto_library_links() {
        assert_eq!(CRATE_NAME, env!("CARGO_PKG_NAME"));
        // The edge to gto-model is real: this symbol resolves only through that crate.
        assert_eq!(gto_model::CRATE_NAME, "gto-model");
    }

    /// The edge to gto-solve is real whenever the `solve` feature is on (the default).
    /// `CAN_SOLVE` is a constant, so the test touches the dependency instead of
    /// asserting the flag.
    #[cfg(feature = "solve")]
    #[test]
    fn r0_1_gto_library_solve_edge_links() {
        assert_eq!(gto_solve::CRATE_NAME, "gto-solve");
    }
}
