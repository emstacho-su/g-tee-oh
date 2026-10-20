//! The Hypertext Transfer Protocol (HTTP) server: reads the configuration, installs the
//! log subscriber, binds `SOLVER_QUERY_BIND`, serves the router from `app` and stops on
//! ctrl-c or, on Unix, SIGTERM, letting in-flight requests finish (graceful shutdown
//! through `tokio::signal`).

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

/// Reads the configuration, starts logging and runs the server until a shutdown signal.
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

/// Resolves when a shutdown signal arrives. Two listeners race in `tokio::select!` and the
/// first to fire wins: ctrl-c (SIGINT on Unix, the console event on Windows) on every
/// platform, and SIGTERM through [`terminate`] on Unix. SIGTERM matters in the container:
/// the binary is process 1 there, `docker stop` and `compose down` send it SIGTERM and wait
/// a grace period, and a process that only listens for ctrl-c would ignore the request and
/// be killed when the period ends, dropping in-flight requests instead of finishing them.
/// If a listener cannot be installed, the error is logged and that branch never resolves,
/// so the server keeps serving instead of stopping at once; the process can still be killed.
async fn shutdown_signal() {
    let interrupt = async {
        match tokio::signal::ctrl_c().await {
            Ok(()) => tracing::info!("ctrl-c received, shutting down"),
            Err(error) => {
                tracing::error!(%error, "cannot listen for ctrl-c; graceful shutdown on it is off");
                std::future::pending::<()>().await;
            }
        }
    };
    tokio::select! {
        () = interrupt => {}
        () = terminate() => {}
    }
}

/// Resolves when SIGTERM arrives. `tokio::signal::unix::signal` registers the handler when
/// the stream is created, so a SIGTERM that lands while the listener exists is queued for
/// `recv` rather than killing the process with the default action.
#[cfg(unix)]
async fn terminate() {
    use tokio::signal::unix::{SignalKind, signal};

    match signal(SignalKind::terminate()) {
        Ok(mut stream) => {
            stream.recv().await;
            tracing::info!("SIGTERM received, shutting down");
        }
        Err(error) => {
            tracing::error!(%error, "cannot listen for SIGTERM; graceful shutdown on it is off");
            std::future::pending::<()>().await;
        }
    }
}

/// Never resolves: there is no SIGTERM outside Unix, so only ctrl-c stops the server.
#[cfg(not(unix))]
async fn terminate() {
    std::future::pending::<()>().await;
}

#[cfg(all(test, unix))]
mod tests {
    use tokio::signal::unix::{SignalKind, signal};

    /// The listener [`super::terminate`] installs is installable in a plain test process
    /// (the same runtime shape as `serve`), so the Unix branch is compiled and exercised
    /// wherever the tests run on Unix.
    #[tokio::test]
    async fn r0_7_sigterm_listener_installs_on_unix() {
        let stream = signal(SignalKind::terminate());
        assert!(stream.is_ok(), "SIGTERM listener: {:?}", stream.err());
    }
}
