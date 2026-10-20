//! Build planning: compares what the solutions library holds against what the trainer
//! needs and produces the ordered list of spots the background builder should solve next.
//! It depends on `gto-model` and `gto-library` (A1 section 2) and reads the library's
//! catalogue only; solving is the builder's job.

#![forbid(unsafe_code)]

/// The crate's package name, used by the workspace link tests (R0.1).
pub const CRATE_NAME: &str = "gto-planner";

#[cfg(test)]
mod tests {
    use super::CRATE_NAME;

    #[test]
    fn r0_1_gto_planner_links() {
        assert_eq!(CRATE_NAME, env!("CARGO_PKG_NAME"));
        // Both internal edges are real: these symbols resolve only through those crates.
        assert_eq!(gto_model::CRATE_NAME, "gto-model");
        assert_eq!(gto_library::CRATE_NAME, "gto-library");
    }
}
