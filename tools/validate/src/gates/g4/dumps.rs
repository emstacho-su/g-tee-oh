//! Reading and checking the two node dumps of gate G4 (R2.11). Child module of `g4`.
//!
//! Mechanism. [`load_dump`] reads a dump file once under library-pack's size cap, parses
//! it and digests the bytes it parsed (the sha256 the report notes record, O-169);
//! [`check_dump`] holds any dump, a file's or the engine dump solved in memory, to the
//! criterion 2 invariants (rules 1 to 5) and to library-pack's node checks, which apply
//! whatever the hand space: unique and parseable keys naming the dump's configuration
//! and pair, a pot above zero, two stacks, reach within [0, 1] with one entry per seat,
//! a sized token equal to its `size_cbb`. A violation is `GateError::Dump` naming the
//! dump and the node.

use std::fmt::Write as _;
use std::path::Path;

use library_pack::{MAX_DUMP_BYTES, NodeDump, check_dump_structure, check_invariants, parse_dump};
use sha2::{Digest, Sha256};

use crate::fixtures::FixtureError;

use super::super::GateError;

/// A dump read from a file, with the digest of the bytes it was parsed from (O-169).
#[derive(Debug, Clone, PartialEq)]
pub struct LoadedDump {
    /// The dump.
    pub dump: NodeDump,
    /// The SHA-256 of the file's bytes as 64 lowercase hex digits, for the report notes.
    pub sha256: String,
}

/// Read a dump file once: the size cap, the digest, the parse, then [`check_dump`].
///
/// # Errors
///
/// `GateError::Fixture` when the file cannot be read or is above the cap,
/// `GateError::Dump` with every violation when it breaks the invariants.
pub fn load_dump(path: &Path) -> Result<LoadedDump, GateError> {
    let read_error = |source| FixtureError::Read { path: path.to_path_buf(), source };
    let bytes = std::fs::metadata(path).map_err(read_error)?.len();
    if bytes > MAX_DUMP_BYTES {
        let reason = format!("{bytes} bytes is above the {MAX_DUMP_BYTES} byte dump cap");
        return Err(FixtureError::Invalid { path: path.to_path_buf(), reason }.into());
    }
    let text = std::fs::read(path).map_err(read_error)?;
    let what = path.display().to_string();
    let dump = parse_dump(&text)
        .map_err(|violations| GateError::Dump { dump: what.clone(), violations })?;
    check_dump(&dump, &what)?;
    Ok(LoadedDump { dump, sha256: sha256_hex(&text) })
}

/// Hold `dump` to the criterion 2 invariants (rules 1 to 5) and to library-pack's node
/// checks, which apply to any dump whatever its hand space; `what` names the dump in the
/// error: its path, or the engine dump solved in this run.
///
/// # Errors
///
/// `GateError::Dump` with every violation, each naming its node.
pub fn check_dump(dump: &NodeDump, what: &str) -> Result<(), GateError> {
    let violations = [check_invariants(dump), check_dump_structure(dump)].concat();
    if violations.is_empty() {
        Ok(())
    } else {
        Err(GateError::Dump { dump: what.to_owned(), violations })
    }
}

/// The SHA-256 digest of `bytes` as 64 lowercase hex digits, for the report notes.
#[must_use]
pub fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut hex = String::with_capacity(digest.len() * 2);
    for byte in digest {
        write!(hex, "{byte:02x}").expect("writing to a String cannot fail");
    }
    hex
}
