//! The Hypertext Transfer Protocol (HTTP) server: reads the configuration, installs the
//! log subscriber, binds `SOLVER_QUERY_BIND`, serves the router from `app` and stops on
//! ctrl-c, letting in-flight requests finish (graceful shutdown through `tokio::signal`).

use std::fmt;
use std::io;
use std::net::SocketAddr;

use crate::app::{AppState, app_with};
use crate::config::{self, Config};
use crate::logging;

/// Why the server did not start or did not stop cleanly.
#[derive(Debug)]
pub enum Error {
    /// A configuration variable is malformed.
    Config(config::Error),
    /// The log subscriber could not be installed.
    Logging(logging::Error),
    /// The async runtime could not be built.
    Runtime(io::Error),
    /// The listen address could not be bound.
    Bind {
        /// The address that was requested.
        address: SocketAddr,
        /// The failure, typically a port in use or a denied bind.
        source: io::Error,
    },
    /// The server loop failed.
    Serve(io::Error),
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Config(source) => write!(f, "configuration: {source}"),
            Self::Logging(source) => write!(f, "logging: {source}"),
            Self::Runtime(source) => write!(f, "cannot start the async runtime: {source}"),
            Self::Bind { address, source } => write!(f, "cannot bind {address}: {source}"),
            Self::Serve(source) => write!(f, "server failed: {source}"),
        }
    }
}

impl std::error::Error for Error {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Config(source) => Some(source),
            Self::Logging(source) => Some(source),
            Self::Runtime(source) | Self::Serve(source) | Self::Bind { source, .. } => Some(source),
        }
    }
}

/// Reads the configuration, starts logging and runs the server until ctrl-c.
///
/// # Errors
///
/// Every startup failure is returned as an [`Error`] so `main` can print it and exit 1.
pub fn run() -> Result<(), Error> {
    let config = Config::from_env().map_err(Error::Config)?;
    logging::init(config.log_json).map_err(Error::Logging)?;
    let runtime =
        tokio::runtime::Builder::new_multi_thread().enable_all().build().map_err(Error::Runtime)?;
    runtime.block_on(serve(&config))
}

/// Serves the application on `config.bind` until the shutdown signal arrives.
///
/// # Errors
///
/// Returns [`Error::Bind`] when the address cannot be bound and [`Error::Serve`] when
/// the accept loop fails.
pub async fn serve(config: &Config) -> Result<(), Error> {
    tracing::info!(
        bind = %config.bind,
        fixture_library_path = ?config.fixture_library_path,
        query_cache_bytes = ?config.query_cache_bytes,
        "starting {}",
        crate::version_line()
    );
    let (router, _document) = app_with(AppState::from(config));
    let listener = tokio::net::TcpListener::bind(config.bind)
        .await
        .map_err(|source| Error::Bind { address: config.bind, source })?;
    tracing::info!(address = %config.bind, "listening");
    axum::serve(listener, router)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .map_err(Error::Serve)?;
    tracing::info!("stopped");
    Ok(())
}

/// Resolves when ctrl-c arrives. If the signal handler cannot be installed, the error is
/// logged and the future never resolves, so the server keeps serving instead of stopping
/// at once; the process can still be killed.
async fn shutdown_signal() {
    match tokio::signal::ctrl_c().await {
        Ok(()) => tracing::info!("ctrl-c received, shutting down"),
        Err(error) => {
            tracing::error!(%error, "cannot listen for ctrl-c; graceful shutdown is off");
            std::future::pending::<()>().await;
        }
    }
}
