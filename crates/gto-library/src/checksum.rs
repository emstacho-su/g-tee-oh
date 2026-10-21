//! File checksums (R2.7, A3 sections 3 and 5): the sha256 of every library file, listed in
//! the manifest and checked the first time the file is opened after a restart.
//!
//! Lane W (writer) owns this file.

use std::fmt::Write as _;

use sha2::{Digest, Sha256};

use crate::error::LibraryError;

/// Hexadecimal digits in a sha256.
const SHA256_HEX_LEN: usize = 64;

/// The sha256 of `bytes` as 64 lowercase hexadecimal digits.
#[must_use]
pub fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes).iter().fold(String::with_capacity(SHA256_HEX_LEN), |mut hex, byte| {
        // Writing to a String cannot fail, so the Result carries nothing to handle.
        let _ = write!(hex, "{byte:02x}");
        hex
    })
}

/// Checks `bytes` against the expected sha256, in the lowercase form `sha256_hex` produces
/// and the manifest schema requires.
///
/// # Errors
///
/// `LibraryError::ChecksumMismatch` naming `path`, the expected and the actual digest.
pub fn verify_sha256(path: &str, bytes: &[u8], expected: &str) -> Result<(), LibraryError> {
    let actual = sha256_hex(bytes);
    if actual == expected {
        Ok(())
    } else {
        Err(LibraryError::ChecksumMismatch {
            path: path.to_owned(),
            expected: expected.to_owned(),
            actual,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::{sha256_hex, verify_sha256};
    use crate::error::LibraryError;

    /// The sha256 of the empty input (the FIPS 180-4 test vector, Federal Information
    /// Processing Standard).
    const EMPTY_SHA256: &str = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

    #[test]
    fn r2_7_sha256_matches_the_empty_input_vector() {
        assert_eq!(sha256_hex(b""), EMPTY_SHA256);
        verify_sha256("chunks/0000.bin.zst", b"", EMPTY_SHA256).expect("the digest matches");
        match verify_sha256("chunks/0000.bin.zst", b"a", EMPTY_SHA256) {
            Err(LibraryError::ChecksumMismatch { path, expected, actual }) => {
                assert_eq!(path, "chunks/0000.bin.zst");
                assert_eq!(expected, EMPTY_SHA256);
                assert_eq!(actual, sha256_hex(b"a"));
            }
            other => panic!("expected a checksum mismatch, got {other:?}"),
        }
    }
}
