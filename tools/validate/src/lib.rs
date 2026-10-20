//! Library half of `validate`: the types that load the public gate fixtures under
//! `validation/fixtures/` (R0.11; 04 section 6 gates G1 to G3; O-30 for the `OpenSpiel`
//! curve). The binary in `main.rs` stays the S01 stub until S13 wires the gates and the
//! `recompute` path (O-60) through these types.
//!
//! Only loading and structural validation live here. The pass rules of the gates are
//! written as pending tests in `tests/gates.rs` and move into this crate when S13 turns
//! them green.

#![forbid(unsafe_code)]

pub mod fixtures;
