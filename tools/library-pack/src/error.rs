//! The tool's one error type and its exit codes (R2.8). Shared by every module, so the
//! pack lane (P) and the estimate lane (M) use it without owning it; a new variant goes
//! through the integrator.
//!
//! Exit codes: 0 success; 1 the dump was rejected or a read-back differs (one sentence per
//! problem on standard error); 2 a usage error or an input/output (I/O) failure.

use gto_library::LibraryError;
use thiserror::Error;

use crate::invariants::Violation;

/// The command succeeded.
pub const EXIT_OK: u8 = 0;
/// The dump broke an invariant, or the read-back differs from it.
pub const EXIT_REJECTED: u8 = 1;
/// A usage error, an unreadable input or a failed write.
pub const EXIT_USAGE: u8 = 2;

/// Every failure the tool reports.
#[derive(Debug, Error)]
pub enum PackError {
    /// The dump broke one or more criterion 2 or structural rules; nothing was written.
    #[error("the dump was rejected with {} violation(s)", .0.len())]
    Rejected(Vec<Violation>),
    /// The library read back differs from the dump, one sentence per difference.
    #[error("the read-back differs from the dump in {} place(s)", .0.len())]
    Mismatch(Vec<String>),
    /// A file could not be read or written.
    #[error("input/output error on {path}: {source}")]
    Io {
        /// The file path.
        path: String,
        /// The underlying error.
        source: std::io::Error,
    },
    /// A dump larger than `MAX_DUMP_BYTES`.
    #[error("dump {path} is {bytes} bytes, above the limit of {limit} bytes")]
    TooLarge {
        /// The file path.
        path: String,
        /// Its size.
        bytes: u64,
        /// The limit.
        limit: u64,
    },
    /// A command line or option that cannot be acted on.
    #[error("usage: {0}")]
    Usage(String),
    /// The library failed to write or read.
    #[error(transparent)]
    Library(#[from] LibraryError),
}

impl PackError {
    /// The process exit code for this error: `EXIT_REJECTED` for a rejection or a mismatch,
    /// `EXIT_USAGE` for everything else.
    #[must_use]
    pub fn exit_code(&self) -> u8 {
        match self {
            PackError::Rejected(_) | PackError::Mismatch(_) => EXIT_REJECTED,
            PackError::Io { .. }
            | PackError::TooLarge { .. }
            | PackError::Usage(_)
            | PackError::Library(_) => EXIT_USAGE,
        }
    }
}
