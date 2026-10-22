//! `library-pack`: converts a node dump (`packages/contracts/schemas/node-dump.schema.json`)
//! into the solutions library format and checks it (R2.8; criterion 2; feeds R1.5).
//!
//! Mechanism, in the order `pack` runs it: the dump is read with a size cap
//! (`MAX_DUMP_BYTES`) and parsed (`dump`), the criterion 2 invariants of
//! `packages/contracts/src/node-dump.ts` rules 1 to 5 and the Rust-only structural checks run
//! over it (`invariants`), the dump becomes solution metadata plus solved nodes (`convert`),
//! and `gto-library` writes them. Any violation rejects the dump before a byte is written.
//! `export` is the read-back side: library nodes back into a dump, for the round trip.
//! `estimate` writes the synthetic size estimate (R-19), `synthetic` writes a seeded
//! synthetic dump that `pack` accepts (O-149), and `cli` is the command line.
//!
//! The tool links `gto-library` and `gto-model` and never a solver (plan G5), so the
//! external-dump parser stays out of `solver-query` (architecture decision record (ADR)
//! 0018).

#![forbid(unsafe_code)]

pub mod cli;
pub mod convert;
pub mod dump;
pub mod error;
pub mod estimate;
pub mod export;
pub mod invariants;
pub mod pack;
pub mod synthetic;

pub use convert::{PackOptions, to_solution};
pub use dump::{DumpAction, DumpConfig, DumpHand, DumpNode, NodeDump, parse_dump};
pub use error::PackError;
pub use estimate::{SizeEstimate, estimate};
pub use export::{compare_dumps, export_dump};
pub use invariants::{FREQUENCY_SUM_TOLERANCE, Rule, Violation, check_invariants, check_structure};
pub use pack::{check_dump_file, pack, verify};
pub use synthetic::{SyntheticOptions, synthetic_dump, write_synthetic_dump};

/// The largest dump the tool reads, 512 MiB; a larger file is refused before parsing.
pub const MAX_DUMP_BYTES: u64 = 512 * 1024 * 1024;
