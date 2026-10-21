//! Solver adapter: wraps the vendored postflop engine (crate `engine`, aliased
//! `postflop-engine`, vendored by git subtree per R0.2) behind `gto-model` and `gto-tree`
//! types. Every other crate reaches the engine through this one, so engine internals stay
//! out of the library, the planner and the services (A1 section 2, ADR 0018).

#![forbid(unsafe_code)]

pub mod equity;
mod exploit;
pub mod postflop;
pub mod toy;

/// The crate's package name, used by the workspace link tests (R0.1).
pub const CRATE_NAME: &str = "gto-solve";

#[cfg(test)]
mod tests {
    use super::CRATE_NAME;

    #[test]
    fn r0_1_gto_solve_links() {
        assert_eq!(CRATE_NAME, env!("CARGO_PKG_NAME"));
        // Both internal edges are real: these symbols resolve only through those crates.
        assert_eq!(gto_model::CRATE_NAME, "gto-model");
        assert_eq!(gto_tree::CRATE_NAME, "gto-tree");
    }

    #[test]
    fn r0_2_vendored_engine_links() {
        // The engine edge is real: a card round-trips through the vendored crate's
        // encoding (rank * 4 + suit, so the ace of spades is 12 * 4 + 3).
        let card = postflop_engine::cards::parse_card("As").expect("As is a valid card");
        assert_eq!(card, 51);
        assert_eq!(postflop_engine::cards::card_to_string(card), "As");
    }
}
