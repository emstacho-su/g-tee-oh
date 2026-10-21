//! File checksums (R2.7, A3 sections 3 and 5): the sha256 of every library file, listed in
//! the manifest and checked the first time the file is opened after a restart.
//!
//! Lane W (writer) owns this file.

#![allow(unused_variables, reason = "S14 red skeleton: lane W replaces the todo!() bodies")]

use crate::error::LibraryError;

/// The sha256 of `bytes` as 64 lowercase hexadecimal digits.
#[must_use]
pub fn sha256_hex(bytes: &[u8]) -> String {
    todo!("lane W: sha256 as lowercase hex")
}

/// Checks `bytes` against the expected sha256.
///
/// # Errors
///
/// `LibraryError::ChecksumMismatch` naming `path`, the expected and the actual digest.
pub fn verify_sha256(path: &str, bytes: &[u8], expected: &str) -> Result<(), LibraryError> {
    todo!("lane W: compare digests")
}
