//! `solver-query`: the query service that answers spot lookups from the solutions
//! library. It links the read-only face of `gto-library` and nothing that can solve, so
//! no request path can start a solve (architecture decision record (ADR) 0018, success
//! criterion 10).
//!
//! The library half of the crate holds everything the binary and the integration tests
//! share: the axum application with its `OpenAPI` document (`app`), the environment
//! configuration (`config`), the subcommand parser (`cli`), the server with graceful
//! shutdown (`server`), the log setup (`logging`) and the health self-probe the container
//! health check runs (`probe`). `src/main.rs` only maps a parsed command to one of them.
//!
//! S06 lands the skeleton: `GET /healthz` (A5 section 2) and the document export that
//! `just contracts` commits (R0.7, O-116).

#![forbid(unsafe_code)]

pub mod app;
pub mod cli;
pub mod config;
pub mod logging;
pub mod openapi;
pub mod probe;
pub mod routes;
pub mod server;

/// The binary's package name, also the `service` field of the health response.
pub const SERVICE_NAME: &str = env!("CARGO_PKG_NAME");

/// The binary's package version.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// Internal crates this binary links (A1 section 2), named so the edges are exercised.
pub const LINKS: &[&str] = &[gto_library::CRATE_NAME];

/// The one line `solver-query version` prints (the R0.1 smoke test reads it).
#[must_use]
pub fn version_line() -> String {
    format!("{SERVICE_NAME} {VERSION} (links {})", LINKS.join(", "))
}

#[cfg(test)]
mod tests {
    use super::{SERVICE_NAME, VERSION, version_line};

    #[test]
    fn r0_1_version_line_names_the_crate_and_its_links() {
        let line = version_line();
        assert!(line.starts_with(&format!("{SERVICE_NAME} {VERSION} ")), "line was {line}");
        assert!(line.contains("gto-library"), "line was {line}");
        assert!(!line.contains('\n'), "line was {line}");
    }
}
