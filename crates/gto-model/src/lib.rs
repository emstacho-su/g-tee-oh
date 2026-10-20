//! Core domain types for no-limit hold'em: cards, positions, stacks, actions and the
//! identifiers that every other crate speaks in. It sits at the bottom of the layering
//! (A1 section 2) and has no internal dependencies, so every crate above it shares one
//! vocabulary without pulling in a solver.

#![forbid(unsafe_code)]

/// The crate's package name, used by the workspace link tests (R0.1).
pub const CRATE_NAME: &str = "gto-model";

#[cfg(test)]
mod tests {
    use super::CRATE_NAME;

    #[test]
    fn r0_1_gto_model_links() {
        assert_eq!(CRATE_NAME, env!("CARGO_PKG_NAME"));
    }
}
