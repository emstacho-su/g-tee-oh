//! The three file-level operations behind the subcommands (R2.8): check a dump file, pack
//! it into a library root, and verify a packed solution against its dump.
//!
//! Mechanism: every operation reads the dump through one size-capped read
//! (`MAX_DUMP_BYTES`), parses it and runs both checkers. `pack` validates the config id and
//! the solution id before it builds any output path and writes nothing when the dump is
//! rejected; it writes `<out_root>/preflop/<config_id>/<id>/` through `gto_library::FsStore`.
//!
//! Lane P (pack) owns this file.

#![allow(unused_variables, reason = "S14 red skeleton: lane P replaces the todo!() bodies")]

use std::path::Path;

use gto_library::Manifest;

use crate::convert::PackOptions;
use crate::dump::NodeDump;
use crate::error::PackError;

/// Reads, parses and checks a dump file.
///
/// # Errors
///
/// `PackError::Rejected` with every violation, `PackError::TooLarge` or `PackError::Io`.
pub fn check_dump_file(dump: &Path) -> Result<NodeDump, PackError> {
    todo!("lane P: capped read, parse, both checkers")
}

/// Packs a dump into the library under `out_root` and returns the manifest written.
///
/// # Errors
///
/// As `check_dump_file`, plus `PackError::Library` when the write fails. A rejected dump
/// writes nothing.
pub fn pack(dump: &Path, out_root: &Path, o: &PackOptions) -> Result<Manifest, PackError> {
    todo!("lane P: check, convert, write_preflop")
}

/// Reads the solution at `prefix` under `library_root` back and compares it with the dump
/// (O-133).
///
/// # Errors
///
/// `PackError::Mismatch` with every difference, or the errors of `check_dump_file` and the
/// reader.
pub fn verify(library_root: &Path, prefix: &str, dump: &Path) -> Result<(), PackError> {
    todo!("lane P: read back and compare_dumps")
}
