//! Log setup: `tracing-subscriber` filtered by `RUST_LOG` (default `info`), printing the
//! human text format or, when `SOLVER_QUERY_LOG=json`, one JavaScript Object Notation
//! (JSON) object per line, which is what the compose stack ships as container logs.

use std::fmt;

use tracing_subscriber::EnvFilter;
use tracing_subscriber::filter::LevelFilter;

/// The level used when `RUST_LOG` is unset.
pub const DEFAULT_LEVEL: LevelFilter = LevelFilter::INFO;

/// The subscriber could not be installed: one was already set in this process. It wraps
/// the boxed error `tracing-subscriber` returns from `try_init`.
#[derive(Debug)]
pub struct Error(Box<dyn std::error::Error + Send + Sync + 'static>);

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "cannot install the log subscriber: {}", self.0)
    }
}

impl std::error::Error for Error {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        Some(&*self.0)
    }
}

/// Installs the global subscriber, as JSON lines when `json` is set.
///
/// # Errors
///
/// Returns [`Error`] when a global subscriber is already installed (a second call in one
/// process).
pub fn init(json: bool) -> Result<(), Error> {
    let filter = EnvFilter::builder().with_default_directive(DEFAULT_LEVEL.into()).from_env_lossy();
    let builder = tracing_subscriber::fmt().with_env_filter(filter);
    let result = if json { builder.json().try_init() } else { builder.try_init() };
    result.map_err(Error)
}
