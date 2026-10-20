//! Betting tree construction: turns a spot description built from `gto-model` types into
//! the game tree a solver walks. It depends on `gto-model` only (A1 section 2), so a tree
//! can be built, inspected and serialised without linking any solver.

#![forbid(unsafe_code)]

/// The crate's package name, used by the workspace link tests (R0.1).
pub const CRATE_NAME: &str = "gto-tree";

#[cfg(test)]
mod tests {
    use super::CRATE_NAME;

    #[test]
    fn r0_1_gto_tree_links() {
        assert_eq!(CRATE_NAME, env!("CARGO_PKG_NAME"));
        // The edge to gto-model is real: this symbol resolves only through that crate.
        assert_eq!(gto_model::CRATE_NAME, "gto-model");
    }
}
