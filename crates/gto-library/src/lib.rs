//! Solutions library: stores solved spots and serves them by key, so every request path
//! reads a prebuilt solution instead of starting a solve (ADR 0018, library-first).
//!
//! The crate depends on `gto-model` only. Solutions enter and leave it as `gto-model`
//! types, so the writers (`library-builder`, `validate`, `library-pack`) combine it with
//! `gto-solve` while `solver-query` links it without any path to a solver. Because the
//! edge to `gto-solve` does not exist here, no Cargo feature unification can add it
//! (O-101); `just rust-boundary` checks the workspace graph to keep it that way.

#![forbid(unsafe_code)]

/// The crate's package name, used by the workspace link tests (R0.1).
pub const CRATE_NAME: &str = "gto-library";

#[cfg(test)]
mod tests {
    use super::CRATE_NAME;

    #[test]
    fn r0_1_gto_library_links() {
        assert_eq!(CRATE_NAME, env!("CARGO_PKG_NAME"));
        // The edge to gto-model is real: this symbol resolves only through that crate.
        assert_eq!(gto_model::CRATE_NAME, "gto-model");
    }
}
