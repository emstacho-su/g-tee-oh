//! `library-builder`: the background worker that takes the planner's build list, solves
//! each spot through `gto-solve` and writes the result into the solutions library. It is
//! the one process that solves, and it runs outside every request path, which is what
//! lets `solver-query` stay solve-free (architecture decision record (ADR) 0018).
//!
//! The library half of the crate holds everything the binary and the integration tests
//! share; `src/main.rs` only maps a parsed command to one of the modules below.

#![forbid(unsafe_code)]

pub mod config;
