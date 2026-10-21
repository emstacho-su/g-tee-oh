//! `LeReader`: the bounds-checked little-endian cursor the file directory parser and the
//! record decoder share. Every read returns `LibraryError::Decode` naming what was being read
//! instead of panicking on short input, which is what lets both decoders promise never to
//! panic on malformed bytes.
//!
//! Lane W (writer) owns this file.

use crate::error::LibraryError;

use super::overflow;

/// A bounds-checked little-endian cursor over a byte slice: every read returns
/// `LibraryError::Decode` naming what was being read instead of panicking on short input.
pub(crate) struct LeReader<'a> {
    bytes: &'a [u8],
    position: usize,
}

impl<'a> LeReader<'a> {
    /// A cursor at the start of `bytes`.
    pub(crate) fn new(bytes: &'a [u8]) -> Self {
        LeReader { bytes, position: 0 }
    }

    /// Bytes consumed so far.
    pub(crate) fn position(&self) -> usize {
        self.position
    }

    /// Bytes left.
    pub(crate) fn remaining(&self) -> usize {
        self.bytes.len() - self.position
    }

    /// The next `len` bytes.
    pub(crate) fn take(&mut self, len: usize, what: &str) -> Result<&'a [u8], LibraryError> {
        if len > self.remaining() {
            return Err(LibraryError::Decode(format!(
                "{what} needs {len} bytes, only {} remain",
                self.remaining()
            )));
        }
        let slice = &self.bytes[self.position..self.position + len];
        self.position += len;
        Ok(slice)
    }

    /// A `u32` count of entries of `entry_bytes` each, checked against the bytes left.
    pub(crate) fn count(&mut self, entry_bytes: usize, what: &str) -> Result<usize, LibraryError> {
        let count = usize::try_from(self.u32(what)?).map_err(|_| overflow(what))?;
        match count.checked_mul(entry_bytes) {
            Some(len) if len <= self.remaining() => Ok(count),
            _ => Err(LibraryError::Decode(format!("{what} lists more entries than it holds"))),
        }
    }

    fn array<const N: usize>(&mut self, what: &str) -> Result<[u8; N], LibraryError> {
        let mut array = [0; N];
        array.copy_from_slice(self.take(N, what)?);
        Ok(array)
    }

    pub(crate) fn u8(&mut self, what: &str) -> Result<u8, LibraryError> {
        Ok(self.array::<1>(what)?[0])
    }

    pub(crate) fn u16(&mut self, what: &str) -> Result<u16, LibraryError> {
        Ok(u16::from_le_bytes(self.array(what)?))
    }

    pub(crate) fn u32(&mut self, what: &str) -> Result<u32, LibraryError> {
        Ok(u32::from_le_bytes(self.array(what)?))
    }

    pub(crate) fn u64(&mut self, what: &str) -> Result<u64, LibraryError> {
        Ok(u64::from_le_bytes(self.array(what)?))
    }

    pub(crate) fn f32(&mut self, what: &str) -> Result<f32, LibraryError> {
        Ok(f32::from_le_bytes(self.array(what)?))
    }
}
